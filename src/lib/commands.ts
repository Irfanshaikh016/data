// Universal command vocabulary — translates the public
// { column, action_category, method, params } envelope (used by external
// agents, scripts and the co-pilot) into internal recipe Ops.

import type { Op, UniversalCommand } from "@/lib/types";

function needColumn(cmd: UniversalCommand): string {
  const c = cmd.column?.trim();
  if (!c) throw new Error(`Command "${cmd.action_category}/${cmd.method}" requires a "column".`);
  return c;
}

function numParam(v: unknown, fallback: number, min: number, max: number, name: string): number {
  if (v === undefined || v === null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`params.${name} must be a number (got ${JSON.stringify(v)}).`);
  return Math.min(max, Math.max(min, n));
}

function intParam(v: unknown, fallback: number, min: number, max: number, name: string): number {
  return Math.round(numParam(v, fallback, min, max, name));
}

const CAST_TYPES = ["Int64", "Float64", "String", "Boolean"] as const;

/**
 * Translate one universal command into one or more recipe ops.
 * Throws Error with an actionable message on anything invalid.
 */
export function commandToOps(cmd: UniversalCommand): Op[] {
  const category = (cmd.action_category ?? "").toLowerCase().trim();
  const method = (cmd.method ?? "").toLowerCase().trim();
  const p = cmd.params ?? {};

  switch (category) {
    case "missing_values": {
      const column = needColumn(cmd);
      switch (method) {
        case "drop_rows":
          return [{ type: "drop_nulls", column }];
        case "mean":
        case "median":
        case "mode":
        case "forward":
          return [{ type: "fill_null", column, strategy: method }];
        case "custom":
        case "constant":
        case "value": {
          const value = p.value;
          if (value === undefined || value === null || String(value) === "") {
            throw new Error('missing_values/custom requires params.value (e.g. "params": {"value": "Unknown"}).');
          }
          return [{ type: "fill_null", column, strategy: "constant", value: String(value) }];
        }
        case "knn":
          return [{ type: "knn_impute", column, k: intParam(p.k, 5, 1, 25, "k") }];
        default:
          throw new Error(`Unknown missing_values method "${method}" — try drop_rows | mean | median | mode | forward | custom | knn.`);
      }
    }

    case "outliers": {
      const column = needColumn(cmd);
      const multiplier = numParam(p.multiplier ?? p.m, 1.5, 0.1, 20, "multiplier");
      if (method === "capping" || method === "cap" || method === "winsorize") {
        return [{ type: "cap_outliers", column, multiplier }];
      }
      if (method === "drop_rows" || method === "drop") {
        return [{ type: "drop_outliers", column, multiplier }];
      }
      throw new Error(`Unknown outliers method "${method}" — try capping | drop_rows (with params.multiplier).`);
    }

    case "manual_edit": {
      if (method === "drop_row" || method === "delete_row" || method === "drop_rows") {
        const indices: number[] = Array.isArray(p.indices)
          ? p.indices.map(Number)
          : p.index !== undefined
            ? [Number(p.index)]
            : [];
        if (indices.length === 0 || indices.some((i) => !Number.isInteger(i) || i < 0)) {
          throw new Error('manual_edit/drop_row requires params.index (0-based integer) or params.indices: number[].');
        }
        // Descending order so every index still refers to the pre-batch view.
        return [...new Set(indices)].sort((a, b) => b - a).map((index) => ({ type: "drop_row", index }));
      }
      throw new Error(`Unknown manual_edit method "${method}" — try drop_row (params.index) .`);
    }

    case "types": {
      const column = needColumn(cmd);
      if (method === "cast") {
        const to = String(p.to ?? "");
        if (!CAST_TYPES.includes(to as (typeof CAST_TYPES)[number])) {
          throw new Error(`types/cast requires params.to ∈ ${CAST_TYPES.join(" | ")}.`);
        }
        return [{ type: "cast", column, to }];
      }
      if (CAST_TYPES.includes(method as (typeof CAST_TYPES)[number])) {
        return [{ type: "cast", column, to: method }];
      }
      throw new Error(`Unknown types method "${method}" — try cast with params.to ∈ ${CAST_TYPES.join(" | ")}.`);
    }

    case "text": {
      if (method === "trim" || method === "strip") {
        return cmd.column ? [{ type: "trim", column: cmd.column }] : [{ type: "trim" }];
      }
      if (method === "lowercase" || method === "lower") {
        return [{ type: "normalize_case", column: needColumn(cmd), mode: "lower" }];
      }
      if (method === "uppercase" || method === "upper") {
        return [{ type: "normalize_case", column: needColumn(cmd), mode: "upper" }];
      }
      throw new Error(`Unknown text method "${method}" — try trim | lowercase | uppercase.`);
    }

    case "structure": {
      if (method === "dedupe" || method === "drop_duplicates") return [{ type: "drop_duplicates" }];
      if (method === "drop_column") return [{ type: "drop_column", column: needColumn(cmd) }];
      if (method === "rename") {
        const to = String(p.to ?? "").trim();
        if (!to) throw new Error('structure/rename requires params.to.');
        return [{ type: "rename_column", column: needColumn(cmd), to }];
      }
      throw new Error(`Unknown structure method "${method}" — try dedupe | drop_column | rename.`);
    }

    default:
      throw new Error(
        `Unknown action_category "${category}" — supported: missing_values | outliers | manual_edit | types | text | structure. GET /api/apply_cleaning for the full schema.`,
      );
  }
}

/** Human one-liner for logs/snapshot notes. */
export function commandSummary(cmd: UniversalCommand): string {
  const params = cmd.params && Object.keys(cmd.params).length > 0 ? ` ${JSON.stringify(cmd.params)}` : "";
  return `${cmd.action_category}/${cmd.method}${cmd.column ? ` on ${cmd.column}` : ""}${params}`;
}

/** Machine-readable schema served by GET /api/apply_cleaning. */
export const COMMANDS_DOC = {
  endpoint: "POST /api/apply_cleaning",
  envelope: {
    datasetId: "string (required) — id returned by /api/upload",
    source: '"manual" | "ai" (optional, default "manual")',
    command: "single UniversalCommand",
    commands: "UniversalCommand[] — applied atomically as one batch (one undo step)",
    ops: "internal Op[] passthrough (accepted as well)",
    undo: "true — restore the latest in-memory snapshot",
    reset: "true — clear the recipe (snapshotted, so it is itself undoable)",
  },
  universalCommand: {
    column: "string — target column (required except structure/dedupe, text/trim, manual_edit)",
    action_category: "string",
    method: "string",
    params: "object — method-specific",
  },
  methods: {
    missing_values: {
      drop_rows: {},
      mean: {},
      median: {},
      mode: {},
      forward: {},
      custom: { value: "required, imputation literal" },
      knn: { k: "neighbors, default 5, 1–25" },
    },
    outliers: {
      capping: { multiplier: "IQR multiplier, default 1.5" },
      drop_rows: { multiplier: "IQR multiplier, default 1.5" },
    },
    manual_edit: {
      drop_row: { index: "0-based row index", indices: "number[] alternative" },
    },
    types: { cast: { to: ["Int64", "Float64", "String", "Boolean"] } },
    text: { trim: {}, lowercase: {}, uppercase: {} },
    structure: { dedupe: {}, drop_column: {}, rename: { to: "new column name" } },
  },
  state: "Every mutation pushes an in-memory snapshot of the dataframe + recipe (max 8). Send { undo: true } to restore the latest one.",
  example: {
    datasetId: "…",
    source: "ai",
    command: { column: "Salary", action_category: "missing_values", method: "knn", params: { k: 5 } },
  },
};
