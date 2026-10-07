import assert from "node:assert/strict";
import { test } from "node:test";
import {
  discoverUiComponents,
  extractUiComponentsReference,
  loadDiscoveryConfig,
} from "../src/discover-ui-components.mjs";

const config = {
  bitbucketUrl: "https://bitbucket.example.test",
  project: "PICAF",
  token: "test-token",
};
const sha = (character) => character.repeat(40);
const packages = (version) => `
  with ui-components =
      { dependencies = [ "console", "effect" ]
      , repo = "ssh://git@ssh.bitbucket.juspay.net/picaf/ui-components.git"
      , version = "${version}"
      }
  with another-package = { version = "unrelated" }
`;

test("discovers every matching branch page and reads packages.dhall at each pinned SHA", async () => {
  const requests = [];
  const progress = [];
  const releases = await discoverUiComponents(config, {
    onProgress: (message) => progress.push(message),
    fetchImpl: async (url, options) => {
      const request = new URL(url);
      requests.push(request);
      assert.equal(options.headers.Authorization, "Bearer test-token");
      if (request.pathname.endsWith("/branches")) {
        assert.equal(request.searchParams.get("filterText"), "release-2026");
        if (request.searchParams.get("start") === "0") {
          return Response.json({
            values: [
              { displayId: "release-20260105", latestCommit: sha("a") },
              { displayId: "release-20251229", latestCommit: sha("b") },
              { displayId: "release-20260105-extra", latestCommit: sha("c") },
            ],
            isLastPage: false,
            nextPageStart: 3,
          });
        }
        assert.equal(request.searchParams.get("start"), "3");
        return Response.json({
          values: [{ displayId: "release-20260202", latestCommit: sha("d") }],
          isLastPage: true,
        });
      }

      assert.equal(request.pathname.endsWith("/raw/packages.dhall"), true);
      const at = request.searchParams.get("at");
      assert.ok([sha("a"), sha("d")].includes(at));
      return new Response(packages(at === sha("a") ? "v2.56.3" : "devqa-PICAF-30919"));
    },
  });

  assert.deepEqual(releases, [
    {
      branch: "release-20260105",
      widgetHeadSha: sha("a"),
      uiComponentsRef: "v2.56.3",
      uiComponentsRefType: "version",
      error: null,
    },
    {
      branch: "release-20260202",
      widgetHeadSha: sha("d"),
      uiComponentsRef: "devqa-PICAF-30919",
      uiComponentsRefType: "branch",
      error: null,
    },
  ]);
  assert.equal(requests.length, 4);
  assert.ok(progress.some((message) => message.includes("2/2 release branches")));
});

test("retains an affected branch with an error when its pinned packages.dhall cannot be read", async () => {
  const releases = await discoverUiComponents(config, {
    fetchImpl: async (url) => {
      const request = new URL(url);
      if (request.pathname.endsWith("/branches")) {
        return Response.json({
          values: [
            { displayId: "release-20260302", latestCommit: sha("e") },
            { displayId: "release-20260308", latestCommit: sha("f") },
          ],
          isLastPage: true,
        });
      }
      if (request.searchParams.get("at") === sha("e")) {
        return new Response(packages(sha("1")));
      }
      return new Response("File not found", { status: 404 });
    },
  });

  assert.equal(releases[0].uiComponentsRefType, "commit");
  assert.equal(releases[1].uiComponentsRef, null);
  assert.match(releases[1].error, /Bitbucket 404/);
});

test("rejects incomplete branch pagination instead of returning a partial discovery", async () => {
  await assert.rejects(
    discoverUiComponents(config, {
      fetchImpl: async () => Response.json({
        values: [{ displayId: "release-20260105", latestCommit: sha("a") }],
        isLastPage: false,
        nextPageStart: 0,
      }),
    }),
    /valid next page/
  );
});

test("extracts only the ui-components dependency and requires its repository", () => {
  assert.equal(extractUiComponentsReference(packages("v2.56.3")), "v2.56.3");
  assert.throws(() => extractUiComponentsReference("with other = { version = \"v1.0.0\" }"), /Expected one/);
  assert.throws(
    () => extractUiComponentsReference(packages("main").replace("/ui-components.git", "/other.git")),
    /expected repository/
  );
});

test("discovery needs only Bitbucket credentials and always targets hyper-widget", () => {
  const loaded = loadDiscoveryConfig({
    BITBUCKET_TOKEN: "secret",
    BITBUCKET_REPO: "another-repo",
  });
  assert.deepEqual(loaded, {
    bitbucketUrl: "https://bitbucket.juspay.net",
    project: "PICAF",
    username: undefined,
    token: "secret",
  });
});
