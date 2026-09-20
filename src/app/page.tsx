"use client";

import { Columns3, Copy, Cpu, Download, FilePlus2, ListChecks, Rows3, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ColumnProfiler } from "@/components/column-profiler";
import { Copilot } from "@/components/copilot";
import { DataGrid } from "@/components/data-grid";
import { EmptyState } from "@/components/empty-state";
import { GoalBox } from "@/components/goal-box";
import type { Decision } from "@/components/proposal-card";
import { Toolbar } from "@/components/toolbar";
import type {
  AnalyzeAllResponse,
  ApplyCleaningSuccess,
  ChatAction,
  ChatMessage,
  ChatReply,
  DatasetPayload,
  GoalSpec,
  Op,
  Proposal,
} from "@/lib/types";

async function callApi<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return data as T;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  ts: 0,
  content:
    "Welcome to the co-pilot zone. Once a dataset lands on the left, I'll profile every column — nulls, duplicates, type mismatches, whitespace, casing — and hand you ranked, one-click fixes.\n\nTry the quick prompts below, or upload a CSV to watch me work.",
};

export default function Home() {
  const [payload, setPayload] = useState<DatasetPayload | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [selectedCol, setSelectedCol] = useState<string | null>(null);
  const [busyUpload, setBusyUpload] = useState(false);
  const [busyOp, setBusyOp] = useState(false);
  const [busyChat, setBusyChat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [goal, setGoal] = useState<GoalSpec | null>(null);
  const [busyGoal, setBusyGoal] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [dlSignals, setDlSignals] = useState<string[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);
  const msgSeq = useRef(0);
  const dragDepth = useRef(0);

  const nextMsgId = () => `m-${Date.now()}-${++msgSeq.current}`;
  const pushMsg = (m: Omit<ChatMessage, "id" | "ts">) =>
    setMessages((prev) => [...prev, { ...m, id: nextMsgId(), ts: Date.now() }]);

  const resetGoalState = () => {
    setGoal(null);
    setDecisions({});
    setDlSignals([]);
  };

  // Toast auto-dismiss
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  // ------------------------------------------------------------------ upload
  const afterLoad = useCallback((p: DatasetPayload) => {
    setPayload(p);
    setSelectedCol(null);
    resetGoalState();
    const found = p.suggestions.length;
    pushMsg({
      role: "assistant",
      content: `Profiled "${p.name}" — ${p.totalRows.toLocaleString()} rows × ${p.totalCols} columns, ingested in ${p.chunks} chunks.\n${
        found
          ? `I found ${found} issue${found === 1 ? "" : "s"} worth fixing (${p.dupes.toLocaleString()} duplicate rows included).`
          : "It looks remarkably clean — no duplicates, no null hotspots, sane dtypes."
      }\n\nNext: tell me your objective in the Goal box above the grid, then hit “Analyze dataset” — I'll return an ML-first plan you can approve step by step.`,
      actions: p.suggestions.slice(0, 3).map((s) => ({ label: s.title, description: s.detail, ops: [s.op] })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      setBusyUpload(true);
      setError(null);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const p = await callApi<DatasetPayload>("/api/upload", { method: "POST", body: fd });
        afterLoad(p);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setBusyUpload(false);
      }
    },
    [afterLoad],
  );

  const loadDemo = useCallback(async () => {
    setBusyUpload(true);
    setError(null);
    try {
      const p = await callApi<DatasetPayload>("/api/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ demo: true }),
      });
      afterLoad(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Demo load failed");
    } finally {
      setBusyUpload(false);
    }
  }, [afterLoad]);

  // Window-level drag & drop
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        dragDepth.current += 1;
        setDragging(true);
      }
    };
    const onDragLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f && !busyUpload) uploadFile(f);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [busyUpload, uploadFile]);

  // --------------------------------------------------------------------- ops
  // All mutations flow through the universal gateway (/api/apply_cleaning),
  // which snapshots the dataframe in memory before every batch.
  const applyOps = useCallback(
    async (ops: Op[], source: "manual" | "ai" = "manual") => {
      if (!payload || ops.length === 0) return;
      setBusyOp(true);
      setError(null);
      try {
        const res = await callApi<ApplyCleaningSuccess>("/api/apply_cleaning", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ datasetId: payload.id, source, ops }),
        });
        const p = res.dataset;
        setPayload(p);
        const labels = res.applied;
        pushMsg({
          role: "assistant",
          content:
            labels.length === 1
              ? `Applied: ${labels[0]}.\nSnapshot saved (undo depth ${res.undoDepth}) — grid re-profiled.`
              : `Applied ${labels.length} steps:\n${labels.map((l) => `• ${l}`).join("\n")}\nSnapshot saved (undo depth ${res.undoDepth}) — grid re-profiled.`,
        });
        if (selectedCol && !p.columns.some((c) => c.name === selectedCol)) setSelectedCol(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Operation failed";
        setError(msg);
        pushMsg({ role: "assistant", content: `That step failed: ${msg}\nThe recipe was left unchanged.` });
      } finally {
        setBusyOp(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payload, selectedCol],
  );

  const mutateRecipe = useCallback(
    async (mode: "undo" | "reset") => {
      if (!payload) return;
      setBusyOp(true);
      try {
        const res = await callApi<ApplyCleaningSuccess>("/api/apply_cleaning", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ datasetId: payload.id, [mode]: true }),
        });
        setPayload(res.dataset);
        pushMsg({
          role: "assistant",
          content:
            mode === "undo"
              ? `Reverted "${res.restored ?? "last batch"}" — dataframe restored from the in-memory snapshot (undo depth ${res.undoDepth}).`
              : "Recipe cleared — back to the raw upload. I snapshotted the previous state first, so Undo can bring it back.",
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      } finally {
        setBusyOp(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payload],
  );

  // -------------------------------------------------------------------- chat
  const sendChat = useCallback(
    async (text: string) => {
      if (busyChat) return;
      setBusyChat(true);
      pushMsg({ role: "user", content: text });
      try {
        const res = await callApi<ChatReply>("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ datasetId: payload?.id ?? null, message: text }),
        });
        pushMsg({ role: "assistant", content: res.reply, actions: res.actions });
        // The chat may have executed a state change (undo/reset) — re-sync.
        if (res.refresh && payload?.id) {
          const fresh = await callApi<DatasetPayload>(`/api/datasets/${payload.id}`);
          setPayload(fresh);
        }
      } catch (e) {
        pushMsg({ role: "assistant", content: `I hit an error: ${e instanceof Error ? e.message : "unknown"}` });
      } finally {
        setBusyChat(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busyChat, payload?.id],
  );

  const runAction = useCallback((a: ChatAction) => applyOps(a.ops, "ai"), [applyOps]);

  // ------------------------------------------------- goal / analyze / approve
  const submitGoal = useCallback(
    async (text: string) => {
      if (!payload) return;
      setBusyGoal(true);
      try {
        const res = await callApi<{ goal: GoalSpec | null }>(`/api/datasets/${payload.id}/goal`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ goal: text }),
        });
        setGoal(res.goal);
        pushMsg({
          role: "assistant",
          content: res.goal
            ? `Goal locked in: “${res.goal.raw}”.\n${res.goal.summary}\n\nEvery suggestion from here on is scored against this objective — and I'll flag any step that could hurt it. Hit “Analyze dataset” for the full ML-first plan.`
            : "Goal cleared.",
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not set goal");
      } finally {
        setBusyGoal(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payload],
  );

  const analyzeAll = useCallback(async () => {
    if (!payload) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await callApi<AnalyzeAllResponse>("/api/analyze_all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ datasetId: payload.id, goal: goal?.raw }),
      });
      setDlSignals(res.complexity.signals.map((s) => s.label));
      const proposals = [...res.proposals, ...(res.deepLearningWarning ? [res.deepLearningWarning] : [])];
      const policy = res.deepLearningWarning
        ? `\n\nComplexity score ${res.complexity.score} — signals: ${res.complexity.signals.map((s) => s.label).join(", ")}. Per my ML-first policy I have NOT run anything Deep Learning; see the warning card below.`
        : `\n\nML-first policy: ${res.dataset.numericCols} numeric / ${res.dataset.textCols} text columns look like standard tabular data, so traditional ML (KNN, Isolation Forest, scaling) is the right tool — no Deep Learning needed.`;
      pushMsg({
        role: "assistant",
        content: res.headline + policy + (proposals.length ? "\n\nApprove or reject each step:" : ""),
        proposals,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }, [payload, goal]);

  /** Approve — the ONLY path that sends a proposal to /apply_cleaning. */
  const approveProposal = useCallback(
    async (p: Proposal) => {
      if (p.kind === "deep_learning_warning") {
        setDecisions((d) => ({ ...d, [p.id]: "approved" }));
        pushMsg({
          role: "assistant",
          content: `Understood — proceeding on the Deep Learning track.\n\nThis workbench cleans tabular data with Polars, so I won't train a network inside the grid. Handoff plan:\n1. Freeze a clean tabular baseline (the ML steps above) so you have something to beat.\n2. Encode the hard parts: sentence-transformer embeddings for free text, entity embeddings for high-cardinality categoricals.\n3. Train an autoencoder on that matrix and use reconstruction error as the anomaly score instead of Isolation Forest.\n4. Only adopt the DL pipeline if it beats the ML baseline on a held-out split.\n\nSignals that drove this: ${dlSignals.join(", ") || "complexity checks"}.`,
        });
        return;
      }
      setDecisions((d) => ({ ...d, [p.id]: "approved" }));
      await applyOps(p.ops, "ai"); // → POST /api/apply_cleaning
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyOps, dlSignals],
  );

  const rejectProposal = useCallback((p: Proposal) => {
    setDecisions((d) => ({ ...d, [p.id]: "rejected" }));
    pushMsg({
      role: "assistant",
      content:
        p.kind === "deep_learning_warning"
          ? "Staying on the traditional ML track — a sound default. I'll keep every suggestion within KNN / Isolation Forest / scaling / statistical imputation. If your model plateaus on validation, revisit this."
          : `Rejected “${p.title}” — nothing was applied and the dataframe is untouched. I won't suggest it again in this pass.`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalNulls = payload?.columns.reduce((acc, c) => acc + c.nulls, 0) ?? 0;

  // ------------------------------------------------------------------ render
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink text-zinc-200">
      {/* App header */}
      <header className="flex h-13 shrink-0 items-center gap-3 border-b border-edge bg-panel/80 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-lime-300">
            <Cpu className="h-4 w-4 text-zinc-950" />
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-tight text-white">
              Clean<span className="text-lime-300">Grid</span>
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-500">hybrid data cleaning platform</div>
          </div>
        </div>

        {payload && (
          <div className="ml-4 hidden items-center gap-1.5 md:flex">
            <span className="max-w-[220px] truncate rounded-md border border-edge bg-panel2 px-2 py-1 font-mono text-[10.5px] text-zinc-400" title={payload.name}>
              {payload.name}
            </span>
            <Chip icon={<Rows3 className="h-3 w-3" />} value={payload.totalRows.toLocaleString()} />
            <Chip icon={<Columns3 className="h-3 w-3" />} value={String(payload.totalCols)} />
            <Chip icon={<ShieldAlert className="h-3 w-3" />} value={`${totalNulls.toLocaleString()} nulls`} warn={totalNulls > 0} />
            <Chip icon={<Copy className="h-3 w-3" />} value={`${payload.dupes.toLocaleString()} dupes`} warn={payload.dupes > 0} />
            <Chip icon={<ListChecks className="h-3 w-3" />} value={`${payload.recipe.length} steps`} active={payload.recipe.length > 0} />
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden rounded-md border border-edge bg-panel2 px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.15em] text-zinc-500 lg:block">
            manual 70 / ai 30 · polars engine
          </span>
          {payload && (
            <a
              href={`/api/datasets/${payload.id}/export`}
              className="flex items-center gap-1.5 rounded-lg bg-lime-300 px-3 py-1.5 text-[12px] font-semibold text-zinc-950 transition hover:bg-lime-200"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </a>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-edge2 bg-panel2 px-3 py-1.5 text-[12px] font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-white"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            {payload ? "New file" : "Open CSV"}
          </button>
        </div>
      </header>

      {/* Split screen */}
      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* LEFT — Manual Action Zone (70%) */}
        <section className="flex min-h-[55%] w-full min-w-0 flex-col lg:h-auto lg:w-[70%]">
          {payload ? (
            <>
              <GoalBox goal={goal} busy={busyGoal} onSubmit={submitGoal} />

              <Toolbar
                busy={busyOp || busyUpload}
                columns={payload.columns}
                totalRows={payload.totalRows}
                selectedCol={selectedCol}
                onSelectCol={setSelectedCol}
                canUndo={payload.undoDepth > 0}
                recipeCount={payload.recipe.length}
                onOp={(op) => applyOps([op])}
                onUndo={() => mutateRecipe("undo")}
                onReset={() => mutateRecipe("reset")}
              />

              <ColumnProfiler
                datasetId={payload.id}
                column={selectedCol}
                refreshKey={`${payload.recipe.map((o) => o.type).join(".")}-${payload.totalRows}`}
              />

              {payload.recipe.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto border-b border-edge bg-panel/50 px-3 py-1.5">
                  <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.2em] text-zinc-600">recipe</span>
                  {payload.recipe.map((op, i) => (
                    <span
                      key={i}
                      className="flex shrink-0 items-center gap-1.5 rounded-full border border-edge bg-panel2 px-2.5 py-0.5 font-mono text-[10.5px] text-zinc-400"
                    >
                      <span className="text-lime-300/70">{String(i + 1).padStart(2, "0")}</span>
                      {op.label ?? op.type}
                      {i === payload.recipe.length - 1 && (
                        <button onClick={() => mutateRecipe("undo")} className="ml-0.5 text-zinc-600 transition hover:text-rose-300" title="Undo this step">
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                  <span
                    className="ml-auto shrink-0 rounded-full border border-edge bg-ink px-2 py-0.5 font-mono text-[9.5px] text-zinc-600"
                    title="In-memory dataframe snapshots available for Undo"
                  >
                    snapshots: {payload.undoDepth}
                  </span>
                </div>
              )}

              <div className="relative min-h-0 flex-1">
                <DataGrid
                  columns={payload.columns}
                  rows={payload.rows}
                  totalRows={payload.totalRows}
                  chunks={payload.chunks}
                  recipeCount={payload.recipe.length}
                  selected={selectedCol}
                  busy={busyOp}
                  onSelect={setSelectedCol}
                />
              </div>
            </>
          ) : (
            <EmptyState busy={busyUpload} onBrowse={() => fileRef.current?.click()} onDemo={loadDemo} onDropFile={uploadFile} />
          )}
        </section>

        {/* RIGHT — AI Co-pilot Zone (30%) */}
        <aside className="w-full border-t border-edge lg:h-auto lg:w-[30%] lg:min-w-[350px] lg:border-l lg:border-t-0">
          <Copilot
            messages={messages}
            suggestions={payload?.suggestions ?? []}
            busyChat={busyChat}
            analyzing={analyzing}
            hasDataset={!!payload}
            disabledActions={!payload || busyOp || busyUpload}
            decisions={decisions}
            onSend={sendChat}
            onAction={runAction}
            onAnalyze={analyzeAll}
            onApprove={approveProposal}
            onReject={rejectProposal}
          />
        </aside>
      </main>

      {/* Error toast */}
      {error && (
        <div className="animate-fade-up fixed bottom-5 left-5 z-50 max-w-md rounded-xl border border-rose-400/30 bg-rose-950/90 px-4 py-3 text-[12.5px] text-rose-100 shadow-2xl backdrop-blur">
          {error}
        </div>
      )}

      {/* Global drag overlay */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-lime-300/60 bg-panel px-10 py-8 text-center">
            <div className="text-lg font-semibold text-lime-200">Drop to ingest</div>
            <div className="mt-1 font-mono text-[11px] text-zinc-500">streamed chunk-by-chunk → first 100 rows + full profile</div>
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function Chip({ icon, value, warn, active }: { icon: React.ReactNode; value: string; warn?: boolean; active?: boolean }) {
  return (
    <span
      className={`flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10.5px] ${
        warn
          ? "border-amber-400/25 bg-amber-400/10 text-amber-200"
          : active
            ? "border-lime-300/25 bg-lime-300/10 text-lime-200"
            : "border-edge bg-panel2 text-zinc-400"
      }`}
    >
      {icon}
      {value}
    </span>
  );
}
