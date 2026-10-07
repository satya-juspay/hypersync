export class UiComponentImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UiComponentImportValidationError";
  }
}

export type ImportedUiComponentSnapshot = {
  branch: string;
  widgetHeadSha: string;
  uiComponentsRef: string;
  uiComponentsRefType: "version" | "commit" | "branch";
  uiComponentsHeadSha: string;
  uiComponentsBranches: string[];
  jenkinsBoundarySha: string | null;
  status: "published-version" | "release-commits";
  warnings: string[];
  expectedCommitCount: number;
};

export type ImportedUiComponentCommit = {
  sha: string;
  displayId: string;
  author: { name: string | null; emailAddress: string | null };
  authorTimestamp: number | null;
  message: string;
  parents: string[];
};

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const RELEASE_BRANCH = /^release-2026\d{4}$/;
const VERSION_REF = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_RECORDS = 25;
const MAX_COMMITS = 20_000;

function invalid(path: string, expected: string): never {
  throw new UiComponentImportValidationError(`${path} ${expected}`);
}

function record(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "must be an object");
  }
}

function boundedString(
  value: unknown,
  path: string,
  maxLength: number,
  { allowEmpty = false, reference = false } = {},
): asserts value is string {
  if (typeof value !== "string" || value.length > maxLength || (!allowEmpty && !value.trim())) {
    invalid(path, `must be ${allowEmpty ? "a" : "a nonempty"} string of at most ${maxLength} characters`);
  }
  if (value.includes("\0") || (reference && /[\s\x00-\x1f\x7f]/.test(value))) {
    invalid(path, reference ? "must not contain whitespace or control characters" : "must not contain null characters");
  }
}

function sha(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !FULL_SHA.test(value)) {
    invalid(path, "must be a lowercase 40- or 64-character commit SHA");
  }
}

function integer(value: unknown, path: string, maximum: number): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    invalid(path, `must be an integer between 0 and ${maximum}`);
  }
}

function array(value: unknown, path: string, maximum: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    invalid(path, `must be an array of at most ${maximum} items`);
  }
}

function unique(value: string, seen: Set<string>, path: string) {
  if (seen.has(value)) invalid(path, "must not contain duplicates");
  seen.add(value);
}

function stringArray(value: unknown, path: string, maximum: number, maxLength: number, references: boolean) {
  array(value, path, maximum);
  const seen = new Set<string>();
  value.forEach((item, index) => {
    boundedString(item, `${path}[${index}]`, maxLength, { reference: references });
    if (references) unique(item, seen, path);
  });
}

export function validateRunId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) {
    invalid("runId", "must be a lowercase canonical UUID");
  }
}

export function validateBranch(value: unknown): asserts value is string {
  if (typeof value !== "string" || !RELEASE_BRANCH.test(value)) {
    invalid("branch", "must match release-2026XXXX");
  }
}

export function validateExpectedBranches(value: unknown): asserts value is number {
  integer(value, "expectedBranches", 5_000);
  if (!value) invalid("expectedBranches", "must include at least one release branch");
}

export function validateBranchManifest(value: unknown): asserts value is string[] {
  array(value, "branches", 5_000);
  if (!value.length) invalid("branches", "must include at least one release branch");
  const branches = new Set<string>();
  value.forEach((branch) => {
    validateBranch(branch);
    unique(branch, branches, "branches");
  });
}

export function validateSnapshotRecords(value: unknown): asserts value is ImportedUiComponentSnapshot[] {
  array(value, "snapshots", MAX_RECORDS);
  const branches = new Set<string>();
  value.forEach((snapshot, index) => {
    const path = `snapshots[${index}]`;
    record(snapshot, path);
    validateBranch(snapshot.branch);
    unique(snapshot.branch, branches, "snapshots.branch");
    sha(snapshot.widgetHeadSha, `${path}.widgetHeadSha`);
    sha(snapshot.uiComponentsHeadSha, `${path}.uiComponentsHeadSha`);
    boundedString(snapshot.uiComponentsRef, `${path}.uiComponentsRef`, 500, { reference: true });
    stringArray(snapshot.uiComponentsBranches, `${path}.uiComponentsBranches`, 5_000, 500, true);
    stringArray(snapshot.warnings, `${path}.warnings`, 100, 2_000, false);
    integer(snapshot.expectedCommitCount, `${path}.expectedCommitCount`, MAX_COMMITS);

    if (snapshot.uiComponentsRefType === "version") {
      if (!VERSION_REF.test(snapshot.uiComponentsRef)) invalid(`${path}.uiComponentsRef`, "must be a v-prefixed semantic version");
      if (snapshot.status !== "published-version") invalid(`${path}.status`, "must be published-version for a version reference");
      if (snapshot.jenkinsBoundarySha !== null) invalid(`${path}.jenkinsBoundarySha`, "must be null for a version reference");
      if (snapshot.expectedCommitCount !== 0) invalid(`${path}.expectedCommitCount`, "must be 0 for a version reference");
      return;
    }

    if (snapshot.uiComponentsRefType !== "commit" && snapshot.uiComponentsRefType !== "branch") {
      invalid(`${path}.uiComponentsRefType`, "must be version, commit, or branch");
    }
    if (snapshot.uiComponentsRefType === "commit" && snapshot.uiComponentsRef !== snapshot.uiComponentsHeadSha) {
      invalid(`${path}.uiComponentsRef`, "must equal uiComponentsHeadSha for a pinned commit");
    }
    if (snapshot.status !== "release-commits") invalid(`${path}.status`, "must be release-commits for a branch or commit reference");
    sha(snapshot.jenkinsBoundarySha, `${path}.jenkinsBoundarySha`);
    if (snapshot.jenkinsBoundarySha === snapshot.uiComponentsHeadSha) {
      if (snapshot.expectedCommitCount !== 0) invalid(`${path}.expectedCommitCount`, "must be 0 when the dependency head is the Jenkins boundary");
    } else if (snapshot.expectedCommitCount === 0) {
      invalid(`${path}.expectedCommitCount`, "must include the non-Jenkins dependency head");
    }
  });
}

export function validateCommitRecords(value: unknown): asserts value is ImportedUiComponentCommit[] {
  array(value, "commits", MAX_RECORDS);
  const commits = new Set<string>();
  value.forEach((commit, index) => {
    const path = `commits[${index}]`;
    record(commit, path);
    sha(commit.sha, `${path}.sha`);
    unique(commit.sha, commits, "commits.sha");
    boundedString(commit.displayId, `${path}.displayId`, 64);
    if (commit.displayId.length < 7 || !commit.sha.startsWith(commit.displayId)) {
      invalid(`${path}.displayId`, "must be a prefix of sha with at least 7 characters");
    }
    record(commit.author, `${path}.author`);
    for (const field of ["name", "emailAddress"] as const) {
      if (commit.author[field] !== null) boundedString(commit.author[field], `${path}.author.${field}`, 5_000, { allowEmpty: true });
    }
    const authorName = (commit.author.name as string | null)?.trim() ?? "";
    const authorEmail = (commit.author.emailAddress as string | null)?.trim() ?? "";
    if (!authorName && !authorEmail) invalid(`${path}.author`, "must contain a nonempty name or emailAddress");
    if (authorName.toLowerCase() === "jenkins.user" || authorEmail.toLowerCase() === "jenkins.user@juspay.in") {
      invalid(`${path}.author`, "must not be the Jenkins release author");
    }
    if (commit.authorTimestamp !== null) integer(commit.authorTimestamp, `${path}.authorTimestamp`, 8_640_000_000_000_000);
    boundedString(commit.message, `${path}.message`, 100_000, { allowEmpty: true });
    array(commit.parents, `${path}.parents`, 64);
    const parents = new Set<string>();
    commit.parents.forEach((parent, parentIndex) => {
      sha(parent, `${path}.parents[${parentIndex}]`);
      if (parent === commit.sha) invalid(`${path}.parents`, "must not contain the commit itself");
      unique(parent, parents, `${path}.parents`);
    });
  });
}

export function validateCommitShas(value: unknown): asserts value is string[] {
  array(value, "commitShas", 100);
  const seen = new Set<string>();
  value.forEach((item, index) => {
    sha(item, `commitShas[${index}]`);
    unique(item, seen, "commitShas");
  });
}
