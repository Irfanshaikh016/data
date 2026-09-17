// GET /api/datasets/:id — current preview payload (recipe applied).

import { NextResponse } from "next/server";
import { getSession, sessionPayload } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json(
      { error: "Dataset not found (session may have expired) — please re-upload.", code: "SESSION_EXPIRED" },
      { status: 404 },
    );
  }
  const payload = await sessionPayload(session);
  return NextResponse.json(payload);
}
