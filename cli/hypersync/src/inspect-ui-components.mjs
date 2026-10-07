import { discoverUiComponents, loadDiscoveryConfig } from "./discover-ui-components.mjs";

const FULL_SHA = /^[0-9a-f]{40,64}$/i;
const PAGE_SIZE = 100;
const MAX_PAGES = 200;
const MAX_FIRST_PARENT_COMMITS = 10000;

export async function inspectUiComponents(config = loadDiscoveryConfig(), options = {}) {
  const releases = await discoverUiComponents(config, options);
  return resolveUiComponents(releases, config, options);
}

// Read-only: resolve immutable heads before examining history. A containing
// branch is context only; it must never replace a pinned dependency SHA.
export async function resolveUiComponents(
  releases,
  config = loadDiscoveryConfig(),
  { fetchImpl = fetch, onProgress = () => {} } = {}
) {
  const baseUrl = config.bitbucketUrl.replace(/\/+$/, "");
  const repoPath = `projects/${encodeURIComponent(config.project)}/repos/ui-components`;
  const repoUrl = `${baseUrl}/rest/api/1.0/${repoPath}`;
  const authorization = config.username
    ? `Basic ${Buffer.from(`${config.username}:${config.token}`).toString("base64")}`
    : `Bearer ${config.token}`;
  const commitCache = new Map();
  const boundaryCache = new Map();
  const historyCache = new Map();
  const referenceCache = new Map();

  async function getJson(url) {
    const response = await fetchImpl(url, {
      headers: { Authorization: authorization, Accept: "application/json" },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      throw new Error(`Bitbucket ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    return response.json();
  }

  async function getPages(path, query, description) {
    const values = [];
    let start = 0;
    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
      const url = new URL(path);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("start", String(start));
      const page = await getJson(url);
      if (!Array.isArray(page.values) || typeof page.isLastPage !== "boolean") {
        throw new Error(`Bitbucket returned an invalid ${description} page`);
      }
      values.push(...page.values);
      onProgress(`Read ${description} page ${pageNumber + 1} (${values.length} results)`);
      if (page.isLastPage) return values;
      if (!Number.isInteger(page.nextPageStart) || page.nextPageStart <= start) {
        throw new Error(`Bitbucket ${description} pagination ended without a valid next page`);
      }
      start = page.nextPageStart;
    }
    throw new Error(`Bitbucket ${description} exceeded ${MAX_PAGES} pages; refusing an incomplete result`);
  }

  async function resolveNamedRef(reference, type) {
    const isTag = type === "version";
    const prefix = isTag ? "refs/tags/" : "refs/heads/";
    const name = reference.startsWith(prefix) ? reference.slice(prefix.length) : reference;
    const refs = await getPages(`${repoUrl}/${isTag ? "tags" : "branches"}`, { filterText: name }, `${isTag ? "tag" : "branch"} lookup for ${name}`);
    const matches = refs.filter((ref) => ref.id === `${prefix}${name}` || (!ref.id && ref.displayId === name));
    if (!matches.length) throw new Error(`ui-components ${isTag ? "tag" : "branch"} not found: ${reference}`);
    const heads = new Set(matches.map((ref) => ref.latestCommit?.toLowerCase()));
    if (heads.size !== 1 || !FULL_SHA.test([...heads][0] || "")) {
      throw new Error(`ui-components ref ${reference} has an invalid or changing head; rerun the command`);
    }
    return { sha: [...heads][0], branch: isTag ? null : name };
  }

  async function getCommit(sha) {
    sha = sha.toLowerCase();
    if (!commitCache.has(sha)) {
      commitCache.set(sha, getJson(`${repoUrl}/commits/${sha}`).then((value) => {
        const commit = normalizeCommit(value);
        if (commit.sha !== sha) throw new Error(`Bitbucket returned the wrong commit for ${sha}`);
        return commit;
      }));
    }
    return commitCache.get(sha);
  }

  async function findBoundary(headSha) {
    const visited = new Set();
    let sha = headSha;
    while (visited.size < MAX_FIRST_PARENT_COMMITS) {
      if (boundaryCache.has(sha)) {
        const boundary = boundaryCache.get(sha);
        for (const ancestor of visited) boundaryCache.set(ancestor, boundary);
        return boundary;
      }
      if (visited.has(sha)) throw new Error(`Cycle in first-parent history at ${sha}`);
      visited.add(sha);
      const commit = await getCommit(sha);
      onProgress(`Checking ui-components history ${visited.size}: ${commit.displayId}`);
      if (isJenkinsAuthor(commit.author)) {
        for (const ancestor of visited) boundaryCache.set(ancestor, sha);
        return sha;
      }
      if (!commit.parents.length) throw new Error(`No jenkins.user boundary in first-parent history of ${headSha}`);
      sha = commit.parents[0];
    }
    throw new Error(`No jenkins.user boundary within ${MAX_FIRST_PARENT_COMMITS} first-parent commits of ${headSha}`);
  }

  async function inspectHistory(headSha) {
    const boundary = await findBoundary(headSha);
    if (boundary === headSha) return { jenkinsBoundarySha: boundary, releaseCommits: [] };
    // since is exclusive, until is inclusive. Include merged side-branch work,
    // not just the first-parent chain used to locate the release boundary.
    const values = await getPages(`${repoUrl}/commits`, {
      since: boundary, until: headSha, merges: "include",
    }, `commit range ${boundary.slice(0, 12)}..${headSha.slice(0, 12)}`);
    const commits = new Map();
    for (const value of values) {
      const commit = normalizeCommit(value);
      if (commit.sha === boundary) throw new Error("Bitbucket commit range incorrectly included the Jenkins boundary");
      commits.set(commit.sha, commit);
    }
    if (!commits.has(headSha)) throw new Error("Bitbucket commit range did not include the pinned head");
    return {
      jenkinsBoundarySha: boundary,
      releaseCommits: [...commits.values()].filter((commit) => !isJenkinsAuthor(commit.author)),
    };
  }

  async function inspectReference(reference, type) {
    const { sha, branch } = type === "commit"
      ? { sha: reference.toLowerCase(), branch: null }
      : await resolveNamedRef(reference, type);
    await getCommit(sha); // Validate tags and pinned SHAs in the expected repo.
    const result = {
      uiComponentsHeadSha: sha,
      uiComponentsBranches: branch ? [branch] : [],
      jenkinsBoundarySha: null,
      releaseCommits: [],
      status: type === "version" ? "published-version" : "release-commits",
      warnings: [],
    };
    if (type === "version") return result;

    if (!historyCache.has(sha)) historyCache.set(sha, inspectHistory(sha));
    Object.assign(result, await historyCache.get(sha));
    if (type === "commit") {
      try {
        const branches = await getPages(`${baseUrl}/rest/branch-utils/1.0/${repoPath}/branches/info/${sha}`, {}, `containing branches for ${sha.slice(0, 12)}`);
        const names = branches.map((item) => item.displayId || item.id?.replace(/^refs\/heads\//, ""));
        if (names.some((name) => typeof name !== "string" || !name)) throw new Error("Invalid containing branch name");
        result.uiComponentsBranches = [...new Set(names)].sort();
      } catch (error) {
        // A deleted branch or unavailable plugin does not invalidate a SHA's
        // independently verified history, but do not silently hide the failure.
        result.warnings.push(`Containing branch lookup failed: ${errorMessage(error)}`);
      }
    }
    return result;
  }

  const result = [];
  for (const release of releases) {
    let inspected = {
      ...release, uiComponentsHeadSha: null, uiComponentsBranches: [],
      jenkinsBoundarySha: null, releaseCommits: null, status: "error", warnings: [],
    };
    if (!release.error) {
      try {
        const { uiComponentsRef: reference, uiComponentsRefType: type } = release;
        if (!reference || !["version", "commit", "branch"].includes(type)) throw new Error("Invalid ui-components reference");
        if (type === "commit" && !FULL_SHA.test(reference)) throw new Error("Invalid pinned ui-components SHA");
        onProgress(`Resolving ${release.branch}: ${reference} (${type})`);
        const key = `${type}:${reference}`;
        if (!referenceCache.has(key)) referenceCache.set(key, inspectReference(reference, type));
        inspected = { ...inspected, ...await referenceCache.get(key) };
      } catch (error) {
        inspected.error = errorMessage(error);
      }
    }
    result.push(inspected);
    onProgress(`Resolved ${result.length}/${releases.length} release branches: ${release.branch} — ${inspected.error || `${inspected.releaseCommits.length} release commits (${inspected.status})`}`);
  }
  return result;
}

export function isJenkinsAuthor(author) {
  return author?.name?.trim().toLowerCase() === "jenkins.user"
    || author?.emailAddress?.trim().toLowerCase() === "jenkins.user@juspay.in";
}

function normalizeCommit(commit) {
  if (!FULL_SHA.test(commit.id || "") || !Array.isArray(commit.parents)
    || commit.parents.some((parent) => !FULL_SHA.test(parent.id || ""))
    || !commit.author || (!commit.author.name && !commit.author.emailAddress)
    || (commit.author.name != null && typeof commit.author.name !== "string")
    || (commit.author.emailAddress != null && typeof commit.author.emailAddress !== "string")) {
    throw new Error("Bitbucket returned invalid commit metadata");
  }
  return {
    sha: commit.id.toLowerCase(),
    displayId: commit.displayId || commit.id.slice(0, 12),
    author: { name: commit.author.name || null, emailAddress: commit.author.emailAddress || null },
    authorTimestamp: commit.authorTimestamp ?? null,
    message: commit.message || "",
    parents: commit.parents.map((parent) => parent.id.toLowerCase()),
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
