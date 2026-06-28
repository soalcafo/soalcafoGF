# Architecture & Implementation Plan — Training Catalog & Tracking Web App

**Client:** ATEC-style European/Portuguese vocational training facility
**Document type:** Architecture + implementation plan (no application code in this phase)
**Status:** For client review — implementation-ready
**Date:** 2026-06-27

---

## 0. How to read this document & conflicts resolved

Seven independent dimension designs plus an adversarial review were consolidated into this single deliverable. As principal architect I have picked one canonical answer per conflict and **fixed every valid critic finding inline** (schema-compilation bugs, tenant-isolation holes, GDPR gaps, idempotency-key inconsistencies, scope realism). The whole document uses the canonical vocabulary only.

| Conflict | Options seen | **Canonical decision** | Why |
|---|---|---|---|
| Authorization model | role-on-User vs Membership join | **Membership join** (user × scope × role) | Only it expresses a person who is HR *and* a worker, facility staff across tenants, and offboarding as a row-state change. |
| Role names | several sets | **`FACILITY_ADMIN`, `FACILITY_STAFF`, `COMPANY_ADMIN`, `HR_MANAGER`, `WORKER`** (+`SUPPLIER_PORTAL`, **deferred to Phase 4**, not built in MVP) | Most expressive; separates company-billing authority from operational HR. SUPPLIER_PORTAL is enum-reserved but not wired/tested until Phase 4 (was gold-plating in MVP). |
| Catalog/course entity | `TrainingOffering` vs `Training` | **`Training`** | Shorter; all downstream dimensions key off it. "Offering" is a UI synonym only. |
| Dated occurrence | `TrainingSession` | **`TrainingSession`** | Unanimous. |
| Worker-on-training | `Enrollment` vs `Assignment` | **`Enrollment`** (record); "Assign" is the UI verb | One noun, one verb. |
| Completion entity | two names | **`CompletionRecord`** | Immutable, append-only, correction-by-supersede. |
| Origin enums | conflated 3–4-value enums | **Two orthogonal enums:** `SourceType` (`INTERNAL/SUPPLIER/OTHER_FACILITY`) on the source; `Provenance` (`ADMIN_MANUAL/HR_MANUAL/API_IMPORT`) on each row | Separates *who runs it* from *how the row arrived*. |
| Hours storage | Decimal vs integer minutes | **Integer minutes** (`plannedMinutes/actualMinutes/nominalMinutes`) | Exact summation, no float drift, locale decimals at render only. |
| Job queue | Cron vs pg-boss | **Vercel Cron + idempotent handlers (MVP) → pg-boss (Phase 3)** | Zero extra infra for the manual MVP. |
| Aggregated hours | counters vs views | **Live SQL views in MVP; one materialized cube only if latency demands (Phase 5)** | Counters drift under corrections/anonymization; the cube was gold-plating at tens-to-low-hundreds of tenants. |
| Idempotency key | `(externalSystemId, externalRef)` vs `(sourceId, externalRef)` | **`(sourceId, externalRef)` everywhere** (tenant-aware for tenant-private rows) | A provider can only guarantee externalRef uniqueness *within a source*; the pipeline already keys on sourceId. Resolves the cross-source/cross-tenant collision the review flagged. |
| Timeline scope | "dated occurrences only" silently | **Explicit client decision (Open Q1); default = also surface unscheduled published catalog rows in an "Unscheduled" lane** | "Every training of any supplier" is the literal requirement; silently excluding session-less catalog rows was a requirement miss. |
| Gantt library | FullCalendar (license caveat) | **Minimal list/agenda timeline in MVP (no license); FullCalendar calendar/Gantt in Phase 2 pending license decision** | A core requirement (#7) must not be fully deferred or blocked on a commercial question. |

---

## 1. Executive summary

We are building a **bilingual (pt-PT + en), multi-tenant web application** that lets a vocational-training facility publish a **training catalog** to its customer companies, and lets each company's **HR staff** manage **workers**, assign them to trainings, record trainings done at other providers, and track **completed training hours** on a single **cross-supplier timeline**.

Six concrete jobs:

1. **Catalog** of available trainings — clear, searchable — from the facility (**internal**), from **suppliers** it resells, or (later) **pulled via API**.
2. **Facility admins create** catalog trainings, tagging each with a supplier or marking it internal. The same data can later arrive by API with no redesign (manual entry and API ingestion share one write path).
3. **HR records trainings their workers did elsewhere** (third-party "other facilities" the facility neither sells nor schedules) — typed today, automatable by API tomorrow (both catalog *and* completion ingestion designed).
4. **Tracks each worker and their completed hours**, source-agnostic, with certificates and expiry.
5. **HR assigns workers** (single or bulk) and **marks cohorts complete in bulk**.
6. **One timeline** of every training of every supplier.

It is **standalone for now but integration-ready**: a connector/adapter boundary lets it later ingest external catalogs *and* completions, and two-way-sync with the facility's existing platform (modeled as "just another source" behind an anti-corruption layer). Because EU/GDPR applies, the design uses **shared-DB multi-tenancy with Postgres RLS enforced via transaction-local GUC**, composite-FK cross-tenant integrity, EU data residency, audited PII access, an anonymize-not-delete retention model, and an explicit lawful-basis/consent model.

**Stack (locked):** Next.js 15 (App Router) + TypeScript, PostgreSQL 16 + Prisma, Auth.js v5, Tailwind v4 + shadcn/ui, Zod, next-intl. Single codebase.

---

## 2. Domain glossary

The biggest domain risk is conflating five "training" concepts. Canonical definitions:

| Term | Entity | Tenant-scoped? | Definition |
|---|---|---|---|
| **Facility** | `INTERNAL` source + facility-scope memberships | No | The academy operating the app; above all tenants. |
| **Tenant / Company** | `Tenant` | root of scope | A customer company; the unit of isolation. |
| **Source** | `TrainingSource` | global, or tenant-private for HR `OTHER_FACILITY` | **Who runs/sells a training.** `sourceType ∈ INTERNAL / SUPPLIER / OTHER_FACILITY`. |
| **Available Training** | `Training` | global catalog, or tenant-private | **The browsable course definition.** Points to one source. |
| **Session** | `TrainingSession` | inherits training scope | **A dated occurrence** (optional; self-paced/external often have none). |
| **Enrollment** | `Enrollment` | yes | A **worker put on a training** (optionally a session). "Assign" is the UI verb. |
| **Completion Record** | `CompletionRecord` | yes | **Immutable proof of completion**; holds *actual* minutes, date, certificate. Corrections supersede, never edit. |
| **HR** | `User` + `Membership(COMPANY_ADMIN|HR_MANAGER)` | company | Manage workers, assign, record external, read dashboards. |
| **Worker** | `Worker` (PII record) | yes | The trained person; may exist with no login. PII concentrated here for GDPR. |
| **Provenance** | enum on rows | — | **How a row arrived:** `ADMIN_MANUAL / HR_MANUAL / API_IMPORT`. Orthogonal to `sourceType`. |

**Disambiguations:** Source ≠ Training (one source, many trainings). Training ≠ Session (the timeline plots sessions, dated enrollments, *and* unscheduled published catalog rows in a dedicated lane — never silently nothing). Enrollment ≠ Completion (reports read only completions). Worker ≠ User (most workers never log in).

---

## 3. Domain & data model

### 3.1 Entity list

**Identity & tenancy:** `Tenant`, `User`, `Membership`, `Worker`, `ConsentRecord`, Auth.js tables (`Account`, `AuthSession`, `VerificationToken`), `Invitation`, `CustomerEmailDomain`, `TenantIdentityProvider` (schema now / wired Phase 4).

**Catalog & sources:** `TrainingSource`, `Training`, `TrainingTranslation`, `TrainingSession`, `TrainingCategory`, `CategoryTranslation`, `TrainingCategoryLink`, `CatalogEntitlement` (Phase-1 toggle for contracted-subset catalogs).

**Workflow & records:** `Enrollment`, `StatusTransition`, `CompletionRecord`, `CompletionCategory`, `Certificate`, `Attachment`.

**Integration & audit:** `IngestRun`, `IngestedRecord`, `MatchCandidate`, `SourceSyncState`, `AuditLog`.

**Read models (DB views):** `timeline_item`, `v_worker_hours`, `v_company_hours`, `v_certification_status`, `v_compliance_gaps` (live views; optional `mv_worker_period_category_hours` only in Phase 5).

### 3.2 ERD (relationships & cardinalities)

```
Tenant 1──N Worker / Membership / Enrollment / CompletionRecord / ConsentRecord
Tenant 1──N (private) TrainingSource / Training        (OTHER_FACILITY, HR-created)
Membership with tenantId NULL = facility scope

User  N──N Tenant (via Membership)        User 1──N Membership
Worker 0..1 link to User VIA Membership(role=WORKER, workerId)   // single authoritative login link
TrainingSource 1──N Training              Training 1──N TrainingSession / TrainingTranslation / Enrollment
Training N──N TrainingCategory (TrainingCategoryLink)
TrainingCategory self 0..1──N (skill tree) ; 1──N CategoryTranslation
TrainingSession 1──N Enrollment
Worker 1──N Enrollment ; Enrollment 1──N CompletionRecord (original + supersessions; one ACTIVE)
Enrollment 1──N StatusTransition
CompletionRecord self 0..1 supersededBy ; 1──N CompletionCategory ; 1──0..1 Certificate ; 1──N Attachment
TrainingSource 1──N IngestRun 1──N IngestedRecord ; IngestedRecord 0..1 MatchCandidate → Training
AuditLog → actor User (+ optional Tenant) — append-only, never deletable, IDs only (no raw PII)
```

**Provenance & idempotency.** Every offering, source, session, enrollment, and completion carries `provenance` plus nullable `externalRef`. The canonical idempotency key is **`(sourceId, externalRef)`** (a provider only guarantees externalRef uniqueness *within its own source*). For tenant-private rows it is **`(tenantId, sourceId, externalRef)`**. This makes re-imports idempotent and future ingestion additive.

**Externally-recorded trainings reuse the same tables (now generalized).** "Record a completed training" works for **any** source, not only OTHER_FACILITY: (1) find-or-create source (OTHER_FACILITY tenant-private, or pick an existing internal/supplier `Training`); (2) find-or-create the `Training` (`requiresSession=false` for external); (3) create `Enrollment` (`sessionId NULL`) + immediate `CompletionRecord` via the same completion transaction the cohort flow uses. Identical tables; zero special-casing in hours/timeline. API import later produces the same rows with `provenance=API_IMPORT`.

### 3.3 Consolidated Prisma schema sketch

```prisma
generator client { provider = "prisma-client-js" }
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")   // pooled (Neon, transaction mode) for runtime
  directUrl = env("DIRECT_URL")     // direct for migrations
}

// ─────────────── ENUMS ───────────────
enum ScopeType         { FACILITY CUSTOMER SUPPLIER }
enum MembershipRole    { FACILITY_ADMIN FACILITY_STAFF COMPANY_ADMIN HR_MANAGER WORKER SUPPLIER_PORTAL }
enum MembershipStatus  { INVITED ACTIVE SUSPENDED REVOKED }
enum InviteStatus      { PENDING ACCEPTED EXPIRED REVOKED }

enum SourceType        { INTERNAL SUPPLIER OTHER_FACILITY }        // who runs/sells it
enum SourceKind        { FACILITY SUPPLIER EXTERNAL_PROVIDER FACILITY_PLATFORM }
enum Provenance        { ADMIN_MANUAL HR_MANUAL API_IMPORT }       // how the row arrived
enum SyncDirection     { PULL_ONLY PUSH_ONLY BIDIRECTIONAL }

enum TrainingModality  { IN_PERSON ONLINE_LIVE ONLINE_SELF_PACED BLENDED }
enum TrainingStatus    { DRAFT PUBLISHED ARCHIVED }
enum SessionStatus     { SCHEDULED OPEN_FOR_ENROLLMENT FULL IN_PROGRESS COMPLETED CANCELLED }

enum EnrollmentStatus  { REQUESTED ASSIGNED IN_PROGRESS COMPLETED CANCELLED NO_SHOW WAITLISTED }
enum CompletionStatus  { PASSED FAILED ATTENDED_NO_ASSESSMENT PARTIAL CANCELLED }
enum VerificationStatus{ SELF_REPORTED EVIDENCE_PROVIDED VERIFIED }
enum LawfulBasis       { LEGAL_OBLIGATION CONTRACT LEGITIMATE_INTEREST CONSENT }

enum ConnectorAuthType { NONE API_KEY OAUTH2 BASIC }
enum SyncRunState      { OK PARTIAL FAILED RUNNING }   // RENAMED from SyncState (was a name collision with the model)
enum IngestStatus      { STAGED MATCHED UPSERTED CONFLICT SKIPPED ERROR }
enum AttachmentKind    { CERTIFICATE ATTENDANCE_SHEET OTHER_EVIDENCE }
enum MirrorState       { NONE PENDING SENT ACK FAILED }

// ─────────────── IDENTITY & TENANCY ───────────────
model Tenant {
  id           String   @id @default(cuid())
  name         String
  legalName    String?
  vatNumber    String?  @unique
  slug         String   @unique
  defaultLocale String  @default("pt-PT")
  status       String   @default("ACTIVE")
  catalogMode  String   @default("ALL_PUBLISHED")   // "ALL_PUBLISHED" | "ENTITLED_SUBSET" (Open Q is resolved per-tenant)
  ssoEnabled   Boolean  @default(false)
  workers      Worker[]
  memberships  Membership[]
  enrollments  Enrollment[]
  completions  CompletionRecord[]
  consents     ConsentRecord[]
  entitlements CatalogEntitlement[]
  emailDomains CustomerEmailDomain[]
  identityProviders TenantIdentityProvider[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  @@unique([id])                          // enables composite FKs (id, tenantId pattern)
  @@index([slug])
}

model User {
  id            String   @id @default(cuid())
  email         String   @unique          // citext via migration
  emailVerified DateTime?
  name          String?
  passwordHash  String?                    // argon2id; null for SSO/magic-link
  locale        String   @default("pt-PT")
  isActive      Boolean  @default(true)
  mfaSecretEnc  String?                    // ENCRYPTED at rest (envelope, KMS KEK) — never plaintext TOTP seed
  sessionVersion Int     @default(0)
  memberships   Membership[]
  accounts      Account[]
  sessions      AuthSession[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
}

model Membership {
  id         String           @id @default(cuid())
  userId     String
  scopeType  ScopeType
  tenantId   String?           // set when scopeType=CUSTOMER
  supplierId String?           // set when scopeType=SUPPLIER
  role       MembershipRole
  status     MembershipStatus  @default(INVITED)
  workerId   String?  @unique  // SINGLE authoritative login↔Worker link (Worker.userId removed)
  membershipVersion Int @default(0)
  invitedById String?
  user   User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  tenant Tenant? @relation(fields: [tenantId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([userId, scopeType, tenantId, supplierId, role])
  @@index([tenantId, role, status]) @@index([userId, status])
  // CHECK (migration): exactly one scope FK matches scopeType; role allowed for scopeType.
  // Worker.userId removed entirely → one human (User) can be WORKER in N tenants (multi-tenant worker supported).
}

model Worker {
  id         String  @id @default(cuid())
  tenantId   String
  employeeNo String
  firstName  String
  lastName   String
  email      String?
  department String?
  jobTitle   String?
  hireDate   DateTime?
  // GDPR controls
  status     String  @default("ACTIVE")
  isAnonymized       Boolean @default(false)   // tombstone
  legalHold          Boolean @default(false)   // blocks erasure
  processingRestricted Boolean @default(false) // Art.18 restriction
  tenant      Tenant @relation(fields: [tenantId], references: [id])
  enrollments Enrollment[]
  completions CompletionRecord[]
  consents    ConsentRecord[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  @@unique([tenantId, employeeNo])
  @@unique([id, tenantId])               // target for composite FKs from Enrollment/CompletionRecord
  @@index([tenantId, lastName])
}

model ConsentRecord {                     // GDPR: consent is recorded, not a boolean flag
  id         String @id @default(cuid())
  tenantId   String
  workerId   String
  purpose    String                       // e.g. "training-records"
  lawfulBasis LawfulBasis
  textVersion String                      // which consent text version
  grantedAt  DateTime?
  grantedByUserId String?
  withdrawnAt DateTime?
  tenant Tenant @relation(fields: [tenantId], references: [id])
  worker Worker @relation(fields: [workerId, tenantId], references: [id, tenantId])
  @@index([tenantId, workerId])
}

// ─────────────── CATALOG & SOURCES ───────────────
model TrainingSource {
  id            String     @id @default(cuid())
  sourceType    SourceType
  kind          SourceKind @default(SUPPLIER)
  name          String
  normalizedName String                          // for idempotent find-or-create
  slug          String
  legalName     String?  contactEmail String?  website String?  vatNumber String?
  isTenantPrivate Boolean @default(false)        // true only for HR-created OTHER_FACILITY
  tenantId      String?                          // set only when isTenantPrivate
  // INBOUND auth (supplier pushes to /api/v1/ingest/:sourceId)
  ingestApiKeyHash String?
  // OUTBOUND pull config (facility pulls)
  connectorCode String?  connectorVersion String?
  authType      ConnectorAuthType @default(NONE)
  credentialRef String?                          // handle into EU KMS-backed secret store; never inline
  baseConfig    Json?
  syncEnabled   Boolean   @default(false)
  syncSchedule  String?
  syncDirection SyncDirection @default(PULL_ONLY)
  systemOfRecord Boolean  @default(false)        // conflict winner for bidirectional sync
  provenance    Provenance @default(ADMIN_MANUAL)
  externalRef   String?
  isActive      Boolean   @default(true)
  trainings     Training[]
  ingestRuns    IngestRun[]
  createdAt DateTime @default(now()) updatedAt DateTime @updatedAt deletedAt DateTime?
  @@index([sourceType]) @@index([tenantId]) @@index([syncEnabled, syncSchedule])
  // partial UNIQUE (migration): (slug) WHERE tenantId IS NULL ; (tenantId, slug) WHERE tenantId IS NOT NULL
  // partial UNIQUE (migration): (tenantId, normalizedName) → idempotent HR find-or-create (no duplicate providers)
  // partial UNIQUE (migration): (externalRef) WHERE tenantId IS NULL AND externalRef IS NOT NULL
}

model Training {
  id            String           @id @default(cuid())
  sourceId      String
  tenantId      String?           // NULL = global catalog; set = HR-private (OTHER_FACILITY)
  title         String
  slug          String  summary  String?  description String?
  modality      TrainingModality  @default(IN_PERSON)
  nominalMinutes Int
  language      String           @default("pt-PT")
  certificationName String?
  primaryCategoryId String?       // designated primary (full set via TrainingCategoryLink) — resolves multi-category ambiguity
  level         String?
  status        TrainingStatus    @default(DRAFT)
  requiresSession Boolean         @default(true)
  coverImageUrl String?  externalUrl String?
  provenance    Provenance        @default(ADMIN_MANUAL)
  externalRef   String?
  dedupKey      String?  contentHash String?
  manualOverrides Json?           // typed {schemaVersion, fields} snapshot preserved across API upgrade
  fieldPrecedence Json?           // per-field "api" | "manual"; mutable on conflict resolution
  lastSeenAt    DateTime?  retiredAt DateTime?   // soft-retire when origin stops reporting
  source        TrainingSource    @relation(fields: [sourceId], references: [id])
  sessions      TrainingSession[]
  translations  TrainingTranslation[]
  enrollments   Enrollment[]
  categoryLinks TrainingCategoryLink[]
  createdAt DateTime @default(now()) updatedAt DateTime @updatedAt deletedAt DateTime?
  @@unique([sourceId, slug])
  @@unique([id, tenantId])        // composite-FK target (NULL tenantId rows: use generated coalesce key in migration)
  @@index([tenantId, status]) @@index([sourceId])
  // partial UNIQUE (migration): (sourceId, externalRef) WHERE externalRef IS NOT NULL  [global]
  //                              (tenantId, sourceId, externalRef) WHERE tenantId IS NOT NULL AND externalRef IS NOT NULL
  // partial INDEX (migration): WHERE tenantId IS NULL AND status='PUBLISHED' AND retiredAt IS NULL  (public catalog)
  // CHECK (migration): catalog enrollment requires a session when requiresSession (see Enrollment)
}

model TrainingTranslation {
  id String @id @default(cuid())
  trainingId String  locale String  title String  summary String?  description String?
  training Training @relation(fields: [trainingId], references: [id])
  @@unique([trainingId, locale])
}

model TrainingSession {
  id           String        @id @default(cuid())
  trainingId   String
  sessionCode  String?
  startsAt     DateTime      @db.Timestamptz(6)
  endsAt       DateTime      @db.Timestamptz(6)
  timezone     String        @default("Europe/Lisbon")
  location String?  onlineUrl String?  isOnline Boolean @default(false)
  capacity Int?  seatsTaken Int @default(0)
  instructorName String?
  status       SessionStatus @default(SCHEDULED)
  priceAmount  Decimal? @db.Decimal(10,2)  priceCurrency String? @default("EUR")
  provenance   Provenance @default(ADMIN_MANUAL)  externalRef String?
  training     Training      @relation(fields: [trainingId], references: [id])
  enrollments  Enrollment[]
  createdAt DateTime @default(now()) updatedAt DateTime @updatedAt deletedAt DateTime?
  @@index([trainingId, startsAt]) @@index([status, startsAt])
  // NOTE: source/category facets are NOT denormalized here — the timeline view derives them via join to Training/TrainingSource,
  //       so a manual→API claim (which changes Training.sourceId) cannot leave stale facets. (Fixes stale-denormalization bug.)
  // partial UNIQUE (migration): (trainingId, externalRef) WHERE externalRef IS NOT NULL
  // GiST index on generated tstzrange(startsAt,endsAt) added via migration.
  // rrule removed from v1 — recurring sessions are concrete rows (admins create the few needed). Add later if a feed needs it.
}

model TrainingCategory {
  id String @id @default(cuid())
  code String @unique  parentId String?
  parent TrainingCategory? @relation("CatTree", fields: [parentId], references: [id])
  children TrainingCategory[] @relation("CatTree")
  isMandatory Boolean @default(false)
  defaultValidityMonths Int?  expiryLeadDays Int @default(60)
  retentionYears Int @default(5)  lawfulBasis LawfulBasis @default(LEGAL_OBLIGATION)
  isActive Boolean @default(true)
  translations CategoryTranslation[]  links TrainingCategoryLink[]
  createdAt DateTime @default(now()) updatedAt DateTime @updatedAt
}
model CategoryTranslation {
  id String @id @default(cuid())  categoryId String  locale String  name String
  category TrainingCategory @relation(fields: [categoryId], references: [id])
  @@unique([categoryId, locale])
}
model TrainingCategoryLink {                 // SINGLE source of truth for categorization (free-text Training.category dropped)
  trainingId String  categoryId String
  training Training @relation(fields: [trainingId], references: [id])
  category TrainingCategory @relation(fields: [categoryId], references: [id])
  @@id([trainingId, categoryId]) @@index([categoryId])
}

// ─────────────── WORKFLOW & RECORDS ───────────────
model Enrollment {
  id            String           @id @default(cuid())
  tenantId      String
  workerId      String
  trainingId    String
  sessionId     String?           // NULL => self-paced / externally-recorded / after-the-fact record
  status        EnrollmentStatus  @default(ASSIGNED)
  externalTrainingTitle String?  externalProviderName String?  // free-text fallback when no Training row
  plannedMinutes Int
  plannedStartAt DateTime? @db.Timestamptz(6)  plannedEndAt DateTime? @db.Timestamptz(6)
  dueAt DateTime?  requestedById String?  confirmedById String?  assignedById String
  assignedAt DateTime @default(now())  startedAt DateTime?  notes String?
  provenance    Provenance @default(HR_MANUAL)  externalRef String?
  // bidirectional-sync outbound mirror (Phase 4; columns present now so 2-way is retrofittable)
  mirroredExternalId String?  mirrorState MirrorState @default(NONE)  mirrorVersion Int @default(0)  lastMirroredHash String?
  tenant   Tenant @relation(fields: [tenantId], references: [id])
  worker   Worker @relation(fields: [workerId, tenantId], references: [id, tenantId])   // COMPOSITE FK → same-tenant guarantee
  training Training @relation(fields: [trainingId], references: [id])
  session  TrainingSession? @relation(fields: [sessionId], references: [id])
  completions CompletionRecord[]                              // one-to-MANY (original + supersessions)
  transitions StatusTransition[]
  createdAt DateTime @default(now()) updatedAt DateTime @updatedAt deletedAt DateTime?
  @@index([tenantId, status]) @@index([workerId]) @@index([tenantId, plannedStartAt])
  // partial UNIQUE (migration): (workerId, trainingId) WHERE sessionId IS NULL  → no duplicate session-less enrollment (NULL-distinct hole fixed)
  // partial UNIQUE (migration): (workerId, trainingId, sessionId) WHERE sessionId IS NOT NULL
  // partial UNIQUE (migration): (sessionId, workerId) WHERE status NOT IN ('CANCELLED','NO_SHOW')  → one active seat, re-enroll after terminal
  // partial UNIQUE (migration): (sourceId-via-training, externalRef) handled at IngestedRecord; enrollment ext key: (tenantId, externalRef) WHERE externalRef IS NOT NULL
  // CHECK (migration): training.requiresSession=true AND status forward-assigned ⇒ sessionId NOT NULL
  //                    (after-the-fact RECORD path allows sessionId NULL via explicit completion fast-path)
  // CHECK/composite-FK: tenant-private Training must match enrollment.tenantId; global Training (tenantId NULL) allowed.
}

model StatusTransition {
  id String @id @default(cuid())
  enrollmentId String  fromStatus EnrollmentStatus?  toStatus EnrollmentStatus
  changedById String  reason String?  changedAt DateTime @default(now())
  enrollment Enrollment @relation(fields: [enrollmentId], references: [id])
  @@index([enrollmentId])
}

model CompletionRecord {
  id              String           @id @default(cuid())
  tenantId        String
  workerId        String
  enrollmentId    String
  completionStatus CompletionStatus
  actualMinutes   Int                              // AUTHORITATIVE completed hours
  completedOn     DateTime
  verification    VerificationStatus @default(SELF_REPORTED)
  sourceTypeSnapshot SourceType                     // POINT-IN-TIME snapshot — deliberately NOT rewritten on claim
  isMandatorySnapshot Boolean @default(false)
  gradeOrScore    String?
  recordedById    String  provenance Provenance @default(HR_MANUAL)
  reopened        Boolean @default(false)
  supersededById  String? @unique  externalRef String?
  supersededBy CompletionRecord? @relation("Supersede", fields: [supersededById], references: [id])
  supersedes   CompletionRecord? @relation("Supersede")
  tenant     Tenant @relation(fields: [tenantId], references: [id])
  worker     Worker @relation(fields: [workerId, tenantId], references: [id, tenantId])      // COMPOSITE FK
  enrollment Enrollment @relation(fields: [enrollmentId, tenantId, workerId], references: [id, tenantId, workerId]) // composite → no misattribution
  categories CompletionCategory[]  certificate Certificate?  attachments Attachment[]
  createdAt DateTime @default(now())               // immutable; NO deletedAt (corrections supersede)
  @@index([tenantId, workerId]) @@index([tenantId, completedOn])
  // partial UNIQUE (migration): (enrollmentId) WHERE supersededById IS NULL  → exactly one ACTIVE completion
  // partial UNIQUE (migration): (tenantId, externalRef) WHERE externalRef IS NOT NULL  → tenant-scoped completion idempotency
  //   (global key would collide when the same external completion legitimately maps to a contractor in two tenants)
}

model CompletionCategory {
  completionId String  categoryId String  isMandatory Boolean
  completion CompletionRecord @relation(fields: [completionId], references: [id])
  @@id([completionId, categoryId]) @@index([categoryId])
}
model Certificate {
  id String @id @default(cuid())  completionId String @unique
  certificateNumber String?  issuedAt DateTime  validFrom DateTime?  validUntil DateTime?
  issuingBody String?  attachmentId String?
  completion CompletionRecord @relation(fields: [completionId], references: [id])
  createdAt DateTime @default(now())  @@index([validUntil])
}
model Attachment {
  id String @id @default(cuid())
  tenantId String?                       // ADDED: file metadata cannot cross tenants (was an IDOR gap)
  completionId String?
  kind AttachmentKind
  storageKey String                      // RANDOM, unguessable; bucket has NO public read
  fileName String  mimeType String  sizeBytes Int
  containsPii Boolean @default(true)
  uploadedById String  uploadedAt DateTime @default(now())
  completion CompletionRecord? @relation(fields: [completionId], references: [id])
  @@index([completionId]) @@index([tenantId])
}

// ─────────────── INTEGRATION & AUDIT ───────────────
model IngestRun {
  id String @id @default(cuid())  sourceId String  connectorCode String
  startedAt DateTime @default(now())  finishedAt DateTime?  state SyncRunState @default(RUNNING)
  cursorBefore Json?  cursorAfter Json?
  fetched Int @default(0) upserted Int @default(0) skipped Int @default(0) conflicts Int @default(0)
  errorText String?
  source TrainingSource @relation(fields: [sourceId], references: [id])  records IngestedRecord[]
  @@index([sourceId, startedAt])
}
model IngestedRecord {
  id String @id @default(cuid())  runId String  sourceId String  externalRef String
  recordKind String                    // "TRAINING" | "COMPLETION" (catalog vs completion ingestion)
  rawPayload Json  normalized Json  contentHash String
  normalizedSchemaVersion String  connectorVersion String   // versioned replay
  status IngestStatus @default(STAGED)  matchedTrainingId String?  matchedWorkerId String?  tenantId String?  note String?
  run IngestRun @relation(fields: [runId], references: [id])  createdAt DateTime @default(now())
  @@unique([sourceId, externalRef, contentHash])   // idempotency
  @@index([status]) @@index([recordKind])
  // rawPayload PURGED after N days once UPSERTED (retention; may contain external PII)
}
model MatchCandidate {
  id String @id @default(cuid())  ingestedRecordId String  trainingId String? workerId String?
  score Float  reason Json  resolved Boolean @default(false)
  decision String?  decidedBy String?  decidedAt DateTime?  createdAt DateTime @default(now())
  @@index([resolved])
}
model SourceSyncState {                  // RENAMED model (the enum is now SyncRunState)
  id String @id @default(cuid())  sourceId String @unique
  cursor Json?  lastRunAt DateTime?  lastState SyncRunState @default(OK)
}
model AuditLog {
  id String @id @default(cuid())  tenantId String?  actorUserId String?  actorMembershipId String?
  impersonatedWorkerId String?         // distinguishes support-impersonation actions
  action String  entityType String?  entityId String?  pii Boolean @default(false)
  // IDs ONLY — NO raw PII in before/after (so immutable audit does not defeat erasure). Diffs are field-name + non-PII.
  changedFields Json?  ip String?  userAgent String?  createdAt DateTime @default(now())
  @@index([tenantId, entityType, entityId]) @@index([actorUserId, createdAt]) @@index([createdAt])
}
model CatalogEntitlement {               // only used when Tenant.catalogMode='ENTITLED_SUBSET'
  tenantId String  trainingId String?  sourceId String?
  tenant Tenant @relation(fields: [tenantId], references: [id])
  @@id([tenantId, trainingId])
}
// Auth.js adapter tables (Account, AuthSession, VerificationToken) — standard, omitted.
```

**Raw-SQL additions (migrations) Prisma cannot express:** `citext` emails; all partial unique indexes listed above; **composite foreign keys** carrying `tenantId` (Enrollment/CompletionRecord → Worker/Training; Prisma can express the `(workerId, tenantId)` form against `@@unique([id, tenantId])` targets, and raw SQL covers the remainder); generated `tstzrange` columns + GiST indexes; CHECK constraints (Membership scope/role, Training provenance, Enrollment session-required, cross-tenant FK consistency for tenant-private trainings); **RLS policies + the transaction-local GUC mechanism** (see §5); a CI schema-scan that fails if a new free-text column is not classified PII/non-PII.

---

## 4. Roles & permissions matrix

Five roles live in MVP across two scope types; `SUPPLIER_PORTAL` (SUPPLIER scope) is enum-reserved and **wired in Phase 4 only**. A role is valid only inside its scope type (DB CHECK + Zod).

| Scope | Role | Who |
|---|---|---|
| FACILITY | `FACILITY_ADMIN` | Super-admin: catalog, suppliers, tenants, SSO/connectors, audit, GDPR execution. |
| FACILITY | `FACILITY_STAFF` | Operations: create/edit trainings, manage suppliers, support; no global config/audit. |
| CUSTOMER | `COMPANY_ADMIN` | Account owner: billing/seats, settings, manages HR users, approves exports, raises erasure. |
| CUSTOMER | `HR_MANAGER` | Day-to-day HR: workers, assignments, external-training entry, completions, dashboards. |
| CUSTOMER | `WORKER` | Self-view only (deferred to Phase 1b/2 — see §12; data-only in MVP per Open Q). |
| SUPPLIER | `SUPPLIER_PORTAL` | **Phase 4** — supplier maintains own catalog entries. |

Legend: ● full · ◐ own-tenant-scoped · ▲ self-only · ✕ none.

| Capability | FAC_ADMIN | FAC_STAFF | COMPANY_ADMIN | HR_MANAGER | WORKER |
|---|:--:|:--:|:--:|:--:|:--:|
| catalog.training.create/edit/publish | ● | ● | ✕ | ✕ | ✕ |
| catalog.training.delete | ● | ◐ | ✕ | ✕ | ✕ |
| catalog.browse | ● | ● | ◐ | ◐ | ◐ |
| supplier.manage | ● | ● | ✕ | ✕ | ✕ |
| source/connector.configure | ● | ◐ | ✕ | ✕ | ✕ |
| ingest.conflict.resolve | ● | ● | ✕ | ✕ | ✕ |
| customer.create (onboard) | ● | ● | ✕ | ✕ | ✕ |
| customer.settings.edit | ● | ◐(support) | ◐ | ✕ | ✕ |
| customer.billing.manage | ● | ✕ | ◐ | ✕ | ✕ |
| membership.invite.hr | ✕ | ✕ | ◐ | ✕ | ✕ |
| membership.invite.worker | ✕ | ✕ | ◐ | ◐ | ✕ |
| membership.invite.facilityStaff | ● | ✕ | ✕ | ✕ | ✕ |
| worker.record.create/edit/import | ✕ | ✕ | ◐ | ◐ | ✕ |
| worker.record.read (PII) | ◐(audited, support-gated) | ◐(audited, support-gated) | ◐ | ◐ | ▲ |
| worker.profile.rectify | ✕ | ✕ | ◐ | ◐ | ▲(request) |
| training.assignment.create | ✕ | ✕ | ◐ | ◐ | ✕ |
| training.assignment.read | ◐(audited) | ◐(audited) | ◐ | ◐ | ▲ |
| completion.record (any source) | ◐(audited) | ✕ | ◐ | ◐ | ✕ |
| completion.bulk (cohort) | ◐ | ◐ | ◐ | ◐ | ✕ |
| completion.reopen | ◐(audited) | ✕ | ◐(elevated) | ✕ | ✕ |
| certificate.issue | ◐ | ◐ | ◐ | ◐ | ✕ |
| hours.read.tenant | ◐(audited) | ◐(audited) | ◐ | ◐ | ✕ |
| hours.read.self | ✕ | ✕ | ▲ | ▲ | ▲ |
| report.read/export | ◐(audited) | ◐ | ◐ | ◐ | ▲(self) |
| timeline.view.global | ● | ● | ✕ | ✕ | ✕ |
| timeline.view.tenant | ● | ● | ◐ | ◐ | ▲(own) |
| gdpr.export (DSAR) | ● | ✕ | ◐ | ✕ | ▲(self request) |
| gdpr.erase/anonymize | ● | ✕ | ◐(request→facility executes) | ✕ | ▲(request) |
| audit.read | ● | ✕ | ◐(own tenant) | ✕ | ✕ |
| identityProvider.configure (SSO) | ● | ✕ | ◐(own tenant) | ✕ | ✕ |
| impersonate.customer (support) | ◐(time-boxed, reason, audited, customer-granted) | ◐(time-boxed, audited) | ✕ | ✕ | ✕ |

Capabilities are a data-driven grant map (`ROLE_CAPABILITIES` in `lib/auth/capabilities.ts`), the single source of truth, asserted by a CI test against this matrix.

---

## 5. Multi-tenancy & security model (incl. GDPR posture)

### 5.1 Tenancy = shared DB, shared schema, `tenantId` discriminator
One database/schema; every customer-owned table carries non-null `tenantId`; composite indexes lead with `tenantId`. Rationale: tens-to-low-hundreds of companies; schema/DB-per-tenant would break the facility-wide catalog/timeline/API fan-in.

### 5.2 Cross-tenant integrity is structural, not conventional
RLS checks each row's *own* `tenantId` in isolation, so a service bug creating `Enrollment{tenantId=A, workerId=<B's worker>}` would pass RLS for A yet leak B's PII via a join. **Composite foreign keys carrying `tenantId`** (`Enrollment/CompletionRecord → Worker(id, tenantId)`, and tenant-private `Training`) make cross-tenant relations *impossible at the DB level*. Global `Training (tenantId NULL)` references are allowed by a CHECK (`training.tenantId IS NULL OR = row.tenantId`).

### 5.3 Defense-in-depth isolation (four layers)
- **A — Edge/middleware.** `middleware.ts` (composed with next-intl) requires an authenticated session with an active membership for scoped routes; forwards verified `x-scope-*` headers; no DB at the edge.
- **B — Server guard.** Every Server Action / Route Handler calls `requireAuth({ capability })` → `{ userId, membershipId, scopeType, scopeId, role, capabilities, workerId? }`; 403 on missing capability. **Object-level (IDOR) checks are mandatory:** the guard resolves the `:id` entity and asserts it is in scope; for `WORKER` role it injects `workerId = session.workerId` and an RLS policy additionally requires `workerId = current_setting('app.worker_id')` (tenant-RLS alone cannot enforce intra-tenant self-only). All authz lives in the **service layer** so future API callers are equally protected.
- **C — Scoped data access.** `db.forTenant(scopeId)` **always opens an interactive transaction** and, as its first statement, runs the **transaction-local, injection-safe** `SELECT set_config('app.tenant_id', $scopeId, true)` (and `app.worker_id`, `app.is_facility` as needed). It auto-injects `where:{tenantId}`, sets `tenantId` on create, rejects mismatched `tenantId` on update/delete, and applies `deletedAt IS NULL`. **The non-transactional path is lint-banned** — this is the load-bearing fix: in PgBouncer/Neon *transaction* pooling, a bare `SET LOCAL` issued outside a transaction is lost before the next query (fails closed to zero rows) or could read a lingering GUC; binding via `set_config(...,true)` inside one interactive transaction guarantees the GUC and the query share a connection and transaction. **String-concatenated `SET LOCAL` is forbidden (SQL-injection vector).**
- **D — Postgres RLS (hard backstop).** Every tenant table `ENABLE`/`FORCE ROW LEVEL SECURITY` with `USING/WITH CHECK ("tenantId" = current_setting('app.tenant_id', true))`. Runtime connects as a `NOBYPASSRLS` role; a forgotten where-clause cannot leak.

**Minimized BYPASSRLS.** The global **catalog** (`Training WHERE tenantId IS NULL`) needs **no** bypass — an RLS policy allows reading `tenantId IS NULL` rows for any authenticated role, served under the normal role. The **global timeline** also does not bypass: it sets `app.is_facility='on'` only after `requireAuth` confirms a FACILITY membership with `timeline.view.global`, and a policy permits cross-tenant reads only when that GUC is set, returning **pseudonymized worker handles, not names**. Any residual `db.asFacility()` use is confined to a few named functions (lint-banned elsewhere), restricted to a non-PII column allowlist, and every call writes a PII-aware `AuditLog`.

**Pooling note:** Neon transaction-pooling; isolation GUC is always transaction-local; an integration test asserts isolation **against the pooled endpoint** (not just local Postgres) and asserts fail-closed when the GUC is omitted.

### 5.4 Authentication
Auth.js v5 + Prisma adapter. **Day one:** Credentials (argon2id, peppered, rate-limited with lockout/backoff) + Email magic-link (also invitation onboarding; tokens **single-use, short-TTL, bound to the invited email, rate-limited per email+IP**). **Flag-gated to Phase 4:** per-tenant OIDC/SAML via `TenantIdentityProvider` + verified `CustomerEmailDomain`, JIT provisioning that never auto-grants `COMPANY_ADMIN`.

Session: JWT carrying `userId, email, locale, sessionVersion`, the active `{membershipId, membershipVersion, scopeType, scopeId}`, and a minimal membership list for the switcher. **Role, status, and capabilities are re-loaded server-side from the current membership on every request** (the JWT identifies *who* and *which membership*, not *what they may do*), so a downgrade/suspension takes effect within one ~60s Redis-cached check — which runs on **every** tenant-data request, not only "sensitive" ones. SUSPEND/REVOKE/deactivate proactively bump the version and bust the cache. `mfaSecretEnc` is **encrypted at rest** (KMS KEK). MFA (TOTP) mandatory for `FACILITY_ADMIN` and any holder of cross-tenant / `audit.read` / `gdpr.*` capabilities; recommended for `COMPANY_ADMIN`/`HR_MANAGER` (PII handlers) — final scope is Open Q.

### 5.5 GDPR posture
- **Residency:** Vercel `fra1`; Neon EU (Frankfurt); object storage EU (R2 / S3 `eu-central-1`); Sentry EU; Resend EU. DPAs + SCCs + a Transfer Impact Assessment on file for each US-parent processor; sub-processor list maintained (Art.30). Open Q escalated: accept US-parent + EU-residency + SCCs, or move to the documented fully-EU self-host exit path.
- **Lawful basis & consent (not a boolean).** Each category carries `lawfulBasis`; mandatory/regulatory training is typically `LEGAL_OBLIGATION` (erasure rights differ — these cannot be erased on request). Where consent applies, a full `ConsentRecord` (purpose, textVersion, grantedAt/By, withdrawnAt) is stored. **National ID collection is opt-in and minimized** (likely unnecessary for hours tracking); any Art.9 special-category data needs a documented Art.9 condition. Flagged to the client's DPO.
- **PII concentration & masking:** PII lives on `Worker`; a shared serializer masks sensitive fields for roles lacking full `worker.record.read`. Facility's *default* view of customer data is aggregated/pseudonymized; raw PII requires a **time-boxed, reason-logged, customer-granted, audited** support/impersonation action (read-only by default).
- **Files:** PII attachments are **streamed through an authenticated route** that re-resolves `Attachment.tenantId` against the active scope and audits the read — **never via a presigned GET handed to the browser**. Keys are random; bucket has no public read. Anonymization's object-storage deletion is verified-complete and audited.
- **Audit & erasure.** `AuditLog` and `CompletionRecord` are non-deletable; **audit rows store IDs and field names only, never raw PII**, so immutability does not defeat erasure. `anonymizeWorker()` (one guarded transaction) covers an **exhaustive PII field inventory** — `Worker` PII, the linked `User.email/passwordHash` (via Membership), `Enrollment.notes/externalTrainingTitle/externalProviderName`, `StatusTransition.reason`, `CompletionRecord.gradeOrScore`, attachments where `containsPii`, and `IngestedRecord.rawPayload` — repoints completions/enrollments to a per-tenant `ANONYMIZED` placeholder so totals stay numerically correct, and is itself audited (actor+timestamp, never the erased values). A CI schema-scan fails if a new free-text column is unclassified. `legalHold` blocks erasure; `processingRestricted` supports Art.18; retention clock = `completedOn + category.retentionYears` (nightly eligibility job). DSAR export is a complete machine-readable (JSON) + human-readable bundle covering the same PII inventory, tested against it.
- **Observability PII:** Sentry `beforeSend` strips bodies/emails/headers/query strings, `sendDefaultPii=false`; Pino logs carry actor/request IDs only.

---

## 6. Training-source abstraction & future API-integration design

### 6.1 One normalized `Training` table, two orthogonal facts
All trainings live in one table; `TrainingSource.sourceType` says *who runs it*, `Training.provenance` says *how it arrived*. Every consumer queries one shape. Table-per-source rejected (polymorphic FKs, UNION-everywhere, broken timeline).

### 6.2 Connector port + registry — **two ingestion contracts**
Catalog ingestion and **completion ingestion** are first-class (the latter is the literal future of Requirement 4 — "pull other providers' training data instead of HR entering by hand").

```ts
export interface NormalizedTraining {
  externalRef: string; title: string; description?: string;
  modality: 'IN_PERSON'|'ONLINE_LIVE'|'ONLINE_SELF_PACED'|'BLENDED';
  language: string; totalMinutes: number; price?: { amount: number; currency: string };
  certification?: string; externalUrl?: string; startsAt?: string; endsAt?: string;
  translations?: { locale: string; title: string; description?: string }[]; raw: unknown;
}
export interface NormalizedCompletion {                    // NEW — Req 4 future state
  externalRef: string;                                     // unique within source
  worker: { employeeNo?: string; email?: string; externalWorkerRef?: string }; // matched to (tenant, worker)
  trainingExternalRef?: string; externalTrainingTitle: string; externalProviderName: string;
  actualMinutes: number; completedOn: string;
  completionStatus: 'PASSED'|'FAILED'|'ATTENDED_NO_ASSESSMENT'|'PARTIAL';
  verification: 'SELF_REPORTED'|'EVIDENCE_PROVIDED'|'VERIFIED';
  certificate?: { number?: string; validUntil?: string; fileRef?: string }; raw: unknown;
}
export interface ConnectorCapabilities { incremental: boolean; webhook: boolean; pushEnrollment: boolean; completions: boolean; }
export interface ProviderConnector {
  readonly code: string; readonly contractVersion: string;
  capabilities(): ConnectorCapabilities;
  healthCheck(cfg): Promise<{ ok: boolean; detail?: string }>;
  fetchCatalog(cfg, cursor?): Promise<{ records: NormalizedTraining[]; nextCursor?: unknown }>;
  fetchChanges?(cfg, since): Promise<{ records: NormalizedTraining[]; deletions: string[]; nextCursor?: unknown }>; // incremental + tombstones
  fetchCompletions?(cfg, cursor?): Promise<{ records: NormalizedCompletion[]; nextCursor?: unknown }>;               // Req 4 future
  handleWebhook?(cfg, signedPayload): Promise<void>;       // signature-verified inbound
  fetchTraining?(cfg, externalRef): Promise<NormalizedTraining>;
  pushEnrollment?(cfg, e): Promise<{ externalEnrollmentId: string }>;   // bidirectional (Phase 4)
}
export const ConnectorRegistry = new Map<string, ProviderConnector>();
```

**Manual entry IS a connector.** The `manual` connector's fetch returns nothing; manual forms call the same `normalizeAndStage(sourceId, recordKind, payload)` helper the pull pipeline uses. Typed and pulled data converge on **one write path**.

**Inbound vs outbound auth, separated.** `TrainingSource.ingestApiKeyHash` authenticates a supplier **pushing** to `POST /api/v1/ingest/:sourceId` (key scoped to exactly that source; payload lands in `IngestedRecord`, never `Training`). `authType + credentialRef` (EU KMS-backed) are for the facility **pulling**. `syncDirection` records which a source uses.

### 6.3 Two-phase, idempotent ingestion pipeline
Connectors never write `Training`/`CompletionRecord` directly — they stage raw+normalized to immutable, content-hashed, **version-stamped** `IngestedRecord` (`recordKind ∈ TRAINING|COMPLETION`); a matcher/upserter promotes them. Jobs (Vercel Cron handlers MVP → pg-boss Phase 3):
1. `source.sync.schedule` → `source.sync(sourceId)` (`singletonKey=sourceId`).
2. `source.sync` → open `IngestRun`; `fetchChanges` if incremental else `fetchCatalog`; (and `fetchCompletions` when enabled); stage; persist cursor; close.
3. `record.stage` → content hash; insert `IngestedRecord` (unique `(sourceId, externalRef, contentHash)` ⇒ duplicate = SKIP).
4. `record.match` → exact `(sourceId, externalRef)`; else fuzzy **claim** **restricted to the SAME `sourceId` and EXCLUDING any tenant-private (`tenantId NOT NULL`) Training** (an API import must never claim an HR-private OTHER_FACILITY row); score ≥0.85 auto-claim, 0.5–0.85 → `MatchCandidate`, <0.5 → new. **Completion** records match the worker by `(tenant, employeeNo|email)`; ambiguous → `MatchCandidate(workerId)`.
5. `record.upsert` → deterministic 3-source merge `incoming(api) + manualOverrides + fieldPrecedence`, **evaluated on every upsert** (precedence/override state is folded into `contentHash` so a precedence flip forces re-evaluation; `precedence='manual'` stages the API value as a one-click conflict, never a freeze). On claim: **keep `Training.id`**, set `externalRef`, snapshot priors into typed `manualOverrides{schemaVersion}`.
6. `source.reconcile` → soft-retire (`retiredAt`) only for **full-refresh** sources (`capabilities().incremental === false`); incremental sources retire only via the `deletions` tombstone channel (so a delta sync never wrongly retires everything).

Idempotency at run (`singletonKey`), stage (content-hash unique), and upsert (hash short-circuit). `recordKind` keeps catalog and completion replay distinct; `normalizedSchemaVersion` keeps append-only replay honest as the contract evolves.

### 6.4 Manual → API "claim" with no data loss
Because enrollments/completions/hours FK to `Training.id` and the claim keeps that id, upgrade is invisible to them. **Source/category facets are derived in views (not denormalized on sessions/enrollments)**, so a claim that changes `Training.sourceId` cannot leave stale colors/filters. `CompletionRecord.sourceTypeSnapshot` is a deliberate point-in-time snapshot and is **not** rewritten. The claim is reversible.

### 6.5 Bidirectional sync to the facility's existing platform
Registered as `TrainingSource{ kind: FACILITY_PLATFORM, connectorCode:'facility-platform' }` behind an **anti-corruption layer** (`/integrations/connectors/facility-platform/acl.ts`). Phase 4: read-only catalog pull first. Two-way (optional) uses the **outbound mirror fields** on `Enrollment` (`mirroredExternalId, mirrorState, mirrorVersion, lastMirroredHash`) so a pushed enrollment is recorded and not re-pushed; **echo suppression** skips inbound records whose `externalRef` we produced; `systemOfRecord` + `syncDirection` make conflict resolution data-driven (Open Q: is the platform the system of record for enrollments?). Swapping their API touches one file.

### 6.6 Cross-tenant external identity
Tenant-private external refs are keyed `(tenantId, sourceId, externalRef)`; completion idempotency is `(tenantId, externalRef)`. The same external person/completion legitimately maps to multiple rows when a contractor works for multiple customers — completion ingestion resolves the external person to a `(tenant, worker)` pair before staging, so there is no collision and no cross-tenant contamination.

---

## 7. Hours & completion tracking + reporting

### 7.1 Unit of truth & lifecycle
`Enrollment` is mutable workflow; `CompletionRecord` is the immutable fact. Hours in **integer minutes**. Reports read **only** completions.

| From | To | Side effect |
|---|---|---|
| ASSIGNED | IN_PROGRESS | set `startedAt` |
| ASSIGNED | CANCELLED/NO_SHOW | terminal (0 counted) |
| IN_PROGRESS | COMPLETED | create `CompletionRecord` (snapshot categories, `actualMinutes`, `completedOn`), optional `Certificate` |
| IN_PROGRESS | CANCELLED/NO_SHOW | terminal |
| COMPLETED | IN_PROGRESS (reopen) | supersede in same txn, `reopened=true`; requires `completion.reopen` + reason |

**Record-completed-training fast-path (generalized to ANY source).** HR can record a completion against **any** training — internal, supplier, or other-facility — including catalog trainings with `requiresSession=true` completed off-platform: create `Enrollment(sessionId NULL)` + immediate `CompletionRecord` in one transaction. This closes the Req 5 gap for catalog-origin trainings finished elsewhere. **Bulk completion** marks a whole cohort roster (status + `actualMinutes` + `completedOn`, optional shared certificate) in one batch transaction — symmetric with bulk assign. **Partial** = `completionStatus=PARTIAL` with `actualMinutes < plannedMinutes`.

### 7.2 Source-agnostic completions
Each completion carries `sourceTypeSnapshot`, a nullable `trainingId`, and free-text fallbacks. All sources roll up identically; `verification` segments (not excludes) self-reported vs evidence-backed hours.

### 7.3 Categories — live N:N + snapshot
`TrainingCategoryLink` is the **single source of truth** (free-text category dropped); `Training.primaryCategoryId` designates the one used by single-value facets (timeline color, compliance). At completion the full resolved set is copied to `CompletionCategory` (+ `isMandatorySnapshot`) so re-categorizing later cannot rewrite past compliance.

### 7.4 Aggregation via live views (no drifting counters)
- `v_worker_hours(workerId, totalMinutes, mandatoryMinutes, optionalMinutes, completionsCount)`
- `v_company_hours(tenantId, totalMinutes, mandatoryMinutes, optionalMinutes, workerCount)`
- `v_certification_status(...)` → VALID / EXPIRING_SOON (within `expiryLeadDays`) / EXPIRED
- `v_compliance_gaps(tenantId, workerId, categoryId)` → workers missing a current VALID cert for an applicable mandatory category

Hours total = `SUM(actualMinutes)` over `CompletionRecord` **`WHERE supersededById IS NULL AND completionStatus IN ('PASSED','ATTENDED_NO_ASSESSMENT','PARTIAL')`** (no `deletedAt` — completions are append-only; corrections supersede), backed by `(tenantId, workerId)`. `actualMinutes` is authoritative. The materialized cube `mv_worker_period_category_hours` is **deferred to Phase 5** and added only if live-view latency demands it (with "as of" labels + live drill-downs).

### 7.5 Reporting & exports (first-class)
- **CSV** (server-streamed, UTF-8 BOM, locale-aware): per-worker hours, per-period, per-category, raw completions.
- **PDF** (server-rendered, localized; **Phase 1b**): certificate, per-worker transcript, company compliance report.
- **Filters** on every report: date range, category (+mandatory-only), source, worker/department, verification status.
- **Endpoints** (`/api/v1`, tenant+role+object-level enforced): `GET /reports/worker-hours`, `/company-hours`, `/completions.csv`, `/certifications`; PII files streamed through authenticated, audited routes. Large async exports → Phase 3 (pg-boss, email-a-link).

---

## 8. Information architecture & screens per role + key flows

### 8.1 Role-specific shells
Server-chosen per active membership: **Admin console** (`/admin/*`), **Customer/HR workspace** (`/app/*`), **Worker portal** (`/app/me/*`, ships Phase 1b/2 per the worker-login decision). Topbar role/tenant switcher when multi-membership. Locale-prefixed routes (`localePrefix:'as-needed'`).

### 8.2 Site map
```
/[locale]
├─ /login · /accept-invite
├─ /admin                    FACILITY_ADMIN | FACILITY_STAFF
│  ├─ /                       dashboard (offerings, suppliers, tenants, ingest health)
│  ├─ /catalog · /catalog/new · /catalog/[id]   manage offerings (+ sessions, pricing, i18n)
│  ├─ /suppliers · /suppliers/[id] · /categories · /tenants · /tenants/[id]
│  ├─ /integrations · /integrations/[connectorId]   connectors, mappings, sync logs, conflicts
│  ├─ /timeline              GLOBAL timeline   └─ /settings (config, RBAC, audit, impersonation)
├─ /app                      COMPANY_ADMIN | HR_MANAGER
│  ├─ /                       HR dashboard (org hours KPI, upcoming, expiry alerts, onboarding checklist)
│  ├─ /catalog · /catalog/[id] · /catalog/[id]/assign
│  ├─ /workers · /workers/new · /workers/import(1b) · /workers/[id]
│  ├─ /trainings · /trainings/record-completed · /trainings/[id]  (assigned + recorded; roster + bulk complete)
│  ├─ /timeline · /reports · /settings (HR users, locale, consent texts, departments)
└─ /app/me                   WORKER (Phase 1b/2)  ├─ / (My Trainings) · /hours · /profile
```

### 8.3 Screen inventory (~36)
- **Facility Admin (10):** Dashboard; Manage Offerings (source badges); Create/Edit Offering wizard (pt/en tabs → Internal vs Supplier → category/modality/duration → sessions → pricing/attachments → publish); Suppliers; Categories; Tenants; Tenant detail; **Integrations/Connectors** (config, mapping, logs, conflict resolution); Global Timeline; Settings/Audit/Roles/Impersonation.
- **HR (13):** Dashboard (with empty-states + onboarding checklist); **Catalog Browse** (faceted, search-first — §8.4); Training Detail; Assign Workers; Workers list (bulk-select → assign); Add/Edit Worker (consent/lawful-basis capture); Import Workers (Phase 1b); Worker Profile (assignments/completed/hours/personal timeline; transcript); Trainings (tabs All/Assigned/Recorded/Completed); **Record Completed Training** (single fast form, any source); Training/Cohort Detail (roster, **bulk attendance + bulk complete**); Reports/Exports; Tenant Settings.
- **Worker (3, Phase 1b/2):** My Trainings; My Hours; My Profile (read-only + rectification request + GDPR data request).

### 8.4 Catalog browse (the "easy, clear" requirement)
Search-first three-zone layout: top search + ⌘K palette; sticky left rail of **URL-encoded facets** (Type, Supplier, Category, Modality, Language, Duration band, Certification, Availability) read server-side from `searchParams` (shareable/back-safe); responsive **card grid** (supplier avatar + source badge, 2-line title, category badges, duration/modality/language/next-session/price). Mobile collapses facets into a `Sheet`. Detail: hero + Assign CTA, tabs (Overview/Modules/Sessions/Provider/Practical), sticky summary; missing-translation fallback shows source language with a badge. Query: `WHERE status='PUBLISHED' AND retiredAt IS NULL` and either `tenantId IS NULL` (ALL_PUBLISHED) **or** joined to `CatalogEntitlement` (ENTITLED_SUBSET) per `Tenant.catalogMode`.

### 8.5 Key flows
1. **Browse → detail** (URL-driven; back restores state).
2. **Assign workers** (detail or Workers bulk → Sheet: choose session, searchable multiselect with hours/conflict hints; **seat/capacity validated only when a session exists** — N/A for self-paced/session-less; partial unique index prevents duplicate session-less enrollment → `Enrollment` ASSIGNED → toast **+ assignment-confirmation email**). **Req 6.**
3. **Record completed training** (single fast form: provider combobox create-on-type, course title, **hours in human form `12,5h`/`12h30` → minutes**, date, certificate drag-drop, dedup hint; source/Training/Enrollment/CompletionRecord created backstage atomically; "recently used providers/courses" affordance). Works for any source. **Req 4.**
4. **Bulk cohort completion** (roster select-all → status/minutes/date in one batch). **Req 5/6.**
5. **Worker views own hours** (Phase 1b/2; self-scoped).
6. **Admin creates training & assigns supplier** (wizard; ingested offerings land in the same list with a source badge). **Req 2a.**
7. **Timeline** (tenant + global). **Req 7.**

### 8.6 Bilingual UX
Locale switch preserves all `searchParams`. UI strings via next-intl ICU; **domain content** in DB `*Translation` tables (pt-PT fallback surfaced to admins as "missing en"). Shared `formatHours()` (minutes → `12,5 h`/`12.5 h`, long form `12 h 30 min`), `format.dateTime`, `Intl.NumberFormat` (EUR). Layouts tolerate ~30% longer pt strings.

---

## 9. Timeline feature design

### 9.1 What a timeline item is — now including unscheduled catalog rows
A `timeline_item` view projects **three** kinds (resolving the literal "every training of any supplier"):

| Kind | Backing | When | Time fields |
|---|---|---|---|
| `SESSION` | `TrainingSession` | scheduled run | `startsAt/endsAt` |
| `ASSIGNMENT` | `Enrollment` WHERE `sessionId IS NULL` | self-paced / recorded | `plannedStartAt/End`, else `completedOn` (point) |
| `UNSCHEDULED` | published `Training` with no session and no enrollment | catalog row with no date yet | rendered in an "Unscheduled" lane keyed on `createdAt/lastSeenAt` |

No double-counting: an enrollment with a session is shown by its SESSION (worker is a participant), not its own row. **Source/category facets are derived by joining `Training`/`TrainingSource`** (not denormalized), so claims never stale them. Whether `UNSCHEDULED` shows by default is **Open Q1**; default = on, toggleable.

```sql
CREATE VIEW timeline_item AS
SELECT s.id, 'SESSION' kind, s."trainingId" training_id, ts."sourceType", ts.id source_id,
       tc.category_id, NULL company_id, NULL worker_id, s."startsAt", s."endsAt",
       s.status::text, s.capacity, (SELECT count(*) FROM "Enrollment" e WHERE e."sessionId"=s.id) enrolled
FROM "TrainingSession" s JOIN "Training" t ON t.id=s."trainingId" JOIN "TrainingSource" ts ON ts.id=t."sourceId"
LEFT JOIN LATERAL (SELECT "primaryCategoryId" category_id FROM "Training" WHERE id=t.id) tc ON true
UNION ALL
SELECT e.id, 'ASSIGNMENT', e."trainingId", ts."sourceType", ts.id, t."primaryCategoryId", e."tenantId", e."workerId",
       COALESCE(e."plannedStartAt", c."completedOn"), COALESCE(e."plannedEndAt", c."completedOn"), e.status::text, NULL, 1
FROM "Enrollment" e JOIN "Training" t ON t.id=e."trainingId" JOIN "TrainingSource" ts ON ts.id=t."sourceId"
LEFT JOIN "CompletionRecord" c ON c."enrollmentId"=e.id AND c."supersededById" IS NULL
WHERE e."sessionId" IS NULL
UNION ALL
SELECT t.id, 'UNSCHEDULED', t.id, ts."sourceType", ts.id, t."primaryCategoryId", t."tenantId", NULL,
       t."createdAt", t."createdAt", 'PUBLISHED', NULL, 0
FROM "Training" t JOIN "TrainingSource" ts ON ts.id=t."sourceId"
WHERE t.status='PUBLISHED' AND t."retiredAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "TrainingSession" s WHERE s."trainingId"=t.id)
  AND NOT EXISTS (SELECT 1 FROM "Enrollment" e WHERE e."trainingId"=t.id);
```

### 9.2 Views, one dataset — phased
**MVP: List/agenda** (custom virtualized table via TanStack Virtual + keyset pagination) — same `timeline_item` view, **no third-party license**, so the core requirement ships early. **Phase 2: Calendar** (FullCalendar) and **Gantt/resource-timeline** added **after the license decision** (FullCalendar Scheduler needs a commercial license; OSS fallback = vis-timeline / CSS-grid Gantt). A shared `<TimelineToolbar>` preserves filters/date window across views.

### 9.3 Filtering, color, queries
Faceted, server-applied, AND-ed within role scope; filter state in URL (Zod). **MVP color = single axis (source hue) + a status icon**; the richer two-axis treatment (hatching/desaturation) is Phase 2. Always icon/text paired (WCAG); supplier identity is a text chip. Query = half-open overlap `startsAt < windowEnd AND endsAt > windowStart` on GiST `tstzrange` indexes + btree `(startsAt, endsAt)`. Role scoping injected server-side (`buildTimelineScope`: WORKER→self, HR→tenant, ADMIN→all). Calendar/Gantt bounded by window (cap ~2,000 → "narrow filters" banner); List keyset-paginated, virtualized. `timestamptz` storage, render `Europe/Lisbon`/user pref. **Retired-source treatment:** `retiredAt` sessions render with a "retired" style; retired trainings are excluded from `UNSCHEDULED` and from assign pickers, but existing enrollments remain completable. **Req 7.**

---

## 10. Tech stack, structure, i18n, infra, testing

### 10.1 Locked stack
Next.js 15 (App Router, React 19, `strict`+`noUncheckedIndexedAccess`); PostgreSQL 16 (Neon EU, pooled via `@prisma/adapter-neon`, direct for migrations); Prisma 6; Auth.js v5 + Prisma adapter; Zod; next-intl; Tailwind v4 + shadcn/ui; react-hook-form; TanStack Table/Virtual (timeline MVP) + FullCalendar (Phase 2); Vercel Cron (MVP) → pg-boss (Phase 3); R2/S3 `eu-central-1`; **EU KMS-backed secret store** for connector/MFA secrets; Resend EU/SMTP; Vitest + Testcontainers + Playwright; ESLint flat + `eslint-plugin-boundaries`; Sentry EU (PII-scrubbed) + Pino; pnpm.

### 10.2 API strategy
1. **Server Actions** — first-party UI mutations (thin; call services).
2. **Versioned Route Handlers `/api/v1/*`** — integration/public surface (ingest push, webhooks, file streaming, read/reports API). Mandatory for integration-readiness (external systems can't consume tRPC — tRPC rejected).
3. **Shared service layer `src/server/services/*`** — ALL business logic + authz (incl. object-level checks); both transports delegate, enforced by a `boundaries` lint rule.

### 10.3 Folder structure (abridged)
```
src/
├─ app/[locale]/{(auth),(customer:/app),(facility:/admin),(worker:/app/me)}/...
│  └─ api/{auth/[...nextauth], v1/{trainings,ingest/[sourceId],ingest/[sourceId]/webhook,reports/*},
│           internal/jobs/*, files/attachments/[id]}   // PII files streamed, never presigned-to-browser
├─ server/{actions, services (training, assignment, worker, hours, completion, sync/*, gdpr),
│          auth/{config,capabilities,guard(requireAuth),rbac}, db.ts (forTenant/asFacility txn extensions),
│          storage.ts, crypto.ts (KMS envelope)}
├─ lib/{schemas/*, i18n/*, env.ts, utils.ts}
├─ components/{ui, features (CatalogCard, Timeline)}
├─ middleware.ts
prisma/{schema.prisma, migrations/, sql/{rls.sql, indexes.sql, composite_fks.sql}, seed.ts}
messages/{pt-PT.json, en.json} · tests/{unit,integration,e2e} · vercel.json (crons)
```

### 10.4 i18n
next-intl, `locales=['pt-PT','en']`, default pt-PT, `localePrefix:'as-needed'`. UI chrome in `messages/*.json` (ICU plurals); domain content in DB `*Translation` (also fed by API), pt-PT fallback. Shared `formatHours()/formatDateRange()` reused by reports/exports; locale-aware `Link`/`redirect` (raw `next/link` lint-banned).

### 10.5 Infra & validation
Vercel `fra1`; Neon EU (pooled+direct); EU object storage (authenticated streaming for PII, presigned only for non-PII); env validated at boot (`@t3-oss/env-nextjs` + Zod); three environments (local, per-PR preview with Neon branch DBs, prod). Migrations: `migrate dev` locally, `migrate deploy` in CI/release (never `db push` in prod). Sentry EU (scrubbed) + Pino correlation IDs; `/api/internal/health` asserts DB+region. Documented portable EU exit path (Hetzner).

### 10.6 Testing pyramid
- **Unit (Vitest):** services (Prisma mocked) + every Zod schema.
- **Integration (Vitest + Testcontainers):** real Postgres + `migrate deploy` + seed; **tenant-isolation denial tests against the pooled endpoint** (cross-tenant access fails; GUC-omitted reads return zero rows); **composite-FK cross-tenant insert attempts must fail**; idempotent catalog **and completion** ingest; manual→API claim keeps `Training.id` and excludes tenant-private rows; **WORKER reading a colleague's record must 403** (not rely on RLS alone).
- **E2E (Playwright):** the requirement flows in **both locales** (assign+email, record completed any-source, bulk cohort complete, browse, list-timeline renders incl. unscheduled, admin create+publish, API ingest dedup), per-role storageState.
- **CI gate:** typecheck + lint (boundaries) + unit + integration on every PR; e2e + `migrate deploy` on a fresh DB pre-deploy; a test asserts `ROLE_CAPABILITIES` matches §4; the **PII schema-scan** fails on unclassified free-text columns.

---

## 11. Requirements-traceability

| # | Requirement | Where |
|---|---|---|
| 1 | Customers see available trainings & info, supplier or internal | §2, §3.3, §6.1, §8.4, §10.4 |
| 2 | Trainings enter via (a) admins create+assign supplier/internal and (b) future API, coexisting | §6.2 (manual=connector, one write path), §6.3 pipeline, §8.5 Flow 6 + wizard, §3.3 provenance/`(sourceId,externalRef)`, §12 |
| 3 | Catalog easy & clear | §8.1 dedicated shell, §8.4 search-first faceted catalog, §10.4 localized content |
| 4 | HR inputs other facilities' trainings (manual now, **API later — catalog AND completion**) | §3.2 reuse, §6.2 `NormalizedCompletion`+`fetchCompletions`, §6.3 completion matching, §6.6 cross-tenant identity, §7.1/§8.5 Flow 3 generalized, §6.4 claim |
| 5 | Area with workers & completed hours | §3.3 `Worker`/`CompletionRecord` (minutes), §7 views, §8.3 Worker Profile + portal, §7.5 exports |
| 6 | HR assigns workers | §4 `training.assignment.create`, §3.3 `Enrollment` + machine, §8.5 Flow 2 (single/bulk) + Flow 4 (bulk complete), §7.1 |
| 7 | Timeline of **every** training of any supplier | §9 (`timeline_item` incl. `UNSCHEDULED`; list MVP, calendar/Gantt Phase 2), §8.2 |
| — | Integration-ready | §6 connectors/ACL + bidirectional fields, §10.2 `/api/v1` + service layer |
| — | Bilingual pt-PT/en | §10.4, §8.6, DB `*Translation` |
| — | EU/GDPR | §5 (RLS via txn-GUC, composite-FK integrity, residency, audited PII, anonymize-not-delete, consent/lawful-basis, file streaming, Sentry scrub), §7.4 retention |

---

## 12. Phased delivery roadmap

**Phase 0 — Foundations (1 sprint).** Repo, env-validation, Prisma schema + migrations + **RLS via transaction-local GUC + composite FKs** + seed; Auth.js (Credentials + magic-link), Membership, `requireAuth`/`forTenant`/`asFacility` with object-level checks; next-intl scaffolding; shadcn baseline; CI (typecheck/lint/unit/integration with Testcontainers, incl. pooled-endpoint isolation + cross-tenant-FK denial + PII schema-scan); Vercel fra1 + Neon EU + EU bucket + KMS provisioned with DPAs/SCCs; Sentry PII scrubbing. Decides **facility cross-tenant PII default (Open Q)** since masking/RLS is built here. **Ships:** skeleton, login, tenant isolation proven.

**Phase 1a — True MVP (2–3 sprints).** Admin creates/publishes internal & supplier trainings (Flow 6); supplier directory; faceted catalog browse + detail (Flow 1); **manual** worker creation; assign workers single/bulk (Flow 2) **+ assignment-confirmation email**; enrollment lifecycle + completions; **bulk cohort completion** (Flow 4); record-completed-training any-source (Flow 3); HR org hours area + live views; **minimal list/agenda timeline incl. unscheduled** (Flow 7, no license); CSV export; empty-states + company-bootstrap onboarding; audit logging. **Ships Req 1, 2a, 3, 4(manual), 5(HR-facing), 6, 7(list)**, bilingual.

**Phase 1b — Worker self-service & convenience (1–2 sprints).** Worker portal (My Trainings/Hours/Profile) **only if workers log in (Open Q resolved yes)**; worker invitation onboarding + DSAR self-service + rectification request; CSV worker import; server-rendered localized **PDF** (certificate, transcript, compliance). **Completes Req 5 self-view.**

**Phase 2 — Timeline polish + compliance + GDPR ops (2 sprints).** FullCalendar calendar + Gantt (**after license decision**) + two-axis color; categories + mandatory/optional + certificate expiry; compliance/renewals dashboard (`v_certification_status`, `v_compliance_gaps`) + **expiry reminder emails**; DSAR export bundle + anonymize flow hardened. **Ships full Req 7 + compliance reporting.**

**Phase 3 — API ingestion (supplier connectors) (2 sprints).** pg-boss; two-phase pipeline (`IngestRun/IngestedRecord/MatchCandidate`, catalog **and** completion ingestion); first real supplier connector (incremental + tombstones + webhook); conflict-resolution admin UI; manual→API claim/upgrade (source-scoped, tenant-private-excluded); async large exports. **Ships Req 2b + the automatable path for Req 4.**

**Phase 4 — Facility-platform integration & enterprise (2 sprints).** `facility-platform` connector + ACL (read-only pull first, optional two-way `pushEnrollment` via mirror fields); per-tenant OIDC/SAML SSO + domain routing + JIT; supplier self-service portal (`SUPPLIER_PORTAL` wired). **Ships** deep integration + enterprise auth.

**Phase 5+ — Hardening.** Optional materialized cube (only if latency demands), billing/invoicing (price snapshot ready), worker "request a training" workflow, source dedup/merge admin tool, self-hosted EU exit path if required.

---

## 13. Risks & open questions

**Risks (with mitigations):** tenant-isolation correctness — RLS via transaction-local GUC + composite FKs + pooled-endpoint denial tests; Server Actions are endpoints — service-layer authz + `safeParse` + object-level checks, lint-enforced; JWT staleness — short TTL + per-request version check; FullCalendar Scheduler license — list MVP carries no dependency, decision gates Phase 2; pg-boss needs a worker — container/dyno in Phase 3 only; presigned-URL PII leakage — authenticated streaming instead; Sentry PII — `beforeSend` scrub.

**Open questions requiring client/legal input:**
1. **Timeline scope** — does "every training" include unscheduled published catalog rows (default: yes, in an "Unscheduled" lane)? Confirm Gantt resource axis (worker vs supplier) and default-hide CANCELLED.
2. **Facility cross-tenant PII default** (Phase 0 gate) — strictly aggregated/pseudonymized unless customer grants time-boxed support access (recommended), or audited raw access allowed?
3. **Do workers log in?** (Phase 1a/1b gate) — default: data-only in MVP; portal ships Phase 1b only if yes.
4. **Catalog scoping** (Phase 1a gate) — all customers see full catalog (`ALL_PUBLISHED`) or contracted subset (`ENTITLED_SUBSET`, `CatalogEntitlement` ready)?
5. **GDPR retention + lawful basis per category** (PT/EU) — drives `retentionYears`, `lawfulBasis`, `legalHold`, and whether erasure even applies; confirm national-ID collection and any Art.9 data. Defaulted 5y / LEGAL_OBLIGATION.
6. **MFA scope** — privileged only (proposed) or also COMPANY_ADMIN/HR_MANAGER?
7. **Hosting/processors** — accept US-parent + EU-residency + SCCs (Vercel/Neon/R2/Sentry) or fully-EU self-host? Object-storage and email vendors.
8. **Existing-platform API** — REST/SOAP/export with `updatedSince`? Is it the system of record for enrollments; is write-back wanted (mirror fields ready)?
9. **External-completion dedup/identity** — one worker row per tenant (current; multi-tenant worker now supported via Membership); company-private external sources vs ever promoting a frequent provider to global.
10. **Official PT hours format** for certificates/exports (`12,5 h` vs `12 h 30 min`; both supported from minutes) and whether annual hours targets per worker/department drive Progress indicators.
11. **Impersonation policy** — confirm customer-granted, read-only-by-default, reason-logged for all facility impersonation (incl. FACILITY_ADMIN).
12. **SSO timing** — Phase 4, or will an early enterprise customer force it sooner (schema ready either way)?