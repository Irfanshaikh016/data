"use client";

import { Bot, Radar, SendHorizontal, Sparkles, User, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ProposalCard, type Decision } from "@/components/proposal-card";
import type { ChatAction, ChatMessage, Proposal, Suggestion } from "@/lib/types";

interface CopilotProps {
  messages: ChatMessage[];
  suggestions: Suggestion[];
  busyChat: boolean;
  analyzing: boolean;
  hasDataset: boolean;
  disabledActions: boolean;
  decisions: Record<string, Decision>;
  onSend: (text: string) => void;
  onAction: (action: ChatAction) => void;
  onAnalyze: () => void;
  onApprove: (p: Proposal) => void;
  onReject: (p: Proposal) => void;
}

const IMPACT_DOT: Record<string, string> = {
  high: "bg-rose-400",
  medium: "bg-amber-300",
  low: "bg-sky-300",
};

const QUICK_PROMPTS = ["What should I fix first?", "Does this fit my goal?", "Why not Deep Learning?", "How bad are the nulls?"];

function ActionButton({ action, disabled, onAction }: { action: ChatAction; disabled: boolean; onAction: (a: ChatAction) => void }) {
  return (
    <button
      onClick={() => onAction(action)}
      disabled={disabled}
      title={action.description}
      className="group flex w-full items-start gap-2 rounded-lg border border-violet-400/20 bg-violet-400/[0.06] px-2.5 py-2 text-left transition hover:border-violet-400/50 hover:bg-violet-400/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300 transition group-hover:text-violet-200" />
      <span>
        <span className="block text-[12px] font-medium text-violet-100">{action.label}</span>
        <span className="mt-0.5 block text-[10.5px] leading-snug text-zinc-500">{action.description}</span>
      </span>
    </button>
  );
}

export function Copilot({
  messages,
  suggestions,
  busyChat,
  analyzing,
  hasDataset,
  disabledActions,
  decisions,
  onSend,
  onAction,
  onAnalyze,
  onApprove,
  onReject,
}: CopilotProps) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busyChat]);

  return (
    <div className="flex h-full flex-col bg-panel/60">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-edge bg-panel2/70 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-violet-400/30 bg-violet-400/10">
            <Bot className="h-4 w-4 text-violet-300" />
          </div>
          <div>
            <div className="text-[13px] font-semibold text-zinc-100">AI Co-pilot</div>
            <div className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-violet-300/70">profiling engine · online</div>
          </div>
        </div>
        <button
          onClick={onAnalyze}
          disabled={!hasDataset || analyzing || disabledActions}
          title="Profile the entire dataset and propose ML-first actions"
          className="flex items-center gap-1.5 rounded-lg border border-violet-400/40 bg-violet-400/15 px-2.5 py-1.5 text-[11.5px] font-semibold text-violet-100 transition hover:bg-violet-400/25 disabled:opacity-40"
        >
          <Radar className={`h-3.5 w-3.5 ${analyzing ? "animate-spin" : ""}`} />
          {analyzing ? "Analyzing…" : "Analyze dataset"}
        </button>
      </div>

      {/* Live suggestions */}
      {suggestions.length > 0 && (
        <div className="border-b border-edge bg-panel/40 px-3 py-2.5">
          <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-zinc-500">live suggestions</div>
          <div className="space-y-1.5">
            {suggestions.slice(0, 3).map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg border border-edge bg-panel2/60 px-2.5 py-1.5">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${IMPACT_DOT[s.impact]}`} />
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-zinc-300" title={s.detail}>
                  {s.title}
                </span>
                <button
                  onClick={() => onAction({ label: s.title, description: s.detail, ops: [s.op] })}
                  disabled={disabledActions}
                  className="shrink-0 rounded border border-lime-300/25 bg-lime-300/10 px-2 py-0.5 font-mono text-[10px] text-lime-200 transition hover:bg-lime-300/20 disabled:opacity-40"
                >
                  apply
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[88%] rounded-xl rounded-br-sm border border-lime-300/20 bg-lime-300/10 px-3 py-2 text-[12.5px] leading-relaxed text-lime-50">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={m.id} className="animate-fade-up flex gap-2">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-violet-400/25 bg-violet-400/10">
                {m.role === "assistant" ? <Bot className="h-3.5 w-3.5 text-violet-300" /> : <User className="h-3.5 w-3.5 text-zinc-400" />}
              </div>
              <div className="min-w-0 max-w-[92%]">
                <div className="whitespace-pre-wrap rounded-xl rounded-tl-sm border border-edge bg-panel2/70 px-3 py-2 text-[12.5px] leading-relaxed text-zinc-300">
                  {m.content}
                </div>
                {m.proposals && m.proposals.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {m.proposals.map((p) => (
                      <ProposalCard
                        key={p.id}
                        proposal={p}
                        decision={decisions[p.id]}
                        disabled={disabledActions}
                        onApprove={onApprove}
                        onReject={onReject}
                      />
                    ))}
                  </div>
                )}
                {m.actions && m.actions.length > 0 && (
                  <div className="mt-1.5 space-y-1.5">
                    {m.actions.map((a, i) => (
                      <ActionButton key={i} action={a} disabled={disabledActions} onAction={onAction} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ),
        )}
        {busyChat && (
          <div className="flex gap-2">
            <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-md border border-violet-400/25 bg-violet-400/10">
              <Bot className="h-3.5 w-3.5 text-violet-300" />
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-edge bg-panel2/70 px-3 py-2.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-1.5 w-1.5 animate-blink-dot rounded-full bg-violet-300/80" style={{ animationDelay: `${i * 150}ms` }} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Quick prompts + input */}
      <div className="border-t border-edge bg-panel2/50 p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q}
              onClick={() => onSend(q)}
              disabled={busyChat}
              className="rounded-full border border-edge px-2.5 py-1 text-[10.5px] text-zinc-400 transition hover:border-violet-400/40 hover:text-violet-200 disabled:opacity-40"
            >
              {q}
            </button>
          ))}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) {
              onSend(draft.trim());
              setDraft("");
            }
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask for cleaning advice…"
            className="min-w-0 flex-1 rounded-lg border border-edge bg-ink px-3 py-2 text-[12.5px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-400/50"
          />
          <button
            type="submit"
            disabled={busyChat || !draft.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-400/90 text-zinc-950 transition hover:bg-violet-300 disabled:opacity-40"
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
