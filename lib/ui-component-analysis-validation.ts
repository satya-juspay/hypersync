import { UiComponentImportValidationError } from "./ui-component-import-validation";
import type { UiComponentFingerprint, UiComponentMainPrInput, UiComponentCommitAnalysisInput } from "./ui-component-types";

const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const TOKEN = /^[FAR]:[A-Za-z0-9_-]{43}$/;
const INITIAL_SYNC = Date.parse("2026-01-01T00:00:00.000Z");
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new UiComponentImportValidationError(message);
}
function obj(value: unknown): asserts value is Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value), "Invalid analysis record");
}
function text(value: unknown, max: number, empty = false): value is string {
  return typeof value === "string" && value.length <= max && !value.includes("\0") && (empty || !!value.trim());
}
export function validatePrIds(value: unknown): asserts value is number[] {
  check(Array.isArray(value) && value.length <= 20_000, "Invalid main PR manifest");
  check(value.every((id) => Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647) && new Set(value).size === value.length, "Invalid or duplicate main PR IDs");
}
export function validateAnalysisShas(value: unknown): asserts value is string[] {
  check(Array.isArray(value) && value.length <= 20_000, "Invalid analysis manifest");
  check(value.every((sha) => typeof sha === "string" && SHA.test(sha)) && new Set(value).size === value.length, "Invalid or duplicate analysis SHAs");
}
export function validateFingerprint(value: unknown): asserts value is UiComponentFingerprint {
  obj(value);
  if (value.fingerprintStatus === "READY") {
    check(text(value.patchFingerprint, 750_000) && value.fingerprintError === null, "Invalid ready fingerprint");
    const lines = value.patchFingerprint.split("\n");
    check(lines[0] === "v2" && lines.slice(1).every((line) => TOKEN.test(line)) && new Set(lines).size === lines.length, "Fingerprint must contain unique v2 hash tokens");
  } else {
    check(["SKIPPED_500", "UNAVAILABLE"].includes(String(value.fingerprintStatus)) && value.patchFingerprint === null && text(value.fingerprintError, 2000), "Invalid unavailable fingerprint");
  }
}
export function validateMainPrRecords(value: unknown): asserts value is UiComponentMainPrInput[] {
  check(Array.isArray(value) && value.length <= 25, "Invalid main PR records");
  const ids: number[] = [];
  for (const pr of value) {
    obj(pr);
    validatePrIds([pr.prId]); ids.push(pr.prId as number);
    check(text(pr.title, 10_000) && text(pr.authorName, 5000) && text(pr.fromBranch, 500) && pr.toBranch === "main", "Invalid main PR metadata");
    check(["OPEN", "MERGED", "DECLINED"].includes(String(pr.state)), "Invalid main PR state");
    check(typeof pr.sourceSha === "string" && SHA.test(pr.sourceSha) && typeof pr.targetSha === "string" && SHA.test(pr.targetSha), "Invalid main PR heads");
    check(typeof pr.updatedAt === "string" && Number.isFinite(Date.parse(pr.updatedAt)) && Date.parse(pr.updatedAt) >= INITIAL_SYNC, "Main PR must be updated since 2026-01-01");
    validateAnalysisShas(pr.commitShas);
    validateFingerprint(pr);
  }
  validatePrIds(ids);
}
export function validateAnalysisRecords(value: unknown): asserts value is UiComponentCommitAnalysisInput[] {
  check(Array.isArray(value) && value.length <= 25, "Invalid commit analysis records");
  const shas: string[] = [];
  for (const row of value) { obj(row); validateAnalysisShas([row.commitSha]); shas.push(row.commitSha as string); validateFingerprint(row); }
  validateAnalysisShas(shas);
}
export function validateDiffFailureKey(value: unknown): asserts value is string {
  check(typeof value === "string" && (/^pr:[1-9]\d{0,9}$/.test(value) || /^commit:(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)), "Invalid diff failure key");
}
