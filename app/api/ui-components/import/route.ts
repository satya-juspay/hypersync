import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { uiComponentImporter } from "@/lib/import-ui-components";
import { UiComponentImportConflict } from "@/lib/ui-component-import-store";
import { UiComponentImportValidationError, validateRunId } from "@/lib/ui-component-import-validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_BODY_BYTES = 1_000_000;

export async function POST(request: Request) {
  const secret = process.env.HYPERSYNC_IMPORT_TOKEN;
  if (!secret) return NextResponse.json({ error: "UI Components import API is not configured" }, { status: 503 });
  const header = request.headers.get("authorization") || "";
  const supplied = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(secret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    // Bound chunked requests too, without buffering an unbounded body.
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (!reader) throw new Error();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return NextResponse.json({ error: "Request too large" }, { status: 413 });
      }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    validateRunId(body.runId);
    const runId = body.runId;
    let result: object;
    switch (body.action) {
      case "start": result = await uiComponentImporter.start(runId); break;
      case "heartbeat": result = await uiComponentImporter.heartbeat(runId); break;
      case "prepare-analysis": result = await uiComponentImporter.prepareAnalysis(runId, body.prIds, body.commitShas); break;
      case "main-prs": result = await uiComponentImporter.mainPrs(runId, body.records); break;
      case "commit-analyses": result = await uiComponentImporter.commitAnalyses(runId, body.records); break;
      case "diff-failures": result = await uiComponentImporter.diffFailures(runId, body.keys); break;
      case "diff-failed": result = await uiComponentImporter.diffFailed(runId, body.key); break;
      case "prepare": result = await uiComponentImporter.prepare(runId, body.branches); break;
      case "manifest": result = await uiComponentImporter.manifest(runId, body.records); break;
      case "commits": result = await uiComponentImporter.commits(runId, body.records); break;
      case "snapshot-commits": result = await uiComponentImporter.snapshotCommits(runId, body.branch, body.commitShas); break;
      case "seal": result = await uiComponentImporter.seal(runId, body.branch); break;
      case "finish": result = await uiComponentImporter.finish(runId, body.expectedBranches); break;
      case "abort": result = await uiComponentImporter.abort(runId, body.error); break;
      default: throw new UiComponentImportValidationError("Unknown UI Components import action");
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof UiComponentImportConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof UiComponentImportValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[ui-components/import] Failed:", error);
    return NextResponse.json({ error: "UI Components import failed" }, { status: 500 });
  }
}
