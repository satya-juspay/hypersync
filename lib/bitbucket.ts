const BASE_URL = process.env.BITBUCKET_BASE_URL;
const PROJECT_KEY = process.env.BITBUCKET_PROJECT_KEY;
const TOKEN = process.env.BITBUCKET_TOKEN;

// Client-safe URL builder — uses NEXT_PUBLIC_ vars so it works in both server and browser
export function prUrl(repo: string, prId: string | number): string {
  const base =
    process.env.NEXT_PUBLIC_BITBUCKET_BASE_URL ||
    process.env.BITBUCKET_BASE_URL ||
    "";
  const project =
    process.env.NEXT_PUBLIC_BITBUCKET_PROJECT_KEY ||
    process.env.BITBUCKET_PROJECT_KEY ||
    "";
  return `${base}/projects/${project}/repos/${repo}/pull-requests/${prId}/overview`;
}

export async function fetchPullRequest(repo: string, prId: number) {
  const url = `${BASE_URL}/rest/api/1.0/projects/${PROJECT_KEY}/repos/${repo}/pull-requests/${prId}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bitbucket API error ${response.status}: ${text}`);
  }

  return response.json();
}

const MAIN_BRANCHES = ["main", "master"];

/**
 * Derives sync status by fetching the main PR from Bitbucket.
 * Returns:
 *   "SYNCED"           — PR targets main/master and is MERGED
 *   "MAIN_PR_OPEN"     — PR targets main/master and is still OPEN
 *   "MISSING_MAIN_PR"  — PR does NOT target main/master (wrong branch)
 */
export async function resolveMainPrStatus(
  repo: string,
  mainPrId: number
): Promise<"SYNCED" | "MAIN_PR_OPEN" | "MISSING_MAIN_PR"> {
  const pr = await fetchPullRequest(repo, mainPrId);
  const targetBranch: string = pr.toRef?.displayId ?? "";

  if (!MAIN_BRANCHES.includes(targetBranch.toLowerCase())) {
    return "MISSING_MAIN_PR";
  }

  return pr.state === "MERGED" ? "SYNCED" : "MAIN_PR_OPEN";
}
