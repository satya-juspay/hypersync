import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
function compile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const validationUrl = moduleUrl(compile("../lib/ui-component-import-validation.ts"));
const conflictUrl = moduleUrl("export class UiComponentImportConflict extends Error {}");
const { UiComponentImportValidationError } = await import(validationUrl);
const { UiComponentImportConflict } = await import(conflictUrl);
let calls = [];
let failure;
const importer = new Proxy({}, {
  get: (_, method) => async (...args) => {
    calls.push({ method, args });
    if (failure) throw failure;
    return { processed: 1 };
  },
});
globalThis.__uiComponentRouteTestImporter = importer;
const routeSource = compile("../app/api/ui-components/import/route.ts")
  .replace('import { NextResponse } from "next/server";', "const NextResponse = { json: (body, init) => Response.json(body, init) };")
  .replace('import { uiComponentImporter } from "@/lib/import-ui-components";', "const uiComponentImporter = globalThis.__uiComponentRouteTestImporter;")
  .replace('"@/lib/ui-component-import-store"', JSON.stringify(conflictUrl))
  .replace('"@/lib/ui-component-import-validation"', JSON.stringify(validationUrl));
const { POST } = await import(moduleUrl(routeSource));
delete globalThis.__uiComponentRouteTestImporter;
const token = "test-import-secret";
const runId = "11111111-1111-4111-8111-111111111111";

async function request(body, { secret = token, authorization = `Bearer ${token}`, headers = {} } = {}) {
  const previous = process.env.HYPERSYNC_IMPORT_TOKEN;
  if (secret === undefined) delete process.env.HYPERSYNC_IMPORT_TOKEN;
  else process.env.HYPERSYNC_IMPORT_TOKEN = secret;
  calls = [];
  try {
    return await POST(new Request("https://hypersync.example.test/api/ui-components/import", {
      method: "POST", headers: { Authorization: authorization, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }));
  } finally {
    if (previous === undefined) delete process.env.HYPERSYNC_IMPORT_TOKEN;
    else process.env.HYPERSYNC_IMPORT_TOKEN = previous;
  }
}

test("import endpoint requires a configured, exact bearer secret before any store access", async () => {
  const previous = process.env.HYPERSYNC_IMPORT_TOKEN;
  delete process.env.HYPERSYNC_IMPORT_TOKEN;
  try {
    const response = await POST(new Request("https://example.test", { method: "POST", body: "{}" }));
    assert.equal(response.status, 503);
  } finally {
    if (previous !== undefined) process.env.HYPERSYNC_IMPORT_TOKEN = previous;
  }
  for (const authorization of ["", "Bearer wrong", `Basic ${token}`, `Bearer ${token}x`]) {
    const response = await request({ action: "start", runId }, { authorization });
    assert.equal(response.status, 401);
    assert.deepEqual(calls, []);
  }
});

test("import endpoint bounds both declared length and actual UTF-8 body bytes", async () => {
  const declared = await request({}, { headers: { "content-length": "1000001" } });
  assert.equal(declared.status, 413);
  assert.deepEqual(calls, []);
  const oversized = await request(JSON.stringify({ action: "start", runId, padding: "é".repeat(500000) }));
  assert.equal(oversized.status, 413);
  assert.deepEqual(calls, []);
});

test("invalid JSON, nonobject bodies, bad run IDs and unknown actions are rejected", async () => {
  for (const body of ["broken", "null", "[]", "1"]) {
    const response = await request(body);
    assert.equal(response.status, 400);
    assert.deepEqual(calls, []);
  }
  for (const body of [{ action: "start" }, { action: "start", runId: "bad" }, { action: "not-supported", runId }]) {
    const response = await request(body);
    assert.equal(response.status, 400);
    assert.deepEqual(calls, []);
  }
});

test("all isolated import actions delegate only their expected payload fields", async () => {
  for (const [action, method, payload, args] of [
    ["start", "start", {}, [runId]],
    ["heartbeat", "heartbeat", {}, [runId]],
    ["prepare", "prepare", { branches: ["release-20260105"] }, [runId, ["release-20260105"]]],
    ["manifest", "manifest", { records: [] }, [runId, []]],
    ["commits", "commits", { records: [] }, [runId, []]],
    ["snapshot-commits", "snapshotCommits", { branch: "release-20260105", commitShas: [] }, [runId, "release-20260105", []]],
    ["seal", "seal", { branch: "release-20260105" }, [runId, "release-20260105"]],
    ["finish", "finish", { expectedBranches: 55 }, [runId, 55]],
    ["abort", "abort", { error: "Read failed" }, [runId, "Read failed"]],
  ]) {
    const response = await request({ action, runId, ...payload });
    assert.equal(response.status, 200, action);
    assert.deepEqual(await response.json(), { success: true, processed: 1 });
    assert.deepEqual(calls, [{ method, args }]);
  }
});

test("lease conflicts and validation errors are distinguished without exposing internal failures", async () => {
  const originalLog = console.error;
  console.error = () => {};
  try {
    for (const [error, status, message] of [
      [new UiComponentImportConflict("Other run owns lease"), 409, "Other run owns lease"],
      [new UiComponentImportValidationError("Invalid branch"), 400, "Invalid branch"],
      [new Error("internal database detail"), 500, "UI Components import failed"],
    ]) {
      failure = error;
      const response = await request({ action: "start", runId });
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error: message });
    }
  } finally {
    failure = undefined;
    console.error = originalLog;
  }
});
