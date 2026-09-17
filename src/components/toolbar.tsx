"use client";

import {
  CaseLower,
  ChevronDown,
  CopyX,
  Dna,
  Eraser,
  Filter,
  GitCommitHorizontal,
  ListX,
  PaintBucket,
  PenLine,
  Replace,
  RotateCcw,
  Rows3,
  Scissors,
  Spline,
  Trash2,
  Undo2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ColumnProfile, Op } from "@/lib/types";

interface ToolbarProps {
  busy: boolean;
  columns: ColumnProfile[];
  totalRows: number;
  selectedCol: string | null;
  onSelectCol: (col: string | null) => void;
  canUndo: boolean;
  recipeCount: number;
  onOp: (op: Op) => void;
  onUndo: () => void;
  onReset: () => void;
}

type MenuId = "columns" | "missing" | "outliers" | "edit" | "colops";

const inputCls =
  "w-full rounded-md border border-edge bg-ink px-2 py-1 font-mono text-[11.5px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-lime-300/50";

function Dropdown({
  id,
  open,
  setOpen,
  icon: Icon,
  label,
  disabled,
  highlight,
  width = "w-60",
  children,
}: {
  id: MenuId;
  open: MenuId | null;
  setOpen: (m: MenuId | null) => void;
  icon: LucideIcon;
  label: ReactNode;
  disabled?: boolean;
  highlight?: boolean;
  width?: string;
  children: ReactNode;
}) {
  const isOpen = open === id;
  return (
    <div className="relative">
      <button
        disabled={disabled}
        onClick={() => setOpen(isOpen ? null : id)}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-35 ${
          highlight
            ? "border-lime-300/30 bg-lime-300/10 text-lime-100 hover:bg-lime-300/20"
            : "border-edge bg-panel2 text-zinc-300 hover:border-edge2 hover:text-white"
        } ${isOpen ? "ring-1 ring-lime-300/40" : ""}`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-[170px] truncate">{label}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 opacity-60 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(null)} />
          <div
            className={`animate-fade-up absolute left-0 top-full z-50 mt-1.5 ${width} rounded-xl border border-edge2 bg-panel2/95 p-2 shadow-2xl shadow-black/60 backdrop-blur-md`}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function ActionBtn({
  label,
  onClick,
  disabled,
  danger,
  icon: Icon,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition disabled:opacity-40 ${
        danger
          ? "border-rose-400/30 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20"
          : "border-edge bg-white/[0.04] text-zinc-300 hover:border-lime-300/30 hover:text-white"
      }`}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {label}
    </button>
  );
}

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <div className="px-1 pb-1 pt-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-600 first:pt-0">{children}</div>
);

export function Toolbar({
  busy,
  columns,
  totalRows,
  selectedCol,
  onSelectCol,
  canUndo,
  recipeCount,
  onOp,
  onUndo,
  onReset,
}: ToolbarProps) {
  const [open, setOpen] = useState<MenuId | null>(null);
  const [customValue, setCustomValue] = useState("");
  const [knnK, setKnnK] = useState(5);
  const [iqrM, setIqrM] = useState(1.5);
  const [rowIdx, setRowIdx] = useState("");
  const [castTo, setCastTo] = useState("Float64");
  const [renameTo, setRenameTo] = useState("");
  const [normMode, setNormMode] = useState<"lower" | "upper">("lower");

  const sel = columns.find((c) => c.name === selectedCol);
  const colDisabled = busy || !selectedCol;

  const fire = (op: Op) => {
    onOp(op);
    setOpen(null);
  };

  const rowNum = Number(rowIdx);
  const validRow = Number.isInteger(rowNum) && rowNum >= 1 && rowNum <= totalRows;

  return (
    <div className="border-b border-edge bg-panel/80">
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
        <div className="mr-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          <Wrench className="h-3.5 w-3.5 text-lime-300/80" />
          Manual tools
        </div>

        {/* Column picker */}
        <Dropdown
          id="columns"
          open={open}
          setOpen={setOpen}
          icon={Rows3}
          highlight={!!selectedCol}
          label={selectedCol ? `Column: ${selectedCol}` : "Select column"}
          disabled={busy}
          width="w-64"
        >
          <div className="max-h-72 overflow-y-auto">
            {columns.map((c) => (
              <button
                key={c.name}
                onClick={() => {
                  onSelectCol(c.name === selectedCol ? null : c.name);
                  setOpen(null);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-white/[0.06] ${
                  c.name === selectedCol ? "bg-lime-300/10" : ""
                }`}
              >
                <span className={`min-w-0 flex-1 truncate font-mono text-[11.5px] ${c.name === selectedCol ? "text-lime-200" : "text-zinc-200"}`}>
                  {c.name}
                </span>
                <span className="shrink-0 rounded border border-white/10 bg-white/5 px-1 py-px font-mono text-[9px] uppercase text-zinc-500">
                  {c.dtype}
                </span>
                {c.nulls > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/80" title={`${c.nulls} nulls`} />}
              </button>
            ))}
          </div>
        </Dropdown>

        {/* Missing Values */}
        <Dropdown id="missing" open={open} setOpen={setOpen} icon={PaintBucket} label="Missing Values" disabled={colDisabled}>
          <SectionLabel>drop / impute · {selectedCol}</SectionLabel>
          <div className="grid grid-cols-4 gap-1">
            <ActionBtn label="Drop rows" disabled={busy} onClick={() => fire({ type: "drop_nulls", column: selectedCol! })} />
            <ActionBtn label="Mean" disabled={busy} onClick={() => fire({ type: "fill_null", column: selectedCol!, strategy: "mean" })} />
            <ActionBtn label="Median" disabled={busy} onClick={() => fire({ type: "fill_null", column: selectedCol!, strategy: "median" })} />
            <ActionBtn label="Mode" disabled={busy} onClick={() => fire({ type: "fill_null", column: selectedCol!, strategy: "mode" })} />
          </div>

          <SectionLabel>custom value</SectionLabel>
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (customValue !== "") fire({ type: "fill_null", column: selectedCol!, strategy: "constant", value: customValue });
            }}
          >
            <input
              className={inputCls}
              placeholder="e.g. Unknown or 0"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
            />
            <ActionBtn label="Fill" disabled={busy || customValue === ""} onClick={() => {}} />
          </form>

          <SectionLabel>knn imputer · numeric</SectionLabel>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              fire({ type: "knn_impute", column: selectedCol!, k: knnK });
            }}
          >
            <span className="shrink-0 font-mono text-[10.5px] text-zinc-500">k neighbors</span>
            <input
              type="number"
              min={1}
              max={25}
              value={knnK}
              onChange={(e) => setKnnK(Math.min(25, Math.max(1, Number(e.target.value) || 5)))}
              className={inputCls + " w-16"}
            />
            <ActionBtn label="Impute" icon={Dna} disabled={busy} onClick={() => {}} />
          </form>
          <p className="px-1 pt-1.5 text-[10px] leading-snug text-zinc-600">
            Learns from the other numeric columns to estimate each missing value.
          </p>
        </Dropdown>

        {/* Outliers */}
        <Dropdown id="outliers" open={open} setOpen={setOpen} icon={Spline} label="Outliers" disabled={colDisabled}>
          <SectionLabel>iqr fence · {selectedCol}</SectionLabel>
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 font-mono text-[10.5px] text-zinc-500">multiplier</span>
            <input
              type="number"
              min={0.1}
              max={20}
              step={0.1}
              value={iqrM}
              onChange={(e) => setIqrM(Math.min(20, Math.max(0.1, Number(e.target.value) || 1.5)))}
              className={inputCls + " w-16"}
            />
          </div>
          <p className="px-1 pt-1 font-mono text-[9.5px] text-zinc-600">fence = Q1 − m·IQR … Q3 + m·IQR</p>
          <div className="grid grid-cols-2 gap-1 pt-2">
            <ActionBtn
              label="Cap (winsorize)"
              icon={GitCommitHorizontal}
              disabled={busy}
              onClick={() => fire({ type: "cap_outliers", column: selectedCol!, multiplier: iqrM })}
            />
            <ActionBtn
              label="Drop rows"
              icon={ListX}
              danger
              disabled={busy}
              onClick={() => fire({ type: "drop_outliers", column: selectedCol!, multiplier: iqrM })}
            />
          </div>
          <p className="px-1 pt-1.5 text-[10px] leading-snug text-zinc-600">
            The profiler strip below shows the live outlier count at this multiplier.
          </p>
        </Dropdown>

        {/* Manual Edit */}
        <Dropdown id="edit" open={open} setOpen={setOpen} icon={Filter} label="Manual Edit" disabled={busy}>
          <SectionLabel>delete row by index</SectionLabel>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (validRow) {
                fire({ type: "drop_row", index: rowNum - 1 });
                setRowIdx("");
              }
            }}
          >
            <span className="shrink-0 font-mono text-[10.5px] text-zinc-500">row #</span>
            <input
              type="number"
              min={1}
              max={totalRows}
              value={rowIdx}
              placeholder={`1–${totalRows.toLocaleString()}`}
              onChange={(e) => setRowIdx(e.target.value)}
              className={inputCls + " w-24"}
            />
            <ActionBtn label="Delete" icon={Eraser} danger disabled={busy || !validRow} onClick={() => {}} />
          </form>
          <p className="px-1 pt-1.5 text-[10px] leading-snug text-zinc-600">
            Matches the # gutter in the grid. The index refers to the current cleaned view.
          </p>
        </Dropdown>

        {/* Column ops */}
        <Dropdown id="colops" open={open} setOpen={setOpen} icon={Replace} label="Column ops" disabled={colDisabled}>
          <SectionLabel>
            cast dtype · {selectedCol}
            {sel ? ` (${sel.dtype})` : ""}
          </SectionLabel>
          <div className="flex gap-1.5">
            <select className={inputCls} value={castTo} onChange={(e) => setCastTo(e.target.value)}>
              <option>Int64</option>
              <option>Float64</option>
              <option>String</option>
              <option>Boolean</option>
            </select>
            <ActionBtn label="Cast" disabled={busy} onClick={() => fire({ type: "cast", column: selectedCol!, to: castTo })} />
          </div>

          <SectionLabel>rename</SectionLabel>
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (renameTo.trim()) fire({ type: "rename_column", column: selectedCol!, to: renameTo.trim() });
            }}
          >
            <input className={inputCls} placeholder="new name" value={renameTo} onChange={(e) => setRenameTo(e.target.value)} />
            <ActionBtn label="Rename" icon={PenLine} disabled={busy || !renameTo.trim()} onClick={() => {}} />
          </form>

          <SectionLabel>text</SectionLabel>
          <div className="grid grid-cols-2 gap-1">
            <ActionBtn label="Trim" icon={Scissors} disabled={busy} onClick={() => fire({ type: "trim", column: selectedCol! })} />
            <div className="flex gap-1">
              <select className={inputCls} value={normMode} onChange={(e) => setNormMode(e.target.value as "lower" | "upper")}>
                <option value="lower">lower</option>
                <option value="upper">UPPER</option>
              </select>
              <ActionBtn label="Case" icon={CaseLower} disabled={busy} onClick={() => fire({ type: "normalize_case", column: selectedCol!, mode: normMode })} />
            </div>
          </div>

          <div className="pt-1.5">
            <ActionBtn
              label={`Drop column ${selectedCol ?? ""}`}
              icon={Trash2}
              danger
              disabled={busy}
              onClick={() => fire({ type: "drop_column", column: selectedCol! })}
            />
          </div>
        </Dropdown>

        <div className="mx-1 h-5 w-px bg-edge" />

        <ActionBtn label="Deduplicate" icon={CopyX} disabled={busy} onClick={() => onOp({ type: "drop_duplicates" })} />
        <ActionBtn
          label={selectedCol ? "Trim col" : "Trim all text"}
          icon={Scissors}
          disabled={busy}
          onClick={() => onOp(selectedCol ? { type: "trim", column: selectedCol } : { type: "trim" })}
        />

        <div className="ml-auto flex items-center gap-1.5">
          <ActionBtn label="Undo" icon={Undo2} disabled={busy || !canUndo} onClick={onUndo} />
          <ActionBtn label="Reset" icon={RotateCcw} disabled={busy || recipeCount === 0} onClick={onReset} />
        </div>
      </div>
    </div>
  );
}
