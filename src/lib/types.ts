// Shared types used by both the API routes (server) and the UI (client).

export type CellValue = string | number | boolean | null;
export type PreviewRow = Record<string, CellValue>;

/** A single step in the user's cleaning recipe. Re-applied in order. */
export interface Op {
  type:
    | "fill_null"
    | "drop_nulls"
    | "drop_duplicates"
    | "drop_column"
    | "rename_column"
    | "cast"
    | "trim"
    | "normalize_case"
    | "knn_impute"
    | "cap_outliers"
    | "drop_outliers"
    | "drop_row"
    | "iforest_outliers"
    | "scale";
  column?: string;
  strategy?: "mean" | "median" | "mode" | "forward" | "constant";
  value?: string;
  to?: string;
  mode?: "lower" | "upper";
  /** KNN imputer neighbor count. */
  k?: number;
  /** IQR multiplier for outlier bounds. */
  multiplier?: number;
  /** 0-based row index for drop_row. */
  index?: number;
  /** Isolation Forest expected anomaly share (0.001–0.4). */
  contamination?: number;
  /** Scaler kind. */
  scaler?: "standard" | "minmax";
  /** Feature columns for multivariate ML ops (defaults to all numeric). */
  features?: string[];
  /** Human readable label shown in the recipe rail. */
  label?: string;
}

export interface ColumnProfile {
  name: string;
  dtype: string;
  nulls: number;
  nullPct: number;
  unique: number;
  /** Sample display values (first non-null values seen). */
  sample: string[];
  /** 0..1 — share of non-null string values that parse as numbers. */
  numericLike: number;
  /** Count of string values with leading/trailing whitespace. */
  whitespace: number;
  /** Count of values that collide with another value when lowercased. */
  caseCollisions: number;
}

export interface Suggestion {
  id: string;
  title: string;
  detail: string;
  confidence: number; // 0..1
  impact: "high" | "medium" | "low";
  op: Op;
}

export interface DatasetPayload {
  id: string;
  name: string;
  totalRows: number;
  totalCols: number;
  chunks: number;
  fileBytes: number;
  dupes: number;
  columns: ColumnProfile[];
  rows: PreviewRow[]; // first 100 rows
  recipe: Op[];
  suggestions: Suggestion[];
  /** Snapshots available for undo (state-mangement stack depth). */
  undoDepth: number;
  engine: { ingest: string; stats: string };
}

/** Response of GET /api/datasets/:id/profile?column=X (Task 2 profiler). */
export interface ColumnProfileResponse {
  column: string;
  dtype: string;
  totalRows: number;
  nulls: number;
  nullPct: number;
  unique: number;
  sample: string[];
  /** True when stats below were computed on numeric values. */
  numeric: boolean;
  /** True when a text column was coerced to numbers for the stats. */
  coerced: boolean;
  stats?: {
    min: number;
    q1: number;
    median: number;
    q3: number;
    max: number;
    mean: number;
    std: number;
    iqr: number;
  };
  outliers?: {
    count: number;
    pct: number;
    lowerBound: number;
    upperBound: number;
    multiplier: number;
  };
  histogram?: { bins: number[]; min: number; max: number };
  topValues?: { value: string; count: number }[];
  whitespace: number;
  caseCollisions: number;
  sampled: boolean;
  tips: string[];
}

export interface ChatAction {
  label: string;
  description: string;
  /** Ops applied in order when the action is taken. */
  ops: Op[];
}

export interface ChatReply {
  reply: string;
  actions: ChatAction[];
  /** When true, the client should refetch the dataset (chat executed a state change). */
  refresh?: boolean;
}

// ---------------------------------------------------------------------------
// Task 4 — ML-first co-pilot, goal alignment and the approval system
// ---------------------------------------------------------------------------

export type MlTask = "classification" | "regression" | "clustering" | "nlp" | "timeseries" | "eda" | "unknown";

/** Parsed interpretation of the user's stated objective. */
export interface GoalSpec {
  raw: string;
  task: MlTask;
  /** Detected target/label column, if the goal names one. */
  target: string | null;
  /** Short restatement shown in the UI. */
  summary: string;
  keywords: string[];
}

export type ProposalKind = "ml" | "cleaning" | "deep_learning_warning";

/** A suggestion awaiting the data scientist's Approve/Reject decision. */
export interface Proposal {
  id: string;
  kind: ProposalKind;
  title: string;
  /** Why the co-pilot proposes this. */
  rationale: string;
  /** Named technique, e.g. "KNN Imputer", "Isolation Forest", "StandardScaler". */
  method: string;
  /** "Traditional ML" (Rule A) or "Deep Learning" (Rule B, approval required). */
  family: "Traditional ML" | "Statistical" | "Deep Learning";
  column: string | null;
  confidence: number;
  impact: "high" | "medium" | "low";
  /** Ops sent to /api/apply_cleaning on approval (empty for DL warnings). */
  ops: Op[];
  /** Goal-alignment note: how this helps the stated objective. */
  goalNote?: string;
  /** Goal-alignment RISK: how this could harm the objective. */
  goalWarning?: string;
  /** True when the proposal must never auto-run (Rule B). */
  requiresExplicitApproval?: boolean;
}

export interface ComplexitySignal {
  code: "high_dimensionality" | "unstructured_text" | "pii" | "nonlinear_anomalies" | "high_cardinality";
  label: string;
  detail: string;
  severity: "warn" | "critical";
}

export interface AnalyzeAllResponse {
  datasetId: string;
  goal: GoalSpec | null;
  headline: string;
  /** Rule A proposals — traditional ML / statistical, safe to approve. */
  proposals: Proposal[];
  /** Rule B — populated only when the data is judged highly complex. */
  deepLearningWarning: Proposal | null;
  complexity: {
    score: number;
    complex: boolean;
    signals: ComplexitySignal[];
  };
  dataset: {
    rows: number;
    cols: number;
    numericCols: number;
    textCols: number;
    dupes: number;
    missingPct: number;
  };
}

/** Universal command envelope accepted by POST /api/apply_cleaning. */
export interface UniversalCommand {
  column?: string;
  action_category: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface ApplyCleaningSuccess {
  ok: true;
  /** Labels of the ops committed in this batch. */
  applied: string[];
  /** Note of the snapshot restored (undo only). */
  restored: string | null;
  undoDepth: number;
  recipeLength: number;
  dataset: DatasetPayload;
}

export interface ApplyCleaningError {
  ok: false;
  error: string;
  undoDepth: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  actions?: ChatAction[];
  /** Proposals rendered as Approve / Reject cards. */
  proposals?: Proposal[];
  /** Decisions already taken, keyed by proposal id. */
  ts: number;
}
