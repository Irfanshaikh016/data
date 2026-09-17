// GET /api/datasets/:id/export — full cleaned dataset as a CSV download
// (all rows, entire recipe applied — not just the 100-row preview).

import { NextResponse } from "next/server";
import { currentDf, getSession } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json(
      { error: "Dataset not found (session may have expired) — please re-upload.", code: "SESSION_EXPIRED" },
      { status: 404 },
    );
  }
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
