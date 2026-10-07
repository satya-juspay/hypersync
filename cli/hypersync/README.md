# HyperSync CLI

Run this package on an office-network laptop. It fetches Bitbucket PRs locally
and sends small authenticated batches to the HyperSync web app. The Bitbucket
token is never sent to the web app.

## Setup

Use Node.js 20.12 or newer. Copy `.env.example` to `.env` in the directory where
you run the command and set `HYPERSYNC_URL`, `HYPERSYNC_IMPORT_TOKEN`, and
`BITBUCKET_TOKEN`. The import token must match the value configured in Vercel.
Keep the CLI `.env` private.

Create the shared import secret once with `openssl rand -hex 32`. Put the same
value in the web app's `HYPERSYNC_IMPORT_TOKEN` environment variable and the
CLI's local `.env`. The Bitbucket token is a separate credential and belongs
only in the CLI's `.env`.

Until this package is published, run it from this repository:

```bash
node cli/hypersync/bin/hypersync.mjs refresh
```

To discover 2026 hyper-widget release branches and their pinned ui-components
references, run the read-only command on the office network:

```bash
npm run --silent discover:ui-components
```

It uses `BITBUCKET_TOKEN` (and optional `BITBUCKET_USERNAME`,
`BITBUCKET_BASE_URL`, `BITBUCKET_PROJECT_KEY`). It does not require the web app
or database. Progress goes to stderr and the complete JSON result goes to
stdout. The `--silent` flag suppresses npm's banner so stdout is valid JSON.
A branch with an unreadable or invalid `packages.dhall` appears in the
result with an `error`; the command exits nonzero if any branch has an error.

To also resolve the ui-components references and collect custom release
commits, run:

```bash
npm run --silent inspect:ui-components
# Or invoke the CLI directly from this repository:
node cli/hypersync/bin/hypersync.mjs inspect-ui-components
```

This command is also read-only and needs only the Bitbucket credentials. It
performs discovery on every run, then reports `uiComponentsHeadSha`,
`uiComponentsBranches`, `jenkinsBoundarySha`, and `releaseCommits` for each
widget release branch. Progress goes to stderr and JSON to stdout.

- Version references such as `v2.56.12` must resolve to an exact tag. They have
  status `published-version` and no custom release commits.
- Branch references resolve to the branch head captured during this run.
- Commit references keep the exact pinned SHA as their head. All currently
  containing branches are listed as context only; an empty or multiple-branch
  result is valid and does not change the pinned head.
- For branch/commit references, the nearest `jenkins.user`-authored commit on
  the **first-parent** chain is the release boundary. The command includes all
  commits reachable from the head but not reachable from that boundary,
  including merged side-branch work. Jenkins-authored commits are excluded.
  Author name `jenkins.user` or email `jenkins.user@juspay.in` is matched
  case-insensitively, not the committer or commit message.

A head that is itself a Jenkins commit produces an empty successful list.
A missing reference, unreadable history, missing Jenkins boundary, invalid
pagination, or safety-limit overflow sets `status: "error"` and
`releaseCommits: null`; it never presents a partial list as complete. The
command continues with other widget branches and exits nonzero if any branch
has an error. A failed containing-branch lookup is recorded in `warnings`
without discarding independently verified commit history.

The history walk is limited to 10,000 first-parent commits, paginated queries
to 200 pages, and each HTTP request to 30 seconds. References and histories
are cached only within a run; a separate invocation refetches them. Neither
discovery nor inspection invokes the web import API, changes PostgreSQL, or
updates the existing hyper-widget refresh cursor.

## UI Components database import

After the new migration and web endpoint are deployed, run the separate import
on the office network:

```bash
npm run refresh:ui-components
# Or invoke the CLI directly:
node cli/hypersync/bin/hypersync.mjs refresh-ui-components
```

Use the same local `HYPERSYNC_URL`, `HYPERSYNC_IMPORT_TOKEN`, and Bitbucket
credentials as the existing refresh. The web app needs only the import secret
and database credentials, never the Bitbucket token. The new endpoint is
`POST /api/ui-components/import`; the existing `/api/import` is unchanged.

This is a full inspection on every run, not an incremental PR cursor. It stores
2026 widget release snapshots, their dependency refs/heads/Jenkins boundaries,
unique ui-components release commits, and snapshot-to-commit links. Published
version refs get validated snapshots with no custom release commits. The same
command also imports all states of ui-components PRs targeting `main` and
updated on or after `2026-01-01T00:00:00Z`, reads their commit memberships, and
fingerprints those PRs and every unique release commit. PR discovery scans all
pages for the main destination so older-created PRs updated in 2026 are included.
It logs pagination, each diff, upload counts, and final publication.

JSON diffs are used to detect Bitbucket's truncation flags. Hash fingerprints
retain file and added/removed line tokens for partial patch scoring. Oversized,
truncated, or failed diffs are recorded as unavailable and do not stop the next
diff. HTTP 500 is additionally persisted immediately and skipped on subsequent
runs, including when the current run later aborts. Other unavailable diffs are
retried on the next refresh. Authentication, connectivity, incomplete metadata,
or a PR changing during inspection abort publication.

The dashboard at `/ui-components` shows the last completed run, branch and
commit filters, exact commit matches, patch suggestions, main PR states, and
file/line overlap counts. A patch score, even at 100%, remains a suggestion;
only exact membership in a merged main PR sets a commit's merged status. A
single commit may be used by multiple widget release branches and is counted
once. Reloading dashboard results never calls Bitbucket.

The importer uses eight isolated tables: `UiComponentRefreshRun`,
`UiComponentSyncStatus`, `UiComponentReleaseSnapshot`,
`UiComponentReleaseCommit`, `UiComponentSnapshotCommit`, `UiComponentMainPr`,
`UiComponentCommitAnalysis`, and `UiComponentDiffFailure`. To read the
published dataset, filter snapshots by `UiComponentSyncStatus.activeRunId`,
not by newest snapshot timestamps. History and failed staging runs are retained.
Commits are deduplicated by immutable SHA and may belong to several snapshots.

Each run declares its complete branch manifest, stages bounded batches, seals
each snapshot after checking its unique commit count/head, and publishes
every declared main PR/commit analysis before atomically changing the active
run pointer. Empty discoveries or any inspection error fail the run and leave
the previous dataset active. Failed
containing-branch lookups remain warnings. A separate five-minute lease blocks
other ui-components refreshes; heartbeats renew it during inspection. An old
process cannot abort a newer run. Existing hyper-widget refreshes use their own
tables and lock.

### Deploying the isolated schema

The additive migrations are
`prisma/migrations-postgresql/20261001000000_ui_component_import/migration.sql`
and `prisma/migrations-postgresql/20261007000000_ui_component_main_matching/migration.sql`.
The latter adds only UI Components analysis tables and run fields. These files
are prepared locally; verify their applied status before refreshing. Do not use `db push`,
`migrate reset`, or `migrate dev` against the shared production database.

From a machine that can reach Supabase, with the intended `DIRECT_URL` set:

```bash
npx prisma migrate status
```

Check that only the intended UI Components migrations are pending
(`20261001000000_ui_component_import` and/or `20261007000000_ui_component_main_matching`).
If other migrations are pending, stop and review them: `migrate deploy` applies
**all** pending migrations. Once that check is satisfactory:

```bash
npx prisma migrate deploy
```

Deploy the web app version containing the new endpoint and dashboard, then run
`npm run refresh:ui-components` locally. The CLI logs each phase and sealed
branch. This migration and command do not modify existing hyper-widget data.

Offline verification (no database access):

```bash
npm run test:ui-components
npx prisma validate
```

After moving this directory to its own repository and publishing the
`hypersync-office-cli` npm package, users can run:

```bash
npx hypersync-office-cli refresh
```

Each run uploads PR metadata updated since the last successful run, then fills
every missing release and main PR patch fingerprint already represented in the
database. Progress is logged for every PR and phase. A failed run leaves its
cursor unchanged, and rerunning resumes from fingerprints already stored
without creating duplicate rows.

Fingerprints contain versioned SHA-256 tokens for file paths, added lines, and
removed lines rather than raw source text. The scorer remains compatible with
legacy fingerprints while refresh replaces them with the compact format.

Only one refresh can hold the database lease at a time. If the process dies,
the lease expires after five minutes. Oversized fingerprints and per-PR
Bitbucket 404/5xx failures are reported and skipped so the remaining PRs can
continue. A PR whose diff endpoint returns HTTP 500 is marked in PostgreSQL and
excluded from future fingerprint attempts.

The unscoped npm name `hypersync` is already taken. The package name
`hypersync-office-cli` was unregistered when this package was prepared; verify
availability again before publishing. If your organization prefers a scope,
rename the package and use `npx --package @your-org/hypersync-cli hypersync refresh`.

To create the separate CLI repository, copy this directory as its root, then
run `npm test` and `npm pack --dry-run` there. Publishing requires an npm account
with access to the chosen name or organization registry.
