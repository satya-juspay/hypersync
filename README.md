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
