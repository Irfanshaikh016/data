// POST /api/analyze_all — profile the ENTIRE dataset and return suggested
// actions using the ML-First policy.
//
//   Rule A: default to traditional ML / statistical methods (KNN Imputer,
//           Isolation Forest, StandardScaler, median/mode imputation…).
//   Rule B: if the data is highly complex (extreme dimensionality,
//           unstructured text/PII, severe non-linear anomalies), DO NOT run
//           Deep Learning — return a warning proposal that the data scientist
//           must explicitly approve.
//
// Body: { datasetId: string, goal?: string }
// Every returned proposal carries the ops that /api/apply_cleaning will run
// on Approve, plus goal-alignment notes and warnings.

import { NextRequest, NextResponse } from "next/server";
import {
  buildDeepLearningWarning,
  buildProposals,
  detectComplexity,
  parseGoal,
} from "@/lib/ml-advisor";
import {
  buildProfile,
  duplicateCount,
  dtypeOf,
  isNumericDtype,
  isolationForest,
  numericMatrix,
} from "@/lib/polars-engine";
import { currentDf, getSession } from "@/lib/store";
import type { AnalyzeAllResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: { datasetId?: string; goal?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.datasetId) {
    return NextResponse.json({ error: 'Missing "datasetId".' }, { status: 400 });
  }
  const session = await getSession(body.datasetId);
  if (!session) {
    return NextResponse.json(
      { error: "Dataset not found (session may have expired) — please re-upload.", code: "SESSION_EXPIRED" },
      { status: 404 },
    );
  }

  const df = currentDf(session);
  const rows = df.height;
  const allCols: string[] = df.columns;
  const columns = buildProfile(df, rows);
  const dupes = duplicateCount(df);

  // Goal: use the freshly supplied text, else whatever the session remembers.
  if (typeof body.goal === "string" && body.goal.trim()) {
    session.goal = parseGoal(body.goal, allCols);
  }
  const goal = session.goal;

  const numericCols = allCols.filter((c) => isNumericDtype(dtypeOf(df, c)));

  // --- Isolation Forest pre-scan (Rule A tool + Rule B signal) ------------
  let anomalyRate = 0;
  let anomalyCount = 0;
  if (numericCols.length >= 2 && rows >= 50 && rows <= 200000) {
    try {
      const { matrix } = numericMatrix(df, numericCols);
      // Score with a neutral contamination, then measure how many rows sit in
      // the clearly-anomalous band — that rate feeds the complexity check.
      const { scores } = isolationForest(matrix, 0.05);
      const flagged = scores.filter((s) => s >= 0.62).length;
      anomalyCount = flagged;
      anomalyRate = flagged / rows;
    } catch {
      anomalyRate = 0;
      anomalyCount = 0;
    }
  }

  const complexity = detectComplexity(columns, rows, anomalyRate);

  const proposals = buildProposals({
    columns,
    rows,
    dupes,
    goal,
    anomalyRate,
    anomalyCount,
    numericCols,
  });

  // Rule B — warn, never auto-run.
  const deepLearningWarning = complexity.complex ? buildDeepLearningWarning(complexity.signals, goal) : null;

  const totalCells = rows * columns.length;
  const missingCells = columns.reduce((a, c) => a + c.nulls, 0);
  const missingPct = totalCells > 0 ? Math.round((missingCells / totalCells) * 1000) / 10 : 0;
  const textCols = columns.length - numericCols.length;

  const headline = deepLearningWarning
    ? `Full profile complete — ${rows.toLocaleString()} rows × ${columns.length} columns. I have ${proposals.length} ML-first cleaning step${proposals.length === 1 ? "" : "s"} ready, but this dataset also tripped my complexity checks.`
    : proposals.length === 0
      ? `Full profile complete — ${rows.toLocaleString()} rows × ${columns.length} columns. Everything checks out: no duplicates, no null hotspots, sane dtypes. Nothing to approve.`
      : `Full profile complete — ${rows.toLocaleString()} rows × ${columns.length} columns, ${missingPct}% cells missing, ${dupes.toLocaleString()} duplicates. Standard ML methods are a good fit here, so I've prepared ${proposals.length} step${proposals.length === 1 ? "" : "s"}${goal ? " aligned to your goal" : ""}. Approve the ones you want.`;

  const payload: AnalyzeAllResponse = {
    datasetId: session.id,
    goal,
    headline,
    proposals,
    deepLearningWarning,
    complexity,
    dataset: {
      rows,
      cols: columns.length,
      numericCols: numericCols.length,
      textCols,
      dupes,
      missingPct,
    },
  };
  return NextResponse.json(payload);
}
