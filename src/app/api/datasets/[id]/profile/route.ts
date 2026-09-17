// GET /api/datasets/:id/profile?column=NAME[&m=1.5]
// Per-column profiler for the Manual Toolbox: missing %, dtype, outlier
// count (IQR method), quartile stats, a histogram for numeric columns and
// top values for text — computed on the CURRENT cleaned view (post-recipe).

import { NextRequest, NextResponse } from "next/server";
import {
  iqrBounds,
  isNumericDtype,
  numericView,
  percentile,
  seriesToArray,
  dtypeOf,
} from "@/lib/polars-engine";
import { currentDf, getSession } from "@/lib/store";
import type { ColumnProfileResponse } from "@/lib/types";

export const runtime = "nodejs";

const SAMPLE = 100_000;
const BINS = 14;

const r4 = (v: number) => Math.round(v * 10000) / 10000;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json(
      { error: "Dataset not found (session may have expired) — please re-upload.", code: "SESSION_EXPIRED" },
      { status: 404 },
    );
  }

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
      { status: 404 },
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
    const mean = finiteAll.reduce((a, b) => a + b, 0) / finiteAll.length;
    const std = Math.sqrt(finiteAll.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(finiteAll.length - 1, 1));
    const q1 = percentile(sorted, 0.25);
    const median = percentile(sorted, 0.5);
    const q3 = percentile(sorted, 0.75);
    const { iqr, lower, upper } = iqrBounds(finiteAll, m);
    stats = { min: r4(min), q1: r4(q1), median: r4(median), q3: r4(q3), max: r4(max), mean: r4(mean), std: r4(std), iqr: r4(iqr) };

    const outCount = finiteAll.filter((v) => v < lower || v > upper).length;
    outliers = {
      count: outCount,
      pct: Math.round((outCount / finiteAll.length) * 1000) / 10,
      lowerBound: r4(lower),
      upperBound: r4(upper),
      multiplier: m,
    };

    if (max > min) {
      const width = (max - min) / BINS;
      const bins = new Array(BINS).fill(0) as number[];
      for (const v of finiteAll) bins[Math.min(BINS - 1, Math.floor((v - min) / width))] += 1;
      histogram = { bins, min: r4(min), max: r4(max) };
    } else {
      histogram = { bins: [finiteAll.length], min: r4(min), max: r4(max) };
    }

    if (outCount > 0) {
      tips.push(`${outCount.toLocaleString()} outlier${outCount === 1 ? "" : "s"} beyond IQR ×${m} [${r4(lower)}, ${r4(upper)}] — use Outliers → Cap (winsorize) or Drop rows.`);
    }
  } else if (!numeric) {
    const counts = new Map<string, number>();
    for (const v of nonNull) {
      let s = String(v);
      if (s.length > 48) s = s.slice(0, 48) + "…";
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    topValues = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([value, count]) => ({ value, count }));
  }

  if (nulls > 0) {
    tips.unshift(
      numeric
        ? `${nullPct}% missing — try Mean/Median fills, or the KNN imputer for value-aware imputation (Missing Values).`
        : `${nullPct}% missing — fill with the mode or a custom value, or drop the rows (Missing Values).`,
    );
  }
  if (coerced) tips.push(`Stored as text but ≥90% of values parse as numbers — Column ops → Cast unlocks math & outlier tools.`);
  if (whitespace > 0) tips.push(`${whitespace.toLocaleString()} values have stray whitespace — Trim is in the toolbar.`);
  if (caseCollisions >= 2) tips.push(`${caseCollisions} case collisions (e.g. "Paris" vs "paris") — Normalize case merges them.`);
  if (tips.length === 0) tips.push("Healthy column — no missing values, no outlier or text-hygiene issues detected.");

  const body: ColumnProfileResponse = {
    column,
    dtype,
    totalRows,
    nulls,
    nullPct,
    unique,
    sample,
    numeric,
    coerced,
    stats: stats && { ...stats, iqr: r4(stats.iqr) },
    outliers,
    histogram,
    topValues,
    whitespace,
    caseCollisions,
    sampled,
    tips,
  };
  return NextResponse.json(body);
}
