"use client";

import { Crosshair, Loader2, Pencil, Target } from "lucide-react";
import { useState } from "react";
import type { GoalSpec } from "@/lib/types";

interface GoalBoxProps {
  goal: GoalSpec | null;
  busy: boolean;
  onSubmit: (goal: string) => void;
}

const EXAMPLES = [
  "I want to build a classification model for churn",
  "Forecast monthly revenue per city",
  "Cluster customers into segments",
];

const TASK_STYLE: Record<string, string> = {
  classification: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  regression: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  clustering: "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200",
  timeseries: "border-teal-400/30 bg-teal-400/10 text-teal-200",
  nlp: "border-orange-400/30 bg-orange-400/10 text-orange-200",
  eda: "border-zinc-400/30 bg-zinc-400/10 text-zinc-300",
  unknown: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400",
};

export function GoalBox({ goal, busy, onSubmit }: GoalBoxProps) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  if (goal && !editing) {
    return (
      <div className="flex items-center gap-2 border-b border-edge bg-gradient-to-r from-violet-500/[0.07] to-transparent px-3 py-2">
        <Target className="h-3.5 w-3.5 shrink-0 text-violet-300" />
        <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.2em] text-zinc-500">goal</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-200" title={goal.raw}>
          {goal.raw}
        </span>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-wide ${TASK_STYLE[goal.task]}`}>
          {goal.task}
        </span>
        {goal.target && (
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-lime-300/25 bg-lime-300/10 px-2 py-0.5 font-mono text-[9.5px] text-lime-200">
            <Crosshair className="h-2.5 w-2.5" />
            target: {goal.target}
          </span>
        )}
        <button
          onClick={() => {
            setDraft(goal.raw);
            setEditing(true);
          }}
          className="shrink-0 rounded-md border border-edge p-1 text-zinc-500 transition hover:text-zinc-200"
          title="Edit goal"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-edge bg-gradient-to-r from-violet-500/[0.07] to-transparent px-3 py-2.5">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) {
            onSubmit(draft.trim());
            setEditing(false);
          }
        }}
      >
        <Target className="h-4 w-4 shrink-0 text-violet-300" />
        <input
          autoFocus={editing}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What's your objective? e.g. “I want to build a classification model for churn”"
          className="min-w-0 flex-1 rounded-lg border border-edge bg-ink px-3 py-1.5 text-[12.5px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-400/60"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-400/90 px-3 py-1.5 text-[12px] font-semibold text-zinc-950 transition hover:bg-violet-300 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Target className="h-3.5 w-3.5" />}
          Set goal
        </button>
        {editing && (
          <button type="button" onClick={() => setEditing(false)} className="shrink-0 px-2 text-[11.5px] text-zinc-500 hover:text-zinc-300">
            Cancel
          </button>
        )}
      </form>
      {!editing && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6">
          <span className="font-mono text-[9.5px] uppercase tracking-widest text-zinc-600">try</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => onSubmit(ex)}
              disabled={busy}
              className="rounded-full border border-edge px-2 py-0.5 text-[10.5px] text-zinc-500 transition hover:border-violet-400/40 hover:text-violet-200 disabled:opacity-40"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
