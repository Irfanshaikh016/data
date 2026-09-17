// Polars-backed data engine: profiling, cleaning ops, preview building,
// CSV export and demo-data generation. Everything DataFrame-shaped lives here.

import pl from "nodejs-polars";
import fs from "node:fs";
import path from "node:path";
import type { CellValue, ColumnProfile, Op, PreviewRow } from "@/lib/types";
import { isNullToken } from "@/lib/csv-stream";

// nodejs-polars bundles a native binary; its public typings lag the runtime,
// so we derive the DataFrame type and stay pragmatic at the edges.
type DF = ReturnType<typeof pl.readCSV>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyPl = pl as any;

export const READ_OPTS = {
  nullValues: ["", "NA", "N/A", "na", "null", "NULL", "None", "NaN"],
  ignoreErrors: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

export const UPLOAD_DIR = path.join(process.cwd(), ".data", "uploads");
export const PREVIEW_LIMIT = 100;
const SAMPLE_LIMIT = 2000; // rows scanned in JS for pattern profiling

export function ensureUploadDir(): void {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export function readCsv(filePath: string): DF {
  return pl.readCSV(filePath, READ_OPTS);
}

// ---------------------------------------------------------------------------
// Dtype + value helpers
// ---------------------------------------------------------------------------

export function dtypeOf(df: DF, col: string): string {
  try {
    // nodejs-polars represents dtypes as class instances whose CONSTRUCTOR
    // NAME is the dtype ("String", "Int64", …). Fall back through the other
    // two shapes the bindings have exposed across versions.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schema = (df as any).schema as Record<string, any>;
    const v = schema?.[col];
    if (!v) return "Unknown";
    const ctor = v.constructor?.name;
    if (typeof ctor === "string" && ctor !== "" && ctor !== "Object") return ctor;
    if (typeof v.DataType === "string") return v.DataType;
    const m = /DataType\(([\w]+)\)/.exec(String(v));
    return m?.[1] ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

export function isNumericDtype(dtype: string): boolean {
  return /^(Int|UInt|Float|Decimal)/.test(dtype);
}

/** Extract a full column as a JS array (numbers/strings/booleans/null). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function seriesToArray(df: DF, col: string): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((df as any).getColumn(col).toArray() as any[]) ?? [];
}

/** Coerce a cell to a finite number if it reasonably parses (strips $ , %). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toNumeric(v: any): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    const t = v.trim().replace(/[$,€£%\s]/g, "");
    if (t !== "" && /^-?\d+(\.\d+)?$/.test(t)) {
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

/** Numeric view of a column + the share of non-null values that parsed. */
export function numericView(df: DF, col: string): { nums: (number | null)[]; ratio: number } {
  const raw = seriesToArray(df, col);
  const nums = raw.map((v) => toNumeric(v)) as (number | null)[];
  const nonNull = raw.filter((v) => v !== null && v !== undefined && v !== "").length;
  const parsed = nums.filter((n) => n !== null).length;
  return { nums, ratio: nonNull > 0 ? parsed / nonNull : 0 };
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Replace one column's values wholesale, preserving column order. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function replaceColumn(df: DF, name: string, values: any[]): DF {
  const oneCol = anyPl.readRecords(values.map((v) => ({ [name]: v })));
  const joined = anyPl.concat([df.drop(name), oneCol], { how: "horizontal" });
  return joined.select(df.columns);
}

/** Keep rows where mask[i] is true (adds/removes a temp helper column). */
export function filterByMask(df: DF, mask: boolean[]): DF {
  const TMP = "__keep__";
  const flags = anyPl.readRecords(mask.map((m) => ({ [TMP]: m ? 1 : 0 })));
  const joined = anyPl.concat([df, flags], { how: "horizontal" });
  return joined.filter(col(TMP).eq(1)).drop(TMP).select(df.columns);
}

/** Deterministic PRNG so recipe replay always reproduces ML results. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const avgPathLength = (n: number): number =>
  n <= 1 ? 0 : 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1)) / n;

interface ITNode {
  feat?: number;
  split?: number;
  left?: ITNode;
  right?: ITNode;
  size: number;
  depth: number;
}

function buildTree(rows: number[][], idx: number[], depth: number, maxDepth: number, rnd: () => number): ITNode {
  if (depth >= maxDepth || idx.length <= 1) return { size: idx.length, depth };
  const nFeat = rows[0]?.length ?? 0;
  if (nFeat === 0) return { size: idx.length, depth };
  const feat = Math.floor(rnd() * nFeat);
  let min = Infinity;
  let max = -Infinity;
  for (const i of idx) {
    const v = rows[i][feat];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || min === max) return { size: idx.length, depth };
  const split = min + rnd() * (max - min);
  const left: number[] = [];
  const right: number[] = [];
  for (const i of idx) (rows[i][feat] < split ? left : right).push(i);
  if (left.length === 0 || right.length === 0) return { size: idx.length, depth };
  return {
    feat,
    split,
    size: idx.length,
    depth,
    left: buildTree(rows, left, depth + 1, maxDepth, rnd),
    right: buildTree(rows, right, depth + 1, maxDepth, rnd),
  };
}

function pathLength(node: ITNode, row: number[]): number {
  let cur = node;
  let len = 0;
  while (cur.feat !== undefined && cur.left && cur.right) {
    len += 1;
    cur = row[cur.feat] < cur.split! ? cur.left : cur.right;
  }
  return len + avgPathLength(cur.size);
}

export interface IForestResult {
  scores: number[];
  flags: boolean[];
  threshold: number;
  features: string[];
}

/**
 * Isolation Forest (Liu et al.) — unsupervised multivariate anomaly detection.
 * Deterministic: fixed seed + fixed subsample order, so replaying a recipe
 * always produces the same rows.
 */
export function isolationForest(
  matrix: number[][],
  contamination: number,
  opts: { trees?: number; sampleSize?: number; seed?: number } = {},
): { scores: number[]; flags: boolean[]; threshold: number } {
  const n = matrix.length;
  const trees = opts.trees ?? 100;
  const sampleSize = Math.min(opts.sampleSize ?? 256, n);
  const rnd = seeded(opts.seed ?? 42);
  const maxDepth = Math.ceil(Math.log2(Math.max(sampleSize, 2)));
  const c = avgPathLength(sampleSize);

  const forest: ITNode[] = [];
  for (let t = 0; t < trees; t++) {
    const idx: number[] = [];
    for (let i = 0; i < sampleSize; i++) idx.push(Math.floor(rnd() * n));
    forest.push(buildTree(matrix, idx, 0, maxDepth, rnd));
  }

  const scores = matrix.map((row) => {
    let sum = 0;
    for (const tree of forest) sum += pathLength(tree, row);
    return Math.pow(2, -(sum / forest.length) / (c || 1));
  });

  const sorted = [...scores].sort((a, b) => b - a);
  const k = Math.max(1, Math.floor(n * contamination));
  const threshold = sorted[Math.min(k, sorted.length) - 1];
  return { scores, flags: scores.map((s) => s >= threshold), threshold };
}

/** Build a dense numeric matrix (median-imputed) for multivariate ML ops. */
export function numericMatrix(df: DF, features: string[]): { matrix: number[][]; used: string[] } {
  const used = features.filter((f) => df.columns.includes(f));
  const cols = used.map((f) => numericView(df, f).nums);
  const medians = cols.map((arr) => {
    const vals = arr.filter((v): v is number => v !== null).sort((a, b) => a - b);
    return vals.length ? percentile(vals, 0.5) : 0;
  });
  // z-score so no single wide-range feature dominates the splits
  const stats = cols.map((arr, j) => {
    const vals = arr.map((v) => v ?? medians[j]);
    const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(vals.length - 1, 1)) || 1;
    return { mean, std };
  });
  const rows = df.height;
  const matrix: number[][] = [];
  for (let i = 0; i < rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < used.length; j++) {
      const v = cols[j][i] ?? medians[j];
      row.push((v - stats[j].mean) / stats[j].std);
    }
    matrix.push(row);
  }
  return { matrix, used };
}

export interface IqrBounds {
  q1: number;
  q3: number;
  iqr: number;
  lower: number;
  upper: number;
}

export function iqrBounds(nums: number[], multiplier: number): IqrBounds {
  const sorted = [...nums].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  return { q1, q3, iqr, lower: q1 - multiplier * iqr, upper: q3 + multiplier * iqr };
}

/** Coerce a raw string cell (from the chunked reader) into a display value
 *  using the dtype Polars inferred. */
export function coerceCell(raw: string | undefined, dtype: string): CellValue {
  if (raw === undefined || isNullToken(raw)) return null;
  const v = raw.trim();
  if (isNumericDtype(dtype)) {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) && v !== "" && /^-?[\d.,]+$/.test(v) ? n : raw;
  }
  if (dtype === "Boolean") {
    const l = v.toLowerCase();
    if (l === "true") return true;
    if (l === "false") return false;
    return raw;
  }
  return raw;
}

/** Normalize a Polars-typed value into a JSON-safe cell. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeCell(v: any): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isInteger(v) ? v : Number(v.toFixed(6));
  if (typeof v === "string" || typeof v === "boolean") return v;
  return String(v);
}

export function headRecords(df: DF, n = PREVIEW_LIMIT): PreviewRow[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recs = (df.head(n) as any).toRecords() as Record<string, unknown>[];
  return recs.map((r) => {
    const out: PreviewRow = {};
    for (const k of Object.keys(r)) out[k] = normalizeCell(r[k]);
    return out;
  });
}

// ---------------------------------------------------------------------------
// Profiling
// ---------------------------------------------------------------------------

export function buildProfile(df: DF, totalRows: number): ColumnProfile[] {
  const cols: string[] = df.columns;
  const height = df.height;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nullRow = ((df.nullCount() as any).toRecords?.()[0] ?? {}) as Record<string, number>;
  const sample = headRecords(df.head(Math.min(SAMPLE_LIMIT, height)), SAMPLE_LIMIT);

  return cols.map((name) => {
    const dtype = dtypeOf(df, name);
    const nulls = Number(nullRow?.[name] ?? 0);
    const values: CellValue[] = sample.map((r) => r[name]);
    const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");

    const uniq = new Set<string>();
    let numeric = 0;
    let integerLike = 0;
    let whitespace = 0;
    const lowerSeen = new Map<string, string>();
    let caseCollisions = 0;
    const displaySample: string[] = [];

    for (const v of nonNull) {
      const s = String(v);
      if (uniq.size < 5000) uniq.add(s);
      if (displaySample.length < 3 && !displaySample.includes(s)) displaySample.push(s);
      if (dtype === "String") {
        const t = s.trim();
        if (t !== s) whitespace += 1;
        if (t !== "" && isNullToken(t) === false && /^-?[\d.,]+%?$/.test(t) && Number.isFinite(Number(t.replace(/,/g, "")))) {
          numeric += 1;
          if (/^-?\d+$/.test(t.replace(/,/g, ""))) integerLike += 1;
        }
        const low = t.toLowerCase();
        const prev = lowerSeen.get(low);
        if (prev && prev !== t) caseCollisions += 1;
        else lowerSeen.set(low, t);
      }
    }

    const strCount = nonNull.length || 1;
    return {
      name,
      dtype,
      nulls,
      nullPct: totalRows > 0 ? Math.round((nulls / totalRows) * 1000) / 10 : 0,
      unique: uniq.size,
      sample: displaySample,
      numericLike: dtype === "String" ? Math.round((numeric / strCount) * 100) / 100 : 0,
      whitespace,
      caseCollisions,
    };
  });
}

export function duplicateCount(df: DF): number {
  try {
    return df.height - df.unique().height;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Cleaning ops — each takes a DataFrame and returns a NEW DataFrame
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function col(name: string): any {
  return pl.col(name);
}

export function applyOp(df: DF, op: Op): DF {
  const c = op.column;
  switch (op.type) {
    case "drop_duplicates":
      return df.unique();

    case "drop_nulls":
      return c ? df.dropNulls([c]) : df.dropNulls();

    case "drop_column":
      if (!c) throw new Error("drop_column requires a column");
      return df.drop(c);

    case "rename_column": {
      if (!c || !op.to) throw new Error("rename_column requires column + to");
      const target = op.to.trim();
      if (!target) throw new Error("New column name cannot be empty");
      if (df.columns.includes(target)) throw new Error(`Column "${target}" already exists`);
      return df.rename({ [c]: target });
    }

    case "cast": {
      if (!c || !op.to) throw new Error("cast requires column + to");
      const dt = anyPl[op.to];
      if (!dt) throw new Error(`Unsupported dtype "${op.to}"`);
      return df.withColumn(col(c).cast(dt, false).alias(c));
    }

    case "trim": {
      const targets = c ? [c] : df.columns.filter((k: string) => dtypeOf(df, k) === "String");
      let out = df;
      for (const t of targets) out = out.withColumn(col(t).str.stripChars().alias(t));
      return out;
    }

    case "normalize_case": {
      if (!c) throw new Error("normalize_case requires a column");
      const expr = op.mode === "upper" ? col(c).str.toUpperCase() : col(c).str.toLowerCase();
      return df.withColumn(expr.alias(c));
    }

    case "fill_null": {
      if (!c) throw new Error("fill_null requires a column");
      const dtype = dtypeOf(df, c);
      let expr;
      switch (op.strategy ?? "constant") {
        case "mean":
          expr = col(c).fillNull(col(c).mean());
          break;
        case "median":
          expr = col(c).fillNull(col(c).median());
          break;
        case "mode":
          expr = col(c).fillNull(col(c).mode().first());
          break;
        case "forward":
          expr = col(c).forwardFill();
          break;
        case "constant": {
          const raw = op.value ?? "";
          const asNum = Number(raw);
          const lit = isNumericDtype(dtype) && raw.trim() !== "" && Number.isFinite(asNum)
            ? anyPl.lit(asNum)
            : anyPl.lit(raw);
          expr = col(c).fillNull(lit);
          break;
        }
        default:
          throw new Error(`Unknown fill strategy "${op.strategy}"`);
      }
      return df.withColumn(expr.alias(c));
    }

    case "knn_impute": {
      if (!c) throw new Error("knn_impute requires a column");
      const k = Math.min(25, Math.max(1, Math.round(op.k ?? 5)));
      const n = df.height;
      if (n > 20000) throw new Error(`KNN imputation is capped at 20k rows in this workspace (this dataset has ${n.toLocaleString()}). Try median/mode instead.`);

      const { nums: target } = numericView(df, c);
      const present = target.filter((v): v is number => v !== null);
      if (present.length === 0) throw new Error(`KNN imputation needs some numeric values in "${c}" to learn from.`);
      const missingIdx = target.flatMap((v, i) => (v === null ? [i] : []));
      if (missingIdx.length === 0) return df; // nothing to do

      // Other numeric columns act as feature space.
      const feats = df.columns
        .filter((k2: string) => k2 !== c && isNumericDtype(dtypeOf(df, k2)))
        .slice(0, 8);
      if (feats.length === 0 || n < k + 1) {
        // Not enough structure — degrade gracefully to median imputation.
        return applyOp(df, { type: "fill_null", column: c, strategy: "median" });
      }

      // Standardize features (z-score); missing feature values count as 0 distance contribution.
      const featArrs = feats.map((f: string) => numericView(df, f).nums);
      const stats = featArrs.map((arr) => {
        const vals = arr.filter((v): v is number => v !== null);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(vals.length - 1, 1);
        return { mean, std: Math.sqrt(variance) || 1 };
      });
      const z = (row: number, f: number): number | null => {
        const v = featArrs[f][row];
        return v === null ? null : (v - stats[f].mean) / stats[f].std;
      };
      const zCache = new Map<number, number | null>();
      const zc = (row: number, f: number): number | null => {
        const key = row * 31 + f;
        if (!zCache.has(key)) zCache.set(key, z(row, f));
        return zCache.get(key) ?? null;
      };

      const imputed = [...target];
      const presentIdx = target.flatMap((v, i) => (v !== null ? [i] : []));
      for (const i of missingIdx) {
        // distance to every row with a known target value
        const dists: { d: number; v: number }[] = [];
        for (const j of presentIdx) {
          let sum = 0;
          let dims = 0;
          for (let f = 0; f < feats.length; f++) {
            const zi = zc(i, f);
            const zj = zc(j, f);
            if (zi !== null && zj !== null) {
              sum += (zi - zj) ** 2;
              dims += 1;
            }
          }
          if (dims > 0 || feats.length === 0) dists.push({ d: Math.sqrt(sum / Math.max(dims, 1)), v: target[j] as number });
        }
        dists.sort((a, b) => a.d - b.d);
        const neighbors = dists.slice(0, k);
        if (neighbors.length > 0) {
          imputed[i] = neighbors.reduce((a, b) => a + b.v, 0) / neighbors.length;
        }
      }

      // Replace the column: rebuild it via readRecords + horizontal concat,
      // then restore the original column order.
      const oneCol = anyPl.readRecords(imputed.map((v) => ({ [c]: v })));
      const joined = anyPl.concat([df.drop(c), oneCol], { how: "horizontal" });
      return joined.select(df.columns);
    }

    case "cap_outliers":
    case "drop_outliers": {
      if (!c) throw new Error(`${op.type} requires a column`);
      const dtype = dtypeOf(df, c);
      if (!isNumericDtype(dtype)) {
        throw new Error(`Outlier ops need a numeric column — "${c}" is ${dtype}. Cast it to Float64 first (Column ops → Cast).`);
      }
      const m = Math.min(20, Math.max(0.1, op.multiplier ?? 1.5));
      const { nums } = numericView(df, c);
      const vals = nums.filter((v): v is number => v !== null);
      if (vals.length < 4) throw new Error(`Not enough numeric values in "${c}" to compute quartiles.`);
      const intCol = /^U?Int/.test(dtype);
      let { lower, upper } = iqrBounds(vals, m);
      if (intCol) {
        // Keep integer dtypes intact: clamp with integer bounds.
        lower = Math.ceil(lower);
        upper = Math.floor(upper);
      }
      if (op.type === "cap_outliers") {
        // Winsorize: clamp everything outside [lower, upper] to the bounds.
        const expr = pl
          .when(col(c).gt(anyPl.lit(upper)))
          .then(anyPl.lit(upper))
          .otherwise(pl.when(col(c).lt(anyPl.lit(lower))).then(anyPl.lit(lower)).otherwise(col(c)))
          .alias(c);
        return df.withColumn(expr);
      }
      // Drop rows outside the bounds; rows with nulls are kept.
      const keep = col(c).gtEq(lower).and(col(c).ltEq(upper)).or(col(c).isNull());
      return df.filter(keep);
    }

    case "iforest_outliers": {
      // Rule A workhorse: multivariate anomaly detection across numeric columns.
      const contamination = Math.min(0.4, Math.max(0.001, op.contamination ?? 0.05));
      const feats = (op.features?.length ? op.features : df.columns.filter((k: string) => isNumericDtype(dtypeOf(df, k)))).filter(
        (f: string) => df.columns.includes(f),
      );
      if (feats.length === 0) {
        throw new Error("Isolation Forest needs at least one numeric column — cast your numeric-looking text columns first.");
      }
      if (df.height < 20) throw new Error("Isolation Forest needs at least 20 rows to be meaningful.");
      if (df.height > 200000) throw new Error("Isolation Forest is capped at 200k rows in this workspace.");
      const { matrix } = numericMatrix(df, feats);
      const { flags } = isolationForest(matrix, contamination);
      return filterByMask(df, flags.map((f) => !f)); // drop anomalies
    }

    case "scale": {
      if (!c) throw new Error("scale requires a column");
      const dtype = dtypeOf(df, c);
      if (!isNumericDtype(dtype)) {
        throw new Error(`Scaling needs a numeric column — "${c}" is ${dtype}. Cast it first.`);
      }
      const { nums } = numericView(df, c);
      const vals = nums.filter((v): v is number => v !== null);
      if (vals.length === 0) throw new Error(`No numeric values in "${c}" to scale.`);
      let out: (number | null)[];
      if (op.scaler === "minmax") {
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const range = max - min || 1;
        out = nums.map((v) => (v === null ? null : Math.round(((v - min) / range) * 1e6) / 1e6));
      } else {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(vals.length - 1, 1)) || 1;
        out = nums.map((v) => (v === null ? null : Math.round(((v - mean) / std) * 1e6) / 1e6));
      }
      return replaceColumn(df, c, out);
    }

    case "drop_row": {
      const idx = op.index;
      if (idx === undefined || !Number.isInteger(idx)) throw new Error("drop_row requires a row index");
      if (idx < 0 || idx >= df.height) {
        throw new Error(`Row #${idx + 1} is out of range — the dataset has ${df.height.toLocaleString()} rows right now.`);
      }
      return df.filter(anyPl.intRange(0, df.height).neq(idx));
    }

    default:
      throw new Error(`Unsupported op "${(op as Op).type}"`);
  }
}

export function applyRecipe(base: DF, recipe: Op[]): DF {
  let df = base;
  for (const op of recipe) df = applyOp(df, op);
  return df;
}

export function opLabel(op: Op): string {
  const on = op.column ? ` on ${op.column}` : "";
  switch (op.type) {
    case "drop_duplicates": return "Drop duplicate rows";
    case "drop_nulls": return `Drop null rows${on}`;
    case "drop_column": return `Drop column${on}`;
    case "rename_column": return `Rename ${op.column} → ${op.to}`;
    case "cast": return `Cast ${op.column} → ${op.to}`;
    case "trim": return op.column ? `Trim whitespace on ${op.column}` : "Trim whitespace (all text)";
    case "normalize_case": return `Normalize case (${op.mode ?? "lower"})${on}`;
    case "knn_impute": return `KNN impute (k=${op.k ?? 5})${on}`;
    case "cap_outliers": return `Cap outliers (IQR ×${op.multiplier ?? 1.5})${on}`;
    case "drop_outliers": return `Drop outlier rows (IQR ×${op.multiplier ?? 1.5})${on}`;
    case "drop_row": return `Delete row #${(op.index ?? 0) + 1}`;
    case "iforest_outliers": return `Isolation Forest — drop anomalies (contamination ${((op.contamination ?? 0.05) * 100).toFixed(1)}%)`;
    case "scale": return `${op.scaler === "minmax" ? "MinMax" : "Standard"} scale${on}`;
    case "fill_null": return `Fill nulls (${op.strategy ?? "constant"}${op.strategy === "constant" && op.value !== undefined ? `: "${op.value}"` : ""})${on}`;
    default: return op.type;
  }
}

// ---------------------------------------------------------------------------
// Demo dataset — intentionally messy so the co-pilot has work to do
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CITIES = ["Paris", "paris", "PARIS ", "Lyon", " lyon", "Berlin", "berlin ", "Madrid", "Osaka", " osaka"];
const FIRST = ["alice", "Bob", "CAROL", "dave", "Erin", " frank", "GRACE", "heidi", "Ivan", " judy", "Mallory", "oscar"];
const LAST = ["Martin", "Nguyen", "Smith ", "Garcia", "Kim", " patel", "Müller", "Rossi", "Tanaka", " Silva"];

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function generateDemoCsv(filePath: string, rows = 1800): number {
  const rnd = mulberry32(20261013);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const lines: string[] = ["record_id,full_name,email,age,salary_usd,city,plan_active,score,last_login"];
  let prev: string | null = null;
  for (let i = 0; i < rows; i++) {
    // ~1 in 11 rows is an exact duplicate of the previous one
    if (prev && rnd() < 0.09) {
      lines.push(prev);
      continue;
    }
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const email =
      rnd() < 0.08
        ? ""
        : `  ${pick(FIRST).trim().toLowerCase()}.${pick(LAST).trim().toLowerCase()}@${pick(["mail.com", "example.org", "corp.io", "inbox.net"])}`;
    const age =
      rnd() < 0.07 ? "" : rnd() < 0.06 ? "unknown" : String(18 + Math.floor(rnd() * 60));
    const salary =
      rnd() < 0.05 ? "N/A" : `$${(32 + Math.floor(rnd() * 140)).toString()},${String(Math.floor(rnd() * 900) + 100)}`;
    const city = rnd() < 0.06 ? "" : pick(CITIES);
    const plan = pick(["yes", "no", "Y", "n", "true", "false"]);
    const score = rnd() < 0.05 ? "" : (Math.round(rnd() * 10000) / 100).toFixed(2);
    const d = new Date(2025, Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28));
    const login = rnd() < 0.5 ? d.toISOString().slice(0, 10) : `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    prev = [String(1000 + i), name, email, age, salary, city, plan, score, login].map(csvEscape).join(",");
    lines.push(prev);
  }
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
  return lines.length - 1;
}
