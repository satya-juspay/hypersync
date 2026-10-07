const RELEASE_BRANCH = /^release-2026\d{4}$/;
const PAGE_SIZE = 100;
const MAX_PAGES = 200;

export function loadDiscoveryConfig(env = process.env) {
  if (!env.BITBUCKET_TOKEN) throw new Error("Missing BITBUCKET_TOKEN");
  return {
    bitbucketUrl: env.BITBUCKET_BASE_URL || "https://bitbucket.juspay.net",
    project: env.BITBUCKET_PROJECT_KEY || "PICAF",
    username: env.BITBUCKET_USERNAME,
    token: env.BITBUCKET_TOKEN,
  };
}

export async function discoverUiComponents(
  config = loadDiscoveryConfig(),
  { fetchImpl = fetch, onProgress = () => {} } = {}
) {
  const repoUrl = `${config.bitbucketUrl.replace(/\/+$/, "")}/rest/api/1.0/projects/${encodeURIComponent(config.project)}/repos/hyper-widget`;
  const headers = {
    Authorization: config.username
      ? `Basic ${Buffer.from(`${config.username}:${config.token}`).toString("base64")}`
      : `Bearer ${config.token}`,
  };
  const branches = new Map();
  let start = 0;

  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
    const url = new URL(`${repoUrl}/branches`);
    url.searchParams.set("filterText", "release-2026");
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("start", String(start));
    const page = await getBitbucket(fetchImpl, url, headers, "json");

    if (!Array.isArray(page.values) || typeof page.isLastPage !== "boolean") {
      throw new Error("Bitbucket returned an invalid branch page");
    }
    for (const branch of page.values) {
      if (!RELEASE_BRANCH.test(branch.displayId)) continue;
      const headSha = branch.latestCommit;
      const previous = branches.get(branch.displayId);
      if (previous && previous !== headSha) {
        throw new Error(`Release branch ${branch.displayId} moved during discovery; rerun the command`);
      }
      branches.set(branch.displayId, headSha);
    }
    onProgress(`Scanned ${pageNumber + 1} branch page${pageNumber === 0 ? "" : "s"}; found ${branches.size} matching branches`);

    if (page.isLastPage) break;
    if (!Number.isInteger(page.nextPageStart) || page.nextPageStart <= start) {
      throw new Error("Bitbucket branch pagination ended without a valid next page");
    }
    start = page.nextPageStart;
    if (pageNumber === MAX_PAGES - 1) {
      throw new Error(`Bitbucket has more than ${MAX_PAGES * PAGE_SIZE} matching branch results`);
    }
  }

  const releases = [];
  for (const [branch, widgetHeadSha] of [...branches].sort(([left], [right]) => left.localeCompare(right))) {
    const release = { branch, widgetHeadSha, uiComponentsRef: null, uiComponentsRefType: null, error: null };
    try {
      if (!/^[0-9a-f]{40,64}$/i.test(widgetHeadSha)) {
        throw new Error("Bitbucket did not return a full branch head SHA");
      }
      const url = new URL(`${repoUrl}/raw/packages.dhall`);
      url.searchParams.set("at", widgetHeadSha);
      const packages = await getBitbucket(fetchImpl, url, headers, "text");
      const reference = extractUiComponentsReference(packages);
      release.uiComponentsRef = reference;
      release.uiComponentsRefType = classifyReference(reference);
    } catch (error) {
      release.error = error instanceof Error ? error.message : String(error);
    }
    releases.push(release);
    onProgress(`Inspected ${releases.length}/${branches.size} release branches: ${branch}${release.error ? ` (${release.error})` : ""}`);
  }

  return releases;
}

export function extractUiComponentsReference(packages) {
  const blocks = [...packages.matchAll(/^\s*with\s+ui-components\s*=\s*\{([\s\S]*?)^\s*\}/gm)];
  if (blocks.length !== 1) {
    throw new Error(`Expected one ui-components dependency in packages.dhall; found ${blocks.length}`);
  }
  const body = blocks[0][1];
  const repo = body.match(/^\s*,?\s*repo\s*=\s*"([^"]+)"/m)?.[1];
  const version = body.match(/^\s*,?\s*version\s*=\s*"([^"]+)"/m)?.[1];
  if (!repo || !/\/ui-components\.git$/i.test(repo)) {
    throw new Error("ui-components dependency does not point to the expected repository");
  }
  if (!version) throw new Error("ui-components dependency has no version or ref");
  return version;
}

function classifyReference(reference) {
  if (/^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(reference)) return "version";
  if (/^[0-9a-f]{40,64}$/i.test(reference)) return "commit";
  return "branch";
}

async function getBitbucket(fetchImpl, url, headers, format) {
  const response = await fetchImpl(url, {
    headers: { ...headers, Accept: format === "json" ? "application/json" : "text/plain" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const message = (await response.text()).slice(0, 200);
    throw new Error(`Bitbucket ${response.status}: ${message}`);
  }
  return format === "json" ? response.json() : response.text();
}
