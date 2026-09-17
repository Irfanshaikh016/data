// POST /api/upload
// multipart/form-data (field "file")  → streams the CSV to disk chunk-by-
//   chunk while the incremental parser extracts the header, the first 100
//   rows and the full row count — constant memory, like a batched reader.
// application/json { "demo": true }   → generates a deliberately messy demo
//   dataset and runs it through the exact same pipeline.
// Response: columns (names + inferred dtypes + null counts), first 100 rows,
// total rows, duplicate count and the co-pilot's ranked suggestions.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { ChunkedIngest } from "@/lib/csv-stream";
import { ensureUploadDir, generateDemoCsv, UPLOAD_DIR } from "@/lib/polars-engine";
import { createSession, persistDataset, sessionPayload } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 64 * 1024 * 1024; // 64 MB safety cap for the in-memory engine
const SLICE = 64 * 1024;

export async function POST(req: NextRequest) {
  try {
    ensureUploadDir();
    const ctype = req.headers.get("content-type") ?? "";
    const id = crypto.randomUUID();

    // -- Demo dataset --------------------------------------------------------
    if (ctype.includes("application/json")) {
      const body = (await req.json().catch(() => null)) as { demo?: boolean } | null;
      if (!body?.demo) {
        return NextResponse.json(
          { error: "Send a multipart file (field `file`) or JSON `{ demo: true }`." },
          { status: 400 },
        );
      }
      const filePath = path.join(UPLOAD_DIR, `${id}-demo_messy_customers.csv`);
      generateDemoCsv(filePath);
      const bytes = fs.statSync(filePath).size;
      // Pump the demo file through the chunked parser in 64 KB slices too.
      const ingest = new ChunkedIngest(100);
      const text = fs.readFileSync(filePath, "utf8");
      for (let i = 0; i < text.length; i += SLICE) {
        const piece = text.slice(i, i + SLICE);
        ingest.push(piece, Buffer.byteLength(piece));
      }
      ingest.finish();
      const session = createSession({
        id,
        name: "demo_messy_customers.csv",
        filePath,
        isDemo: true,
        ingest: { totalRows: ingest.totalRows, chunks: ingest.chunks, bytes },
      });
      const payload = await sessionPayload(session);
      persistDataset(session, payload.columns.length);
      return NextResponse.json(payload);
    }

    // -- File upload ---------------------------------------------------------
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided — expected form field `file`." }, { status: 400 });
    }
    if (!/\.(csv|txt)$/i.test(file.name)) {
      return NextResponse.json({ error: "Only .csv files are supported right now." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — this workspace caps uploads at 64 MB.` },
        { status: 413 },
      );
    }

    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const filePath = path.join(UPLOAD_DIR, `${id}-${safeName}`);
    const out = fs.createWriteStream(filePath);
    const ingest = new ChunkedIngest(100);
    const decoder = new TextDecoder("utf-8");
    const reader = (file.stream() as ReadableStream<Uint8Array>).getReader();

    // The chunk-by-chunk read: request body → disk + incremental parser.
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.write(Buffer.from(value));
      ingest.push(decoder.decode(value, { stream: true }), value.byteLength);
    }
    ingest.push(decoder.decode(), 0);
    ingest.finish();
    await new Promise<void>((resolve, reject) =>
      out.end((err?: Error | null) => (err ? reject(err) : resolve())),
    );

    if (!ingest.header || ingest.header.length === 0) {
      fs.rmSync(filePath, { force: true });
      return NextResponse.json({ error: "Could not find a CSV header — is this a valid CSV file?" }, { status: 400 });
    }

    const session = createSession({
      id,
      name: file.name,
      filePath,
      isDemo: false,
      ingest: { totalRows: ingest.totalRows, chunks: ingest.chunks, bytes: ingest.bytes },
    });
    const payload = await sessionPayload(session);
    persistDataset(session, payload.columns.length);
    return NextResponse.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    console.error("[upload]", e);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
