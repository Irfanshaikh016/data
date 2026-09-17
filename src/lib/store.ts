// Session registry: keeps uploaded datasets (and their Polars DataFrames)
// in memory for fast op replay, mirrored to Postgres so sessions can be
// rehydrated after a server restart.

import fs from "node:fs";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages, datasets, recipeSteps } from "@/db/schema";
import {
  applyRecipe,
  buildProfile,
  duplicateCount,
  headRecords,
  opLabel,
  readCsv,
} from "@/lib/polars-engine";
import { analyzeDataset } from "@/lib/copilot";
import type { DatasetPayload, GoalSpec, Op, PreviewRow } from "@/lib/types";

type DF = ReturnType<typeof readCsv>;

/** In-memory state snapshot taken BEFORE a mutation batch — the undo stack frame. */
export interface SessionSnapshot {
  /** Base frame the recipe replays from (shared reference, not a clone). */
  base: DF;
  /** Recipe as it was before the batch. */
  recipe: Op[];
  /** Materialized copy of the resulting dataframe, kept in memory. */
  df: DF;
  note: string;
  at: number;
}

export interface Session {
  id: string;
  name: string;
  filePath: string;
  isDemo: boolean;
  ingest: { totalRows: number; chunks: number; bytes: number };
  recipe: Op[];
  snapshots: SessionSnapshot[];
  base: DF | null;
  /** The user's stated objective (Task 4 goal box). */
  goal: GoalSpec | null;
  createdAt: number;
  lastAccess: number;
}

const MAX_SESSIONS = 6;

const g = globalThis as unknown as { __hdcpSessions?: Map<string, Session> };
const sessions = (g.__hdcpSessions ??= new Map<string, Session>());

function touch(s: Session): void {
  s.lastAccess = Date.now();
}

function evictIfNeeded(): void {
  const loaded = [...sessions.values()].filter((s) => s.base !== null);
  if (loaded.length <= MAX_SESSIONS) return;
  loaded
    .sort((a, b) => a.lastAccess - b.lastAccess)
    .slice(0, loaded.length - MAX_SESSIONS)
    .forEach((s) => {
      s.base = null; // drop the DataFrame; file stays on disk
    });
}

export function createSession(init: {
  id: string;
  name: string;
  filePath: string;
  isDemo: boolean;
  ingest: Session["ingest"];
  recipe?: Op[];
}): Session {
  const s: Session = {
    id: init.id,
    name: init.name,
    filePath: init.filePath,
    isDemo: init.isDemo,
    ingest: init.ingest,
    recipe: init.recipe ?? [],
    snapshots: [],
    base: null,
    goal: null,
    createdAt: Date.now(),
    lastAccess: Date.now(),
  };
  sessions.set(s.id, s);
  evictIfNeeded();
  return s;
}

export async function getSession(id: string): Promise<Session | null> {
  const mem = sessions.get(id);
  if (mem) {
    touch(mem);
    return mem;
  }
  // Rehydrate from Postgres + the on-disk upload (survives server restarts).
  try {
    const rows = await db.select().from(datasets).where(eq(datasets.id, id)).limit(1);
    const row = rows[0];
    if (!row || !fs.existsSync(row.filePath)) return null;
    let recipe: Op[] = [];
    try {
      const steps = await db
        .select({ op: recipeSteps.op, position: recipeSteps.position })
        .from(recipeSteps)
        .where(eq(recipeSteps.datasetId, id))
        .orderBy(asc(recipeSteps.position));
      recipe = steps.map((s) => s.op as Op);
    } catch {
      recipe = [];
    }
    const s = createSession({
      id: row.id,
      name: row.name,
      filePath: row.filePath,
      isDemo: row.isDemo === 1,
      ingest: { totalRows: row.totalRows, chunks: 0, bytes: row.fileBytes },
      recipe,
    });
    return s;
  } catch {
    return null;
  }
}

export function getBaseDf(s: Session): DF {
  if (!s.base) s.base = readCsv(s.filePath);
  touch(s);
  return s.base;
}

export function currentDf(s: Session): DF {
  return applyRecipe(getBaseDf(s), s.recipe);
}

/** Build the full client payload: preview (first 100 rows) + column profile
 *  + duplicate count + ranked co-pilot suggestions for the CURRENT recipe. */
export async function sessionPayload(s: Session): Promise<DatasetPayload> {
  const df = currentDf(s);
  // Row count reflects the CURRENT cleaned view (drop_row / drop_outliers /
  // dedupe / drop_nulls shrink it); the original ingest size stays in meta.
  const totalRows = df.height;
  const columns = buildProfile(df, totalRows);
  const dupes = duplicateCount(df);
  const suggestions = analyzeDataset(columns, dupes, totalRows);
  const rows: PreviewRow[] = headRecords(df, 100);
  return {
    id: s.id,
    name: s.name,
    totalRows,
    totalCols: df.columns.length,
    chunks: s.ingest.chunks,
    fileBytes: s.ingest.bytes,
    dupes,
    columns,
    rows,
    recipe: s.recipe.map((o) => ({ ...o, label: o.label ?? opLabel(o) })),
    suggestions,
    undoDepth: s.snapshots.length,
    engine: { ingest: "chunked stream · 64 KB blocks", stats: "polars engine" },
  };
}

// ---------------------------------------------------------------------------
// State management — snapshot stack for Undo (Task 3)
// ---------------------------------------------------------------------------

const MAX_SNAPSHOTS = 8;

/** Push an in-memory snapshot of the current dataframe + recipe BEFORE a mutation. */
export function pushSnapshot(s: Session, note: string): void {
  const base = getBaseDf(s);
  s.snapshots.push({ base, recipe: [...s.recipe], df: applyRecipe(base, s.recipe), note, at: Date.now() });
  if (s.snapshots.length > MAX_SNAPSHOTS) s.snapshots.shift();
}

export interface BatchResult {
  payload: DatasetPayload;
  labels: string[];
  undoDepth: number;
}

/** Dry-run, snapshot, commit and persist a batch of ops; returns fresh payload. */
export async function applyOpBatch(s: Session, ops: Op[], note: string): Promise<BatchResult> {
  if (ops.length === 0) {
    return { payload: await sessionPayload(s), labels: [], undoDepth: s.snapshots.length };
  }
  const labeled = ops.map((o) => ({ ...o, label: o.label ?? opLabel(o) }));
  const candidate = [...s.recipe, ...labeled];
  applyRecipe(getBaseDf(s), candidate); // dry-run before committing — throws on invalid ops

  pushSnapshot(s, note);
  const startPos = s.recipe.length;
  s.recipe = candidate;
  labeled.forEach((op, i) => persistStep(s.id, startPos + i, op));

  const payload = await sessionPayload(s);
  return { payload, labels: labeled.map((o) => o.label ?? o.type), undoDepth: s.snapshots.length };
}

/** Restore the most recent snapshot (multi-level up to MAX_SNAPSHOTS). */
export async function undoToSnapshot(s: Session): Promise<{ payload: DatasetPayload; note: string; undoDepth: number } | null> {
  const snap = s.snapshots.pop();
  if (!snap) return null;
  s.base = snap.base; // snap.df is a materialized copy of this same restored state
  s.recipe = snap.recipe;
  touch(s);
  const payload = await sessionPayload(s);
  return { payload, note: snap.note, undoDepth: s.snapshots.length };
}

/** Clear the whole recipe — itself snapshotted, so Reset is undoable too. */
export async function resetAll(s: Session): Promise<{ payload: DatasetPayload; undoDepth: number }> {
  pushSnapshot(s, `reset (cleared ${s.recipe.length} step${s.recipe.length === 1 ? "" : "s"})`);
  s.recipe = [];
  const payload = await sessionPayload(s);
  return { payload, undoDepth: s.snapshots.length };
}

// ---------------------------------------------------------------------------
// Postgres persistence (best-effort: the app stays functional without it)
// ---------------------------------------------------------------------------

export function persistDataset(s: Session, totalCols: number): void {
  db.insert(datasets)
    .values({
      id: s.id,
      name: s.name,
      filePath: s.filePath,
      totalRows: s.ingest.totalRows,
      totalCols,
      fileBytes: s.ingest.bytes,
      isDemo: s.isDemo ? 1 : 0,
    })
    .onConflictDoNothing()
    .catch((e) => console.warn("[db] persistDataset failed:", e?.message ?? e));
}

export function persistStep(datasetId: string, position: number, op: Op): void {
  db.insert(recipeSteps)
    .values({ datasetId, position, op })
    .catch((e) => console.warn("[db] persistStep failed:", e?.message ?? e));
}

export function persistChat(datasetId: string | null, role: string, content: string, actions?: unknown): void {
  db.insert(chatMessages)
    .values({ datasetId, role, content, actions: actions ?? null })
    .catch((e) => console.warn("[db] persistChat failed:", e?.message ?? e));
}
