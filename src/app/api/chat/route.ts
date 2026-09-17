// POST /api/chat { datasetId?, message } → co-pilot reply + optional
// one-click actions. The engine re-profiles the dataset so advice always
// reflects the current state of the cleaning recipe.

import { NextRequest, NextResponse } from "next/server";
import { chatReply, contextFromPayload } from "@/lib/copilot";
import { getSession, persistChat, resetAll, sessionPayload, undoToSnapshot } from "@/lib/store";
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

    // Goal-aware answers (Task 4): the objective steers the advice.
    if (session.goal && /\b(goal|objective|my (model|project)|aligned?|does this help)\b/.test(low)) {
      const g = session.goal;
      const guidance: Record<string, string> = {
        classification:
          "For classification: keep your target untouched (never impute labels), check class balance before removing anomalies — if the positive class IS the rare event, Isolation Forest will eat your signal — and scale features only after the train/test split.",
        regression:
          "For regression: watch leverage points (cap rather than drop), keep the target unscaled unless you inverse-transform predictions, and prefer KNN imputation so feature correlations survive.",
        clustering:
          "For clustering: scaling is mandatory (k-means is distance-based), high-cardinality categoricals need encoding before they mean anything, and outliers pull centroids hard — remove them deliberately.",
        timeseries:
          "For time series: don't dedupe blindly (repeated readings are legitimate), forward-fill instead of KNN to respect temporal order, and avoid row deletion — it creates gaps in the index.",
        nlp: "For NLP: keep the raw text column intact, normalize case/whitespace only for metadata fields, and remember free text needs embeddings rather than tabular encoding.",
        eda: "For reporting: prioritize readability — avoid scaling (it destroys interpretable units) and prefer explicit 'Unknown' categories over silent row deletion.",
        unknown: "Tell me a bit more about the model you're building and I'll tighten these recommendations.",
      };
      const reply = `Your goal: "${g.raw}"\n${g.summary}\n\n${guidance[g.task] ?? guidance.unknown}\n\nRun “analyze my data” and I'll re-score every suggestion against this objective.`;
      persistChat(body.datasetId ?? null, "user", message);
      persistChat(body.datasetId ?? null, "assistant", reply, []);
      return NextResponse.json({ reply, actions: [] });
    }

    if (/\b(deep learning|autoencoder|transformer|neural net|\bdl\b)\b/.test(low)) {
      const reply =
        "My policy is ML-first: KNN imputation, Isolation Forest and standard scaling handle normal tabular data, and they stay interpretable and cheap. I only raise the Deep Learning question when the data is genuinely complex — extreme dimensionality, unstructured free text/PII, or severe non-linear anomalies — and even then I never run it automatically. Hit “Analyze dataset” and I'll tell you which regime you're in.";
      persistChat(body.datasetId ?? null, "user", message);
      persistChat(body.datasetId ?? null, "assistant", reply, []);
      return NextResponse.json({ reply, actions: [] });
    }

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

  const result = chatReply(message, context);
  persistChat(body.datasetId ?? null, "user", message);
  persistChat(body.datasetId ?? null, "assistant", result.reply, result.actions);
  return NextResponse.json(result);
}
