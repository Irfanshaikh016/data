import { NextRequest, NextResponse } from "next/server";
import {
  applyOpBatch,
  currentDf,
  getSession,
  resetAll,
  sessionPayload,
  undoToSnapshot,
} from "@/lib/store";
import {
  dtypeOf,
  iqrBounds,
  isNumericDtype,
  numericView,
  opLabel,
  percentile,
  seriesToArray,
} from "@/lib/polars-engine";
import { parseGoal } from "@/lib/ml-advisor";
import type { ColumnProfileResponse, Op } from "@/lib/types";

export const runtime = "nodejs";

const SAMPLE = 100_000;
const BINS = 14;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string[] }> }
) {
  const { slug } = await ctx.params;
  const [id, action] = slug ?? [];

  if (!id) {
    return NextResponse.json({ error: "Missing dataset id" }, { status: 400 });
  }

  const session = await getSession(id);
  if (!session) {
    return NextResponse.json(
      { error: "Dataset not found (session may have expired) — please re-upload.", code: "SESSION_EXPIRED" },
      { status: 404 }
    );
  }

  // 1. /api/datasets/:id
  if (!action) {
    const payload = await sessionPayload(session);
    return NextResponse.json(payload);
  }

  // 2. /api/datasets/:id/export
  if (action === "export") {
    try {
      const df = currentDf(session);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const csv = String((df as any).writeCSV());
      const base = session.name.replace(/\.[^.]+$/, "").replace(/[^\w.\-]+/g, "_") || "dataset";
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="cleaned-${base}.csv"`,
          "x-cleaning-steps": String(session.recipe.length),
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Export failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // 3. /api/datasets/:id/profile?column=NAME
  if (action === "profile") {
    const url = new URL(req.url);
    const column = url.searchParams.get("column");
    if (!column) {
      return NextResponse.json({ error: "Provide ?column=NAME" }, { status: 400 });
    }
    const m = Math.min(20, Math.max(0.1, Number(url.searchParams.get("m")) || 1.5));

    const df = currentDf(session);
    const cols: string[] = df.columns;
    if (!cols.includes(column)) {
      return NextResponse.json(
        { error: `Column "${column}" no longer exists — it may have been dropped or renamed.` },
        { status: 404 }
      );
    }

    const dtype = dtypeOf(df, column);
    const totalRows = df.height;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nullRow = (((df as any).select([column]).nullCount() as any).toRecords?.()[0] ?? {}) as Record<string, number>;
    const nulls = Number(nullRow[column] ?? 0);
    const nullPct = totalRows > 0 ? Math.round((nulls / totalRows) * 1000) / 10 : 0;

    const raw = seriesToArray(df, column);
    const sampled = raw.length > SAMPLE;
    const view = sampled ? raw.slice(0, SAMPLE) : raw;
    const nonNull = view.filter((v) => v !== null && v !== undefined && v !== "");
    const unique = new Set(nonNull.map((v) => String(v))).size;
    const sample: string[] = [];
    for (const v of nonNull) {
      const s = String(v);
      if (!sample.includes(s)) sample.push(s.length > 42 ? s.slice(0, 42) + "…" : s);
      if (sample.length >= 3) break;
    }

    const { nums, ratio } = numericView(df, column);
    const numeric = isNumericDtype(dtype) || ratio >= 0.9;
    const coerced = numeric && !isNumericDtype(dtype);

    let whitespace = 0;
    let caseCollisions = 0;
    if (!isNumericDtype(dtype)) {
      const lowerSeen = new Map<string, string>();
      for (const v of nonNull) {
        const s = String(v);
        const t = s.trim();
        if (t !== s) whitespace += 1;
        const low = t.toLowerCase();
        const prev = lowerSeen.get(low);
        if (prev && prev !== t) caseCollisions += 1;
        else lowerSeen.set(low, t);
      }
    }

    const tips: string[] = [];
    let stats: ColumnProfileResponse["stats"];
    let outliers: ColumnProfileResponse["outliers"];
    let histogram: ColumnProfileResponse["histogram"];
    let topValues: ColumnProfileResponse["topValues"];

    const finiteAll = (sampled ? nums.slice(0, SAMPLE) : nums).filter((n): n is number => n !== null);

    if (numeric && finiteAll.length > 0) {
      const sorted = [...finiteAll].sort((a, b) => a - b);
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      const q1 = percentile(sorted, 0.25);
      const median = percentile(sorted, 0.5);
      const q3 = percentile(sorted, 0.75);
      const iqr = q3 - q1;
      const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(sorted.length - 1, 1);
      const std = Math.sqrt(variance);

      stats = { min: r4(min), q1: r4(q1), median: r4(median), q3: r4(q3), max: r4(max), mean: r4(mean), std: r4(std), iqr: r4(iqr) };

      const b = iqrBounds(sorted, m);
      const outside = sorted.filter((v) => v < b.lower || v > b.upper);
      outliers = {
        count: outside.length,
        pct: Math.round((outside.length / sorted.length) * 1000) / 10,
        lowerBound: r4(b.lower),
        upperBound: r4(b.upper),
        multiplier: m,
      };

      if (max > min) {
        const bins = new Array(BINS).fill(0);
        const step = (max - min) / BINS;
        for (const v of sorted) {
          const idx = Math.min(BINS - 1, Math.max(0, Math.floor((v - min) / step)));
          bins[idx] += 1;
        }
        histogram = { bins, min: r4(min), max: r4(max) };
      }
    } else {
      const counts = new Map<string, number>();
      for (const v of nonNull) {
        const s = String(v);
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
      topValues = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([value, count]) => ({ value, count }));
    }

    if (nullPct > 20) tips.push(`${nullPct}% nulls — consider dropping or imputing.`);
    else if (nullPct > 0) tips.push(`${nullPct}% nulls — safe to impute.`);
    if (outliers && outliers.count > 0) tips.push(`${outliers.count} outlier rows outside ${m}× IQR.`);
    if (whitespace > 0) tips.push(`${whitespace} string values have leading/trailing whitespace.`);
    if (caseCollisions > 0) tips.push(`${caseCollisions} values differ only by casing.`);
    if (coerced) tips.push(`Parsed as numeric (${Math.round(ratio * 100)}% match) — safe to cast to Float64.`);

    return NextResponse.json({
      column,
      dtype,
      totalRows,
      nulls,
      nullPct,
      unique,
      sample,
      numeric,
      coerced,
      stats,
      outliers,
      histogram,
      topValues,
      whitespace,
      caseCollisions,
      sampled,
      tips,
    });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 404 });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string[] }> }
) {
  const { slug } = await ctx.params;
  const [id, action] = slug ?? [];

  if (!id) {
    return NextResponse.json({ error: "Missing dataset id" }, { status: 400 });
  }

  const session = await getSession(id);
  if (!session) {
    return NextResponse.json(
      { error: "Dataset not found (session may have expired) — please re-upload.", code: "SESSION_EXPIRED" },
      { status: 404 }
    );
  }

  // 1. /api/datasets/:id/goal
  if (action === "goal") {
    let body: { goal?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    const raw = (body.goal ?? "").toString().slice(0, 500).trim();
    if (!raw) {
      session.goal = null;
      return NextResponse.json({ ok: true, goal: null });
    }
    const df = currentDf(session);
    session.goal = parseGoal(raw, df.columns);
    return NextResponse.json({ ok: true, goal: session.goal });
  }

  // 2. /api/datasets/:id/ops
  if (action === "ops") {
    let body: { op?: Op; ops?: Op[] };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    const incoming = (body.ops ?? (body.op ? [body.op] : [])).filter(Boolean);
    if (incoming.length === 0) {
      return NextResponse.json({ error: "Provide `op` or `ops`." }, { status: 400 });
    }
    try {
      const note = `manual: ${incoming.map((o) => o.label ?? opLabel(o)).join(" + ")}`.slice(0, 180);
      const { payload } = await applyOpBatch(session, incoming, note);
      return NextResponse.json(payload);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Operation failed" }, { status: 400 });
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 404 });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string[] }> }
) {
  const { slug } = await ctx.params;
  const [id, action] = slug ?? [];

  if (!id) {
    return NextResponse.json({ error: "Missing dataset id" }, { status: 400 });
  }

  const session = await getSession(id);
  if (!session) {
    return NextResponse.json(
      { error: "Dataset not found (session may have expired) — please re-upload.", code: "SESSION_EXPIRED" },
      { status: 404 }
    );
  }

  if (action === "ops") {
    const url = new URL(req.url);
    if (url.searchParams.get("all") === "true") {
      const { payload } = await resetAll(session);
      return NextResponse.json(payload);
    }
    const restored = await undoToSnapshot(session);
    if (!restored) {
      return NextResponse.json({ error: "Nothing to undo" }, { status: 400 });
    }
    return NextResponse.json(restored.payload);
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 404 });
}
