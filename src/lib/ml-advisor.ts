// ML-First Co-pilot brain (Task 4).
//
// Rule A — ALWAYS default to traditional ML / statistical methods for normal
//          numerical & categorical data (KNN Imputer, Isolation Forest,
//          StandardScaler, mode/median imputation, dedupe…).
// Rule B — Detect genuinely complex data (extreme dimensionality, unstructured
//          text / PII, severe non-linear anomalies, explosive cardinality).
//          NEVER auto-run Deep Learning: emit a warning proposal that the data
//          scientist must explicitly approve.
//
// Every proposal is also checked against the user's stated GOAL, so the
// co-pilot can flag steps that would harm their specific objective.

import type {
  ColumnProfile,
  ComplexitySignal,
  GoalSpec,
  MlTask,
  Op,
  Proposal,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Goal parsing
// ---------------------------------------------------------------------------

const TASK_PATTERNS: { task: MlTask; re: RegExp; label: string }[] = [
  { task: "classification", re: /\b(classif|churn|fraud|spam|predict .*(class|category|label)|binary|logistic|segment .*customers? into)\b/, label: "classification model" },
  { task: "regression", re: /\b(regress|forecast .*(price|value|amount|revenue|sales)|predict .*(price|value|amount|salary|revenue|score|cost)|estimate)\b/, label: "regression model" },
  { task: "timeseries", re: /\b(time[- ]?series|forecast|seasonal|trend over time|arima|prophet)\b/, label: "time-series forecast" },
  { task: "clustering", re: /\b(cluster|segment|unsupervised|k-?means|cohort|group .*similar)\b/, label: "clustering / segmentation" },
  { task: "nlp", re: /\b(nlp|text (analysis|mining|classification)|sentiment|topic model|embedding|llm|language model)\b/, label: "NLP / text model" },
  { task: "eda", re: /\b(dashboard|report|explor|visuali[sz]|bi\b|analytics|insight)\b/, label: "analysis / reporting" },
];

/** Extract a likely target column from the goal text. */
function detectTarget(goal: string, columns: string[]): string | null {
  const low = goal.toLowerCase();
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Explicit phrasing first: "predict X", "target is X", "label X"
  const explicit = /(?:predict|forecast|estimate|target(?: is|:)?|label(?: is|:)?|classify)\s+(?:the\s+)?([\w .\-]{2,40})/.exec(low);
  const candidates = columns
    .map((c) => ({ c, n: norm(c) }))
    .filter((x) => x.n.length > 2)
    .sort((a, b) => b.n.length - a.n.length);
  if (explicit) {
    const phrase = norm(explicit[1]);
    const hit = candidates.find((x) => phrase.includes(x.n) || x.n.includes(phrase));
    if (hit) return hit.c;
  }
  const mentioned = candidates.find((x) => norm(low).includes(x.n));
  return mentioned?.c ?? null;
}

export function parseGoal(raw: string, columns: string[]): GoalSpec {
  const text = raw.trim();
  const low = text.toLowerCase();
  let task: MlTask = "unknown";
  let label = "";
  for (const p of TASK_PATTERNS) {
    if (p.re.test(low)) {
      task = p.task;
      label = p.label;
      break;
    }
  }
  const target = detectTarget(text, columns);
  const keywords = [...new Set(low.match(/[a-z]{4,}/g) ?? [])].slice(0, 12);
  const summary =
    task === "unknown"
      ? `Objective noted${target ? ` — target column "${target}"` : ""}. I'll keep suggestions general-purpose.`
      : `Aligning to a ${label}${target ? ` with target "${target}"` : ""}.`;
  return { raw: text, task, target, summary, keywords };
}

// ---------------------------------------------------------------------------
// Rule B — complexity detection
// ---------------------------------------------------------------------------

const PII_HINTS = /(email|e_mail|mail|phone|tel|ssn|social|passport|iban|credit|card|address|street|zip|postcode|name|user_?name|ip_?addr|dob|birth)/i;

/** Average token count of sampled values — a proxy for "unstructured text". */
function textiness(c: ColumnProfile): number {
  if (c.dtype !== "String" || c.sample.length === 0) return 0;
  const words = c.sample.map((s) => s.trim().split(/\s+/).length);
  return words.reduce((a, b) => a + b, 0) / words.length;
}

export function detectComplexity(
  columns: ColumnProfile[],
  rows: number,
  anomalyRate: number,
): { score: number; complex: boolean; signals: ComplexitySignal[] } {
  const signals: ComplexitySignal[] = [];
  let score = 0;

  // 1) Extremely high dimensionality (absolute, or vs. sample size)
  const nCols = columns.length;
  const ratio = rows > 0 ? nCols / rows : 0;
  if (nCols >= 100 || ratio > 0.2) {
    score += nCols >= 250 || ratio > 0.5 ? 3 : 2;
    signals.push({
      code: "high_dimensionality",
      label: "Extreme dimensionality",
      detail: `${nCols} columns for ${rows.toLocaleString()} rows (p/n ≈ ${ratio.toFixed(2)}). Linear/tree models overfit badly in this regime; representation learning may be required.`,
      severity: nCols >= 250 || ratio > 0.5 ? "critical" : "warn",
    });
  }

  // 2) Unstructured free text
  const longText = columns.filter((c) => textiness(c) >= 8 && c.unique > Math.max(20, rows * 0.4));
  if (longText.length > 0) {
    score += longText.length >= 2 ? 3 : 2;
    signals.push({
      code: "unstructured_text",
      label: "Unstructured free text",
      detail: `${longText.map((c) => `"${c.name}"`).join(", ")} hold long, mostly-unique prose. Bag-of-words loses meaning here — embeddings/transformers capture it.`,
      severity: longText.length >= 2 ? "critical" : "warn",
    });
  }

  // 3) PII-shaped identifiers in text columns
  const pii = columns.filter((c) => c.dtype === "String" && PII_HINTS.test(c.name) && c.unique > Math.max(10, rows * 0.3));
  if (pii.length >= 2) {
    score += 1;
    signals.push({
      code: "pii",
      label: "High-cardinality PII",
      detail: `${pii.map((c) => `"${c.name}"`).join(", ")} look like personal identifiers. They need hashing/removal before modelling — and they can't be one-hot encoded.`,
      severity: "warn",
    });
  }

  // 4) Severe non-linear anomaly structure (Isolation Forest rate is high)
  if (anomalyRate >= 0.12) {
    score += anomalyRate >= 0.2 ? 3 : 2;
    signals.push({
      code: "nonlinear_anomalies",
      label: "Severe non-linear anomalies",
      detail: `Isolation Forest flags ~${(anomalyRate * 100).toFixed(1)}% of rows as anomalous — far above the usual 1–5%. The manifold is likely non-linear; autoencoder reconstruction error separates such cases far better.`,
      severity: anomalyRate >= 0.2 ? "critical" : "warn",
    });
  }

  // 5) Explosive categorical cardinality
  const explosive = columns.filter((c) => c.dtype === "String" && c.unique > 1000 && c.unique > rows * 0.5);
  if (explosive.length >= 1) {
    score += 1;
    signals.push({
      code: "high_cardinality",
      label: "Explosive categorical cardinality",
      detail: `${explosive.map((c) => `"${c.name}"`).join(", ")} exceed 1k distinct values. One-hot encoding explodes; entity embeddings handle this natively.`,
      severity: "warn",
    });
  }

  return { score, complex: score >= 3, signals };
}

// ---------------------------------------------------------------------------
// Goal-alignment guardrails
// ---------------------------------------------------------------------------

interface GoalCheck {
  note?: string;
  warning?: string;
}

function checkAgainstGoal(op: Op, goal: GoalSpec | null, col: ColumnProfile | undefined): GoalCheck {
  if (!goal) return {};
  const isTarget = !!goal.target && op.column === goal.target;
  const t = goal.task;

  if (isTarget) {
    if (op.type === "drop_column") {
      return { warning: `"${op.column}" is your TARGET for this ${t} goal — dropping it destroys the objective. I'd reject this.` };
    }
    if (op.type === "fill_null" || op.type === "knn_impute") {
      return {
        warning: `"${op.column}" is your target. Imputing labels fabricates ground truth and leaks into evaluation — for supervised learning, drop rows with a missing target instead.`,
      };
    }
    if (op.type === "scale") {
      return t === "regression"
        ? { warning: `Scaling the target is only safe if you inverse-transform predictions later. Most pipelines scale features only.` }
        : { warning: `"${op.column}" is your classification target — don't scale it.` };
    }
    if (op.type === "cap_outliers" || op.type === "drop_outliers" || op.type === "iforest_outliers") {
      return { warning: `Trimming extremes on the target can delete exactly the rare positives a ${t} model needs to learn.` };
    }
  }

  switch (op.type) {
    case "scale":
      if (t === "classification" || t === "regression" || t === "clustering") {
        return {
          note:
            t === "clustering"
              ? "Essential for your clustering goal — k-means distance is meaningless on unscaled features."
              : "Helps distance- and gradient-based models (SVM, KNN, neural nets, regularized linear models) converge.",
          warning: "Fit the scaler on the TRAIN split only — scaling before splitting leaks test statistics.",
        };
      }
      return { warning: "Scaling changes the units — it'll make raw reporting/dashboards harder to read." };

    case "iforest_outliers":
      if (t === "classification") {
        return {
          note: "Removes multivariate noise that blurs decision boundaries.",
          warning: "If your positive class IS the anomaly (churn, fraud), this deletes your signal. Check class balance before approving.",
        };
      }
      if (t === "timeseries") {
        return { warning: "Removing rows breaks the time index and creates gaps — for forecasting, prefer flagging or capping over deletion." };
      }
      return { note: "Multivariate anomaly removal usually stabilizes downstream models." };

    case "drop_duplicates":
      if (t === "timeseries") {
        return { warning: "Legitimate repeated readings at different timestamps can look identical — verify before deduping a time series." };
      }
      return { note: "Duplicates inflate accuracy and leak identical rows across train/test splits." };

    case "drop_nulls":
      if ((col?.nullPct ?? 0) > 20) {
        return { warning: `Dropping ~${col?.nullPct}% of rows shrinks your training set a lot — imputation usually beats deletion at this level.` };
      }
      return { note: "Small null share — dropping is cleaner than inventing values." };

    case "knn_impute":
      return {
        note: "Value-aware imputation preserves feature correlations better than a global median.",
        warning: t === "timeseries" ? "For time series, forward-fill respects temporal order better than KNN." : undefined,
      };

    case "cap_outliers":
      return { note: "Winsorizing keeps every row (no sample loss) while taming extreme leverage points." };

    case "drop_column":
      if (col && col.nullPct >= 50) return { note: `${col.nullPct}% missing — this column carries little learnable signal.` };
      return {};

    case "cast":
      return { note: "Correct dtypes are a hard requirement for any ML library — strings won't fit a numeric model." };

    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Rule A — the ML-first proposal engine
// ---------------------------------------------------------------------------

export interface AdvisorInput {
  columns: ColumnProfile[];
  rows: number;
  dupes: number;
  goal: GoalSpec | null;
  /** Share of rows flagged anomalous by Isolation Forest (0..1), if computed. */
  anomalyRate: number;
  anomalyCount: number;
  numericCols: string[];
}

const IMPACT_W = { high: 3, medium: 2, low: 1 } as const;

export function buildProposals(input: AdvisorInput): Proposal[] {
  const { columns, rows, dupes, goal, anomalyRate, anomalyCount, numericCols } = input;
  const out: Proposal[] = [];
  let n = 0;
  const byName = new Map(columns.map((c) => [c.name, c]));

  const push = (p: Omit<Proposal, "id" | "goalNote" | "goalWarning">) => {
    const primary = p.ops[0];
    const check = primary ? checkAgainstGoal(primary, goal, byName.get(p.column ?? "")) : {};
    out.push({ ...p, id: `p${++n}`, goalNote: check.note, goalWarning: check.warning });
  };

  // 1) Structural hygiene first (statistical, always safe)
  if (dupes > 0) {
    const pct = rows > 0 ? Math.round((dupes / rows) * 1000) / 10 : 0;
    push({
      kind: "cleaning",
      title: "Remove duplicate rows",
      method: "Exact-match deduplication",
      family: "Statistical",
      column: null,
      rationale: `${dupes.toLocaleString()} exact duplicates (${pct}%). Identical rows split across train/test inflate validation scores.`,
      confidence: 0.97,
      impact: pct > 2 ? "high" : "medium",
      ops: [{ type: "drop_duplicates" }],
    });
  }

  // 2) Type correctness — prerequisite for every ML method
  for (const c of columns.filter((c) => c.dtype === "String" && c.numericLike >= 0.9).slice(0, 3)) {
    const target = /^-?\d+$/.test(c.sample[0]?.replace(/[,\s]/g, "") ?? "") ? "Int64" : "Float64";
    push({
      kind: "cleaning",
      title: `Cast "${c.name}" to ${target}`,
      method: "Type coercion",
      family: "Statistical",
      column: c.name,
      rationale: `${Math.round(c.numericLike * 100)}% of values are numeric but stored as text. No ML library accepts this column until it's cast.`,
      confidence: 0.93,
      impact: "high",
      ops: [{ type: "cast", column: c.name, to: target }],
    });
  }

  // 3) Missing values — Rule A: KNN Imputer for numeric, mode for categorical
  const nullCols = [...columns].filter((c) => c.nulls > 0).sort((a, b) => b.nullPct - a.nullPct);
  for (const c of nullCols.slice(0, 4)) {
    const isTarget = goal?.target === c.name;
    const numeric = /^(Int|UInt|Float|Decimal)/.test(c.dtype);

    if (isTarget) {
      push({
        kind: "cleaning",
        title: `Drop rows with a missing target ("${c.name}")`,
        method: "Listwise deletion on label",
        family: "Statistical",
        column: c.name,
        rationale: `${c.nulls.toLocaleString()} rows (${c.nullPct}%) have no label. Unlabelled rows can't train a supervised ${goal?.task} model, and imputing labels fabricates ground truth.`,
        confidence: 0.95,
        impact: "high",
        ops: [{ type: "drop_nulls", column: c.name }],
      });
      continue;
    }

    if (c.nullPct >= 60) {
      push({
        kind: "cleaning",
        title: `Drop sparse column "${c.name}"`,
        method: "Sparsity threshold",
        family: "Statistical",
        column: c.name,
        rationale: `${c.nullPct}% missing. Imputing this much data injects more noise than signal.`,
        confidence: 0.7,
        impact: "medium",
        ops: [{ type: "drop_column", column: c.name }],
      });
    } else if (numeric && rows <= 20000 && numericCols.length >= 2) {
      // RULE A: traditional ML imputation
      push({
        kind: "ml",
        title: `KNN-impute "${c.name}" (k=5)`,
        method: "KNN Imputer",
        family: "Traditional ML",
        column: c.name,
        rationale: `${c.nulls.toLocaleString()} nulls (${c.nullPct}%) in a numeric column. With ${numericCols.length} numeric features available, KNN estimates each missing value from its nearest neighbours — preserving correlations a global median would flatten.`,
        confidence: 0.9,
        impact: c.nullPct > 5 ? "high" : "medium",
        ops: [{ type: "knn_impute", column: c.name, k: 5 }],
      });
    } else if (numeric) {
      push({
        kind: "cleaning",
        title: `Median-impute "${c.name}"`,
        method: "Median imputation",
        family: "Statistical",
        column: c.name,
        rationale: `${c.nulls.toLocaleString()} nulls (${c.nullPct}%). ${rows > 20000 ? "Dataset is large, so median is the cost-effective choice over KNN." : "Median is robust to the skew in this column."}`,
        confidence: 0.88,
        impact: c.nullPct > 5 ? "high" : "medium",
        ops: [{ type: "fill_null", column: c.name, strategy: "median" }],
      });
    } else {
      const categorical = c.unique > 0 && c.unique <= 50;
      push({
        kind: "cleaning",
        title: categorical ? `Mode-impute "${c.name}"` : `Fill "${c.name}" with "Unknown"`,
        method: categorical ? "Mode imputation" : "Sentinel category",
        family: "Statistical",
        column: c.name,
        rationale: categorical
          ? `${c.nulls.toLocaleString()} nulls (${c.nullPct}%) in a ${c.unique}-level categorical. The mode keeps the encoding stable.`
          : `${c.nulls.toLocaleString()} nulls (${c.nullPct}%) in a high-cardinality text column. An explicit "Unknown" level beats silently dropping rows.`,
        confidence: 0.85,
        impact: c.nullPct > 10 ? "high" : "medium",
        ops: [
          categorical
            ? { type: "fill_null", column: c.name, strategy: "mode" }
            : { type: "fill_null", column: c.name, strategy: "constant", value: "Unknown" },
        ],
      });
    }
  }

  // 4) Outliers — Rule A: Isolation Forest (multivariate) over per-column IQR
  if (numericCols.length >= 2 && rows >= 50 && anomalyCount > 0 && anomalyRate < 0.12) {
    push({
      kind: "ml",
      title: `Isolation Forest — remove ${anomalyCount.toLocaleString()} anomalous rows`,
      method: "Isolation Forest",
      family: "Traditional ML",
      column: null,
      rationale: `An unsupervised forest over ${numericCols.length} numeric features isolates ~${(anomalyRate * 100).toFixed(1)}% of rows as anomalies. Unlike per-column IQR, it catches rows that are only strange in combination (e.g. age 19 with a 40-year tenure).`,
      confidence: 0.82,
      impact: "medium",
      ops: [{ type: "iforest_outliers", contamination: Math.max(0.01, Math.min(0.1, anomalyRate)), features: numericCols }],
    });
  }

  // 5) Feature scaling — only when the goal benefits from it
  if (goal && ["classification", "regression", "clustering"].includes(goal.task)) {
    const scalable = numericCols.filter((c) => c !== goal.target).slice(0, 1);
    for (const name of scalable) {
      const c = byName.get(name);
      if (!c) continue;
      push({
        kind: "ml",
        title: `Standard-scale "${name}"`,
        method: "StandardScaler (z-score)",
        family: "Traditional ML",
        column: name,
        rationale: `Your ${goal.task} goal benefits from comparable feature magnitudes. Z-scoring centres "${name}" at 0 with unit variance, so no feature dominates by unit choice alone.`,
        confidence: 0.72,
        impact: "low",
        ops: [{ type: "scale", column: name, scaler: "standard" }],
      });
    }
  }

  // 6) Text hygiene — cheap wins that prevent split categories
  for (const c of columns.filter((c) => c.caseCollisions >= 2).slice(0, 1)) {
    push({
      kind: "cleaning",
      title: `Normalize case in "${c.name}"`,
      method: "Case folding",
      family: "Statistical",
      column: c.name,
      rationale: `${c.caseCollisions} values differ only by capitalisation (e.g. ${c.sample.slice(0, 2).map((s) => `"${s}"`).join(" vs ")}). One-hot encoding would create duplicate columns for the same category.`,
      confidence: 0.86,
      impact: "medium",
      ops: [{ type: "normalize_case", column: c.name, mode: "lower" }],
    });
  }
  for (const c of columns.filter((c) => c.whitespace >= 3).slice(0, 1)) {
    push({
      kind: "cleaning",
      title: `Trim whitespace in "${c.name}"`,
      method: "String stripping",
      family: "Statistical",
      column: c.name,
      rationale: `${c.whitespace} sampled values carry stray spaces — they silently break joins, group-bys and category encoding.`,
      confidence: 0.94,
      impact: "medium",
      ops: [{ type: "trim", column: c.name }],
    });
  }

  return out
    .sort((a, b) => IMPACT_W[b.impact] - IMPACT_W[a.impact] || b.confidence - a.confidence)
    .slice(0, 8);
}

// ---------------------------------------------------------------------------
// Rule B — the Deep Learning warning (never auto-run)
// ---------------------------------------------------------------------------

export const DL_WARNING_TEXT =
  "This data appears highly complex/unstructured. Standard ML might fail here. You might need to use Deep Learning (e.g., Autoencoders/Transformers). Should I proceed with Deep Learning?";

export function buildDeepLearningWarning(
  signals: ComplexitySignal[],
  goal: GoalSpec | null,
): Proposal {
  const techniques: string[] = [];
  for (const s of signals) {
    if (s.code === "unstructured_text" || s.code === "pii") techniques.push("Transformer text embeddings (e.g. sentence-transformers) instead of bag-of-words");
    if (s.code === "nonlinear_anomalies") techniques.push("Autoencoder reconstruction error for anomaly detection");
    if (s.code === "high_dimensionality") techniques.push("Autoencoder / representation learning for dimensionality reduction");
    if (s.code === "high_cardinality") techniques.push("Entity embeddings for high-cardinality categoricals");
  }
  const detail = signals.map((s) => `• ${s.label}: ${s.detail}`).join("\n");
  const goalLine = goal
    ? `\n\nFor your stated goal (${goal.task === "unknown" ? "as described" : goal.task}), a DL pipeline means a heavier stack, GPU time and far less interpretability — if you need explainability for stakeholders, I'd exhaust the ML route first.`
    : "";

  return {
    id: "dl-warning",
    kind: "deep_learning_warning",
    title: "Deep Learning may be required",
    method: [...new Set(techniques)].slice(0, 3).join(" · ") || "Autoencoders / Transformers",
    family: "Deep Learning",
    column: null,
    rationale: `${DL_WARNING_TEXT}\n\nWhy I flagged this:\n${detail}${goalLine}`,
    confidence: 0.66,
    impact: "high",
    ops: [], // deliberately empty — nothing runs without explicit approval
    requiresExplicitApproval: true,
  };
}

/** Reply text used when the scientist approves the DL route. */
export function deepLearningApprovedText(signals: ComplexitySignal[]): string {
  const steps = [
    "1. Freeze a clean tabular baseline first (the ML proposals above) so you have something to beat.",
    "2. Encode the complex parts: sentence-transformer embeddings for free-text columns, entity embeddings for high-cardinality categoricals.",
    "3. Train an autoencoder on the numeric+embedded matrix; use reconstruction error as the anomaly score instead of Isolation Forest.",
    "4. Validate that the DL pipeline actually beats the ML baseline on a held-out split before adopting it.",
  ];
  return `Understood — proceeding on the Deep Learning track.\n\nThis platform cleans tabular data with Polars, so I won't train a network inside the grid. Here's the handoff plan I recommend:\n${steps.join("\n")}\n\nSignals that drove this: ${signals.map((s) => s.label).join(", ")}.\nI'll keep applying the safe ML-first cleaning steps meanwhile — they're prerequisites for the DL route too.`;
}

export function deepLearningRejectedText(): string {
  return "Staying on the traditional ML track — good call as a default. I'll keep every suggestion within KNN / Isolation Forest / scaling / statistical imputation. If your model plateaus on the validation split, revisit the Deep Learning option.";
}
