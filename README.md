# hyperSync

Internal release PR synchronization dashboard for the **hyper-widget** Bitbucket project. Track whether release-branch PRs have a corresponding PR targeting `main`, identify unsynced contributors, and manage records from a single UI.

---

## Features

- **Dashboard** — summary cards, contributor leaderboard, searchable release PR table
- **PR detail page** — release metadata, editable main PR ID, and approval controls
- **Admin roles** — super admin plus removable admins for editing any PR
- **Patch score search** — author/admin-only server-side matching against versioned SHA-256 patch fingerprints
- **Paginated DB reads** — filter, sort, and page through release PRs without returning diffs or fingerprints
- **Office-network importer** — a separate npm CLI fetches Bitbucket PRs and uploads them in small batches

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Database | Supabase PostgreSQL (`DATABASE_URL`) |
| ORM | Prisma v7 |
| Icons | lucide-react |
| Bitbucket | Self-hosted Data Center (Basic Auth with HTTP token) |

---

## Prerequisites

- **Node.js 20** (use `nvm use 20`)
- An office-network machine with a Bitbucket Data Center personal access token for imports
- Clerk credentials for authentication

---

## Setup

### 1. Install dependencies

```bash
nvm use 20
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in every value:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `DATABASE_URL` | Supabase pooled PostgreSQL URL used by the application runtime. |
| `DIRECT_URL` | Supabase direct/session PostgreSQL URL used by Prisma migrations. |
| `HYPERSYNC_IMPORT_TOKEN` | Shared secret for the CLI's protected import endpoint. Use the same value in the CLI environment. |
| `NEXT_PUBLIC_BITBUCKET_BASE_URL` | Same as `BITBUCKET_BASE_URL` (exposed to browser for PR links) |
| `NEXT_PUBLIC_BITBUCKET_PROJECT_KEY` | Same as `BITBUCKET_PROJECT_KEY` (exposed to browser) |
| `BASE_URL` | Application base URL |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |

### 3. Run database migrations

```bash
npx prisma migrate deploy
```

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Database Schema

```
ReleasePR
  id              String    (Bitbucket PR ID)
  title           String
  author          String
  authorEmail     String?
  displayName     String
  sourceBranch   String?
  releaseBranch   String
  mainPrId        String?   (PR ID of the corresponding main-branch PR)
  patchFingerprint String?
  patchFingerprintError String? (persistent diff failure marker)
  updatedStatus   String?   (manual status, e.g. APPROVED)
  updatedBy       String?
  mergedAt        DateTime?
  createdAt       DateTime

MainPR
  id              String    (Bitbucket PR ID)
  title           String
  author          String
  displayName     String
  sourceBranch   String?
  status          String
  patchFingerprint String?
  patchFingerprintError String? (persistent diff failure marker)
  mergedAt        DateTime?
  createdAt       DateTime

AdminUser
  email           String
  createdAt       DateTime
  createdBy       String?

SyncStatus
  id              String
  isRunning       Boolean
  lastSynced      DateTime?
  runId           String?
  runStartedAt    DateTime?
  leaseUntil      DateTime?
```

---

## API Reference

| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/api/sync` | Public UI read | Paginated release PRs, dashboard summary, leaderboards, and sync metadata |
| `POST` | `/api/import` | Import bearer token | Start, heartbeat, upload batches, list missing fingerprints, finish, or abort a CLI import |
| `GET` | `/api/sync/[id]` | Public UI read | Get one release PR without diff or fingerprint data |
| `PATCH` | `/api/sync/[id]` | Author, admin, or super admin | Edit a release PR main PR ID or mark it approved |
| `GET` | `/api/sync/[id]/matches` | Author, admin, or super admin | Score main PRs with the same numeric source-branch ticket across PICAF and HYPSDK |
| `GET` | `/api/admins` | Admin or super admin | List admins |
| `POST` | `/api/admins` | Admin or super admin | Add an admin |
| `DELETE` | `/api/admins/[email]` | Super admin | Remove an admin |
| `GET` | `/api/admins/me` | Signed-in user | Get current user's admin role |

`GET /api/sync` supports `page`, `pageSize`, `q`, `status`, `sortBy`, and
`sortDirection` query parameters. Supported page sizes are `10`, `50`, and
`100`.

Run a refresh from an office-network laptop using the standalone CLI in
[`cli/hypersync`](cli/hypersync/README.md). The deployed service never calls Bitbucket.
The `BITBUCKET_TOKEN` belongs only in the CLI's local environment; do not put it
in Vercel. Set `HYPERSYNC_IMPORT_TOKEN` in both Vercel and the CLI.
Generate that shared secret with `openssl rand -hex 32`.

```bash
node cli/hypersync/bin/hypersync.mjs refresh
npm run refresh
```

To inspect hyper-widget `release-2026XXXX` branches and the ui-components ref
pinned by each branch without writing to the database:

```bash
npm run --silent discover:ui-components
```

To also resolve the ui-components heads and list release commits since their
nearest first-parent Jenkins boundary:

```bash
npm run --silent inspect:ui-components
```

This is a separate read-only check; it does not use the web import API or
change production tables. Version tags are validated without listing custom
release commits. See the [CLI guide](cli/hypersync/README.md) for cutoff and
error-handling details.

UI Components has a separate database import command:

```bash
npm run refresh:ui-components
```

Apply the prepared additive UI Components migration and deploy the new
`/api/ui-components/import` endpoint **before** running it. See the
[deployment checklist](cli/hypersync/README.md#deploying-the-isolated-schema).
The command stages a full inspection and atomically publishes complete
snapshots in new `UiComponent*` tables, with its own refresh lease. It does not
modify existing hyper-widget data. The same command imports ui-components PRs
targeting `main` and updated since January 1, 2026 (all states), fingerprints
each release commit and main PR, and publishes their analyses together.

Open `/ui-components` using the repository switcher to review release branches,
shared release commits, and matching main PRs with their statuses. Exact commit
membership in a merged PR is marked merged; patch similarity remains a review
suggestion, including at 100%. Files and added/removed line counts accompany
each patch score. Version dependencies appear without custom release commits.
Diff HTTP 500 failures are persisted and skipped in later refreshes; truncated
or otherwise unavailable diffs stay visibly unavailable.

Its list uses the same filter toolbar as hyper-widget: search, a **Filters**
panel with multi-select statuses (all selected initially), author and release
branch selectors, sorting in either direction, and 10/50/100 rows per page.
Active filters appear as removable chips. Summary tiles select status presets;
clicking an author or release branch filters the list and restores all statuses.
Filtering and sorting happen on the published dataset without changing the DB.

The commit author (matched by email), an admin, or the super admin can use
**Review commit** to confirm an imported main PR or mark the commit manually
approved. A confirmed link follows the main PR's actual status; approval is
shown separately and does not claim the PR was merged. Both can be undone.
Reviewer email and time are displayed. Decisions are stored by commit SHA in
the isolated `UiComponentCommitReview` table and survive subsequent refreshes,
including when one commit is used by multiple release branches. If a confirmed
PR's source SHA changes or it disappears from the latest import, its link needs
review again. Confirming another PR replaces manual approval.

Apply the additive `20261007000001_ui_component_commit_reviews` migration with
`npx prisma migrate deploy`, then restart/redeploy the app to enable reviews.
The migration does not alter existing hyper-widget tables. Until it is applied,
the read-only UI Components dashboard still works and review controls remain
disabled. No Bitbucket calls or office-network access are needed to save reviews.

Only one CLI import may run at a time. Its five-minute lease is renewed during
the run and expires after a crash. Dashboard reads continue during imports.

### Sync Status Values

| Value | Meaning |
|---|---|
| `MERGED` | Main-branch PR exists and is merged |
| `OPEN` | Main-branch PR exists but is still open |
| `DECLINED` | Main-branch PR exists but was declined |
| `INVALID` | Linked main PR does not exist in the local main PR table |
| `APPROVED` | Release PR was manually approved |
| `MISSING` | No main-branch PR is linked |

---

## Project Structure

```
app/
  page.tsx                        # Dashboard (client component)
  layout.tsx                      # Root layout
  globals.css                     # Tailwind v4 import
  pr/[id]/page.tsx                # PR detail page (client component)
  admin/page.tsx                  # Admin management page
  api/
    import/route.ts               # POST — protected batched CLI uploads
    sync/route.ts                 # GET — paginated dashboard data
    sync/[id]/route.ts            # GET/PATCH — read or edit one release PR
    sync/[id]/matches/route.ts    # GET — protected server-side patch matching
    admins/route.ts               # GET/POST — list/add admins
    admins/[email]/route.ts       # DELETE — remove admin
    admins/me/route.ts            # GET — current user admin role
components/
  admin-manager.tsx               # Admin role management UI
  patch-match-search.tsx          # Server-backed patch score search
  navbar.tsx                      # Sticky navbar
  status-badge.tsx                # Sync status pill badge
lib/
  bitbucket.ts                    # Bitbucket PR links
  patch-score.ts                  # Patch fingerprint scoring
  import-prs.ts                   # Lease and batched database imports
  release-pr-view.ts              # Public PR response mapping
  hypersync-store.ts              # Paginated dashboard state
  authz.ts                        # Author/admin/super-admin checks
  prisma.ts                       # Prisma singleton
prisma/
  schema.prisma                   # Database schema
  migrations-postgresql/         # PostgreSQL migration history
cli/hypersync/                    # Standalone npm CLI, ready for its own repo
public/
  logo.png                        # Icon logo
  hypersync.png                   # Full logo
```

---

## Scripts

```bash
npm run dev       # Start development server
npm run build     # Production build
npm run start     # Start production server
npm run lint      # Run ESLint
npx prisma studio # Open Prisma Studio (DB browser)
npx prisma migrate dev --name <name>   # Create and apply a migration
```


## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
