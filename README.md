# HyperSync

Internal release PR synchronization dashboard for the **hyper-widget** Bitbucket project. Track whether release-branch PRs have a corresponding merged PR targeting `main`, identify unsynced contributors, and manage records — all from a single UI.

---

## Features

- **Dashboard** — summary cards (total / synced / unsynced), top risk contributor leaderboard, searchable PR table
- **PR detail page** — full metadata, parsed description table, changed files, commit SHAs
- **Re-sync** — re-fetch a PR from Bitbucket and auto-resolve its sync status
- **Edit PR** — manually override sync status and main-branch PR ID (Clerk auth required)
- **Delete PR** — remove a record from the database (Clerk auth required)
- **Add PR** — sync any PR by ID or full Bitbucket URL via the navbar modal
- **Clerk authentication** — sign-in gated edit/delete; unauthenticated users have read-only access

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Database | Supabase (PostgreSQL) |
| ORM | Prisma v7 + `@prisma/adapter-pg` |
| Auth | Clerk (`@clerk/nextjs` v6) |
| Icons | lucide-react |
| Bitbucket | Self-hosted Data Center (Bearer token) |

---

## Prerequisites

- **Node.js 20** (use `nvm use 20`)
- A [Supabase](https://supabase.com) project with the connection strings
- A [Clerk](https://clerk.com) application
- A Bitbucket Data Center instance with a personal access token

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
| `DATABASE_URL` | Supabase pgBouncer pooler URL (session mode, port 5432) — used at runtime |
| `DIRECT_URL` | Supabase direct connection URL — used for Prisma migrations |
| `BITBUCKET_BASE_URL` | Base URL of your Bitbucket Data Center instance |
| `BITBUCKET_PROJECT_KEY` | Bitbucket project key (e.g. `PICAF`) |
| `BITBUCKET_TOKEN` | Personal access token with read access to the project |
| `NEXT_PUBLIC_BITBUCKET_BASE_URL` | Same as `BITBUCKET_BASE_URL` (exposed to browser for PR links) |
| `NEXT_PUBLIC_BITBUCKET_PROJECT_KEY` | Same as `BITBUCKET_PROJECT_KEY` (exposed to browser) |
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
  jiraKey         String?
  author          String
  releaseBranch   String
  mainPrId        String?   (PR ID of the corresponding main-branch PR)
  syncStatus      String    SYNCED | MAIN_PR_OPEN | MISSING_MAIN_PR
  description     String?
  mergedAt        DateTime?
  createdAt       DateTime
  updatedAt       DateTime
  mergeCommitSha  String?
  commitShas      Json?
  changedFiles    Json?
```

---

## API Reference

| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/pr-sync` | Public | Fetch a PR from Bitbucket and upsert it into the DB |
| `GET` | `/api/release-prs` | Public | List all release PRs |
| `GET` | `/api/release-prs/[id]` | Public | Get a single PR by ID |
| `PATCH` | `/api/release-prs/[id]` | Clerk | Update sync status / main PR ID |
| `DELETE` | `/api/release-prs/[id]` | Clerk | Delete a PR record |

### Sync Status Values

| Value | Meaning |
|---|---|
| `SYNCED` | Main-branch PR exists and is merged |
| `MAIN_PR_OPEN` | Main-branch PR exists but is still open |
| `MISSING_MAIN_PR` | No main-branch PR found or linked |

---

## Project Structure

```
app/
  page.tsx                        # Dashboard (client component)
  layout.tsx                      # Root layout with ClerkProvider
  globals.css                     # Tailwind v4 import
  pr/[id]/page.tsx                # PR detail page (server component)
  api/
    pr-sync/route.ts              # POST — sync a PR from Bitbucket
    release-prs/route.ts          # GET  — list all PRs
    release-prs/[id]/route.ts     # GET / PATCH / DELETE — single PR
components/
  navbar.tsx                      # Sticky navbar with Add PR modal + Clerk auth
  edit-pr-form.tsx                # Re-sync / Edit / Delete actions on detail page
  status-badge.tsx                # Sync status pill badge
lib/
  bitbucket.ts                    # Bitbucket API client + status resolver
  prisma.ts                       # Prisma singleton with PrismaPg adapter
  types.ts                        # Shared TypeScript interfaces
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
