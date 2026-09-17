"use client";

import { DatabaseZap, FileUp, Loader2, Sparkles, Waves } from "lucide-react";
import { useState } from "react";

interface EmptyStateProps {
  busy: boolean;
  onBrowse: () => void;
  onDemo: () => void;
  onDropFile: (file: File) => void;
}

export function EmptyState({ busy, onBrowse, onDemo, onDropFile }: EmptyStateProps) {
  const [over, setOver] = useState(false);

  return (
    <div className="bg-blueprint relative flex h-full flex-col items-center justify-center overflow-hidden px-8">
      <div className="orb left-[8%] top-[12%] h-64 w-64 bg-lime-400/10" />
      <div className="orb bottom-[8%] right-[10%] h-72 w-72 bg-violet-500/10" />

      <div className="animate-fade-up relative z-10 w-full max-w-xl">
        <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-lime-300/80">
          <Waves className="h-3.5 w-3.5" />
          Manual Action Zone
        </div>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight text-zinc-100">
          Drop a messy CSV.
          <br />
          <span className="text-zinc-500">Leave with a clean one.</span>
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-zinc-500">
          Streamed chunk-by-chunk, profiled by the Polars engine, cleaned with manual tools — or let the
          co-pilot on the right apply its ranked fixes for you.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onDropFile(f);
          }}
          className={`mt-8 rounded-2xl border border-dashed p-8 transition-all duration-300 ${
            over
              ? "border-lime-300/70 bg-lime-300/5 shadow-[0_0_60px_-15px_rgba(163,230,53,0.25)]"
              : "border-edge2 bg-panel/60 hover:border-zinc-600"
          }`}
        >
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-edge bg-panel2">
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin text-lime-300" />
              ) : (
                <FileUp className="h-5 w-5 text-lime-300" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-200">
                {busy ? "Streaming chunks & profiling…" : "Drag your CSV here, or browse"}
              </p>
              <p className="mt-1 font-mono text-[11px] text-zinc-600">header row required · up to 64 MB</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onBrowse}
                disabled={busy}
                className="rounded-lg bg-lime-300 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-lime-200 disabled:opacity-50"
              >
                Browse CSV
              </button>
              <button
                onClick={onDemo}
                disabled={busy}
                className="flex items-center gap-2 rounded-lg border border-edge2 bg-panel2 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-violet-400/50 hover:text-white disabled:opacity-50"
              >
                <DatabaseZap className="h-4 w-4 text-violet-300" />
                Load messy demo data
              </button>
            </div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-3 gap-3 font-mono text-[10.5px] leading-relaxed text-zinc-600">
          {[
            ["chunked ingest", "64 KB blocks, first 100 rows streamed"],
            ["polars profiling", "dtypes, nulls, dupes in one pass"],
            ["replayable recipe", "ops stack, never mutates the source"],
          ].map(([t, d]) => (
            <div key={t} className="rounded-lg border border-edge bg-panel/40 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-zinc-400">
                <Sparkles className="h-3 w-3 text-lime-300/70" />
                {t}
              </div>
              {d}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
