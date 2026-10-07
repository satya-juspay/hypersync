import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Exercise the actual dependency-free validation module without generating
// build artifacts or requiring a separate TypeScript test loader.
const source = readFileSync(new URL("../lib/ui-component-import-validation.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const {
  UiComponentImportValidationError,
  validateRunId,
  validateBranch,
  validateBranchManifest,
  validateExpectedBranches,
  validateSnapshotRecords,
  validateCommitRecords,
  validateCommitShas,
} = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const HEAD = "a".repeat(40);
const BOUNDARY = "b".repeat(40);
const SHA256 = "c".repeat(64);
const RUN_ID = "12ab34cd-1234-4567-89ab-123456abcdef";

function snapshot(overrides = {}) {
  return {
    branch: "release-20260929",
    widgetHeadSha: "d".repeat(40),
    uiComponentsRef: HEAD,
    uiComponentsRefType: "commit",
    uiComponentsHeadSha: HEAD,
    uiComponentsBranches: ["devqa-PICAF-123-fix"],
    jenkinsBoundarySha: BOUNDARY,
    status: "release-commits",
    warnings: [],
    expectedCommitCount: 1,
    ...overrides,
  };
}

function versionSnapshot(overrides = {}) {
  return snapshot({
    uiComponentsRef: "v2.63.3",
    uiComponentsRefType: "version",
    uiComponentsBranches: [],
    jenkinsBoundarySha: null,
    status: "published-version",
    expectedCommitCount: 0,
    ...overrides,
  });
}

function commit(overrides = {}) {
  return {
    sha: HEAD,
    displayId: HEAD.slice(0, 12),
    author: { name: "developer", emailAddress: "developer@example.com" },
    authorTimestamp: 1_790_000_000_000,
    message: "fix: widget styling\n\nIncludes merge history",
    parents: [BOUNDARY],
    ...overrides,
  };
}

function rejects(validation, value, pattern) {
  assert.throws(() => validation(value), (error) => {
    assert.ok(error instanceof UiComponentImportValidationError);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

test("run IDs require lowercase canonical UUID format", () => {
  validateRunId(RUN_ID);
  for (const value of [null, {}, 1, "", RUN_ID.toUpperCase(), RUN_ID.replaceAll("-", ""), `${RUN_ID}\n`]) {
    rejects(validateRunId, value, /runId/);
  }
});

test("widget branches are limited to the configured 2026 naming convention", () => {
  validateBranch("release-20260101");
  for (const value of [null, [], "main", "release-20251231", "release-20260101-extra", "release-20260101\n"]) {
    rejects(validateBranch, value, /branch/);
  }
});

test("expected branch counts have bounded positive integer values", () => {
  for (const value of [1, 55, 5_000]) validateExpectedBranches(value);
  for (const value of [null, "55", 0, -1, 1.2, 5_001, NaN, Infinity]) {
    rejects(validateExpectedBranches, value, /expectedBranches/);
  }
});

test("branch manifests require at least one and at most 5,000 unique release branches", () => {
  validateBranchManifest(["release-20260101", "release-20260929"]);
  const branches = Array.from({ length: 5_000 }, (_, index) => `release-2026${index.toString().padStart(4, "0")}`);
  validateBranchManifest(branches);
  for (const value of [null, {}, [], [null], ["main"], ["release-20251231"], ["release-20260101", "release-20260101"], [...branches, "release-20265000"]]) {
    rejects(validateBranchManifest, value);
  }
});

test("valid version, branch, and pinned SHA snapshots are accepted without mutation", () => {
  const records = [
    snapshot(),
    snapshot({ branch: "release-20260928", uiComponentsRefType: "branch", uiComponentsRef: "refs/heads/devqa-feature" }),
    versionSnapshot({ branch: "release-20260921", uiComponentsRef: "v2.63.3-beta.1+build.7" }),
    snapshot({ branch: "release-20260914", uiComponentsRef: SHA256, uiComponentsHeadSha: SHA256, widgetHeadSha: SHA256, jenkinsBoundarySha: SHA256, expectedCommitCount: 0 }),
  ];
  const original = structuredClone(records);
  validateSnapshotRecords(records);
  assert.deepEqual(records, original);
  validateSnapshotRecords([]);
});

test("snapshot batches must contain at most 25 object records with unique widget branches", () => {
  for (const value of [null, {}, "snapshots", [null], [[]], [false], Array(26).fill(snapshot())]) {
    rejects(validateSnapshotRecords, value);
  }
  rejects(validateSnapshotRecords, [snapshot(), snapshot()], /duplicates/);
});

test("snapshot hashes require exactly 40 or 64 lowercase hex characters", () => {
  for (const field of ["widgetHeadSha", "uiComponentsHeadSha", "jenkinsBoundarySha"]) {
    for (const value of [null, "a".repeat(39), "a".repeat(41), "a".repeat(63), "a".repeat(65), HEAD.toUpperCase(), "z".repeat(40)]) {
      rejects(validateSnapshotRecords, [snapshot({ [field]: value })], new RegExp(field));
    }
  }
});

test("dependency refs and containing branches are bounded clean reference strings", () => {
  for (const value of [null, "", "main branch", "main\n", "main\0", "a".repeat(501)]) {
    rejects(validateSnapshotRecords, [snapshot({ uiComponentsRef: value })], /uiComponentsRef/);
  }
  for (const value of [null, "main", [null], [""], ["a b"], ["a".repeat(501)], ["main", "main"], Array(5_001).fill("main")]) {
    rejects(validateSnapshotRecords, [snapshot({ uiComponentsBranches: value })], /uiComponentsBranches/);
  }
});

test("snapshot warnings are bounded to protect the import payload", () => {
  validateSnapshotRecords([snapshot({ warnings: ["Containing branch lookup failed: server\nerror"] })]);
  for (const value of [null, {}, [1], [""], ["a".repeat(2_001)], ["error\0"], Array(101).fill("warning")]) {
    rejects(validateSnapshotRecords, [snapshot({ warnings: value })], /warnings/);
  }
});

test("published version snapshots cannot claim release commits or a Jenkins boundary", () => {
  for (const overrides of [
    { uiComponentsRef: "main" },
    { uiComponentsRef: "v2.63" },
    { uiComponentsRef: "v2.63.3-" },
    { status: "release-commits" },
    { status: "error" },
    { jenkinsBoundarySha: BOUNDARY },
    { expectedCommitCount: 1 },
  ]) rejects(validateSnapshotRecords, [versionSnapshot(overrides)]);
});

test("pinned refs must match the resolved head instead of a newer branch head", () => {
  rejects(validateSnapshotRecords, [snapshot({ uiComponentsRef: BOUNDARY })], /must equal/);
  rejects(validateSnapshotRecords, [snapshot({ uiComponentsRefType: "tag" })], /uiComponentsRefType/);
  rejects(validateSnapshotRecords, [snapshot({ status: "published-version" })], /status/);
});

test("release commit counts must agree with head and boundary and remain bounded", () => {
  validateSnapshotRecords([snapshot({ expectedCommitCount: 20_000 })]);
  for (const value of [null, "1", -1, 0, 1.5, 20_001, Infinity]) {
    rejects(validateSnapshotRecords, [snapshot({ expectedCommitCount: value })], /expectedCommitCount/);
  }
  rejects(validateSnapshotRecords, [snapshot({ jenkinsBoundarySha: HEAD, expectedCommitCount: 1 })], /expectedCommitCount/);
  validateSnapshotRecords([snapshot({ jenkinsBoundarySha: HEAD, expectedCommitCount: 0 })]);
});

test("valid commit records support null metadata and both hash algorithms without mutation", () => {
  const records = [
    commit(),
    commit({ sha: SHA256, displayId: SHA256, author: { name: null, emailAddress: "developer@example.com" }, authorTimestamp: null, message: "", parents: [] }),
  ];
  const original = structuredClone(records);
  validateCommitRecords(records);
  assert.deepEqual(records, original);
  validateCommitRecords([]);
});

test("commit batches reject malformed objects, overlarge batches, and duplicates", () => {
  for (const value of [null, {}, [null], [[]], ["commit"], Array(26).fill(commit())]) {
    rejects(validateCommitRecords, value);
  }
  rejects(validateCommitRecords, [commit(), commit()], /duplicates/);
});

test("commit display IDs must be SHA prefixes rather than arbitrary labels", () => {
  for (const displayId of [null, "", HEAD.slice(0, 6), "1234567", HEAD.toUpperCase(), HEAD + "a"]) {
    rejects(validateCommitRecords, [commit({ displayId })], /displayId/);
  }
  validateCommitRecords([commit({ displayId: HEAD.slice(0, 7) })]);
});

test("authors must have a nonempty name or email and bounded string fields", () => {
  validateCommitRecords([commit({ author: { name: "developer", emailAddress: null } })]);
  validateCommitRecords([commit({ author: { name: "", emailAddress: "developer@example.com" } })]);
  for (const author of [null, [], {}, { name: null, emailAddress: null }, { name: " ", emailAddress: "" }, { name: false, emailAddress: "a@b" }, { name: "developer", emailAddress: 1 }, { name: "a".repeat(5_001), emailAddress: null }]) {
    rejects(validateCommitRecords, [commit({ author })], /author/);
  }
});

test("Jenkins authors are excluded by exact case-insensitive name or email", () => {
  for (const author of [
    { name: "JENKINS.USER", emailAddress: null },
    { name: " jenkins.user ", emailAddress: "other@example.com" },
    { name: "other", emailAddress: " Jenkins.User@Juspay.in " },
  ]) rejects(validateCommitRecords, [commit({ author })], /Jenkins/);
  validateCommitRecords([commit({ author: { name: "jenkins.user-2", emailAddress: "other@example.com" } })]);
});

test("author timestamps must be valid nonnegative integer dates or null", () => {
  for (const value of [0, 8_640_000_000_000_000, null]) validateCommitRecords([commit({ authorTimestamp: value })]);
  for (const value of [undefined, "1700000000000", -1, 0.1, 8_640_000_000_000_001, NaN, Infinity]) {
    rejects(validateCommitRecords, [commit({ authorTimestamp: value })], /authorTimestamp/);
  }
});

test("commit messages are bounded strings", () => {
  validateCommitRecords([commit({ message: "a".repeat(100_000) })]);
  for (const value of [null, {}, "a".repeat(100_001), "message\0"]) {
    rejects(validateCommitRecords, [commit({ message: value })], /message/);
  }
});

test("parents require canonical distinct SHAs and cannot include the commit itself", () => {
  for (const parents of [null, {}, [null], ["abc"], [BOUNDARY.toUpperCase()], [HEAD], [BOUNDARY, BOUNDARY], Array(65).fill(BOUNDARY)]) {
    rejects(validateCommitRecords, [commit({ parents })], /parents/);
  }
  validateCommitRecords([commit({ parents: [BOUNDARY, SHA256] })]);
});

test("commit link batches require at most 100 unique canonical SHAs", () => {
  validateCommitShas([HEAD, SHA256]);
  validateCommitShas([]);
  const shas = Array.from({ length: 100 }, (_, index) => index.toString(16).padStart(40, "0"));
  validateCommitShas(shas);
  for (const value of [null, "sha", {}, [null], [HEAD.toUpperCase()], ["a".repeat(41)], [HEAD, HEAD], [...shas, BOUNDARY]]) {
    rejects(validateCommitShas, value, /commitShas/);
  }
});
