"use client";

import { AlertTriangle, BrainCircuit, Check, Cpu, Sigma, Target, ThumbsDown, X } from "lucide-react";
import type { Proposal } from "@/lib/types";

export type Decision = "approved" | "rejected";

interface ProposalCardProps {
  proposal: Proposal;
  decision?: Decision;
  disabled: boolean;
  onApprove: (p: Proposal) => void;
  onReject: (p: Proposal) => void;
}

const FAMILY_STYLE: Record<Proposal["family"], { chip: string; icon: typeof Cpu }> = {
  "Traditional ML": { chip: "border-sky-400/30 bg-sky-400/10 text-sky-200", icon: Cpu },
  Statistical: { chip: "border-zinc-400/25 bg-white/5 text-zinc-300", icon: Sigma },
  "Deep Learning": { chip: "border-orange-400/40 bg-orange-400/10 text-orange-200", icon: BrainCircuit },
};

const IMPACT_DOT: Record<string, string> = {
  high: "bg-rose-400",
  medium: "bg-amber-300",
  low: "bg-sky-300",
};

export function ProposalCard({ proposal: p, decision, disabled, onApprove, onReject }: ProposalCardProps) {
  const isDL = p.kind === "deep_learning_warning";
  const fam = FAMILY_STYLE[p.family];
  const FamIcon = fam.icon;

  return (
    <div
      className={`animate-fade-up rounded-xl border p-2.5 transition ${
        isDL
          ? "border-orange-400/40 bg-orange-400/[0.07] shadow-[0_0_40px_-20px_rgba(251,146,60,0.6)]"
          : decision === "approved"
            ? "border-lime-300/30 bg-lime-300/[0.05]"
            : decision === "rejected"
              ? "border-edge bg-panel/40 opacity-60"
              : "border-edge2 bg-panel2/70"
      }`}
    >
      <div className="flex items-start gap-2">
        {isDL ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-300" />
        ) : (
          <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${IMPACT_DOT[p.impact]}`} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`text-[12.5px] font-semibold ${isDL ? "text-orange-100" : "text-zinc-100"}`}>{p.title}</span>
            <span className={`flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[9px] uppercase tracking-wide ${fam.chip}`}>
              <FamIcon className="h-2.5 w-2.5" />
              {p.family}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-zinc-500">
            {p.method}
            {p.column ? ` · ${p.column}` : ""} · confidence {Math.round(p.confidence * 100)}%
          </div>
        </div>
      </div>

      <p className={`mt-1.5 whitespace-pre-wrap text-[11.5px] leading-relaxed ${isDL ? "text-orange-50/90" : "text-zinc-400"}`}>
        {p.rationale}
      </p>

      {p.goalNote && (
        <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-violet-400/20 bg-violet-400/[0.07] px-2 py-1.5">
          <Target className="mt-0.5 h-3 w-3 shrink-0 text-violet-300" />
          <span className="text-[11px] leading-snug text-violet-100/90">{p.goalNote}</span>
        </div>
      )}
      {p.goalWarning && (
        <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/[0.08] px-2 py-1.5">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" />
          <span className="text-[11px] leading-snug text-amber-100/90">
            <span className="font-semibold">Goal risk: </span>
            {p.goalWarning}
          </span>
        </div>
      )}

      {decision ? (
        <div
          className={`mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1 font-mono text-[10.5px] ${
            decision === "approved" ? "bg-lime-300/10 text-lime-300" : "bg-white/[0.04] text-zinc-500"
          }`}
        >
          {decision === "approved" ? <Check className="h-3 w-3" /> : <ThumbsDown className="h-3 w-3" />}
          {decision === "approved"
            ? isDL
              ? "Deep Learning route approved"
              : "Approved — applied via /apply_cleaning"
            : "Rejected — nothing was applied"}
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-1.5">
          <button
            onClick={() => onApprove(p)}
            disabled={disabled}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition disabled:opacity-40 ${
              isDL ? "bg-orange-400 text-zinc-950 hover:bg-orange-300" : "bg-lime-300 text-zinc-950 hover:bg-lime-200"
            }`}
          >
            <Check className="h-3.5 w-3.5" />
            {isDL ? "Yes, proceed with DL" : "Approve"}
          </button>
          <button
            onClick={() => onReject(p)}
            disabled={disabled}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-edge2 px-2.5 py-1.5 text-[11.5px] font-medium text-zinc-400 transition hover:border-rose-400/40 hover:text-rose-200 disabled:opacity-40"
          >
            <X className="h-3.5 w-3.5" />
            {isDL ? "No, stay with ML" : "Reject"}
          </button>
        </div>
      )}
    </div>
  );
}
