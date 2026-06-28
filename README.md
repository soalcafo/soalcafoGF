# Training Hub

A multi-tenant, bilingual (pt-PT / en) web app for a vocational training facility: a
training **catalog** (internal + supplier + future API-fed), worker management, training
**assignments**, completed-**hours** tracking, and a cross-supplier **timeline**.

> **Status:** Phase 0 — Foundations. This phase builds the plumbing (data model, tenant
> isolation, auth, i18n, CI). Customer-facing features arrive in Phase 1. See
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design and
> [`docs/DECISIONS.md`](docs/DECISIONS.md) for resolved product decisions.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) + React 19 + TypeScript |
| Database | PostgreSQL (Supabase) + Prisma |
| Auth | Auth.js v5 (NextAuth) — credentials + magic-link; workers can log in |
| i18n | next-intl (pt-PT, en) |
| UI | Tailwind CSS v4 + shadcn/ui |
| Validation | Zod |
| Tests | Vitest (incl. tenant-isolation proofs) |

## Prerequisites

- **Node.js 20+** and a package manager (examples below use `pnpm`; `npm`/`yarn` work too).
- A **Supabase** project (PostgreSQL). Use an **EU region** (e.g. Frankfurt) for GDPR.

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Then edit `.env`. From **Supabase → Project Settings → Database → Connection string**, copy:

- the **Transaction pooler** URL (port **6543**) → `DATABASE_URL`
  (keep the `?pgbouncer=true&connection_limit=1` suffix — it is required for Prisma + the pooler),
- the **Session / direct** URL (port **5432**) → `DIRECT_URL` (used by migrations only).

Generate an auth secret:

```bash
npx auth secret    # writes AUTH_SECRET, or print one with: openssl rand -base64 32
```

> 🔒 Never commit `.env`. It is git-ignored.

### 3. Create the database schema

```bash
pnpm db:generate          # generate the Prisma client
pnpm db:migrate           # create tables/indexes/foreign-keys from schema.prisma
pnpm db:security          # apply RLS, partial unique indexes, CHECKs, triggers (re-runnable)
pnpm db:seed              # optional: seed reference data (categories, internal source, demo admin)
```

> **Why two steps?** Prisma generates the base tables from `schema.prisma`. The
> security layer (row-level security, partial unique indexes, cross-row CHECKs,
> append-only triggers) lives in [`prisma/sql/security.sql`](prisma/sql/security.sql),
> which Prisma can't express. It is idempotent — **re-run `pnpm db:security` after every
> `pnpm db:migrate`**. In CI/production, `pnpm db:setup` runs deploy + security + seed in order.

### 4. Run

```bash
pnpm dev                  # http://localhost:3000
```

## Verifying tenant isolation (important)

This app keeps every customer company's data in one database, isolated by PostgreSQL
**row-level security (RLS)**. An automated test proves a query scoped to tenant A can
**never** read tenant B's rows — run it against your real database:

```bash
pnpm test:isolation
```

If this test ever fails, isolation is broken — treat it as a release blocker. (It also
checks that omitting the tenant context fails *closed* — returns nothing — rather than
leaking everything.)

## Project scripts

| Script | What it does |
|---|---|
| `pnpm dev` / `build` / `start` | Next.js dev / production build / serve |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint (incl. the DB-access guardrail) |
| `pnpm test` | All Vitest tests |
| `pnpm test:isolation` | Tenant-isolation proofs only |
| `pnpm db:migrate` | Apply migrations (dev) |
| `pnpm db:migrate:deploy` | Apply migrations (CI/prod) |
| `pnpm db:studio` | Prisma Studio (DB browser) |
| `pnpm ci` | typecheck + lint + test (what CI runs) |

## Architecture guardrails (don't bypass these)

- **Never import the raw Prisma client** outside `lib/db/`. Use `forTenant()` / `asFacility()`
  from `@/lib/db` so the RLS tenant context is always set. ESLint enforces this.
- **Completion records and audit logs are append-only.** Corrections supersede; they are
  never edited or deleted (GDPR-safe history).
- **Worker PII** is visible to the owning company's HR and to `FACILITY_ADMIN` (audited);
  `FACILITY_STAFF` see anonymized/aggregated data only.

## Directory layout

```
app/                 Next.js App Router (app/[locale]/...)
components/          Shared UI (components/ui = shadcn)
lib/
  auth/              Auth.js config, capabilities map, requireAuth
  db/                Prisma client + tenant-scoped access helpers (the ONLY place raw db lives)
i18n/                next-intl routing + request config
messages/            Translation catalogs (pt-PT.json, en.json)
prisma/              schema.prisma, migrations, seed
tests/               Vitest tests (tests/isolation = RLS proofs)
docs/                ARCHITECTURE.md, DECISIONS.md
```
