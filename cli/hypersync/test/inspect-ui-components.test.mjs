import assert from "node:assert/strict";
import { test } from "node:test";
import { isJenkinsAuthor, resolveUiComponents } from "../src/inspect-ui-components.mjs";

const config = {
  bitbucketUrl: "https://bitbucket.example.test/",
  project: "PICAF",
  token: "test-token",
};
const sha = (character) => character.repeat(40);
const human = { name: "Developer", emailAddress: "developer@example.test" };
const jenkins = { name: "jenkins.user", emailAddress: "jenkins.user@juspay.in" };
const commit = (id, parents = [], author = human, extra = {}) => ({
  id,
  displayId: id.slice(0, 12),
  parents: parents.map((parent) => ({ id: parent })),
  author,
  authorTimestamp: 123456789,
  message: `Commit ${id.slice(0, 12)}`,
  ...extra,
});
const release = (reference, type = "commit", branch = "release-20260105") => ({
  branch,
  widgetHeadSha: sha("0"),
  uiComponentsRef: reference,
  uiComponentsRefType: type,
  error: null,
});
const page = (values, extra = {}) => Response.json({ values, isLastPage: true, ...extra });

function fakeFetch(handler, requests = []) {
  return async (url, options) => {
    const request = new URL(url);
    requests.push(request);
    assert.equal(options.headers.Authorization, "Bearer test-token");
    assert.equal(options.headers.Accept, "application/json");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(request.pathname.includes("/repos/ui-components/"), true);
    const response = await handler(request);
    assert.ok(response instanceof Response, `Unexpected request: ${request}`);
    return response;
  };
}

test("resolves an exact branch across all lookup pages before walking its immutable head", async () => {
  const requests = [];
  const progress = [];
  const results = await resolveUiComponents([release("feature", "branch")], config, {
    onProgress: (message) => progress.push(message),
    fetchImpl: fakeFetch((request) => {
      if (request.pathname.endsWith("/branches")) {
        assert.equal(request.searchParams.get("filterText"), "feature");
        assert.equal(request.searchParams.get("limit"), "100");
        if (request.searchParams.get("start") === "0") {
          return page([{ id: "refs/heads/feature-extra", latestCommit: sha("f") }], {
            isLastPage: false, nextPageStart: 7,
          });
        }
        assert.equal(request.searchParams.get("start"), "7");
        return page([{ id: "refs/heads/feature", displayId: "feature", latestCommit: sha("a") }]);
      }
      if (request.pathname.endsWith(`/commits/${sha("a")}`)) return Response.json(commit(sha("a"), [sha("c")]));
      if (request.pathname.endsWith(`/commits/${sha("c")}`)) return Response.json(commit(sha("c"), [], jenkins));
      if (request.pathname.endsWith("/commits")) {
        assert.equal(request.searchParams.get("until"), sha("a"));
        assert.equal(request.searchParams.get("since"), sha("c"));
        return page([commit(sha("a"), [sha("c")])]);
      }
    }, requests),
  });

  assert.equal(results[0].error, null);
  assert.equal(results[0].uiComponentsHeadSha, sha("a"));
  assert.deepEqual(results[0].uiComponentsBranches, ["feature"]);
  assert.equal(results[0].jenkinsBoundarySha, sha("c"));
  assert.deepEqual(results[0].releaseCommits.map((item) => item.sha), [sha("a")]);
  assert.equal(requests.some((request) => request.pathname.endsWith(`/commits/${sha("f")}`)), false);
  assert.ok(progress.some((message) => message.includes("page 2")));
});

test("keeps a pinned SHA even when its containing branch has advanced", async () => {
  const requests = [];
  const results = await resolveUiComponents([release(sha("a").toUpperCase())], config, {
    fetchImpl: fakeFetch((request) => {
      if (request.pathname.endsWith(`/commits/${sha("a")}`)) return Response.json(commit(sha("a"), [sha("c")]));
      if (request.pathname.endsWith(`/commits/${sha("c")}`)) return Response.json(commit(sha("c"), [], jenkins));
      if (request.pathname.endsWith("/commits")) {
        assert.equal(request.searchParams.get("until"), sha("a"));
        return page([commit(sha("a"), [sha("c")])]);
      }
      if (request.pathname.includes("/branches/info/")) {
        assert.equal(request.pathname, `/rest/branch-utils/1.0/projects/PICAF/repos/ui-components/branches/info/${sha("a")}`);
        return page([
          { displayId: "feature", latestCommit: sha("f") },
          { id: "refs/heads/main", latestCommit: sha("e") },
          { displayId: "feature", latestCommit: sha("f") },
        ]);
      }
    }, requests),
  });

  assert.equal(results[0].error, null);
  assert.equal(results[0].uiComponentsHeadSha, sha("a"));
  assert.deepEqual(results[0].uiComponentsBranches, ["feature", "main"]);
  assert.equal(requests.some((request) => request.pathname.endsWith(`/commits/${sha("f")}`)), false);
  assert.equal(requests.some((request) => request.pathname.endsWith("/branches")), false);
});

test("locates Jenkins on the first parent but includes full paginated graph work and human merge commits", async () => {
  const requests = [];
  const head = commit(sha("a"), [sha("b"), sha("e")], human, { committer: jenkins });
  const firstParent = commit(sha("b"), [sha("c")]);
  const sideWork = commit(sha("d"), [sha("c")]);
  const sideJenkins = commit(sha("e"), [sha("d")], {
    name: "Release automation", emailAddress: " JENKINS.USER@juspay.in ",
  });
  const results = await resolveUiComponents([release("feature", "branch")], config, {
    fetchImpl: fakeFetch((request) => {
      if (request.pathname.endsWith("/branches")) return page([{ id: "refs/heads/feature", latestCommit: sha("a") }]);
      if (request.pathname.endsWith(`/commits/${sha("a")}`)) return Response.json(head);
      if (request.pathname.endsWith(`/commits/${sha("b")}`)) return Response.json(firstParent);
      if (request.pathname.endsWith(`/commits/${sha("c")}`)) return Response.json(commit(sha("c"), [], jenkins));
      if (request.pathname.endsWith("/commits")) {
        assert.equal(request.searchParams.get("since"), sha("c"));
        assert.equal(request.searchParams.get("until"), sha("a"));
        assert.equal(request.searchParams.get("merges"), "include");
        if (request.searchParams.get("start") === "0") {
          return page([head, sideJenkins], { isLastPage: false, nextPageStart: 2 });
        }
        assert.equal(request.searchParams.get("start"), "2");
        return page([sideWork, firstParent, head]);
      }
    }, requests),
  });

  assert.equal(results[0].error, null);
  assert.equal(results[0].jenkinsBoundarySha, sha("c"));
  assert.deepEqual(results[0].releaseCommits.map((item) => item.sha), [sha("a"), sha("d"), sha("b")]);
  assert.equal(requests.some((request) => request.pathname.endsWith(`/commits/${sha("e")}`)), false);
});

test("a Jenkins head produces an empty release without requesting a commit range", async () => {
  const requests = [];
  const results = await resolveUiComponents([release("main", "branch")], config, {
    fetchImpl: fakeFetch((request) => {
      if (request.pathname.endsWith("/branches")) return page([{ id: "refs/heads/main", latestCommit: sha("c") }]);
      if (request.pathname.endsWith(`/commits/${sha("c")}`)) return Response.json(commit(sha("c"), [], jenkins));
    }, requests),
  });
  assert.equal(results[0].error, null);
  assert.equal(results[0].jenkinsBoundarySha, sha("c"));
  assert.deepEqual(results[0].releaseCommits, []);
  assert.equal(requests.length, 2);
});

test("published versions resolve exact tags and validate commits without scanning history", async () => {
  const requests = [];
  const results = await resolveUiComponents([release("v2.56.3", "version")], config, {
    fetchImpl: fakeFetch((request) => {
      if (request.pathname.endsWith("/tags")) {
        assert.equal(request.searchParams.get("filterText"), "v2.56.3");
        if (request.searchParams.get("start") === "0") {
          return page([{ id: "refs/tags/v2.56.30", latestCommit: sha("f") }], {
            isLastPage: false, nextPageStart: 1,
          });
        }
        return page([{ id: "refs/tags/v2.56.3", latestCommit: sha("a") }]);
      }
      if (request.pathname.endsWith(`/commits/${sha("a")}`)) return Response.json(commit(sha("a")));
    }, requests),
  });
  assert.equal(results[0].error, null);
  assert.equal(results[0].status, "published-version");
  assert.equal(results[0].uiComponentsHeadSha, sha("a"));
  assert.equal(results[0].jenkinsBoundarySha, null);
  assert.deepEqual(results[0].releaseCommits, []);
  assert.equal(requests.length, 3);
});

test("caches repeated references, shared commit metadata and ranges by resolved SHA", async () => {
  const requests = [];
  const results = await resolveUiComponents([
    release("main", "branch"),
    release("main", "branch", "release-20260112"),
    release(sha("a"), "commit", "release-20260119"),
    release("alias", "branch", "release-20260126"),
  ], config, {
    fetchImpl: fakeFetch((request) => {
      if (request.pathname.endsWith("/branches")) {
        const name = request.searchParams.get("filterText");
        return page([{ id: `refs/heads/${name}`, latestCommit: sha("a") }]);
      }
      if (request.pathname.endsWith(`/commits/${sha("a")}`)) return Response.json(commit(sha("a"), [sha("c")]));
      if (request.pathname.endsWith(`/commits/${sha("c")}`)) return Response.json(commit(sha("c"), [], jenkins));
      if (request.pathname.endsWith("/commits")) return page([commit(sha("a"), [sha("c")])]);
      if (request.pathname.includes("/branches/info/")) return page([{ displayId: "main" }]);
    }, requests),
  });
  assert.ok(results.every((item) => item.error === null));
  assert.equal(requests.filter((request) => request.pathname.endsWith("/branches")).length, 2);
  assert.equal(requests.filter((request) => request.pathname.endsWith("/commits")).length, 1);
  assert.equal(requests.filter((request) => request.pathname.endsWith(`/commits/${sha("a")}`)).length, 1);
  assert.equal(requests.filter((request) => request.pathname.endsWith(`/commits/${sha("c")}`)).length, 1);
  assert.equal(requests.filter((request) => request.pathname.includes("/branches/info/")).length, 1);
  assert.deepEqual(results.map((item) => item.branch), [
    "release-20260105", "release-20260112", "release-20260119", "release-20260126",
  ]);
});

test("preserves discovery errors and ref failures while continuing to later releases", async () => {
  const requests = [];
  const discoveredError = { ...release(null, null), error: "packages.dhall unavailable" };
  const results = await resolveUiComponents([
    discoveredError,
    release("missing", "branch", "release-20260112"),
    release("v2.56.3", "version", "release-20260119"),
  ], config, {
    fetchImpl: fakeFetch((request) => {
      if (request.pathname.endsWith("/branches")) return page([{ id: "refs/heads/missing-extra", latestCommit: sha("f") }]);
      if (request.pathname.endsWith("/tags")) return page([{ id: "refs/tags/v2.56.3", latestCommit: sha("a") }]);
      if (request.pathname.endsWith(`/commits/${sha("a")}`)) return Response.json(commit(sha("a")));
    }, requests),
  });
  assert.equal(results[0].error, discoveredError.error);
  assert.equal(results[0].releaseCommits, null);
  assert.match(results[1].error, /branch not found: missing/);
  assert.equal(results[1].status, "error");
  assert.equal(results[2].error, null);
  assert.equal(requests.length, 3);
});

test("rejects malformed and non-advancing ref pages rather than accepting partial lookups", async () => {
  for (const invalid of [
    { values: [], isLastPage: "true" },
    { values: {}, isLastPage: true },
    { values: [{ id: "refs/heads/main", latestCommit: sha("a") }], isLastPage: false, nextPageStart: 0 },
    { values: [], isLastPage: false },
  ]) {
    const results = await resolveUiComponents([release("main", "branch")], config, {
      fetchImpl: fakeFetch(() => Response.json(invalid)),
    });
    assert.match(results[0].error, /invalid .* page|valid next page/);
    assert.equal(results[0].releaseCommits, null);
  }
});

test("incomplete commit range pagination discards all partial release commits", async () => {
  const results = await resolveUiComponents([release("main", "branch")], config, {
    fetchImpl: fakeFetch((request) => {
      if (request.pathname.endsWith("/branches")) return page([{ id: "refs/heads/main", latestCommit: sha("a") }]);
      if (request.pathname.endsWith(`/commits/${sha("a")}`)) return Response.json(commit(sha("a"), [sha("c")]));
      if (request.pathname.endsWith(`/commits/${sha("c")}`)) return Response.json(commit(sha("c"), [], jenkins));
      if (request.pathname.endsWith("/commits")) {
        return page([commit(sha("a"), [sha("c")])], { isLastPage: false, nextPageStart: 0 });
      }
    }),
  });
  assert.match(results[0].error, /pagination ended without a valid next page/);
  assert.equal(results[0].releaseCommits, null);
  assert.equal(results[0].status, "error");
});

test("a later-page HTTP failure discards partial range results and continues the next release", async () => {
  const results = await resolveUiComponents([
    release("main", "branch"),
    release("v2.56.3", "version", "release-20260112"),
  ], config, {
    fetchImpl: fakeFetch((request) => {
      if (request.pathname.endsWith("/branches")) return page([{ id: "refs/heads/main", latestCommit: sha("a") }]);
      if (request.pathname.endsWith("/tags")) return page([{ id: "refs/tags/v2.56.3", latestCommit: sha("d") }]);
      if (request.pathname.endsWith(`/commits/${sha("a")}`)) return Response.json(commit(sha("a"), [sha("c")]));
      if (request.pathname.endsWith(`/commits/${sha("c")}`)) return Response.json(commit(sha("c"), [], jenkins));
      if (request.pathname.endsWith(`/commits/${sha("d")}`)) return Response.json(commit(sha("d")));
      if (request.pathname.endsWith("/commits")) {
        if (request.searchParams.get("start") === "0") {
          return page([commit(sha("a"), [sha("c")])], { isLastPage: false, nextPageStart: 1 });
        }
        return new Response("History unavailable", { status: 500 });
      }
    }),
  });
  assert.match(results[0].error, /Bitbucket 500: History unavailable/);
  assert.equal(results[0].releaseCommits, null);
  assert.equal(results[0].status, "error");
  assert.equal(results[1].error, null);
  assert.equal(results[1].status, "published-version");
});

test("refuses inconsistent exact ref heads and incorrect commit identities", async () => {
  const changing = await resolveUiComponents([release("main", "branch")], config, {
    fetchImpl: fakeFetch(() => page([
      { id: "refs/heads/main", latestCommit: sha("a") },
      { id: "refs/heads/main", latestCommit: sha("b") },
    ])),
  });
  assert.match(changing[0].error, /invalid or changing head/);
  const wrongIdentity = await resolveUiComponents([release(sha("a"))], config, {
    fetchImpl: fakeFetch(() => Response.json(commit(sha("b")))),
  });
  assert.match(wrongIdentity[0].error, /wrong commit/);
});

test("a missing Jenkins boundary is an explicit error instead of a truncated release", async () => {
  const results = await resolveUiComponents([release(sha("a"))], config, {
    fetchImpl: fakeFetch(() => Response.json(commit(sha("a")))),
  });
  assert.match(results[0].error, /No jenkins.user boundary in first-parent history/);
  assert.equal(results[0].releaseCommits, null);
});

test("containing branch lookup failure becomes a warning without invalidating verified commits", async () => {
  const results = await resolveUiComponents([release(sha("a"))], config, {
    fetchImpl: fakeFetch((request) => {
      if (request.pathname.endsWith(`/commits/${sha("a")}`)) return Response.json(commit(sha("a"), [sha("c")]));
      if (request.pathname.endsWith(`/commits/${sha("c")}`)) return Response.json(commit(sha("c"), [], jenkins));
      if (request.pathname.endsWith("/commits")) return page([commit(sha("a"), [sha("c")])]);
      if (request.pathname.includes("/branches/info/")) return new Response("Plugin unavailable", { status: 404 });
    }),
  });
  assert.equal(results[0].error, null);
  assert.equal(results[0].status, "release-commits");
  assert.deepEqual(results[0].releaseCommits.map((item) => item.sha), [sha("a")]);
  assert.deepEqual(results[0].uiComponentsBranches, []);
  assert.match(results[0].warnings[0], /Containing branch lookup failed: Bitbucket 404/);
});

test("Jenkins detection uses exact author identity, not similar names or committer", () => {
  assert.equal(isJenkinsAuthor({ name: " JENKINS.USER " }), true);
  assert.equal(isJenkinsAuthor({ name: "Automation", emailAddress: " JENKINS.USER@juspay.in " }), true);
  assert.equal(isJenkinsAuthor({ name: "Automation", emailAddress: "jenkins.user@example.test" }), false);
  assert.equal(isJenkinsAuthor({ name: "jenkins.user-helper", emailAddress: "person@example.test" }), false);
  assert.equal(isJenkinsAuthor({ name: "Developer", committer: jenkins }), false);
  assert.equal(isJenkinsAuthor(null), false);
});
