// Chunk-by-chunk CSV parsing.
// The upload endpoint pumps the request body through this incremental,
// quote-aware state machine so the first 100 rows (and the row count) are
// produced from a *stream* without ever holding the whole file in memory.
// This mirrors a Flask + Polars "batched reader" ingest pattern.

export class IncrementalCsvParser {
  private field = "";
  private row: string[] = [];
  private inQuotes = false;
  private started = false;
  private pendingCR = false;

  /** Feed a decoded string chunk; returns the rows completed by this chunk. */
  push(input: string): string[][] {
    let s = input;
    if (!this.started) {
      this.started = true;
      if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // strip BOM
    }
    const rows: string[][] = [];
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (this.inQuotes) {
        if (ch === '"') {
          if (s[i + 1] === '"') {
            this.field += '"';
            i++;
          } else {
            this.inQuotes = false;
          }
        } else {
          this.field += ch;
        }
        continue;
      }
      if (ch === '"' && this.field === "") {
        this.inQuotes = true;
      } else if (ch === ",") {
        this.row.push(this.field);
        this.field = "";
      } else if (ch === "\n") {
        this.row.push(stripCR(this.field));
        rows.push(this.row);
        this.row = [];
        this.field = "";
      } else {
        this.field += ch;
      }
    }
    return rows;
  }

  /** Emit the final partial row, if any. Call once the stream ends. */
  flush(): string[][] {
    const rows: string[][] = [];
    if (this.field !== "" || this.row.length > 0) {
      this.row.push(stripCR(this.field));
      if (this.row.some((c) => c !== "")) rows.push(this.row);
    }
    this.field = "";
    this.row = [];
    return rows;
  }
}

function stripCR(f: string): string {
  return f.endsWith("\r") ? f.slice(0, -1) : f;
}

export interface ChunkedIngestResult {
  header: string[];
  previewRows: string[][]; // first `maxPreview` data rows (raw strings)
  totalRows: number; // data rows seen across the whole stream
  chunks: number;
  bytes: number;
}

/** Convenience result accumulator used by the upload route. */
export class ChunkedIngest {
  private parser = new IncrementalCsvParser();
  header: string[] | null = null;
  readonly previewRows: string[][] = [];
  totalRows = 0;
  chunks = 0;
  bytes = 0;
  constructor(private readonly maxPreview = 100) {}

  push(chunkText: string, byteLength: number): void {
    this.chunks += 1;
    this.bytes += byteLength;
    const rows = this.parser.push(chunkText);
    this.absorb(rows);
  }

  finish(): void {
    this.absorb(this.parser.flush());
  }

  private absorb(rows: string[][]): void {
    for (const r of rows) {
      if (this.header === null) {
        this.header = r.map((h, i) => (h.trim() === "" ? `column_${i + 1}` : h.trim()));
        continue;
      }
      this.totalRows += 1;
      if (this.previewRows.length < this.maxPreview) this.previewRows.push(r);
    }
  }

  result(): ChunkedIngestResult {
    return {
      header: this.header ?? [],
      previewRows: this.previewRows,
      totalRows: this.totalRows,
      chunks: this.chunks,
      bytes: this.bytes,
    };
  }
}

/** Tokens treated as null across the whole platform. */
export const NULL_TOKENS = new Set(["", "na", "n/a", "null", "none", "nan", "-"]);

export function isNullToken(v: string): boolean {
  return NULL_TOKENS.has(v.trim().toLowerCase());
}
