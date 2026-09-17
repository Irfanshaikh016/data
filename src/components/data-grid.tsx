"use client";

import { Braces, Loader2 } from "lucide-react";
import type { CellValue, ColumnProfile, PreviewRow } from "@/lib/types";

interface DataGridProps {
  columns: ColumnProfile[];
  rows: PreviewRow[];
  totalRows: number;
  chunks: number;
  recipeCount: number;
  selected: string | null;
  busy: boolean;
  onSelect: (col: string | null) => void;
}

function dtypeColor(dtype: string): string {
  if (/^(Int|UInt|Float|Decimal)/.test(dtype)) return "text-sky-300 border-sky-400/20 bg-sky-400/10";
  if (dtype === "Boolean") return "text-fuchsia-300 border-fuchsia-400/20 bg-fuchsia-400/10";
  if (/^(Date|Datetime|Time)/.test(dtype)) return "text-teal-300 border-teal-400/20 bg-teal-400/10";
  return "text-zinc-400 border-white/10 bg-white/5";
}

function Cell({ value }: { value: CellValue | undefined }) {
  if (value === null || value === undefined) {
    return (
      <span className="inline-block rounded bg-amber-400/10 px-1.5 py-px font-mono text-[11px] italic text-amber-300/80">
        null
      </span>
    );
  }
  if (typeof value === "number") {
    return <span className="block text-right font-mono text-zinc-300 tabular-nums">{value.toLocaleString()}</span>;
  }
  if (typeof value === "boolean") {
    return <span className="font-mono text-fuchsia-300/90">{String(value)}</span>;
  }
  return <span className="block max-w-[260px] truncate font-mono text-zinc-300" title={value}>{value}</span>;
}

export function DataGrid({ columns, rows, totalRows, chunks, recipeCount, selected, busy, onSelect }: DataGridProps) {
  const shown = Math.min(rows.length, 100);
  return (
    <div className="relative flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-30 w-12 border-b border-r border-edge bg-panel2 px-2 py-2 text-center font-mono text-[10px] font-normal text-zinc-600">
                #
              </th>
              {columns.map((c) => {
                const active = selected === c.name;
                return (
                  <th
                    key={c.name}
                    onClick={() => onSelect(active ? null : c.name)}
                    title="Click to target this column with manual tools"
                    className={`min-w-[140px] cursor-pointer select-none border-b border-r border-edge px-3 py-2 text-left align-top transition-colors ${
                      active ? "bg-lime-300/10" : "bg-panel2 hover:bg-panel2/70"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`truncate font-mono text-[12px] font-semibold ${active ? "text-lime-200" : "text-zinc-200"}`}>
                        {c.name}
                      </span>
                      <span className={`rounded border px-1 py-px font-mono text-[9.5px] uppercase tracking-wide ${dtypeColor(c.dtype)}`}>
                        {c.dtype}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <div className="h-[3px] w-14 overflow-hidden rounded-full bg-white/5">
                        <div
                          className={`h-full rounded-full ${c.nullPct > 0 ? "bg-amber-400/80" : "bg-emerald-400/50"}`}
                          style={{ width: c.nullPct > 0 ? `${Math.max(c.nullPct, 6)}%` : "100%" }}
                        />
                      </div>
                      <span className={`font-mono text-[9.5px] ${c.nulls > 0 ? "text-amber-300/70" : "text-zinc-600"}`}>
                        {c.nulls > 0 ? `${c.nulls.toLocaleString()} null · ${c.nullPct}%` : "no nulls"}
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={`${recipeCount}-${i}`}
                className="group animate-row-in"
                style={{ animationDelay: `${Math.min(i * 5, 250)}ms` }}
              >
                <td className="sticky left-0 z-10 border-b border-r border-edge bg-panel px-2 py-[5px] text-center font-mono text-[10px] text-zinc-600 group-hover:text-zinc-400">
                  {i + 1}
                </td>
                {columns.map((c) => (
                  <td
                    key={c.name}
                    className={`border-b border-r border-edge/60 px-3 py-[5px] transition-colors group-hover:bg-white/[0.03] ${
                      selected === c.name ? "bg-lime-300/[0.05]" : ""
                    }`}
                  >
                    <Cell value={row[c.name]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-edge bg-panel2/80 px-3 py-1.5 font-mono text-[10.5px] text-zinc-500">
        <div className="flex items-center gap-1.5">
          <Braces className="h-3 w-3 text-zinc-600" />
          showing <span className="text-zinc-300">{shown}</span> of <span className="text-zinc-300">{totalRows.toLocaleString()}</span> rows
          <span className="text-zinc-700">·</span>
          ingested in <span className="text-zinc-300">{chunks}</span> chunks
          <span className="text-zinc-700">·</span>
          <span className={recipeCount > 0 ? "text-lime-300/90" : ""}>{recipeCount} cleaning step{recipeCount === 1 ? "" : "s"}</span>
        </div>
        <span className="text-zinc-700">export downloads all rows</span>
      </div>

      {busy && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-ink/70 backdrop-blur-[2px]">
          <Loader2 className="h-6 w-6 animate-spin text-lime-300" />
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-400">
            polars is replaying your recipe
          </p>
        </div>
      )}
    </div>
  );
}
