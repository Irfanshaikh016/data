// Universal Cleaning API (Task 3)
//
// GET  /api/apply_cleaning  → machine-readable command schema.
// POST /api/apply_cleaning  → process Manual and AI cleaning commands through
//   one gateway with snapshot-based state management:
//
//   { "datasetId": "…", "source": "manual"|"ai",
//     "command": { "column": "Salary", "action_category": "missing_values",
//                  "method": "knn", "params": { "k": 5 } } }
//   { …, "commands": [ … ] }   — atomic batch (one undo step)
//   { …, "ops": [ … ] }        — internal op passthrough
//   { "datasetId": "…", "undo": true }
//   { "datasetId": "…", "reset": true }
//
// Every mutation pushes an in-memory dataframe snapshot first (undo stack),
// then returns the updated first-100-rows payload for the UI.

import { NextRequest, NextResponse } from "next/server";
import { COMMANDS_DOC, commandSummary, commandToOps } from "@/lib/commands";
import { applyOpBatch, getSession, resetAll, undoToSnapshot } from "@/lib/store";
import type { Op, UniversalCommand } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  return NextResponse.json(COMMANDS_DOC);
}

export async function POST(req: NextRequest) {
  let body: {
    datasetId?: string;
    source?: string;
    command?: UniversalCommand;
    commands?: UniversalCommand[];
    ops?: Op[];
    undo?: boolean;
    reset?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const sessionId = body.datasetId;
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: 'Missing "datasetId" (id returned by /api/upload).', undoDepth: 0 }, { status: 400 });
  }
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Dataset not found (session may have expired) — please re-upload.", code: "SESSION_EXPIRED", undoDepth: 0 },
      { status: 404 },
    );
  }

  const source = body.source === "ai" ? "ai" : "manual";

  // ---- Undo --------------------------------------------------------------
  if (body.undo) {
    const restored = await undoToSnapshot(session);
    if (!restored) {
      return NextResponse.json(
        { ok: false, error: "Nothing to undo — the snapshot stack is empty.", undoDepth: 0 },
        { status: 400 },
      );
    }
    return NextResponse.json({
      ok: true,
      applied: [],
      restored: restored.note,
      undoDepth: restored.undoDepth,
      recipeLength: session.recipe.length,
      dataset: restored.payload,
    });
  }

  // ---- Reset (snapshotted, so it is itself undoable) ----------------------
  if (body.reset) {
    const { payload, undoDepth } = await resetAll(session);
    return NextResponse.json({ ok: true, applied: ["Reset recipe"], restored: null, undoDepth, recipeLength: 0, dataset: payload });
  }

  // ---- Translate universal command envelope -------------------------------
  let ops: Op[] = [];
  let noteParts: string[] = [];
  try {
    if (Array.isArray(body.command) || Array.isArray(body.commands)) {
      const cmds = (body.commands ?? (body.command as unknown as UniversalCommand[])) as UniversalCommand[];
      for (const c of cmds) {
        ops.push(...commandToOps(c));
        noteParts.push(commandSummary(c));
      }
    } else if (body.command) {
      ops = commandToOps(body.command);
      noteParts = [commandSummary(body.command)];
    } else if (Array.isArray(body.ops) && body.ops.length > 0) {
      ops = body.ops;
      noteParts = ops.map((o) => o.label ?? o.type);
    } else {
      return NextResponse.json(
        { ok: false, error: 'Provide "command", "commands", "ops", "undo": true or "reset": true.' },
        { status: 400 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Invalid command.", undoDepth: session.snapshots.length },
      { status: 400 },
    );
  }

  // ---- Apply (dry-run → snapshot → commit → fresh 100-row payload) --------
  try {
    const note = `${source}: ${noteParts.join(" + ")}`.slice(0, 180);
    const { payload, labels, undoDepth } = await applyOpBatch(session, ops, note);
    return NextResponse.json({
      ok: true,
      applied: labels,
      restored: null,
      undoDepth,
      recipeLength: session.recipe.length,
      dataset: payload,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Command failed.", undoDepth: session.snapshots.length },
      { status: 400 },
    );
  }
}
