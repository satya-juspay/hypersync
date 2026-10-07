import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function compile(path, replace) {
  let source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  if (replace) source = source.replace('"./ui-component-import-validation"', JSON.stringify(replace));
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}
const url = compile("../lib/ui-component-import-validation.ts");
const { validateFingerprint, validateMainPrRecords, validateAnalysisRecords, validatePrIds, validateAnalysisShas, validateDiffFailureKey } = await import(compile("../lib/ui-component-analysis-validation.ts", url));
const sha = "a".repeat(40);
const ready = { patchFingerprint: `v2\nF:${"A".repeat(43)}\nR:${"B".repeat(43)}`, fingerprintStatus: "READY", fingerprintError: null };
const pr = { ...ready, prId: 1, title: "fix", state: "MERGED", authorName: "dev", fromBranch: "feature", toBranch: "main", sourceSha: sha, targetSha: sha, updatedAt: "2026-01-01T00:00:00.000Z", commitShas: [sha] };

test("only bounded v2 hashes or explicit unavailable statuses can be imported", () => {
  validateFingerprint(ready);
  validateFingerprint({ patchFingerprint: "v2", fingerprintStatus: "READY", fingerprintError: null });
  for (const fingerprint of ["raw diff", "v2\nA:raw", `v2\nA:${"X".repeat(43)}\nA:${"X".repeat(43)}`, `v2\n${"x".repeat(750000)}`]) assert.throws(() => validateFingerprint({ ...ready, patchFingerprint: fingerprint }));
  for (const fingerprintStatus of ["SKIPPED_500", "UNAVAILABLE"]) {
    validateFingerprint({ fingerprintStatus, patchFingerprint: null, fingerprintError: "diff failed" });
    assert.throws(() => validateFingerprint({ fingerprintStatus, patchFingerprint: null, fingerprintError: null }));
    assert.throws(() => validateFingerprint({ ...ready, fingerprintStatus, fingerprintError: "failed" }));
  }
});
test("PR validation restricts main destination, IDs, metadata, and the 2026 cutoff", () => {
  validateMainPrRecords([pr]);
  for (const changes of [{ toBranch: "release" }, { updatedAt: "2025-12-31" }, { state: "ALL" }, { sourceSha: "short" }, { title: "" }, { prId: 0 }, { commitShas: [sha, sha] }]) assert.throws(() => validateMainPrRecords([{ ...pr, ...changes }]));
  assert.throws(() => validateMainPrRecords([pr, pr]));
  assert.throws(() => validateMainPrRecords(Array(26).fill(pr)));
});
test("manifests and failure markers reject duplicates, unbounded arrays, and ambiguous keys", () => {
  validatePrIds([]); validateAnalysisShas([]); validateAnalysisRecords([{ commitSha: sha, ...ready }]);
  assert.throws(() => validatePrIds([1, 1])); assert.throws(() => validatePrIds([2_147_483_648]));
  assert.throws(() => validateAnalysisShas([sha, sha])); assert.throws(() => validateAnalysisShas(["A".repeat(40)]));
  assert.throws(() => validateAnalysisRecords([{ commitSha: sha, ...ready }, { commitSha: sha, ...ready }]));
  for (const key of ["pr:1", `commit:${sha}`]) validateDiffFailureKey(key);
  for (const key of ["pr:0", "pr:001", "release:10", "commit:short", `commit:${sha}\n`, "pr:1\0"]) assert.throws(() => validateDiffFailureKey(key));
});
