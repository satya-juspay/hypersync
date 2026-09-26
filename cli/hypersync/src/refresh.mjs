import { createHash, randomUUID } from "node:crypto";

const INITIAL_SYNC = Date.parse("2026-01-01T00:00:00.000Z");
const PAGE_SIZE = 100;
const MAX_PAGES = 200;
const BATCH_SIZE = 25;
const FINGERPRINT_DELAY_MS = 1500;
const FINGERPRINT_VERSION = "v2";
const MAX_FINGERPRINT = 750_000;

async function backfillFingerprints(config, runId, kind, byId, assertLease, delayMs) {
  const label = kind === "main" ? "main" : "release";
  let completed = 0;
  const skipped = new Set();

  async function processItems(items) {
    for (const item of items) {
      assertLease();
      try {
        const pr = byId.get(item.id)
          ?? await fetchBitbucket(config, prUrl(config, item.id), "json");
        const record = toRecord(pr);
        if (!record || record.kind !== kind) {
          skipped.add(item.id);
          console.warn(`Skipped ${label} PR #${item.id}: it is no longer an eligible ${label} PR`);
          continue;
        }

        console.log(`Fingerprinting ${label} PR #${item.id}`);
        const diff = await fetchBitbucket(config, `${prUrl(config, item.id)}.diff`, "text");
        const fingerprint = createPatchFingerprint(diff);
        if (fingerprint.length > MAX_FINGERPRINT) {
          skipped.add(item.id);
          console.warn(`Skipped ${label} PR #${item.id}: fingerprint exceeds ${MAX_FINGERPRINT} characters`);
          continue;
        }
        await send(config, {
          action: "batch",
          runId,
          records: [{ ...record, patchFingerprint: fingerprint }],
        });
        completed += 1;
        console.log(`${label === "main" ? "Main" : "Release"} fingerprints updated: ${completed}; skipped: ${skipped.size}`);
        if (delayMs > 0) await delay(delayMs);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/^Bitbucket (404|5\d\d):/.test(message)) throw error;
        skipped.add(item.id);
        console.warn(`Skipped ${label} PR #${item.id}: ${message}`);
      }
    }
  }

  const changed = [...byId.entries()]
    .filter(([, pr]) => toRecord(pr)?.kind === kind)
    .map(([id]) => ({ id, kind }));
  if (changed.length > 0) {
    console.log(`Refreshing fingerprints for ${changed.length} updated ${label} PR${changed.length === 1 ? "" : "s"}...`);
    await processItems(changed);
  }

  console.log(`Backfilling missing ${label} PR fingerprints...`);
  while (true) {
    assertLease();
    const pending = await send(config, {
      action: "pending",
      runId,
      kind,
      limit: 50,
      excludeIds: [...skipped],
    });
    if (!pending.records?.length) break;
    const candidates = pending.records.filter((item) => !skipped.has(item.id));
    if (!candidates.length) break;
    console.log(`Processing ${candidates.length} ${label} PR fingerprint${candidates.length === 1 ? "" : "s"}`);

    await processItems(candidates);
  }

  console.log(
    `${label === "main" ? "Main" : "Release"} PR fingerprint phase complete. ${completed} updated, ${skipped.size} skipped.`
  );
  return { completed, skipped: skipped.size };
}

export async function refresh({ delayMs = FINGERPRINT_DELAY_MS } = {}) {
  const config = loadConfig();
  const runId = randomUUID();
  let started = false;
  let leaseError;
  let heartbeat;

  try {
    const start = await send(config, { action: "start", runId });
    started = true;
    heartbeat = setInterval(() => {
      send(config, { action: "heartbeat", runId }).catch((error) => { leaseError = error; });
    }, 60_000);
    console.log(`Importing PRs updated since ${start.since}`);

    const since = Math.max(INITIAL_SYNC, Date.parse(start.since));
    if (!Number.isFinite(since)) throw new Error("Import API returned an invalid sync cursor");
    const allPRs = await fetchRelevantPRs(config, since);
    const selected = allPRs.map(toRecord).filter(Boolean);
    const byId = new Map(allPRs.map((pr) => [String(pr.id), pr]));
    for (let offset = 0; offset < selected.length; offset += BATCH_SIZE) {
      if (leaseError) throw leaseError;
      await send(config, { action: "batch", runId, records: selected.slice(offset, offset + BATCH_SIZE) });
      console.log(`Uploaded ${Math.min(offset + BATCH_SIZE, selected.length)}/${selected.length} PRs`);
    }

    const assertLease = () => {
      if (leaseError) throw leaseError;
    };
    const releaseFingerprints = await backfillFingerprints(
      config,
      runId,
      "release",
      byId,
      assertLease,
      delayMs
    );
    const mainFingerprints = await backfillFingerprints(
      config,
      runId,
      "main",
      byId,
      assertLease,
      delayMs
    );

    if (leaseError) throw leaseError;
    const finished = await send(config, { action: "finish", runId });
    started = false;
    console.log(
      `Refresh complete. ${selected.length} PR metadata records uploaded, ` +
      `${releaseFingerprints.completed} release fingerprints updated, ` +
      `${mainFingerprints.completed} main fingerprints updated, ` +
      `${releaseFingerprints.skipped + mainFingerprints.skipped} fingerprints skipped; ` +
      `cursor ${finished.lastSynced}`
    );
  } catch (error) {
    if (started) {
      try { await send(config, { action: "abort", runId }); } catch { /* Lease expires after a crash. */ }
    }
    throw error;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}

function loadConfig() {
  const config = {
    appUrl: process.env.HYPERSYNC_URL,
    importToken: process.env.HYPERSYNC_IMPORT_TOKEN,
    bitbucketToken: process.env.BITBUCKET_TOKEN,
    bitbucketUrl: process.env.BITBUCKET_BASE_URL || "https://bitbucket.juspay.net",
    project: process.env.BITBUCKET_PROJECT_KEY || "PICAF",
    repo: process.env.BITBUCKET_REPO || "hyper-widget",
    username: process.env.BITBUCKET_USERNAME,
  };
  for (const [key, value] of Object.entries({ HYPERSYNC_URL: config.appUrl, HYPERSYNC_IMPORT_TOKEN: config.importToken, BITBUCKET_TOKEN: config.bitbucketToken })) {
    if (!value) throw new Error(`Missing ${key}`);
  }
  const app = new URL(config.appUrl);
  if (app.protocol !== "https:" && !(app.protocol === "http:" && ["localhost", "127.0.0.1"].includes(app.hostname))) {
    throw new Error("HYPERSYNC_URL must use HTTPS outside localhost");
  }
  return config;
}

async function send(config, body) {
  const url = new URL("/api/import", config.appUrl);
  for (let attempt = 0; attempt < 4; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.importToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (attempt === 3) throw error;
      await delay(1000 * 2 ** attempt);
      continue;
    }
    if ([429, 502, 503, 504].includes(response.status) && attempt < 3) {
      await delay(1000 * 2 ** attempt);
      continue;
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Import API ${response.status}: ${result.error || "Unknown error"}`);
    return result;
  }
}

async function fetchRelevantPRs(config, since) {
  const results = new Map();
  for (const query of [
    { state: "MERGED" },
    { state: "ALL", at: "refs/heads/main", direction: "INCOMING" },
    { state: "ALL", at: "refs/heads/master", direction: "INCOMING" },
  ]) {
    for (const pr of await fetchPRsSince(config, query, since)) {
      if (toRecord(pr)) results.set(String(pr.id), pr);
    }
  }
  console.log(`Found ${results.size} relevant PRs updated since ${new Date(since).toISOString()}`);
  return [...results.values()];
}

async function fetchPRsSince(config, query, since) {
  let start = 0;
  const results = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(prUrl(config));
    for (const [key, value] of Object.entries({ ...query, limit: PAGE_SIZE, start, order: "NEWEST", withProperties: true })) {
      url.searchParams.set(key, String(value));
    }
    const response = await fetchBitbucket(config, url, "json");
    const values = response.values || [];
    results.push(...values.filter((pr) => updatedAt(pr) >= since));
    if (values.some((pr) => updatedAt(pr) < since) || response.isLastPage !== false) return results;
    if (!Number.isInteger(response.nextPageStart)) throw new Error("Bitbucket pagination ended without a cursor");
    start = response.nextPageStart;
  }
  throw new Error(`Bitbucket returned more than ${MAX_PAGES * PAGE_SIZE} recent PRs for ${query.at || query.state}; sync cursor was not advanced`);
}

async function fetchBitbucket(config, url, format) {
  const auth = config.username
    ? `Basic ${Buffer.from(`${config.username}:${config.bitbucketToken}`).toString("base64")}`
    : `Bearer ${config.bitbucketToken}`;
  const response = await fetch(url, { headers: { Authorization: auth, Accept: format === "json" ? "application/json" : "text/plain" } });
  if (!response.ok) {
    const text = (await response.text()).slice(0, 200);
    throw new Error(`Bitbucket ${response.status}: ${text}`);
  }
  return format === "json" ? response.json() : response.text();
}

function prUrl(config, id) {
  return `${config.bitbucketUrl.replace(/\/+$/, "")}/rest/api/1.0/projects/${encodeURIComponent(config.project)}/repos/${encodeURIComponent(config.repo)}/pull-requests${id === undefined ? "" : `/${encodeURIComponent(id)}`}`;
}

function updatedAt(pr) {
  return Number(pr.updatedDate ?? pr.createdDate ?? 0);
}

function toRecord(pr) {
  const branch = pr.toRef?.displayId || "";
  const release = pr.state === "MERGED" && branch.toLowerCase().startsWith("release-");
  const main = ["main", "master"].includes(branch.toLowerCase());
  if (!release && !main) return null;
  const mergedValue = pr.state === "MERGED" ? pr.closedDate ?? pr.updatedDate : null;
  const mergedAt = mergedValue == null ? null : new Date(Number(mergedValue)).toISOString();
  const common = {
    id: String(pr.id),
    kind: release ? "release" : "main",
    title: pr.title || `PR #${pr.id}`,
    author: pr.author?.user?.emailAddress || pr.author?.user?.email || "",
    displayName: pr.author?.user?.displayName || pr.author?.user?.name || "Unknown author",
    sourceBranch: pr.fromRef?.displayId || null,
    mergedAt,
  };
  return release
    ? { ...common, releaseBranch: branch, mainPrId: extractMainPrId(pr.description || "") }
    : { ...common, status: pr.state || "OPEN" };
}

function extractMainPrId(description) {
  return (description.match(/\/hyper-widget\/pull-requests\/(\d+)/i)
    ?? description.match(/main branch PR.*?#(\d+)/i)
    ?? description.match(/\bmain\s+PR\s*#?(\d+)/i))?.[1] ?? null;
}

export function createPatchFingerprint(diff) {
  const files = new Set();
  const addedLines = new Set();
  const removedLines = new Set();
  let filePath = "";
  for (const rawLine of diff.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.startsWith("+++ ")) {
      filePath = line.replace(/^\+\+\+\s+b\//, "").replace(/^\+\+\+\s+/, "");
      continue;
    }
    if (line.startsWith("--- ") || (!line.startsWith("+") && !line.startsWith("-"))) continue;
    const normalized = line.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    const rawToken = `${filePath}\t${normalized}`;
    files.add(`F:${hashToken(filePath)}`);
    if (normalized.startsWith("+")) addedLines.add(`A:${hashToken(rawToken)}`);
    else removedLines.add(`R:${hashToken(rawToken)}`);
  }
  return [
    FINGERPRINT_VERSION,
    ...[...files].sort(),
    ...[...addedLines].sort(),
    ...[...removedLines].sort(),
  ].join("\n");
}

function hashToken(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
