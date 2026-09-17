// Legacy op endpoints — retained for backward compatibility; they delegate
// to the shared snapshot-based state layer used by /api/apply_cleaning.
// Prefer POST /api/apply_cleaning for new integrations.

import { NextRequest, NextResponse } from "next/server";
import { applyOpBatch, getSession, resetAll, undoToSnapshot } from "@/lib/store";
import { opLabel } from "@/lib/polars-engine";
import type { Op } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json(
      { error: "Dataset not found (session may have expired) — please re-upload.", code: "SESSION_EXPIRED" },
      { status: 404 },
    );
  }

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

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json(
      { error: "Dataset not found (session may have expired) — please re-upload.", code: "SESSION_EXPIRED" },
      { status: 404 },
    );
  }
  const mode = new URL(req.url).searchParams.get("mode") ?? "undo";

  if (mode === "reset") {
    const { payload } = await resetAll(session);
    return NextResponse.json(payload);
  }
  const restored = await undoToSnapshot(session);
  if (!restored) {
    return NextResponse.json({ error: "Nothing to undo — the snapshot stack is empty." }, { status: 400 });
  }
  return NextResponse.json(restored.payload);
}
