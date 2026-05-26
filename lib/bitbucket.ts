import { createPatchFingerprint } from "@/lib/patch-score";

const RELEASE_BRANCH_PREFIX = "release-";

export const DEFAULT_REPO = "hyper-widget";

type BitbucketRef = {
  displayId?: string;
};

type BitbucketUser = {
  displayName?: string;
  name?: string;
  emailAddress?: string;
  email?: string;
};

export type BitbucketPullRequest = {
  id: number | string;
  version?: number;
  title?: string;
  description?: string;
  state?: string;
  createdDate?: number | string;
  updatedDate?: number | string;
  closedDate?: number | string;
  fromRef?: BitbucketRef;
  toRef?: BitbucketRef;
  author?: {
    user?: BitbucketUser;
  };
  closedBy?: {
    user?: BitbucketUser;
  };
  links?: {
    self?: Array<{ href?: string }>;
  };
  properties?: {
    mergeCommit?: {
      id?: string;
    };
  };
};

type BitbucketPullRequestPage = {
  values?: BitbucketPullRequest[];
  isLastPage?: boolean;
  nextPageStart?: number;
};

type BitbucketConfig = {
  baseUrl: string;
  projectKey: string;
  username?: string;
  token: string;
};

type FetchPullRequestsOptions = {
  state?: "OPEN" | "MERGED" | "DECLINED" | "ALL";
  limit?: number;
  maxPages?: number;
  mergedAfter?: Date;
};

class BitbucketApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "BitbucketApiError";
  }
}

function getBitbucketConfig(): BitbucketConfig {
  const config = {
    baseUrl: process.env.BITBUCKET_BASE_URL,
    projectKey: process.env.BITBUCKET_PROJECT_KEY,
    token: process.env.BITBUCKET_TOKEN,
  };

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing Bitbucket environment variables: ${missing.join(", ")}`
    );
  }

  return {
    ...config,
    username: process.env.BITBUCKET_USERNAME || undefined,
  } as BitbucketConfig;
}

function encodeBasicAuth(value: string): string {
  if (typeof btoa === "function") {
    return btoa(value);
  }

  return Buffer.from(value).toString("base64");
}

function bitbucketPullRequestsUrl(
  repo: string,
  prId?: string | number,
  query?: Record<string, string | number | boolean | undefined>
) {
  const { baseUrl, projectKey } = getBitbucketConfig();
  const base = baseUrl.replace(/\/+$/, "");
  const path = [
    base,
    "rest/api/1.0/projects",
    encodeURIComponent(projectKey),
    "repos",
    encodeURIComponent(repo),
    "pull-requests",
    prId !== undefined ? encodeURIComponent(String(prId)) : undefined,
  ]
    .filter(Boolean)
    .join("/");
  const url = new URL(path);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function bitbucketPullRequestDiffUrl(repo: string, prId: string | number) {
  return `${bitbucketPullRequestsUrl(repo, prId)}.diff`;
}

async function bitbucketFetch<T>(url: string): Promise<T> {
  const { username, token } = getBitbucketConfig();
  const authorization = username
    ? `Basic ${encodeBasicAuth(`${username}:${token}`)}`
    : `Bearer ${token}`;

  const response = await fetch(url, {
    headers: {
      Authorization: authorization,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new BitbucketApiError(
      `Bitbucket API error ${response.status}: ${text}`,
      response.status
    );
  }

  return response.json();
}

async function bitbucketFetchText(url: string): Promise<string> {
  const { username, token } = getBitbucketConfig();
  const authorization = username
    ? `Basic ${encodeBasicAuth(`${username}:${token}`)}`
    : `Bearer ${token}`;

  const response = await fetch(url, {
    headers: {
      Authorization: authorization,
      Accept: "text/plain",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new BitbucketApiError(
      `Bitbucket API error ${response.status}: ${text}`,
      response.status
    );
  }

  return response.text();
}

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

export async function fetchPullRequests(
  repo: string,
  options: FetchPullRequestsOptions = {}
): Promise<BitbucketPullRequest[]> {
  const state = options.state ?? "MERGED";
  const limit = options.limit ?? 100;
  const maxPages = options.maxPages ?? 50;
  const pullRequests: BitbucketPullRequest[] = [];
  let start = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const response = await bitbucketFetch<BitbucketPullRequestPage>(
      bitbucketPullRequestsUrl(repo, undefined, {
        state,
        limit,
        start,
        order: "NEWEST",
        withProperties: true,
      })
    );

    const values = response.values ?? [];

    pullRequests.push(
      ...values.filter((pr) => isWithinMergedWindow(pr, options.mergedAfter))
    );

    if (shouldStopAtMergedWindow(values, options.mergedAfter)) {
      break;
    }

    if (response.isLastPage !== false || response.nextPageStart === undefined) {
      break;
    }

    start = response.nextPageStart;
  }

  return pullRequests;
}

export async function fetchReleasePullRequests(
  repo = DEFAULT_REPO,
  options: Pick<FetchPullRequestsOptions, "mergedAfter"> = {}
): Promise<BitbucketPullRequest[]> {
  const pullRequests = await fetchPullRequests(repo, {
    state: "MERGED",
    mergedAfter: options.mergedAfter,
  });

  return pullRequests.filter((pr) => isReleaseBranch(pr.toRef?.displayId));
}

export async function fetchPullRequestDiff(
  repo: string,
  prId: string | number
) {
  return bitbucketFetchText(bitbucketPullRequestDiffUrl(repo, prId));
}

export async function fetchPullRequestPatchFingerprint(
  repo: string,
  prId: string | number
) {
  return createPatchFingerprint(await fetchPullRequestDiff(repo, prId));
}

export function extractMainPrId(description = ""): string | null {
  const match =
    description.match(/\/hyper-widget\/pull-requests\/(\d+)/i) ??
    description.match(/main branch PR.*?#(\d+)/i) ??
    description.match(/\bmain\s+PR\s*#?(\d+)/i);

  return match?.[1] ?? null;
}

export function isReleaseBranch(branch?: string | null): boolean {
  return branch?.toLowerCase().startsWith(RELEASE_BRANCH_PREFIX) ?? false;
}

function getMergedDate(pr: BitbucketPullRequest): Date | null {
  if (pr.state !== "MERGED") return null;

  const value = pr.closedDate ?? pr.updatedDate;
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isWithinMergedWindow(
  pr: BitbucketPullRequest,
  mergedAfter?: Date
): boolean {
  if (!mergedAfter) return true;

  const mergedAt = getMergedDate(pr);
  return mergedAt !== null && mergedAt >= mergedAfter;
}

function shouldStopAtMergedWindow(
  prs: BitbucketPullRequest[],
  mergedAfter?: Date
): boolean {
  if (!mergedAfter || prs.length === 0) return false;

  const mergedDates = prs.map(getMergedDate);
  return (
    mergedDates.every((date) => date !== null) &&
    mergedDates.every((date) => date < mergedAfter)
  );
}
