import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  abortImport,
  finishImport,
  importBatch,
  ImportConflict,
  pendingFingerprints,
  renewImport,
  startImport,
  type ImportedPR,
} from "@/lib/import-prs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1_000_000;

export async function POST(request: Request) {
  const secret = process.env.HYPERSYNC_IMPORT_TOKEN;
  if (!secret) return NextResponse.json({ error: "Import API is not configured" }, { status: 503 });
  if (!hasValidBearerToken(request, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return NextResponse.json({ error: "Request too large" }, { status: 413 });

  let body: { action?: string; runId?: string; records?: ImportedPR[]; limit?: number };
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return NextResponse.json({ error: "Request too large" }, { status: 413 });
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.runId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.runId)) {
    return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
  }

  try {
    let result: object;
    switch (body.action) {
      case "start":
        result = await startImport(body.runId);
        break;
      case "heartbeat":
        await renewImport(body.runId);
        result = {};
        break;
      case "batch":
        result = await importBatch(body.runId, body.records as ImportedPR[]);
        break;
      case "pending":
        if (!Number.isInteger(body.limit) || (body.limit ?? 0) < 0 || (body.limit ?? 0) > 50) throw new Error("Invalid limit");
        result = { records: await pendingFingerprints(body.runId, body.limit!) };
        break;
      case "finish":
        result = await finishImport(body.runId);
        break;
      case "abort":
        await abortImport(body.runId);
        result = {};
        break;
      default:
        throw new Error("Unknown import action");
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof ImportConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof Error && (/^Invalid |^Batch |^Unknown /.test(error.message))) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[import] Failed:", error);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}

function hasValidBearerToken(request: Request, expectedToken: string) {
  const header = request.headers.get("authorization") ?? "";
  const supplied = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
