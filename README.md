# HyperSync

Internal release PR synchronization dashboard for the **hyper-widget** Bitbucket project. Track whether release-branch PRs have a corresponding PR targeting `main`, identify unsynced contributors, and manage records from a single UI.

---

## Features

- **Dashboard** — summary cards, contributor leaderboard, searchable release PR table
- **PR detail page** — release metadata, editable main PR ID, and approval controls
- **Admin roles** — super admin plus removable admins for editing any PR
- **Patch score search** — author/admin-only client-side matching against stored main PR patch fingerprints
- **DB-backed sync** — refresh release and main PR data from Bitbucket into Prisma storage

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Database | SQLite by default (`DATABASE_URL`) |
| ORM | Prisma v7 |
| Icons | lucide-react |
| Bitbucket | Self-hosted Data Center (Basic Auth with HTTP token) |

---

## Prerequisites

- **Node.js 20** (use `nvm use 20`)
- A Bitbucket Data Center instance with a personal access token
- Clerk credentials for authentication

---

## Setup

### 1. Install dependencies

```bash
nvm use 20
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env.local` and fill in every value:

```bash
cp .env.example .env.local
```

| Variable | Description |
|---|---|
| `DATABASE_URL` | Prisma database URL. Local default is `file:./dev.db`. |
| `BITBUCKET_BASE_URL` | Base URL of your Bitbucket Data Center instance |
| `BITBUCKET_PROJECT_KEY` | Bitbucket project key (e.g. `PICAF`) |
| `BITBUCKET_USERNAME` | Optional Bitbucket username/email. When set, the backend uses Basic Auth with `BITBUCKET_TOKEN`. |
| `BITBUCKET_TOKEN` | Bitbucket HTTP/PAT token with read access to the project. Used as a Bearer token when `BITBUCKET_USERNAME` is empty. |
| `NEXT_PUBLIC_BITBUCKET_BASE_URL` | Same as `BITBUCKET_BASE_URL` (exposed to browser for PR links) |
| `NEXT_PUBLIC_BITBUCKET_PROJECT_KEY` | Same as `BITBUCKET_PROJECT_KEY` (exposed to browser) |
| `BASE_URL` | Application base URL |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |

### 3. Run database migrations

```bash
npx prisma migrate dev
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
```

---

## API Reference

| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/sync` | Signed-in user | Full Bitbucket sync, or quick DB load with `{ "quick": true }` |
| `PATCH` | `/api/sync/[id]` | Author, admin, or super admin | Edit a release PR main PR ID or mark it approved |
| `GET` | `/api/admins` | Admin or super admin | List admins |
| `POST` | `/api/admins` | Admin or super admin | Add an admin |
| `DELETE` | `/api/admins/[email]` | Super admin | Remove an admin |
| `GET` | `/api/admins/me` | Signed-in user | Get current user's admin role |

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
  pr/[id]/page.tsx                # PR detail page (server component)
  admin/page.tsx                  # Admin management page
  api/
    sync/route.ts                 # POST — DB load/full Bitbucket sync
    sync/[id]/route.ts            # PATCH — edit one release PR
    admins/route.ts               # GET/POST — list/add admins
    admins/[email]/route.ts       # DELETE — remove admin
    admins/me/route.ts            # GET — current user admin role
components/
  admin-manager.tsx               # Admin role management UI
  patch-match-search.tsx          # Client-side patch score search
  navbar.tsx                      # Sticky navbar
  status-badge.tsx                # Sync status pill badge
lib/
  bitbucket.ts                    # Bitbucket API client
  patch-score.ts                  # Client-safe patch fingerprint scoring
  hypersync-store.ts              # Client sync store and /api/sync cache
  authz.ts                        # Author/admin/super-admin checks
  prisma.ts                       # Prisma singleton
prisma/
  schema.prisma                   # Database schema
  migrations/                     # Migration history
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
