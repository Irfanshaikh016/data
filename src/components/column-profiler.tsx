"use client";

import { Activity, AlertTriangle, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { ColumnProfileResponse } from "@/lib/types";

interface ColumnProfilerProps {
  datasetId: string;
  column: string | null;
  /** Bumped whenever the recipe changes so stats refetch. */
  refreshKey: string;
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : String(v));

function Stat({ label, value, accent }: { label: string; value: string; accent?: "amber" | "rose" | "lime" }) {
  const color =
    accent === "amber" ? "text-amber-300" : accent === "rose" ? "text-rose-300" : accent === "lime" ? "text-lime-300" : "text-zinc-200";
  return (
    <div className="flex flex-col justify-center rounded-lg border border-edge bg-ink/60 px-2.5 py-1">
      <span className="font-mono text-[8.5px] uppercase tracking-[0.15em] text-zinc-600">{label}</span>
      <span className={`font-mono text-[11.5px] tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

export function ColumnProfiler({ datasetId, column, refreshKey }: ColumnProfilerProps) {
  const [profile, setProfile] = useState<ColumnProfileResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!column) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetch(`/api/datasets/${datasetId}/profile?column=${encodeURIComponent(column)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? `Profile failed (${res.status})`);
        return body as ColumnProfileResponse;
      })
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((e) => {
        if (!cancelled) {
          setProfile(null);
          setError(e instanceof Error ? e.message : "Profile failed");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId, column, refreshKey]);

  if (!column) return null;

  const maxBin = profile?.histogram ? Math.max(...profile.histogram.bins, 1) : 1;

  return (
    <div className="border-b border-edge bg-panel2/40 px-3 py-2">
      <div className="flex items-center gap-2 overflow-x-auto">
        <div className="flex shrink-0 items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-zinc-500">
          <Activity className="h-3.5 w-3.5 text-violet-300/80" />
          profiler
        </div>
        <span className="shrink-0 font-mono text-[11.5px] font-semibold text-zinc-200">{column}</span>

        {loading && !profile && (
          <div className="flex h-9 flex-1 animate-pulse items-center gap-2">
            <div className="h-7 w-20 rounded-lg bg-white/5" />
            <div className="h-7 w-24 rounded-lg bg-white/5" />
            <div className="h-7 w-28 rounded-lg bg-white/5" />
          </div>
        )}

        {error && (
          <span className="flex items-center gap-1 text-[11px] text-rose-300">
            <AlertTriangle className="h-3 w-3" /> {error}
          </span>
        )}

        {profile && (
          <>
            <span className="shrink-0 rounded border border-violet-400/25 bg-violet-400/10 px-1.5 py-1 font-mono text-[10px] uppercase text-violet-200">
              {profile.dtype}
              {profile.coerced ? " → numeric" : ""}
            </span>
            <Stat label="missing" value={`${profile.nullPct}% (${profile.nulls.toLocaleString()})`} accent={profile.nulls > 0 ? "amber" : "lime"} />
            {profile.numeric && profile.stats && (
              <>
                <Stat label="outliers" value={`${profile.outliers?.count.toLocaleString()} (${profile.outliers?.pct}%)`} accent={(profile.outliers?.count ?? 0) > 0 ? "rose" : "lime"} />
                <Stat label="min" value={fmt(profile.stats.min)} />
                <Stat label="median" value={fmt(profile.stats.median)} />
                <Stat label="mean" value={fmt(profile.stats.mean)} />
                <Stat label="max" value={fmt(profile.stats.max)} />
              </>
            )}
            {profile.histogram && (
              <div
                className="ml-1 flex h-8 shrink-0 items-end gap-px rounded-md border border-edge bg-ink/60 px-1.5 py-1"
                title={`range ${fmt(profile.histogram.min)} → ${fmt(profile.histogram.max)}`}
              >
                {profile.histogram.bins.map((b, i) => (
                  <div
                    key={i}
                    className="w-[7px] rounded-sm bg-violet-400/60 transition-all hover:bg-violet-300"
                    style={{ height: `${Math.max(6, (b / maxBin) * 100)}%` }}
                    title={`bin ${i + 1}: ${b.toLocaleString()} values`}
                  />
                ))}
              </div>
            )}
            {!profile.numeric && profile.topValues && (
              <div className="flex shrink-0 items-center gap-1">
                <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">top</span>
                {profile.topValues.slice(0, 3).map((t) => (
                  <span key={t.value} className="max-w-[140px] truncate rounded border border-edge bg-ink/60 px-1.5 py-1 font-mono text-[10px] text-zinc-400" title={t.value}>
                    {t.value} <span className="text-zinc-600">×{t.count.toLocaleString()}</span>
                  </span>
                ))}
              </div>
            )}
            <span className="ml-auto hidden shrink-0 items-center gap-1.5 pl-2 text-[10.5px] italic text-violet-300/80 2xl:flex">
              <Sparkles className="h-3 w-3 shrink-0" />
              <span className="max-w-[420px] truncate" title={profile.tips[0]}>{profile.tips[0]}</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
