import { createHash } from "node:crypto";

const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const SINCE = Date.parse("2026-01-01T00:00:00.000Z");
const hash = (text) => createHash("sha256").update(text).digest("base64url");
const unavailable = (error, status = "UNAVAILABLE") => ({ patchFingerprint: null, fingerprintStatus: status, fingerprintError: error.slice(0, 2000) });

// JSON diffs expose Bitbucket's truncation flags, unlike raw text diffs.
export function fingerprintUiComponentDiff(value) {
  if (!value || !Array.isArray(value.diffs)) throw new Error("Bitbucket returned an invalid diff");
  const tokens = new Set();
  function truncated(item) {
    if (item?.truncated === true) throw new Error("Bitbucket truncated this diff; fingerprint unavailable");
  }
  truncated(value);
  for (const diff of value.diffs) {
    truncated(diff);
    if (!Array.isArray(diff.hunks)) throw new Error("Invalid diff hunks");
    const path = diff.destination?.toString || diff.source?.toString;
    if (typeof path !== "string" || !path) throw new Error("Invalid diff file path");
    for (const hunk of diff.hunks) {
      truncated(hunk);
      if (!Array.isArray(hunk.segments)) throw new Error("Invalid diff segments");
      for (const segment of hunk.segments) {
        truncated(segment);
        if (!Array.isArray(segment.lines) || !["ADDED", "REMOVED", "CONTEXT"].includes(segment.type)) throw new Error("Invalid diff lines");
        for (const line of segment.lines) {
          truncated(line);
          if (typeof line.line !== "string") throw new Error("Invalid diff line content");
          if (segment.type === "CONTEXT") continue;
          const added = segment.type === "ADDED";
          const changed = `${added ? "+" : "-"}${line.line}`.replace(/\s+/g, " ").trim();
          tokens.add(`F:${hash(path)}`);
          tokens.add(`${added ? "A" : "R"}:${hash(`${path}\t${changed}`)}`);
        }
      }
    }
  }
  const fingerprint = ["v2", ...[...tokens].sort()].join("\n");
  if (fingerprint.length > 750_000) throw new Error("Fingerprint exceeds 750000 characters");
  return fingerprint;
}

export async function analyzeUiComponents(config, { commits, fetchImpl = fetch, send, onProgress = console.log, delayMs = 300 } = {}) {
  const repo = `${config.bitbucketUrl.replace(/\/+$/, "")}/rest/api/1.0/projects/${encodeURIComponent(config.project)}/repos/ui-components`;
  const headers = { Accept: "application/json", Authorization: config.username ? `Basic ${Buffer.from(`${config.username}:${config.token}`).toString("base64")}` : `Bearer ${config.token}` };
  async function json(url) {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      const error = new Error(`Bitbucket HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }
  async function pages(path, params, label) {
    const results = [];
    let start = 0;
    for (let pageNumber = 0; pageNumber < 200; pageNumber++) {
      const url = new URL(`${repo}/${path}`);
      Object.entries({ ...params, limit: 100, start }).forEach(([key, value]) => url.searchParams.set(key, String(value)));
      const page = await json(url);
      if (!Array.isArray(page.values) || typeof page.isLastPage !== "boolean") throw new Error(`Invalid ${label} page`);
      results.push(...page.values);
      onProgress(`Read ${label}: ${results.length} records (page ${pageNumber + 1})`);
      if (page.isLastPage) return results;
      if (!Number.isSafeInteger(page.nextPageStart) || page.nextPageStart <= start) throw new Error(`Invalid ${label} pagination`);
      start = page.nextPageStart;
    }
    throw new Error(`${label} exceeded 200 pages; refusing incomplete analysis`);
  }

  onProgress("Fetching ui-components main PRs updated since 2026-01-01 (all states)...");
  const values = await pages("pull-requests", { state: "ALL", direction: "INCOMING", at: "refs/heads/main", order: "NEWEST" }, "main PRs");
  const byId = new Map();
  for (const pr of values) {
    if (pr.toRef?.id !== "refs/heads/main") continue;
    if (!Number.isSafeInteger(pr.updatedDate)) throw new Error("Invalid main PR update timestamp");
    if (pr.updatedDate < SINCE) continue;
    if (!Number.isSafeInteger(pr.id) || pr.id <= 0) throw new Error("Invalid main PR ID");
    if (byId.has(pr.id) && signature(byId.get(pr.id)) !== signature(pr)) throw new Error(`Main PR #${pr.id} changed during pagination`);
    byId.set(pr.id, pr);
  }
  const prs = [...byId.values()].sort((a, b) => a.id - b.id);
  const keys = [...prs.map((pr) => `pr:${pr.id}`), ...commits.map((commit) => `commit:${commit.sha}`)];
  const skipped = new Set();
  for (let offset = 0; offset < keys.length; offset += 100) {
    const response = await send({ action: "diff-failures", keys: keys.slice(offset, offset + 100) });
    if (!Array.isArray(response.keys) || response.keys.some((key) => !keys.slice(offset, offset + 100).includes(key))) throw new Error("Invalid persisted diff failure response");
    response.keys.forEach((key) => skipped.add(key));
  }
  onProgress(`Found ${prs.length} eligible main PRs; ${skipped.size} diffs previously marked HTTP 500`);

  async function fingerprint(key, url) {
    if (skipped.has(key)) return unavailable("Bitbucket HTTP 500 recorded in an earlier refresh", "SKIPPED_500");
    try {
      const patchFingerprint = fingerprintUiComponentDiff(await json(url));
      return { patchFingerprint, fingerprintStatus: "READY", fingerprintError: null };
    } catch (error) {
      // Authentication/network/lease failures abort instead of publishing a
      // dataset made wholly unavailable by a configuration problem.
      if (error.status === 401 || error.status === 403 || !error.status && /fetch|abort|timeout|lease/i.test(error.message)) throw error;
      if (error.status === 500) {
        await send({ action: "diff-failed", key });
        skipped.add(key);
      }
      onProgress(`Skipped diff ${key}: ${error.message}`);
      return unavailable(error.message, error.status === 500 ? "SKIPPED_500" : "UNAVAILABLE");
    } finally { if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs)); }
  }

  const mainPrs = [];
  for (const listed of prs) {
    onProgress(`Analyzing main PR #${listed.id} (${mainPrs.length + 1}/${prs.length})...`);
    const before = await json(`${repo}/pull-requests/${listed.id}`);
    const record = normalizePr(before);
    const members = await pages(`pull-requests/${listed.id}/commits`, {}, `commits of main PR #${listed.id}`);
    if (members.some((commit) => !SHA.test(commit.id || ""))) throw new Error(`Invalid main PR #${listed.id} commit membership`);
    const patch = await fingerprint(`pr:${listed.id}`, `${repo}/pull-requests/${listed.id}/diff?contextLines=0`);
    const after = await json(`${repo}/pull-requests/${listed.id}`);
    if (signature(before) !== signature(after)) throw new Error(`Main PR #${listed.id} changed while reading its commits/diff; rerun refresh`);
    mainPrs.push({ ...record, commitShas: [...new Set(members.map((commit) => commit.id.toLowerCase()))].sort(), ...patch });
  }
  const analyses = [];
  for (const commit of commits) {
    onProgress(`Fingerprinting release commit ${commit.sha.slice(0, 12)} (${analyses.length + 1}/${commits.length})...`);
    const url = new URL(`${repo}/commits/${commit.sha}/diff`);
    url.searchParams.set("contextLines", "0");
    if (commit.parents[0]) url.searchParams.set("since", commit.parents[0]);
    analyses.push({ commitSha: commit.sha, ...await fingerprint(`commit:${commit.sha}`, url) });
  }
  return { mainPrs, analyses };
}

function signature(pr) { return JSON.stringify([pr.id, pr.version, pr.updatedDate, pr.state, pr.fromRef?.latestCommit, pr.toRef?.latestCommit, pr.toRef?.id]); }
function normalizePr(pr) {
  if (!Number.isSafeInteger(pr.id) || pr.id <= 0 || !["OPEN", "MERGED", "DECLINED"].includes(pr.state)
    || typeof pr.title !== "string" || !pr.title.trim() || pr.toRef?.id !== "refs/heads/main"
    || !SHA.test(pr.fromRef?.latestCommit || "") || !SHA.test(pr.toRef?.latestCommit || "")
    || !Number.isSafeInteger(pr.updatedDate) || pr.updatedDate < SINCE || pr.updatedDate > 8_640_000_000_000_000) throw new Error("Invalid ui-components main PR metadata");
  const author = pr.author?.user;
  return {
    prId: pr.id, title: pr.title, state: pr.state,
    authorName: author?.displayName || author?.name || author?.emailAddress || "Unknown author",
    fromBranch: pr.fromRef.displayId || pr.fromRef.id?.replace(/^refs\/heads\//, "") || "Unknown branch",
    toBranch: "main", sourceSha: pr.fromRef.latestCommit.toLowerCase(), targetSha: pr.toRef.latestCommit.toLowerCase(),
    updatedAt: new Date(pr.updatedDate).toISOString(),
  };
}
