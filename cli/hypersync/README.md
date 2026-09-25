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

After moving this directory to its own repository and publishing the
`hypersync-office-cli` npm package, users can run:

```bash
npx hypersync-office-cli refresh
```

Each run uploads PRs updated since the last successful run. A run first uploads
metadata, then fetches up to 20 missing patch fingerprints one at a time, with
a short pause between Bitbucket diff calls. To change that limit:

```bash
npx hypersync-office-cli refresh --fingerprints 0
npx hypersync-office-cli refresh --fingerprints 50
```

Run again to fill more missing fingerprints. A failed run leaves its cursor
unchanged, and repeated uploads update the same PR IDs without duplicate rows.
Only one importer can hold the database lease at a time. If the process dies,
the lease expires after five minutes.

The unscoped npm name `hypersync` is already taken. The package name
`hypersync-office-cli` was unregistered when this package was prepared; verify
availability again before publishing. If your organization prefers a scope,
rename the package and use `npx --package @your-org/hypersync-cli hypersync refresh`.

To create the separate CLI repository, copy this directory as its root, then
run `npm test` and `npm pack --dry-run` there. Publishing requires an npm account
with access to the chosen name or organization registry.
