import { NextRequest, NextResponse } from "next/server";
import { chatReply, contextFromPayload } from "@/lib/copilot";
import { getSession, persistChat, resetAll, sessionPayload, undoToSnapshot } from "@/lib/store";
import { askGemini } from "@/lib/gemini";
import type { CopilotContext } from "@/lib/copilot";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { datasetId?: string | null; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const message = (body.message ?? "").toString().slice(0, 2000);
  if (!message.trim()) {
    return NextResponse.json({ error: "Empty message." }, { status: 400 });
  }

  // AI commands that change state are executed through the same snapshot
  // state layer as the manual tools, and the reply tells the client to re-sync.
  const session = body.datasetId ? await getSession(body.datasetId) : null;
  if (session) {
    const low = message.toLowerCase();

    const wantsUndo = /\b(undo|revert|go back|take (that|it) back)\b/.test(low);
    const wantsReset = /\b(reset|start over|clear (the )?recipe|restore original)\b/.test(low);
    if (wantsUndo || wantsReset) {
      let reply: string;
      if (wantsUndo) {
        const restored = await undoToSnapshot(session);
        reply = restored
          ? `Reverted "${restored.note}" — the dataframe snapshot has been restored (undo depth now ${restored.undoDepth}). Grid re-synced.`
          : "Nothing to undo yet — the snapshot stack is empty. Apply a cleaning step first and I can roll it back.";
      } else {
        const before = session.recipe.length;
        const { undoDepth } = await resetAll(session);
        reply = `Recipe cleared (${before} step${before === 1 ? "" : "s"} removed) — you're back to the raw upload. Don't worry: I snapshotted the previous state, so "undo" brings it right back.`;
      }
      persistChat(body.datasetId ?? null, "user", message);
      persistChat(body.datasetId ?? null, "assistant", reply, []);
      return NextResponse.json({ reply, actions: [], refresh: true });
    }
  }

  let context: CopilotContext | null = null;
  if (session) {
    const payload = await sessionPayload(session); // fresh profile + suggestions
    context = contextFromPayload(payload, session.recipe.length);
  }

  // 1. First attempt conversational response with Google Gemini
  const geminiReply = await askGemini(message, context, session?.goal ?? null);

  // 2. Compute deterministic Copilot suggestion actions & fallback reply
  const copilotResult = chatReply(message, context);

  const finalReply = geminiReply || copilotResult.reply;
  const actions = copilotResult.actions;

  persistChat(body.datasetId ?? null, "user", message);
  persistChat(body.datasetId ?? null, "assistant", finalReply, actions);
  return NextResponse.json({ reply: finalReply, actions });
}
