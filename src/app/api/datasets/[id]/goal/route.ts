// POST /api/datasets/:id/goal — record the data scientist's objective so
// every subsequent suggestion can be aligned to it (Task 4 Goal Input Box).

import { NextRequest, NextResponse } from "next/server";
import { parseGoal } from "@/lib/ml-advisor";
import { currentDf, getSession } from "@/lib/store";

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
