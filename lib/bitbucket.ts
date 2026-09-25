export const DEFAULT_REPO = "hyper-widget";

export function prUrl(repo: string, prId: string | number): string {
  const base = (process.env.NEXT_PUBLIC_BITBUCKET_BASE_URL || "").replace(/\/+$/, "");
  const project = process.env.NEXT_PUBLIC_BITBUCKET_PROJECT_KEY || "";
  return `${base}/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(repo)}/pull-requests/${encodeURIComponent(String(prId))}/overview`;
}
