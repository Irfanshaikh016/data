// The AI co-pilot: a deterministic profiling engine that turns dataset
// statistics into ranked cleaning suggestions, plus a conversational layer
// that routes user intent to explanations + executable actions.

import type { ChatAction, ChatReply, ColumnProfile, DatasetPayload, Op, Suggestion } from "@/lib/types";
import { opLabel } from "@/lib/polars-engine";

// ---------------------------------------------------------------------------
// Suggestion engine
// ---------------------------------------------------------------------------

const IMPACT_W = { high: 3, medium: 2, low: 1 } as const;

function looksInteger(sample: string[]): boolean {
  const nums = sample.filter((s) => /^-?[\d.,]+$/.test(s.trim()));
  return nums.length > 0 && nums.every((s) => /^-?\d[\d,]*$/.test(s.trim()));
}

export function analyzeDataset(
  columns: ColumnProfile[],
  dupes: number,
  totalRows: number,
): Suggestion[] {
  const out: Suggestion[] = [];
  let n = 0;
  const id = () => `sg-${++n}`;

  if (dupes > 0 && totalRows > 0) {
    const pct = Math.round((dupes / totalRows) * 1000) / 10;
    out.push({
      id: id(),
      title: "Remove duplicate rows",
      detail: `${dupes.toLocaleString()} exact duplicate rows detected (${pct}% of the dataset). Keeping them skews every aggregate downstream.`,
      confidence: 0.97,
      impact: pct > 2 ? "high" : "medium",
      op: { type: "drop_duplicates" },
    });
  }

  const nullCols = [...columns].filter((c) => c.nulls > 0).sort((a, b) => b.nullPct - a.nullPct);
  for (const c of nullCols.slice(0, 3)) {
    const numeric = /^(Int|UInt|Float|Decimal)/.test(c.dtype);
    if (c.nullPct >= 50) {
      out.push({
        id: id(),
        title: `Consider dropping "${c.name}"`,
        detail: `${c.nulls.toLocaleString()} of ${totalRows.toLocaleString()} rows (${c.nullPct}%) are null. A column this sparse rarely carries signal.`,
        confidence: 0.62,
        impact: "low",
        op: { type: "drop_column", column: c.name },
      });
    } else if (numeric) {
      out.push({
        id: id(),
        title: `Impute "${c.name}" with its median`,
        detail: `${c.nulls.toLocaleString()} nulls (${c.nullPct}%) in a numeric column. Median imputation is robust to outliers; mean is available in the toolbar.`,
        confidence: 0.91,
        impact: c.nullPct > 5 ? "high" : "medium",
        op: { type: "fill_null", column: c.name, strategy: "median" },
      });
    } else if (c.nullPct <= 1.5) {
      out.push({
        id: id(),
        title: `Drop rows missing "${c.name}"`,
        detail: `Only ${c.nulls.toLocaleString()} rows (${c.nullPct}%) are null — cheaper to drop than to impute.`,
        confidence: 0.84,
        impact: "medium",
        op: { type: "drop_nulls", column: c.name },
      });
    } else {
      const categorical = c.unique > 0 && c.unique <= 30;
      out.push({
        id: id(),
        title: categorical ? `Fill "${c.name}" with its mode` : `Fill nulls in "${c.name}" with "Unknown"`,
        detail: `${c.nulls.toLocaleString()} nulls (${c.nullPct}%) in a text column.${categorical ? " It looks categorical, so the most frequent value is a safe imputation." : " A sentinel value keeps rows without inventing data."}`,
        confidence: categorical ? 0.86 : 0.78,
        impact: c.nullPct > 10 ? "high" : "medium",
        op: categorical
          ? { type: "fill_null", column: c.name, strategy: "mode" }
          : { type: "fill_null", column: c.name, strategy: "constant", value: "Unknown" },
      });
    }
  }

  for (const c of columns.filter((c) => c.dtype === "String" && c.numericLike >= 0.9 && c.nulls < totalRows).slice(0, 2)) {
    const target = looksInteger(c.sample) ? "Int64" : "Float64";
    out.push({
      id: id(),
      title: `Cast "${c.name}" to ${target}`,
      detail: `${Math.round(c.numericLike * 100)}% of its non-null values look numeric, but the column is typed as text. Non-numeric stragglers become null on cast.`,
      confidence: 0.93,
      impact: "medium",
      op: { type: "cast", column: c.name, to: target },
    });
  }

  for (const c of columns.filter((c) => c.whitespace >= 3).slice(0, 2)) {
    out.push({
      id: id(),
      title: `Trim whitespace in "${c.name}"`,
      detail: `${c.whitespace} sampled values carry leading/trailing spaces — silent killers for joins and group-bys.`,
      confidence: 0.95,
      impact: "medium",
      op: { type: "trim", column: c.name },
    });
  }

  for (const c of columns.filter((c) => c.caseCollisions >= 2).slice(0, 2)) {
    out.push({
      id: id(),
      title: `Normalize case in "${c.name}"`,
      detail: `Values like ${c.sample.slice(0, 2).map((s) => `"${s}"`).join(" / ")} collide once lowercased (${c.caseCollisions} collisions in sample). One canonical case prevents split groups.`,
      confidence: 0.81,
      impact: "low",
      op: { type: "normalize_case", column: c.name, mode: "lower" },
    });
  }

  return out
    .sort((a, b) => IMPACT_W[b.impact] - IMPACT_W[a.impact] || b.confidence - a.confidence)
    .slice(0, 7);
}

// ---------------------------------------------------------------------------
// Conversational layer
// ---------------------------------------------------------------------------

export interface CopilotContext {
  name: string;
  totalRows: number;
  columns: ColumnProfile[];
  dupes: number;
  recipeLen: number;
  suggestions: Suggestion[];
}

function toAction(s: Suggestion): ChatAction {
  return { label: s.title, description: s.detail, ops: [s.op] };
}

/** Ordered, safe auto-clean batch: structure first, imputation last. */
export function autoCleanOps(ctx: CopilotContext): Op[] {
  const ops: Op[] = [];
  const grab = (re: RegExp) => ctx.suggestions.filter((s) => re.test(s.op.type + "|" + (s.title ?? "")));
  if (ctx.dupes > 0) ops.push({ type: "drop_duplicates" });
  for (const s of grab(/^trim/)) ops.push(s.op);
  for (const s of grab(/^normalize_case/)) ops.push(s.op);
  for (const s of grab(/^cast/)) ops.push(s.op);
  for (const s of ctx.suggestions.filter((s) => s.op.type === "fill_null")) ops.push(s.op);
  return ops.slice(0, 8);
}

function topActions(ctx: CopilotContext, n = 3): ChatAction[] {
  return ctx.suggestions.slice(0, n).map(toAction);
}

function columnByName(ctx: CopilotContext, text: string): ColumnProfile | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const t = norm(text);
  return ctx.columns.find((c) => t.includes(norm(c.name)) && norm(c.name).length > 1);
}

function analyzeColumn(ctx: CopilotContext, c: ColumnProfile): ChatReply {
  const related = ctx.suggestions.filter((s) => s.op.column === c.name).map(toAction);
  const lines = [
    `Profile of "${c.name}" — typed as ${c.dtype}.`,
    `• Nulls: ${c.nulls.toLocaleString()} (${c.nullPct}% of ${ctx.totalRows.toLocaleString()} rows)`,
    `• ~${c.unique.toLocaleString()} distinct values in the 2k-row sample`,
    `• Sample values: ${c.sample.length ? c.sample.map((s) => `"${s}"`).join(", ") : "—"}`,
  ];
  if (c.dtype === "String" && c.numericLike >= 0.9)
    lines.push(`• ${Math.round(c.numericLike * 100)}% of values look numeric — a cast would unlock math on this column.`);
  if (c.whitespace > 0) lines.push(`• ${c.whitespace} values have stray whitespace.`);
  if (c.caseCollisions > 0) lines.push(`• ${c.caseCollisions} case collisions detected (e.g. "Paris" vs "paris").`);
  if (c.nulls === 0 && c.whitespace === 0 && c.caseCollisions === 0)
    lines.push("This column looks healthy — I wouldn't touch it.");
  return { reply: lines.join("\n"), actions: related.slice(0, 3) };
}

export function chatReply(rawMessage: string, ctx: CopilotContext | null): ChatReply {
  const msg = rawMessage.trim();
  const low = msg.toLowerCase();

  if (!ctx) {
    if (/(hi|hello|hey|help|start)/.test(low)) {
      return {
        reply:
          "I'm your cleaning co-pilot. Upload a CSV (or load the demo dataset) on the left and I'll profile it — nulls, duplicates, type mismatches, stray whitespace — and hand you one-click fixes.",
        actions: [],
      };
    }
    return {
      reply: "No dataset is loaded yet, so I have nothing to analyze. Upload a CSV in the Manual Action Zone, then ask me things like “what should I fix first?” or “auto-clean everything”.",
      actions: [],
    };
  }

  const clean = ctx.suggestions.length === 0;

  if (/^(hi|hello|hey)\b/.test(low)) {
    return {
      reply: `Analyzed "${ctx.name}" — ${ctx.totalRows.toLocaleString()} rows, ${ctx.columns.length} columns, ${ctx.recipeLen} cleaning steps applied so far. ${clean ? "It looks clean already." : `I found ${ctx.suggestions.length} recommended fixes; here are the top ones:`}`,
      actions: topActions(ctx, 3),
    };
  }

  if (/(auto[- ]?clean|fix everything|clean (it|this|all|everything)|do it all|all at once)/.test(low)) {
    const ops = autoCleanOps(ctx);
    if (ops.length === 0)
      return { reply: "Everything already looks clean — no duplicates, no null hotspots, no type mismatches. Nothing to apply.", actions: [] };
    return {
      reply: `I can run a full auto-clean in one batch — structure first, imputation last:\n${ops.map((o, i) => `${i + 1}. ${opLabel(o)}`).join("\n")}\nApply it and I'll re-profile the result.`,
      actions: [{ label: `Auto-clean (${ops.length} steps)`, description: "Runs the full recommended batch in order.", ops }],
    };
  }

  if (/(what|which|where).*(fix|issue|problem|wrong|first)|suggest|recommend|prioriti[sz]|what should/.test(low)) {
    if (clean)
      return { reply: "Good news — nothing stands out. No duplicates, nulls are under control, types look sane. You can export from the header whenever you're ready.", actions: [] };
    const lines = ctx.suggestions.slice(0, 4).map((s, i) => `${i + 1}. ${s.title} — ${s.detail}`);
    return { reply: `Here's my priority list for "${ctx.name}":\n${lines.join("\n")}`, actions: topActions(ctx, 4) };
  }

  const col = columnByName(ctx, low);
  if (col && /(analy|profile|tell me about|column|check|inspect|look at|stats)/.test(low)) {
    return analyzeColumn(ctx, col);
  }

  if (/null|missing|empty|blank|impute|imputation|nan/.test(low)) {
    const nullCols = ctx.columns.filter((c) => c.nulls > 0);
    if (nullCols.length === 0) return { reply: "No nulls anywhere — the dataset is complete on that front.", actions: [] };
    const lines = nullCols.slice(0, 5).map((c) => `• ${c.name}: ${c.nulls.toLocaleString()} nulls (${c.nullPct}%) — ${/^(Int|UInt|Float)/.test(c.dtype) ? "numeric, median imputation recommended" : "text, mode/sentinel imputation or drop"}`);
    const acts = ctx.suggestions.filter((s) => s.op.type === "fill_null" || s.op.type === "drop_nulls").slice(0, 3).map(toAction);
    return { reply: `Null report:\n${lines.join("\n")}\nRule of thumb: under ~2% nulls, dropping rows is fine; above that, impute.`, actions: acts };
  }

  if (/duplicat|dedup|dupe/.test(low)) {
    if (ctx.dupes === 0) return { reply: "Zero exact duplicates — at least within the current cleaned view.", actions: [] };
    const pct = Math.round((ctx.dupes / ctx.totalRows) * 1000) / 10;
    return {
      reply: `I count ${ctx.dupes.toLocaleString()} exact duplicate rows (${pct}%). Unless duplicates are meaningful events, drop them before any aggregation.`,
      actions: [{ label: "Drop duplicate rows", description: "Keeps the first occurrence of each unique row.", ops: [{ type: "drop_duplicates" }] }],
    };
  }

  if (/outlier|anomal|winsor|capping|\biqr\b/.test(low)) {
    return {
      reply:
        "For outliers, select a numeric column (the profiler strip shows the live outlier count), then open Outliers in the toolbar: set your IQR multiplier — 1.5 is standard, 3.0 is conservative — and either Cap (winsorize: clamp values to the fences) or Drop rows. Try the profiler first so you know how many rows you're about to touch.",
      actions: [],
    };
  }

  if (/\bknn\b/.test(low)) {
    const acts = ctx.suggestions.filter((s) => s.op.type === "fill_null").slice(0, 2).map(toAction);
    return {
      reply:
        "The KNN imputer lives under Missing Values in the toolbar. It standardizes the other numeric columns, finds each null row's k nearest neighbors, and imputes their mean — much smarter than a blanket median when columns correlate. Choose k (5 is a good default). If a column has no numeric neighbors, I fall back to simpler fills like these:",
      actions: acts,
    };
  }

  if (/type|cast|convert|number|numeric|string/.test(low)) {
    const casts = ctx.suggestions.filter((s) => s.op.type === "cast");
    if (casts.length === 0) return { reply: "All inferred types look correct — I don't see text columns that are secretly numeric.", actions: [] };
    return {
      reply: `Type issues found:\n${casts.map((s) => `• ${s.detail}`).join("\n")}`,
      actions: casts.slice(0, 3).map(toAction),
    };
  }

  if (/trim|whitespace|space|case|capital|lower|upper/.test(low)) {
    const acts = ctx.suggestions.filter((s) => s.op.type === "trim" || s.op.type === "normalize_case").slice(0, 4).map(toAction);
    if (acts.length === 0) return { reply: "Text columns look tidy — no stray whitespace or case collisions in the sample.", actions: [] };
    return { reply: "Text hygiene issues found. Stray spaces and inconsistent casing silently break joins and group-bys:", actions: acts };
  }

  if (/export|download|save|csv out/.test(low)) {
    return { reply: `Use the Export button in the header — it streams the full ${ctx.totalRows.toLocaleString()} rows with all ${ctx.recipeLen} cleaning steps applied, not just the 100-row preview.`, actions: [] };
  }

  if (/undo|reset|revert|start over/.test(low)) {
    return { reply: "The toolbar has Undo (removes the last step) and Reset (clears the whole recipe). Your original file is never mutated — ops are replayed from the raw upload.", actions: [] };
  }

  if (/help|what can you|how do you work|capab/.test(low)) {
    return {
      reply:
        "I profile every column the moment you upload, then watch each cleaning step. Select a column to see its live profiler (missing %, outliers, distribution). Ask me:\n• “what should I fix first?”\n• “analyze column age”\n• “auto-clean everything”\n• “outliers?” / “knn?”\nActions I suggest come with one-click apply buttons.",
      actions: topActions(ctx, 2),
    };
  }

  if (col) return analyzeColumn(ctx, col);

  return {
    reply: `Here's my current read on "${ctx.name}": ${clean ? "it looks clean." : `${ctx.suggestions.length} issues worth fixing.`} Ask “what should I fix first?”, “analyze <column>”, or “auto-clean everything”.`,
    actions: topActions(ctx, 3),
  };
}

export function suggestionAppliedMessage(ops: Op[]): string {
  return ops.length === 1
    ? `Applied: ${opLabel(ops[0])}. I've re-profiled the dataset — check the grid.`
    : `Applied ${ops.length} steps:\n${ops.map((o) => `• ${opLabel(o)}`).join("\n")}\nRe-profiling complete — the grid shows the new state.`;
}

export function contextFromPayload(p: DatasetPayload, recipeLen: number): CopilotContext {
  return {
    name: p.name,
    totalRows: p.totalRows,
    columns: p.columns,
    dupes: p.dupes,
    recipeLen,
    suggestions: p.suggestions,
  };
}
