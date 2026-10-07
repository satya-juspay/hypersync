import { randomUUID } from "node:crypto";
import { loadDiscoveryConfig } from "./discover-ui-components.mjs";
import { inspectUiComponents, isJenkinsAuthor } from "./inspect-ui-components.mjs";
import { analyzeUiComponents } from "./analyze-ui-components.mjs";

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const RELEASE_BRANCH = /^release-2026\d{4}$/;
const VERSION_REF = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const MAX_BODY_BYTES = 1_000_000;
const MAX_COMMIT_MESSAGE = 100_000;
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function loadUiComponentsRefreshConfig(env = process.env) {
  if (!env.HYPERSYNC_URL) throw new Error("Missing HYPERSYNC_URL");
  if (!env.HYPERSYNC_IMPORT_TOKEN) throw new Error("Missing HYPERSYNC_IMPORT_TOKEN");
  const url = validateAppUrl(env.HYPERSYNC_URL);
  return {
    hypersyncUrl: url.origin,
    importToken: env.HYPERSYNC_IMPORT_TOKEN,
    discovery: loadDiscoveryConfig(env),
  };
}

// Inspection stays on the office laptop. Only immutable, validated snapshots and
// commit metadata reach the app; the Bitbucket credential never leaves this CLI.
export async function refreshUiComponents({
  config = loadUiComponentsRefreshConfig(),
  fetchImpl = fetch,
  inspectImpl = inspectUiComponents,
  analysisImpl = analyzeUiComponents,
  onProgress = console.log,
  heartbeatMs = 60_000,
  requestTimeoutMs = 30_000,
  retryDelayMs = 500,
  runId = randomUUID(),
} = {}) {
  const endpoint = `${validateAppUrl(config.hypersyncUrl).origin}/api/ui-components/import`;
  if (!config.importToken) throw new Error("Missing HYPERSYNC_IMPORT_TOKEN");
  if (!UUID.test(runId)) throw new Error("UI Components refresh runId must be a canonical UUID");
  if (!Number.isFinite(heartbeatMs) || heartbeatMs <= 0) throw new Error("Invalid heartbeat interval");
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs <= 0) throw new Error("Invalid request timeout");
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) throw new Error("Invalid retry delay");

  let startAttempted = false;
  let started = false;
  let heartbeat;
  let heartbeatPromise;
  let leaseError;
  let stoppingHeartbeat = false;
  const leaseAbort = new AbortController();
  const heartbeatAbort = new AbortController();
  const assertLease = () => { if (leaseError) throw leaseError; };

  async function send(payload, { ignoreLease = false, signal } = {}) {
    const body = serializePayload({ ...payload, runId });
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!ignoreLease) assertLease();
      if (signal?.aborted) throw signal.reason;
      let response;
      try {
        const signals = [AbortSignal.timeout(requestTimeoutMs)];
        if (signal) signals.push(signal);
        if (!ignoreLease) signals.push(leaseAbort.signal);
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.importToken}`, "Content-Type": "application/json" },
          body,
          signal: AbortSignal.any(signals),
        });
        if (!ignoreLease) assertLease();
      } catch (error) {
        if (!ignoreLease) assertLease();
        if (signal?.aborted) throw signal.reason;
        if (attempt === 2) throw new Error(`UI Components import request failed (${payload.action}): ${errorMessage(error)}`, { cause: error });
        onProgress(`Retrying UI Components import ${payload.action} (${attempt + 2}/3): ${errorMessage(error)}`);
        await delay(retryDelayMs * (2 ** attempt), signal);
        continue;
      }
      if (!response.ok) {
        let detail;
        try { detail = (await response.text()).slice(0, 500); }
        catch (error) { detail = `Unable to read error response: ${errorMessage(error)}`; }
        const error = new Error(`UI Components import API ${response.status} (${payload.action}): ${detail}`);
        if (RETRY_STATUSES.has(response.status) && attempt < 2) {
          onProgress(`Retrying UI Components import ${payload.action} (${attempt + 2}/3): HTTP ${response.status}`);
          await delay(retryDelayMs * (2 ** attempt), signal);
          continue;
        }
        throw error;
      }
      let result;
      try { result = await response.json(); }
      catch (error) {
        if (!ignoreLease) assertLease();
        if (signal?.aborted) throw signal.reason;
        if (error instanceof SyntaxError) throw new Error(`UI Components import API returned invalid JSON (${payload.action})`);
        if (attempt === 2) throw new Error(`UI Components import response failed (${payload.action}): ${errorMessage(error)}`, { cause: error });
        onProgress(`Retrying UI Components import ${payload.action} (${attempt + 2}/3): ${errorMessage(error)}`);
        await delay(retryDelayMs * (2 ** attempt), signal);
        continue;
      }
      if (!ignoreLease) assertLease();
      if (result?.success !== true) throw new Error(`UI Components import API did not confirm success (${payload.action})`);
      return result;
    }
  }

  function beginHeartbeat() {
    heartbeat = setInterval(() => {
      if (heartbeatPromise || stoppingHeartbeat || leaseError) return;
      heartbeatPromise = send({ action: "heartbeat" }, { signal: heartbeatAbort.signal })
        .then(() => onProgress("UI Components refresh lease renewed"))
        .catch((error) => {
          if (heartbeatAbort.signal.aborted) return;
          leaseError = error;
          leaseAbort.abort(error);
          onProgress(`UI Components refresh lease lost: ${errorMessage(error)}`);
        })
        .finally(() => { heartbeatPromise = undefined; });
    }, heartbeatMs);
  }

  async function stopHeartbeat(cancel = false) {
    stoppingHeartbeat = true;
    if (heartbeat) clearInterval(heartbeat);
    if (cancel) heartbeatAbort.abort(new Error("Refresh stopped"));
    if (heartbeatPromise) await heartbeatPromise;
  }

  const guardedFetch = async (url, options = {}) => {
    assertLease();
    const signals = [leaseAbort.signal, AbortSignal.timeout(requestTimeoutMs)];
    if (options.signal) signals.push(options.signal);
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.any(signals) });
    assertLease();
    return response;
  };

  try {
    onProgress("Starting isolated UI Components refresh...");
    startAttempted = true;
    const start = await send({ action: "start" });
    started = true;
    if (!Number.isFinite(Date.parse(start.startedAt))) throw new Error("UI Components import API returned an invalid start time");
    beginHeartbeat();

    onProgress("Inspecting all hyper-widget release-2026 branches and ui-components histories...");
    const releases = await inspectImpl(config.discovery, { fetchImpl: guardedFetch, onProgress });
    assertLease();
    const dataset = prepareDataset(releases);
    // Build all bounded requests before staging anything: oversized or malformed
    // commits must not leave a partially uploaded replacement dataset.
    const manifests = batches(dataset.manifest, 25, (records) => ({ action: "manifest", runId, records }));
    const declaredBranches = dataset.manifest.map((record) => record.branch).sort();
    serializePayload({ action: "prepare", runId, branches: declaredBranches });
    const commits = batches(dataset.commits, 25, (records) => ({ action: "commits", runId, records }));
    const links = dataset.snapshots.map((snapshot) => ({
      branch: snapshot.branch,
      batches: batches(snapshot.commitShas, 100, (commitShas) => ({ action: "snapshot-commits", runId, branch: snapshot.branch, commitShas })),
    }));
    onProgress(`Inspection complete: ${dataset.manifest.length} release branches, ${dataset.commits.length} unique release commits`);

    await send({ action: "prepare", branches: declaredBranches });
    onProgress(`Declared complete UI Components manifest: ${declaredBranches.length} release branches`);

    let uploaded = 0;
    for (const records of manifests) {
      await send({ action: "manifest", records });
      uploaded += records.length;
      onProgress(`Uploaded UI Components snapshot metadata: ${uploaded}/${dataset.manifest.length}`);
    }
    uploaded = 0;
    for (const records of commits) {
      await send({ action: "commits", records });
      uploaded += records.length;
      onProgress(`Uploaded UI Components release commits: ${uploaded}/${dataset.commits.length}`);
    }
    for (const snapshot of links) {
      let linked = 0;
      const expected = snapshot.batches.reduce((count, batch) => count + batch.length, 0);
      for (const commitShas of snapshot.batches) {
        await send({ action: "snapshot-commits", branch: snapshot.branch, commitShas });
        linked += commitShas.length;
        onProgress(`Linked ${snapshot.branch}: ${linked}/${expected} release commits`);
      }
      await send({ action: "seal", branch: snapshot.branch });
      onProgress(`Sealed ${snapshot.branch}: ${expected} release commits`);
    }

    const analysis = await analysisImpl(config.discovery, { commits: dataset.commits, fetchImpl: guardedFetch, send, onProgress });
    assertLease();
    if (!Array.isArray(analysis?.mainPrs) || !Array.isArray(analysis?.analyses)) throw new Error("Invalid UI Components analysis result");
    const prIds = analysis.mainPrs.map((pr) => pr.prId).sort((a, b) => a - b);
    const analysisShas = analysis.analyses.map((row) => row.commitSha).sort();
    if (JSON.stringify(analysisShas) !== JSON.stringify(dataset.commits.map((commit) => commit.sha).sort())) throw new Error("Incomplete release commit analysis");
    const mainPrBatches = batches(analysis.mainPrs, 25, (records) => ({ action: "main-prs", runId, records }));
    const analysisBatches = batches(analysis.analyses, 25, (records) => ({ action: "commit-analyses", runId, records }));
    await send({ action: "prepare-analysis", prIds, commitShas: analysisShas });
    uploaded = 0;
    for (const records of mainPrBatches) {
      await send({ action: "main-prs", records });
      uploaded += records.length;
      onProgress(`Uploaded main PR analysis: ${uploaded}/${analysis.mainPrs.length}`);
    }
    uploaded = 0;
    for (const records of analysisBatches) {
      await send({ action: "commit-analyses", records });
      uploaded += records.length;
      onProgress(`Uploaded release commit analysis: ${uploaded}/${analysis.analyses.length}`);
    }

    await stopHeartbeat();
    assertLease();
    const finished = await send({ action: "finish", expectedBranches: dataset.manifest.length });
    started = false;
    startAttempted = false;
    onProgress(`UI Components refresh complete: ${finished.branches} branches, ${finished.commits} unique commits, ${finished.mainPrs ?? analysis.mainPrs.length} main PRs; synced ${finished.lastSynced}`);
    return finished;
  } catch (error) {
    await stopHeartbeat(true);
    if (started || (startAttempted && !/^UI Components import API 409 /.test(errorMessage(error)))) {
      try {
        await send({ action: "abort", error: errorMessage(error).slice(0, 500) }, { ignoreLease: true });
        onProgress("UI Components refresh aborted; the previously published dataset is unchanged");
      } catch (abortError) {
        onProgress(`Could not confirm refresh abort; its lease will expire: ${errorMessage(abortError)}`);
      }
    }
    throw leaseError || error;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}

function prepareDataset(releases) {
  if (!Array.isArray(releases) || !releases.length) throw new Error("No release branches discovered; refusing to replace the current dataset");
  if (releases.length > 5000) throw new Error("More than 5000 release branches discovered; refusing an oversized dataset");
  if (releases.some((release) => !release || typeof release !== "object")) throw new Error("Invalid inspection result: every release must be an object");
  const failed = releases.filter((release) => release.error || !Array.isArray(release.releaseCommits));
  if (failed.length) {
    const examples = failed.slice(0, 5).map((release) => `${release.branch}: ${release.error || "missing release commits"}`).join("; ");
    throw new Error(`Inspection incomplete for ${failed.length} release branches; refusing publication. ${examples}`);
  }
  const branchNames = new Set();
  const commitRecords = new Map();
  const manifest = [];
  const snapshots = [];
  for (const release of releases) {
    if (!RELEASE_BRANCH.test(release.branch) || branchNames.has(release.branch)) throw new Error(`Invalid or duplicate release branch: ${release.branch}`);
    branchNames.add(release.branch);
    const version = release.uiComponentsRefType === "version";
    const reference = release.uiComponentsRefType === "commit" && typeof release.uiComponentsRef === "string"
      ? release.uiComponentsRef.toLowerCase() : release.uiComponentsRef;
    if (!FULL_SHA.test(release.widgetHeadSha || "") || !FULL_SHA.test(release.uiComponentsHeadSha || "")
      || !["version", "branch", "commit"].includes(release.uiComponentsRefType)
      || !boundedText(reference, 500, { reference: true })
      || (version && !VERSION_REF.test(reference))
      || (release.uiComponentsRefType === "commit" && reference !== release.uiComponentsHeadSha.toLowerCase())
      || release.status !== (version ? "published-version" : "release-commits")
      || (version ? release.jenkinsBoundarySha !== null || release.releaseCommits.length > 0 : !FULL_SHA.test(release.jenkinsBoundarySha || ""))
      || !Array.isArray(release.uiComponentsBranches) || release.uiComponentsBranches.length > 5000
      || release.uiComponentsBranches.some((branch) => !boundedText(branch, 500, { reference: true }))
      || !Array.isArray(release.warnings) || release.warnings.length > 100
      || release.warnings.some((warning) => !boundedText(warning, 2000))) {
      throw new Error(`Invalid inspected snapshot: ${release.branch}`);
    }
    const commitShas = new Set();
    for (const commit of release.releaseCommits) {
      const record = normalizeReleaseCommit(commit);
      if (isJenkinsAuthor(record.author) || record.sha === release.jenkinsBoundarySha?.toLowerCase()) {
        throw new Error(`Jenkins release boundary incorrectly included for ${release.branch}: ${record.sha}`);
      }
      const prior = commitRecords.get(record.sha);
      if (prior && JSON.stringify(prior) !== JSON.stringify(record)) throw new Error(`Conflicting commit metadata: ${record.sha}`);
      commitRecords.set(record.sha, record);
      commitShas.add(record.sha);
    }
    if (commitShas.size > 20_000) throw new Error(`Snapshot ${release.branch} exceeds 20000 release commits`);
    if (!version) {
      const head = release.uiComponentsHeadSha.toLowerCase();
      const boundary = release.jenkinsBoundarySha.toLowerCase();
      if ((boundary === head && commitShas.size !== 0) || (boundary !== head && !commitShas.has(head))) {
        throw new Error(`Invalid inspected snapshot: ${release.branch} must include the dependency head unless it is the Jenkins boundary`);
      }
    }
    manifest.push({
      branch: release.branch,
      widgetHeadSha: release.widgetHeadSha.toLowerCase(),
      uiComponentsRef: reference,
      uiComponentsRefType: release.uiComponentsRefType,
      uiComponentsHeadSha: release.uiComponentsHeadSha.toLowerCase(),
      uiComponentsBranches: [...new Set(release.uiComponentsBranches)],
      jenkinsBoundarySha: release.jenkinsBoundarySha?.toLowerCase() ?? null,
      status: release.status,
      warnings: release.warnings,
      expectedCommitCount: commitShas.size,
    });
    snapshots.push({ branch: release.branch, commitShas: [...commitShas] });
  }
  return { manifest, snapshots, commits: [...commitRecords.values()] };
}

function normalizeReleaseCommit(commit) {
  if (!commit || typeof commit !== "object") throw new Error("Invalid release commit metadata: unknown SHA");
  if (!FULL_SHA.test(commit.sha || "") || !boundedText(commit.displayId, 64) || commit.displayId.length < 7
    || !commit.sha.toLowerCase().startsWith(commit.displayId.toLowerCase())
    || typeof commit.message !== "string" || commit.message.includes("\0")
    || !Array.isArray(commit.parents) || commit.parents.length > 64 || commit.parents.some((sha) => !FULL_SHA.test(sha))
    || !commit.author
    || (commit.author.name != null && !boundedText(commit.author.name, 5000, { allowEmpty: true }))
    || (commit.author.emailAddress != null && !boundedText(commit.author.emailAddress, 5000, { allowEmpty: true }))
    || (!commit.author.name?.trim() && !commit.author.emailAddress?.trim())
    || (commit.authorTimestamp != null && (!Number.isSafeInteger(commit.authorTimestamp) || commit.authorTimestamp < 0 || commit.authorTimestamp > 8_640_000_000_000_000))) {
    throw new Error(`Invalid release commit metadata: ${commit.sha || "unknown SHA"}`);
  }
  if (commit.message.length > MAX_COMMIT_MESSAGE) {
    throw new Error(`Release commit ${commit.sha} message exceeds ${MAX_COMMIT_MESSAGE} characters; no snapshots were uploaded. Review the oversized metadata and adjust the CLI and API limits consistently before retrying`);
  }
  const parents = commit.parents.map((sha) => sha.toLowerCase());
  if (parents.includes(commit.sha.toLowerCase()) || new Set(parents).size !== parents.length) {
    throw new Error(`Invalid release commit metadata: ${commit.sha} has self or duplicate parents`);
  }
  return {
    sha: commit.sha.toLowerCase(),
    displayId: commit.displayId.toLowerCase(),
    author: { name: commit.author.name ?? null, emailAddress: commit.author.emailAddress ?? null },
    authorTimestamp: commit.authorTimestamp ?? null,
    message: commit.message,
    parents,
  };
}

function boundedText(value, maximum, { allowEmpty = false, reference = false } = {}) {
  return typeof value === "string" && value.length <= maximum && (allowEmpty || Boolean(value.trim()))
    && !value.includes("\0") && (!reference || !/[\s\x00-\x1f\x7f]/.test(value));
}

function batches(records, limit, makePayload) {
  const result = [];
  let batch = [];
  for (const record of records) {
    const candidate = [...batch, record];
    if (candidate.length > limit || Buffer.byteLength(JSON.stringify(makePayload(candidate)), "utf8") > MAX_BODY_BYTES) {
      if (!batch.length) throw new Error("One UI Components record exceeds the import request size limit; no snapshots were uploaded");
      result.push(batch);
      batch = [record];
      serializePayload(makePayload(batch));
    } else batch = candidate;
  }
  if (batch.length) result.push(batch);
  return result;
}

function serializePayload(payload) {
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) throw new Error("UI Components import request exceeds 1000000 UTF-8 bytes; no snapshots were uploaded");
  return body;
}

function validateAppUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("HYPERSYNC_URL must be a valid absolute URL"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local))
    || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("HYPERSYNC_URL must be an HTTPS app origin (HTTP is allowed only for localhost), without credentials, paths, query strings or fragments");
  }
  return url;
}

function delay(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const cancel = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", cancel); resolve(); }, ms);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
