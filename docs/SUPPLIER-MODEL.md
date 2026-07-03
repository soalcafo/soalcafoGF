# Training Hub — Updated Architecture & Phase 1 Plan (Supplier-Centric Model)

**Status:** Design-ready, implementation-ready. Extends the live foundation (soalcafo-gf.vercel.app). Nothing in the working foundation is redesigned — the tenant RLS GUC mechanism, `app_user` (NOBYPASSRLS), composite-FK discipline, capability RBAC, `requireAuth()`, and PII masking are all **extended, not rewritten**.

**Core thesis:** Supplier isolation is a **strictly narrower second RLS dimension AND-ed under the existing tenant dimension**. HR/facility sessions never set the new GUC and behave exactly as today; supplier sessions set it and are confined. This composes cleanly and fails closed.

> **This revision incorporates the full security review.** Two CRITICAL leaks the earlier draft missed are fixed in the design itself: (1) the **`Attachment` table** (the "Documentos dos colaboradores" screen) had NO supplier scoping and would have leaked every supplier's certificates/attendance files company-wide; (2) the **denormalized `supplierId` write path** was not structurally pinned to the parent training's owner, so a supplier could stamp its own id onto another supplier's training. Both — plus the empty-string-GUC footgun, the `asFacility()` bypass, the cancel-to-retain enrollment attack, the ingestion-table PII gap, and the `requireAuth` `tenantId` prerequisite — are resolved below. Every fix carries a test.

---

## 0. Security Findings Ledger (all incorporated — nothing ignored)

| # | Finding (severity) | Resolution |
|---|---|---|
| F1 | **Attachment has no supplier scoping — cross-supplier PII leak** (CRITICAL) | §2.3 adds `Attachment.supplierId` (trigger-copied from parent `CompletionRecord`); §3.7 scopes its RLS like Enrollment and **drops the `tenantId IS NULL` allowance for supplier sessions**. Test in Phase 1.2. |
| F2 | **Denormalized `Enrollment/CompletionRecord.supplierId` not pinned to parent Training's owner** (CRITICAL) | §3.10 trigger 4e is `SECURITY DEFINER`, **copies (never trusts) and rejects mismatch**; composite FKs added on Enrollment/CompletionRecord. Test in Phase 1.2. |
| F3 | **Empty-string GUC breaks fail-closed** (HIGH) | Every policy predicate uses `nullif(current_setting('app.supplier_id', true), '')`; `forSupplier` throws on empty. §3.1. |
| F4 | **`asFacility()` bypasses the enrolled-only Worker gate for ATEC-as-supplier** (HIGH) | Facility branch changed to `is_facility='on' AND app.supplier_id IS NULL`; `asFacility()` defensively resets `app.supplier_id`; `forSupplier` asserts `is_facility<>'on'`; `requireAuth` refuses facility caps under SUPPLIER scope. §3.2/§3.7/§3.9. |
| F5 | **Enrolled-only EXISTS omits soft-delete/cancelled → cancel-to-retain roster harvest** (HIGH) | Worker EXISTS narrowed to `deletedAt IS NULL AND status NOT IN ('CANCELLED','NO_SHOW')`; partial index added. §3.6. |
| F6 | **`requireAuth` forces `tenantId=null` for SUPPLIER scope; `scopeId` overloaded** (HIGH) | §3.9 sets `tenantId` for CUSTOMER+SUPPLIER, adds distinct `AuthContext.supplierId`, deprecates `scopeId` for data access; lint forbids `forTenant` in supplier paths. Lands in the same PR as supplier memberships. |
| F7 | **Ingestion tables un-RLS'd; `tenantId` nullable; `MatchCandidate/IngestRun/SourceSyncState` have no tenantId** (HIGH) | §7.2 adds NOT-NULL `tenantId`+`supplierId` (backfilled), stamps at run creation via trigger, requires `supplierId = GUC` with **no NULL escape**, then ENABLE/FORCE RLS. Phase 3 build; columns added Phase 1. |
| F8 | **`IngestedRecord` dedup unique key not tenant/supplier-scoped** (HIGH) | §7.3 changes the Prisma `@@unique` to `[tenantId, supplierId, sourceId, externalRef, contentHash]`. |
| F9 | **Suppliers can self-enroll ARBITRARY workers to unlock PII** (MEDIUM) | Open Decision #4 (HR-mediated vs self-serve); interim: audit every supplier enrollment + no supplier-facing endpoint returns not-yet-enrolled workerIds; alert on enroll/cancel churn. §4/§10. |
| F10 | **ConsentRecord over-exposed (prose-only fix)** (MEDIUM) | §3.8 ships the ConsentRecord supplier policy in SQL (same EXISTS-with-active-filter as Worker). |
| F11 | **Child tables (Certificate/StatusTransition/CompletionCategory) inherit isolation transitively but undocumented/brittle** (MEDIUM) | §3.11 documents the transitive inheritance, **denormalizes `supplierId` onto Certificate** (explicit supplier deliverable) and scopes it directly, and adds a CI guard forbidding `SECURITY DEFINER`/`row_security=off` over these tables. |
| F12 | **§3.6 note "Enrollment RLS not re-applied in subquery" is factually inverted** (MEDIUM) | §3.6 note corrected: Enrollment RLS **is** applied in the subquery; safe because both filter on the same `app.supplier_id`; regression test added. |
| F13 | **TrainingSession.supplierId denormalized, no FK, trigger-only** (MEDIUM) | §3.5/§3.10: trigger 4d is authoritative (copy, not trust); a `NOT VALID` CHECK asserts equality to parent; CI asserts all triggers exist after `security.sql`. |
| F14 | **SUPPLIER_PORTAL live caps too broad (`catalog.training.manage`)** (MEDIUM) | §4 replaces the grant set in the SAME PR as supplier memberships; CI invariants forbid `catalog.training.manage`/`worker.manage`/`hours.read.tenant`. No SUPPLIER membership enabled until this lands. |
| F15 | **CSV/search endpoints not bound to `forSupplier`** (MEDIUM) | §6 + §3.9 ESLint rule forbids `forTenant`/`asFacility`/raw prisma in `/portal` routes; export handler derives scope from `requireAuth()` SUPPLIER context. |
| F16 | **Two separate `set_config` calls; NULL-supplier_id = "see all suppliers" is a leak-shaped default** (MEDIUM) | §3.1 sets a `app.session_kind='supplier'` discriminator in the SAME batch; supplier policy branches require the discriminator so a supplier session missing `app.supplier_id` fails CLOSED, not open. |
| F17 | **Inbound-push `POST /api/v1/ingest/:sourceId` may validate key separately from sourceId** (MEDIUM) | §7.4 authenticates atomically (`WHERE id=:sourceId AND ingestApiKeyHash=:hash`); coarse per-source rate limit de-deferred. |
| F18 | **Worker self-visibility relies on app-level filter, not RLS; dead `app.worker_id` GUC** (LOW) | §3.12 wires `app.worker_id` into the Worker policy as defense-in-depth; documents the reliance. |
| F19 | **Legacy `tenantId`-NULL SUPPLIER memberships would break the constraint swap** (LOW) | §8 runs a LIVE audit query before the swap; companion CHECK makes company-less supplier rows impossible. |

---

## 1. Updated Actor / Role Model

```
Vendor super-admin (ATEC)  ──── FACILITY scope (tenantId NULL, global) ────┐
   onboards companies, catalog, connectors, audit, GDPR execution         │
                                                                          │  asFacility()
Company / Tenant (isolated; never see each other — existing tenant RLS)   │  (resets app.supplier_id)
   ├─ HR / Company-admin ──── CUSTOMER scope ──── forTenant()             │
   │     COMPANY_ADMIN | HR_MANAGER: full staff, creates supplier logins, │
   │     sees ALL suppliers' rows in-tenant (no supplier GUC set)         │
   ├─ Suppliers (per-company logins) ── SUPPLIER scope ── forSupplier()   │
   │     SUPPLIER_PORTAL: own offers/trainings/sessions/records;          │
   │     sees ONLY its own enrolled workers (GDPR)                        │
   └─ Workers ──── CUSTOMER scope (WORKER) ──── forWorker()               │
         self-view only                                                   ┘

ATEC-as-supplier = an ordinary Supplier row (isAtec=true) inside a company
                   + a SUPPLIER_PORTAL membership for an ATEC user.
                   NEVER merged with the FACILITY membership; asFacility() is
                   for VENDOR reads only and cannot be reached from a supplier session.
```

| Scope | Role (enum, unchanged) | UI label pt-PT / en | Who |
|---|---|---|---|
| FACILITY | `FACILITY_ADMIN` | Administrador ATEC / Vendor super-admin | ATEC-as-vendor: onboards companies, first HR, catalog, connectors, audit, GDPR, cross-tenant timeline. |
| FACILITY | `FACILITY_STAFF` | Operações ATEC / Vendor staff | ATEC support/operations; no global config/audit/PII. |
| CUSTOMER | `COMPANY_ADMIN` | Administrador da empresa / Company admin | Account owner: settings/billing, manages HR users, **creates supplier accounts**, sees all suppliers, GDPR. |
| CUSTOMER | `HR_MANAGER` | Gestor de RH / HR manager | Day-to-day HR: workers, imports, assignments, completions, **creates supplier accounts**, sees all suppliers. |
| CUSTOMER | `WORKER` | Colaborador / Worker | Self-view only. |
| SUPPLIER | `SUPPLIER_PORTAL` | Fornecedor / Supplier | Per-company supplier: manages OWN offers/trainings/sessions/records; sees ONLY its own enrolled workers. |

**Enum name (decision):** Keep `SUPPLIER_PORTAL` (zero-migration; keeps the CI six-role assertion intact). "Supplier" is a UI/i18n alias only.

**One human, many companies:** A supplier person across N companies holds N `SUPPLIER` memberships (one per `(tenant, supplier)` pair), toggled via the existing scope switcher — mirrors the multi-tenant WORKER pattern. `activeMembershipId` in the JWT determines capabilities per request; no ambient escalation. An ATEC user may hold both a FACILITY and a SUPPLIER membership; **they never merge, and a SUPPLIER-active session cannot reach facility powers** (F4).

---

## 2. Data-Model Deltas (Prisma Sketch)

All deltas are **additive**. The only existing constraint that changes is `chk_membership_scope_role`.

### 2.1 New `Supplier` entity (per-company; NEVER cross-tenant)

```prisma
model Supplier {
  id             String   @id @default(cuid())
  tenantId       String                        // per-company; suppliers NEVER cross tenants
  name           String
  normalizedName String                        // idempotent find-or-create
  slug           String
  legalName      String?
  vatNumber      String?
  contactEmail   String?
  contactPhone   String?
  website        String?
  isAtec         Boolean  @default(false)      // ATEC-as-supplier marker inside a company
  status         String   @default("ACTIVE")   // ACTIVE | SUSPENDED

  tenant       Tenant           @relation(fields: [tenantId], references: [id])
  memberships  Membership[]     @relation("SupplierMemberships")
  sources      TrainingSource[]                // one supplier may have N upstream platforms
  trainings    Training[]
  enrollments  Enrollment[]

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@unique([id, tenantId])                      // composite-FK target (same-tenant guarantee)
  @@unique([tenantId, slug])
  @@index([tenantId, status])
  // SQL partial UNIQUE: (tenantId, normalizedName) WHERE deletedAt IS NULL — idempotent HR create
}
// Tenant gains:  suppliers Supplier[]
```

**Connector cardinality (resolved):** Connector config lives on the supplier-scoped `TrainingSource` row (§7), **not** a 1:1 `Supplier.linkedSourceId`. A supplier with two upstream platforms gets two supplier-scoped source rows.

### 2.2 Membership re-scope (SUPPLIER carries `tenantId` + `supplierId`)

```prisma
model Membership {
  // ...unchanged fields (userId, scopeType, role, status, workerId, ...)...
  tenantId   String?
  supplierId String?

  user     User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tenant   Tenant?   @relation(fields: [tenantId], references: [id])
  supplier Supplier? @relation("SupplierMemberships",
                                fields: [supplierId, tenantId],
                                references: [id, tenantId])       // composite FK pins tenant

  @@unique([userId, scopeType, tenantId, supplierId, role])
  @@index([tenantId, role, status])
  @@index([supplierId, status])                                   // fast supplier-login lookup
  @@index([userId, status])
}
```

The composite FK `(supplierId, tenantId) → Supplier(id, tenantId)` makes cross-tenant misattribution structurally impossible — a supplier login resolves to exactly one `(tenant, supplier)` pair, which `requireAuth` uses to set both GUCs.

> `getMembershipById`/`getActiveMembershipsForUser` (lib/db/auth.ts) already select `supplierId` and `tenantId` — no query change needed there; only `requireAuth`'s mapping changes (§3.9).

### 2.3 `supplierId` on catalog / workflow / attachment tables

```prisma
// TrainingSource — a tenant-private source owned by a per-company supplier
supplierId String?
supplier   Supplier? @relation(fields: [supplierId, tenantId], references: [id, tenantId])
@@index([tenantId, supplierId, syncEnabled])

// Training — one training belongs to at most one supplier within one company
supplierId String?          // NULL = global catalog (tenantId NULL) OR HR in-house
supplier   Supplier? @relation(fields: [supplierId, tenantId], references: [id, tenantId])
@@index([tenantId, supplierId, status])
shortCode  String?          // "Sigla" fallback when session has none

// TrainingSession — ownership inherited from Training; DENORMALIZED for RLS speed
supplierId    String?       // MUST equal parent Training.supplierId (trigger 4d, + NOT VALID CHECK)
supplier      Supplier? @relation(fields: [supplierId, tenantId], references: [id, tenantId]) // F13: FK added
sessionCode   String?       // "Sigla" (e.g. "724")
scheduleType  ScheduleType  @default(WORKING_HOURS)   // "Horário: Laboral"
atClientPremises Boolean    @default(false)           // "Nas instalações do cliente"
@@index([supplierId, startsAt])

// Enrollment — DENORMALIZED supplier owner (drives Worker visibility)
supplierId String?
supplier   Supplier? @relation(fields: [supplierId, tenantId], references: [id, tenantId])
@@index([supplierId, workerId, tenantId, status])              // F5: status trailing for the active filter
// partial index: (supplierId, workerId, tenantId) WHERE deletedAt IS NULL AND status NOT IN ('CANCELLED','NO_SHOW')

// CompletionRecord — same denormalization
supplierId String?
supplier   Supplier? @relation(fields: [supplierId, tenantId], references: [id, tenantId])  // F2: composite FK
@@index([tenantId, supplierId])

// Attachment (F1) — DENORMALIZED supplier owner, copied from parent CompletionRecord
supplierId String?          // trigger 4f copies from CompletionRecord.supplierId
@@index([tenantId, supplierId])

// Certificate (F11) — explicit supplier deliverable, scoped directly
supplierId String?          // trigger copies from parent CompletionRecord.supplierId
@@index([supplierId])

enum ScheduleType { WORKING_HOURS AFTER_HOURS MIXED }
```

**Denormalize onto Enrollment/CompletionRecord (resolved):** the Worker-visibility RLS subquery runs on every supplier Worker read; a denormalized `Enrollment.supplierId` makes it a single indexed lookup instead of an Enrollment→Training join inside the policy. Trigger 4e (§3.10) copies `supplierId` from the parent Training on write and **rejects a mismatch**, so the column can never drift or be forged.

- Composite FKs `(supplierId, tenantId) → Supplier(id, tenantId)` on Training / TrainingSource / TrainingSession / Enrollment / CompletionRecord guarantee same-tenant ownership (TrainingSession FK added per F13).
- **Nullable semantics:** `supplierId = NULL` means "not owned by a specific supplier" — a global-catalog row (`tenantId NULL`) or an HR in-house training. Because `supplierId = <GUC>` is FALSE for NULL rows, HR in-house and global-catalog rows are **correctly hidden from supplier sessions** on the tenant-private branch.

### 2.4 CHECK constraint change (the one existing constraint that MUST change)

```sql
-- F19: assert no legacy rows FIRST — run in the LIVE db, not just CI.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Membership" WHERE "scopeType"='SUPPLIER')
  THEN RAISE EXCEPTION 'backfill supplier memberships to (tenantId, supplierId) first'; END IF;
END $$;

ALTER TABLE "Membership" DROP CONSTRAINT IF EXISTS chk_membership_scope_role;
ALTER TABLE "Membership" ADD CONSTRAINT chk_membership_scope_role CHECK (
     ("scopeType" = 'FACILITY' AND "tenantId" IS NULL     AND "supplierId" IS NULL
        AND "role" IN ('FACILITY_ADMIN','FACILITY_STAFF'))
  OR ("scopeType" = 'CUSTOMER' AND "tenantId" IS NOT NULL AND "supplierId" IS NULL
        AND "role" IN ('COMPANY_ADMIN','HR_MANAGER','WORKER'))
  OR ("scopeType" = 'SUPPLIER' AND "tenantId" IS NOT NULL AND "supplierId" IS NOT NULL  -- was tenantId IS NULL
        AND "role" = 'SUPPLIER_PORTAL')
);
```

Companion CHECK on every table gaining `supplierId`: `supplierId IS NULL OR tenantId IS NOT NULL` (a supplier-owned row is always inside a company — F19). The pre-existing `chk_source_tenant_private` still holds — supplier feeds are tenant-private.

---

## 3. Supplier-Level RLS Design

Two rules, both enforced in RLS (the load-bearing net under NOBYPASSRLS) so a service-layer bug cannot leak:

- **(A) Supplier-scoping** — a supplier sees only its own supplier-owned rows within its tenant.
- **(B) Supplier→only-enrolled-workers** — a supplier sees only workers with an **active** enrollment in that supplier's own trainings (GDPR data-minimization).

### 3.1 Second transaction-local GUC + a session-kind discriminator (F3, F16)

`forSupplier`/`asSupplierSync` set, in ONE `set_config` batch as the first tx statements:

```sql
SELECT set_config('app.tenant_id',    $1, true),
       set_config('app.supplier_id',  $2, true),
       set_config('app.session_kind', 'supplier', true);
```

- **`nullif(...,'')` everywhere (F3):** an empty-string GUC is NOT NULL and would silently switch a session into a broken supplier filter. Every policy uses `nullif(current_setting('app.supplier_id', true), '')` (and the same for `app.tenant_id`). `forSupplier` throws on empty `tenantId`/`supplierId`.
- **`app.session_kind` discriminator (F16):** the supplier-narrowing branch requires `app.session_kind = 'supplier'`, so a supplier session that somehow lost `app.supplier_id` **fails CLOSED (matches nothing)** instead of falling into the HR "see all suppliers" branch. HR/facility never set it.

Reusable narrowing predicate (transparent when unset for HR, confining for suppliers):

```sql
-- HR/facility branch (no supplier session):
(coalesce(current_setting('app.session_kind', true),'') <> 'supplier'
   AND <tenant/facility clause>)
-- Supplier branch: must have a concrete supplier id
OR (current_setting('app.session_kind', true) = 'supplier'
   AND "supplierId" = nullif(current_setting('app.supplier_id', true), ''))
```

### 3.2 `Supplier` table policy

```sql
ALTER TABLE "Supplier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Supplier" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Supplier"
  USING ("tenantId" = nullif(current_setting('app.tenant_id', true),'')
         OR (current_setting('app.is_facility', true) = 'on'
             AND nullif(current_setting('app.supplier_id', true),'') IS NULL))   -- F4
  WITH CHECK ("tenantId" = nullif(current_setting('app.tenant_id', true),'')
              OR current_setting('app.is_facility', true) = 'on');
```

> Every facility branch below is `is_facility='on' AND app.supplier_id IS NULL` (F4): a set supplier GUC always forces the narrowing branch even if `is_facility` leaks on.

### 3.3 `Training` policy (replaces `catalog_visibility`)

```sql
DROP POLICY IF EXISTS catalog_visibility ON "Training";
CREATE POLICY catalog_visibility ON "Training"
  USING (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "supplierId" = nullif(current_setting('app.supplier_id', true),''))        -- supplier: own only
    OR (coalesce(current_setting('app.session_kind', true),'') <> 'supplier'
        AND ( "tenantId" IS NULL                                                       -- shared global catalog (§3.13)
              OR "tenantId" = nullif(current_setting('app.tenant_id', true),'')
              OR (current_setting('app.is_facility', true) = 'on') ))
  )
  WITH CHECK (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "tenantId" = nullif(current_setting('app.tenant_id', true),'')
       AND "supplierId" = nullif(current_setting('app.supplier_id', true),''))         -- pin supplierId on write
    OR (coalesce(current_setting('app.session_kind', true),'') <> 'supplier'
        AND ("tenantId" = nullif(current_setting('app.tenant_id', true),'')
             OR current_setting('app.is_facility', true) = 'on'))
  );
```

The `WITH CHECK` pins `supplierId` to the GUC on write — a supplier session cannot write a row attributed to another supplier.

### 3.4 `TrainingSource` policy — same shape as Training, plus the tenant-private companion CHECK.

### 3.5 `TrainingSession` policy (denormalized `supplierId`, now FK-backed — F13)

```sql
ALTER TABLE "TrainingSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingSession" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_visibility ON "TrainingSession";
CREATE POLICY supplier_visibility ON "TrainingSession"
  USING (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "supplierId" = nullif(current_setting('app.supplier_id', true),''))
    OR (coalesce(current_setting('app.session_kind', true),'') <> 'supplier'
        AND (current_setting('app.is_facility', true) = 'on'
             OR EXISTS (SELECT 1 FROM "Training" t
                        WHERE t.id = "TrainingSession"."trainingId"
                          AND (t."tenantId" IS NULL
                               OR t."tenantId" = nullif(current_setting('app.tenant_id', true),'')))))
  )
  WITH CHECK (
    current_setting('app.session_kind', true) <> 'supplier'
    OR "supplierId" = nullif(current_setting('app.supplier_id', true),'')
  );
```

Trigger 4d (§3.10) is authoritative for `TrainingSession.supplierId`; a `NOT VALID` CHECK backs it.

### 3.6 `Worker` policy — the hard part (supplier reads only its ACTIVELY-enrolled workers)

```sql
DROP POLICY IF EXISTS tenant_isolation ON "Worker";
CREATE POLICY tenant_isolation ON "Worker"
  USING (
    (coalesce(current_setting('app.session_kind', true),'') <> 'supplier'
       AND (current_setting('app.is_facility', true) = 'on'
            OR "tenantId" = nullif(current_setting('app.tenant_id', true),'')))   -- HR/facility: full roster
    OR (current_setting('app.session_kind', true) = 'supplier'
        AND "tenantId" = nullif(current_setting('app.tenant_id', true),'')
        AND EXISTS (                                                              -- supplier: ACTIVE enrollments only (F5)
          SELECT 1 FROM "Enrollment" e
          WHERE e."workerId"   = "Worker".id
            AND e."tenantId"   = "Worker"."tenantId"
            AND e."supplierId" = nullif(current_setting('app.supplier_id', true),'')
            AND e."deletedAt" IS NULL
            AND e."status" NOT IN ('CANCELLED','NO_SHOW')
        ))
  )
  WITH CHECK ("tenantId" = nullif(current_setting('app.tenant_id', true),''));    -- suppliers never write Worker rows
```

- **F5 fix:** the EXISTS excludes soft-deleted and CANCELLED/NO_SHOW enrollments, defeating the "enroll → harvest PII → cancel but retain visibility" attack. Served by the partial index in §2.3.
- **F12 correction (note):** Postgres **does** apply Enrollment's RLS inside this subquery. It composes correctly because the subquery filters `e.supplierId = app.supplier_id`, a subset of what Enrollment's own policy permits for the same session. Any future change to Enrollment's policy must preserve this `(supplierId, tenantId)` match — a regression test pins it.
- **WITH CHECK** omits the supplier clause deliberately: HR owns the roster; suppliers never create/modify Worker rows (also blocked at the capability layer, RLS as backstop). `app_user` already has SELECT on Enrollment; no extra grant.

### 3.7 `Attachment` policy — the critical fix (F1)

Live policy today (`security.sql:64-72`) scopes ONLY by tenant AND makes `tenantId IS NULL` globally readable — a supplier session sees every supplier's completion/certificate files company-wide. Fixed:

```sql
DROP POLICY IF EXISTS tenant_isolation ON "Attachment";
CREATE POLICY tenant_isolation ON "Attachment"
  USING (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "tenantId" = nullif(current_setting('app.tenant_id', true),'')
       AND "supplierId" = nullif(current_setting('app.supplier_id', true),''))   -- supplier: own only, NO tenantId-NULL escape
    OR (coalesce(current_setting('app.session_kind', true),'') <> 'supplier'
        AND ( "tenantId" IS NULL
              OR "tenantId" = nullif(current_setting('app.tenant_id', true),'')
              OR current_setting('app.is_facility', true) = 'on'))
  )
  WITH CHECK (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "tenantId" = nullif(current_setting('app.tenant_id', true),'')
       AND "supplierId" = nullif(current_setting('app.supplier_id', true),''))
    OR (coalesce(current_setting('app.session_kind', true),'') <> 'supplier'
        AND ("tenantId" IS NULL OR "tenantId" = nullif(current_setting('app.tenant_id', true),'')))
  );
```

`Attachment.supplierId` is trigger-copied from its parent `CompletionRecord.supplierId` (trigger 4f). The `tenantId IS NULL` allowance is **dropped for supplier sessions** — a global/NULL-tenant attachment is never visible to a scoped supplier. Interim before the column ships: a service-layer check on the completion's supplierId plus an EXISTS backstop over `CompletionRecord` (which inherits its supplier RLS in the subquery).

### 3.8 `Enrollment` / `CompletionRecord` / `ConsentRecord` policies

Enrollment & CompletionRecord narrow directly on their own denormalized `supplierId` (same branch shape as §3.3). **ConsentRecord** carries no `supplierId`, so it uses the Worker-style active-EXISTS (F10):

```sql
DROP POLICY IF EXISTS tenant_isolation ON "ConsentRecord";
CREATE POLICY tenant_isolation ON "ConsentRecord"
  USING (
    (coalesce(current_setting('app.session_kind', true),'') <> 'supplier'
       AND (current_setting('app.is_facility', true) = 'on'
            OR "tenantId" = nullif(current_setting('app.tenant_id', true),'')))
    OR (current_setting('app.session_kind', true) = 'supplier'
        AND "tenantId" = nullif(current_setting('app.tenant_id', true),'')
        AND EXISTS (SELECT 1 FROM "Enrollment" e
                    WHERE e."workerId" = "ConsentRecord"."workerId"
                      AND e."tenantId" = "ConsentRecord"."tenantId"
                      AND e."supplierId" = nullif(current_setting('app.supplier_id', true),'')
                      AND e."deletedAt" IS NULL
                      AND e."status" NOT IN ('CANCELLED','NO_SHOW')))
  )
  WITH CHECK ("tenantId" = nullif(current_setting('app.tenant_id', true),''));
```

Confirm with the client (§10) whether suppliers need consent data at all; if not, exclude ConsentRecord from every supplier read path and keep it facility/tenant-only with an explicit deny when `session_kind='supplier'`.

### 3.9 `forSupplier()` (request path) + `asSupplierSync()` (jobs) + `requireAuth` fix (F4, F6, F15)

```ts
// lib/db/index.ts — request/session path for SUPPLIER-scope sessions
export async function forSupplier<T>(
  tenantId: string, supplierId: string, fn: (tx: TenantClient) => Promise<T>,
): Promise<T> {
  if (!tenantId || !supplierId) throw new Error("forSupplier requires tenantId and supplierId");
  if (tenantId === supplierId) throw new Error("forSupplier: tenantId and supplierId must differ");
  return prisma.$transaction(async (tx) => {
    // single batch; also assert we are NOT in a facility session (F4)
    await tx.$queryRaw`SELECT
      set_config('app.tenant_id',    ${tenantId},   true),
      set_config('app.supplier_id',  ${supplierId}, true),
      set_config('app.session_kind', 'supplier',    true)`;
    return fn(tx);
  }, TX_OPTS);
}
export async function asSupplierSync<T>(/* same signature/body, headless jobs */): Promise<T> { /* ... */ }
```

`asFacility()` gains a defensive first statement `SELECT set_config('app.supplier_id', NULL, true), set_config('app.session_kind', NULL, true)` so a stale supplier GUC can never combine with facility reads (F4).

`requireAuth()` (F6) — REQUIRED change, ships with the migration:

```ts
// lib/auth/require-auth.ts
tenantId: (membership.scopeType === "CUSTOMER" || membership.scopeType === "SUPPLIER")
            ? membership.tenantId : null,
supplierId: membership.scopeType === "SUPPLIER" ? membership.supplierId : null, // NEW distinct field
```

Add `supplierId: string | null` to `AuthContext` (lib/auth/types.ts); **deprecate `scopeId` for data-access decisions**. `requireAuth` refuses to attach FACILITY capabilities when `scopeType === 'SUPPLIER'` (F4). **ESLint guard** (mirroring the `asFacility` guard) forbids `forTenant`/`asFacility`/raw prisma in any `/portal` route or supplier server action and requires `forSupplier` (F15).

### 3.10 Triggers (keep denormalized `supplierId` consistent — F2, F13)

```sql
-- 4d. TrainingSession.supplierId := parent Training.supplierId (copy, never trust) — SECURITY DEFINER
CREATE OR REPLACE FUNCTION enforce_session_supplier() RETURNS trigger AS $$
DECLARE t_sup TEXT;
BEGIN
  SELECT "supplierId" INTO t_sup FROM "Training" WHERE id = NEW."trainingId";
  NEW."supplierId" := t_sup;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;   -- BEFORE INSERT OR UPDATE ON "TrainingSession"

-- 4e. Enrollment/CompletionRecord.supplierId := parent Training.supplierId; REJECT mismatch (F2)
--     SECURITY DEFINER so the internal SELECT always sees the parent regardless of caller RLS.
CREATE OR REPLACE FUNCTION enforce_row_supplier() RETURNS trigger AS $$
DECLARE t_sup TEXT;
BEGIN
  SELECT "supplierId" INTO t_sup FROM "Training" WHERE id = NEW."trainingId";
  IF NEW."supplierId" IS NOT NULL AND NEW."supplierId" IS DISTINCT FROM t_sup THEN
    RAISE EXCEPTION 'supplierId % does not match parent training supplier %', NEW."supplierId", t_sup;
  END IF;
  NEW."supplierId" := t_sup;   -- authoritative copy
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;
-- Extend the existing enforce_completion_consistency() (security.sql:248) to also derive supplierId
-- via the enrollment's Training in the SAME SELECT.

-- 4f. Attachment.supplierId := parent CompletionRecord.supplierId (F1) — SECURITY DEFINER, copy.
```

> **Global-catalog enrollment (F2/F13 edge case):** if a supplier enrolls a worker into a global-catalog training (`Training.supplierId` NULL), the Enrollment's `supplierId` must still be **stamped with the enrolling supplier's id from the GUC**, not inherited as NULL — otherwise the enrollment grants no visibility and the worker vanishes. Trigger 4e handles this: when parent `t_sup IS NULL`, it stamps `NEW.supplierId := nullif(current_setting('app.supplier_id', true),'')`.

Nightly facility-scope assertion query flags any Enrollment/CompletionRecord/Session/Attachment whose `supplierId` differs from its lineage. CI asserts all expected triggers exist after `security.sql` runs (guards the documented "forgot to re-run security.sql" failure mode).

### 3.11 Child tables Certificate / StatusTransition / CompletionCategory (F11)

These have no own `supplierId` and scope via EXISTS over their parent (Enrollment/CompletionRecord). **Postgres applies the parent's RLS inside that subquery**, so once the parents carry the supplier clause, these fail closed for supplier reads. This is documented here (not left to inference), plus:

- **Certificate** is denormalized with `supplierId` (copied from parent CompletionRecord) and scoped directly like the other tables — it is an explicit supplier deliverable and the direct scope is more robust than the transitive one.
- StatusTransition/CompletionCategory keep the parent-EXISTS pattern, documented as intentionally inheriting supplier isolation.
- **CI guard** forbids any `SECURITY DEFINER` function or `row_security = off` view over these three tables (except the audited trigger functions), so no future "optimization" silently breaks isolation.

### 3.12 Worker self-visibility as RLS (F18)

Wire the previously-dead `app.worker_id` GUC into the Worker policy as defense-in-depth so a WORKER session is RLS-bounded to its own row even if an app-level filter is forgotten:

```sql
-- add to the Worker USING clause:
OR (nullif(current_setting('app.worker_id', true),'') IS NOT NULL
    AND "Worker".id = nullif(current_setting('app.worker_id', true),''))
```

### 3.13 Grants + global-catalog default

**No new privileges.** Existing `GRANT ALL ... TO app` + `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES` cover the new `Supplier` table/columns. Re-run the grant block after migration for environments predating the default-privileges line.

**Global catalog to suppliers (default — flag §10):** the Training policy above **restricts suppliers to their own offers** (the supplier branch has no `tenantId IS NULL` allowance). To let suppliers additionally browse the shared PUBLISHED catalog, add `OR ("tenantId" IS NULL AND "status"='PUBLISHED')` to the supplier branch. One-line toggle; defaulting to the safer restrict.

---

## 4. Updated Permissions Matrix

New capabilities: `supplier.account.manage`, `supplier.offer.manage`, `supplier.session.manage`, `supplier.enrollment.manage`, `supplier.completion.record`, `worker.read.enrolled`, `supplier.import.configure`, `attendance.mark`.

`SUPPLIER_PORTAL` grant set (F14 — **replaces** the live `["catalog.training.manage","catalog.browse"]`, which dangerously shares the facility catalog-management cap; ships in the SAME PR as supplier memberships):

```
"catalog.browse"              // own offers only (RLS-narrowed; global catalog per §10 toggle)
"supplier.offer.manage"       // CRUD own offers/trainings
"supplier.session.manage"     // own sessions/calendar
"supplier.enrollment.manage"  // enroll workers INTO its own trainings (see F9 / Decision #4)
"supplier.completion.record"  // record completions for own trainings
"certificate.issue"           // for own completions
"worker.read.enrolled"        // enrolled-only workers, PII-masked by default
"attendance.mark"             // Assiduidade for own sessions
"timeline.view.self"          // Cronograma of own trainings
"report.read"                 // CSV export of own trainings/workers
"hours.read.self"             // hours it delivered
```

**Explicitly NOT granted:** `catalog.training.manage` (F14), `worker.manage`, `worker.read.pii`, `hours.read.tenant`, `timeline.view.tenant`, `membership.invite.worker`, `assignment.read` (tenant-wide), `gdpr.*`, `audit.read`, `supplier.manage` (facility-only).

`COMPANY_ADMIN` + `HR_MANAGER` gain: `supplier.account.manage`, `supplier.import.configure`. "HR sees all suppliers" needs no capability — it is the **absence of `app.session_kind='supplier'`** on their session.

| Screen / action | Vendor (/admin) | HR (/app) | Supplier (/portal) | Worker (/app/me) | Gate |
|---|:--:|:--:|:--:|:--:|---|
| Onboard company / tenant | ● | ✕ | ✕ | ✕ | `customer.create`, asFacility |
| Company → suppliers (support) | ● (audited) | ✕ | ✕ | ✕ | asFacility |
| Global timeline | ● | ✕ | ✕ | ✕ | `timeline.view.global` |
| Workers "Os meus colaboradores" | ✕ | ● (all staff) | ● (enrolled-only, masked) | ✕ | `worker.manage` / `worker.read.enrolled` |
| Add/Edit worker | ✕ | ● | ✕ | ✕ | `worker.manage`, `worker.read.pii` |
| Manage suppliers + create logins | ✕ | ● | ✕ | ✕ | `supplier.account.manage` |
| Trainings "Ações dos meus colaboradores" | ✕ | ● (all) | ● (own only) | ● (self, read) | forTenant / forSupplier / forWorker |
| Create training | ✕ | ● (on supplier's behalf) | ● (self-serve) | ✕ | `supplier.offer.manage` (scoped) |
| Enrollments "Inscrições" | ✕ | ● | ● (into own trainings) | ✕ | `supplier.enrollment.manage` |
| Attendance "Assiduidade" | ✕ | ● | ● (own sessions) | ✕ | `attendance.mark` |
| Cronograma / schedule | ✕ | ● | ● (own) | ● (self, view) | `timeline.view.tenant` / `.self` |
| Roster "Colaboradores" | ✕ | ● | ● (own enrolled) | ✕ | `assignment.read` (+ supplier scope) |
| Documentos | ✕ | ● | ● (own, F1-scoped) | ● (self) | `attachment.read` (scoped, audited) |
| Controlo de Horas | ✕ | ● (org) | ● (my delivered) | ● (self) | `hours.read.tenant` / `.self` |
| Offers "As minhas ofertas" | ✕ | (browse) | ● | ✕ | `supplier.offer.manage` |
| API integrations (supplier feed) | ● (config) | ● (config) | ● (status) | ✕ | `supplier.import.configure` |
| Profile / password / photo | ● | ● | ● | ● | self |

**CI (`tests/capabilities.test.ts`):** keep the six-role assertion; add invariants — SUPPLIER_PORTAL must NOT have `catalog.training.manage`/`worker.manage`/`hours.read.tenant`/`membership.invite.worker`; SUPPLIER_PORTAL MUST have `supplier.offer.manage`+`worker.read.enrolled`; COMPANY_ADMIN/HR_MANAGER MUST have `supplier.account.manage`. Add the **supplier-isolation integration test** (mirror of `tests/isolation/tenant-isolation.test.ts`): cross-supplier denial; enrolled-only worker visibility; Attachment cross-supplier denial (F1); cross-supplier Enrollment write rejection (F2); fail-closed when `app.supplier_id` is unset OR empty-string on a supplier route (F3); `is_facility='on' AND app.supplier_id set` still sees only enrolled workers (F4); cancel/soft-delete last enrollment removes the worker (F5); a SUPPLIER ctx reaching `forTenant` yields zero rows (F6).

---

## 5. Onboarding Flows (reuse existing `Invitation` + magic-link)

`Invitation` gains a nullable `supplierId` (+ accept handler and its RLS allowance); accepting a SUPPLIER invite creates a Membership with **both** `tenantId` and `supplierId`.

**Flow A — Vendor creates company + first HR:** FACILITY_ADMIN (`customer.create`, asFacility, audited) creates `Tenant` → `Invitation{CUSTOMER, COMPANY_ADMIN, tenantId}` → magic-link → set password (argon2id) → `Membership{CUSTOMER, COMPANY_ADMIN, tenantId, ACTIVE}`.

**Flow B — HR creates a Supplier account (`supplier.account.manage`):** HR (forTenant) creates a `Supplier` (idempotent on `(tenantId, normalizedName)`); a paired `TrainingSource{SUPPLIER, tenantId, supplierId, isTenantPrivate=true}` is find-or-created (connector anchor). `Invitation{SUPPLIER, SUPPLIER_PORTAL, tenantId, supplierId}` → supplier accepts → `Membership{SUPPLIER, SUPPLIER_PORTAL, tenantId, supplierId, ACTIVE}`. Multiple supplier staff = multiple memberships to the same `supplierId`.

**Flow C — HR imports workers (`worker.manage`, existing):** CSV/manual under forTenant; unchanged. **Suppliers cannot see any of these workers until actively enrolled** (Worker RLS EXISTS).

**Flow D — Supplier self-serve (SUPPLIER session via `forSupplier`):** creates offers → `Training{tenantId, sourceId=own, supplierId, provenance=ADMIN_MANUAL}`; sessions; **enrolls the company's workers INTO its own trainings** (`supplier.enrollment.manage`) — enrolling is what grants worker visibility (see F9/Decision #4); records completions/certificates for its own trainings. HR can also create on the supplier's behalf (forTenant, sets `supplierId` explicitly; `HR_MANUAL`); API import → `API_IMPORT` via the supplier's connector (§7).

**Flow E — Worker login (existing, unchanged):** `Invitation{CUSTOMER, WORKER, tenantId, workerId}` → `Membership{WORKER, workerId}`; forWorker() self-scope.

**ATEC-as-supplier:** HR creates a `Supplier` (`isAtec=true`, e.g. "ATEC — Palmela") and invites an ATEC user → SUPPLIER membership scoped to that `(tenant, supplier)`. Indistinguishable from any other supplier (same isolation, same enrolled-only view). `asFacility()` is for VENDOR reads ONLY and **cannot be reached from a supplier session** (F4).

---

## 6. Phase 1 Screen Inventory (per role, modeled on the screenshots)

New **supplier shell at `/[locale]/portal/*`**, chosen server-side from active membership `scopeType=SUPPLIER`, alongside existing `/admin`, `/app`, `/app/me`. localePrefix "always".

```
/[locale]
├─ /login · /accept-invite                                (existing)
├─ /admin      VENDOR
│  ├─ /companies · /companies/[id] · /companies/[id]/suppliers (audited)
│  └─ / · /timeline (global) · /settings
├─ /app        HR (COMPANY_ADMIN | HR_MANAGER)
│  ├─ / (dashboard) · /workers · /workers/new · /workers/[id] · /workers/import
│  ├─ /suppliers · /suppliers/new · /suppliers/[id]        MANAGE SUPPLIERS + create logins (NEW)
│  ├─ /trainings (ALL company) · /trainings/new · /trainings/[id] · /trainings/record-completed
│  ├─ /enrollments
│  ├─ /trainings/[id]/attendance · /schedule · /workers · /documents
│  └─ /hours · /timeline · /reports · /settings
├─ /portal     SUPPLIER (SUPPLIER_PORTAL)                  [NEW SHELL]
│  ├─ / (dashboard: my active trainings, my enrolled headcount, my hours)
│  ├─ /offers · /offers/new · /offers/[id]                 "As minhas ofertas"
│  ├─ /trainings (ONLY mine) · /trainings/new · /trainings/[id]
│  ├─ /trainings/[id]/attendance · /schedule · /workers (ONLY my enrolled) · /documents (F1-scoped)
│  ├─ /enrollments (into my trainings) · /workers (enrolled-only, masked)
│  ├─ /hours · /integrations (Phase-3-ready) · /profile · /profile/password · /profile/photo
└─ /app/me     WORKER  [Phase 1b]
   ├─ / (As minhas ações) · /hours · /profile
```

**Central reusable `<TrainingsListTable>`** — powers HR (`forTenant`, all) and Supplier (`forSupplier`, own only). **The page owns the DB-helper call and passes already-scoped rows** — isolation is enforced by which helper the page calls, never by divergent UI. The `/portal` CSV export and search/facet routes derive scope from `requireAuth()` SUPPLIER context and call `forSupplier(tenantId, supplierId)` — never `forTenant` with an app-side supplier filter (F15).

- Header: title, "Pesquisa por:" field Select (Ação / Sigla / Local / Situação / Início), CSV export. All list state in `searchParams` (Zod-validated, server-read); export reads the identical `searchParams` (UTF-8 BOM, locale-aware) so CSV mirrors the on-screen set.
- Columns: **Ação** (title, link) · **Duração** (`formatHours()` → "24,0 horas") · **Local** (session.location; "Nas instalações do cliente" when `atClientPremises`) · **Início** · **Fim** · **Horário** (`scheduleType` → "Laboral" Badge) · **Sigla** (`sessionCode ?? shortCode`, mono Badge "724") · **Situação** (colored Badge) · **⋮**.
- **⋮ actions:** Assiduidade · Cronograma · Colaboradores · Documentos dos colaboradores · (gated) Editar / Registar conclusão / Cancelar.
- **Situação mapping (no new vocabulary):** "A iniciar"=SCHEDULED/ASSIGNED (future); "Em curso"=IN_PROGRESS; "Concluída"=COMPLETED; "Cancelada"=CANCELLED/NO_SHOW. Badges neutral/blue/green/red, always paired with text (WCAG).
- **Responsive:** at `<md` rows become Cards (one shared column-config drives both). Filters collapse into a bottom Sheet; the "Área de utilizador" sidebar collapses to a Sheet drawer.
- **PII masking** (`lib/auth/pii.ts`) applies to supplier `/portal/workers` and rosters via `worker.read.enrolled`.

**shadcn/ui to generate** (new-york, lucide; `components/ui` empty): `table, card, badge, dropdown-menu, select, input, button, sheet, dialog, form, label, tabs, avatar, separator, sonner, skeleton, tooltip, pagination, popover, command, calendar, date-picker, checkbox, sidebar, breadcrumb`. Data grid via TanStack Table wrapped by shadcn `table`; timeline via TanStack Virtual (list MVP).

**i18n namespaces to add:** `trainings, workers, enrollments, suppliers, hours, portal, attendance, schedule, documents`. DB domain content stays in `*Translation` tables with pt-PT fallback; reuse `formatHours()`/`formatDateRange()`.

**Deferred from Phase 1:** "Pagamentos" (billing → Phase 5). Worker portal `/app/me` → Phase 1b.

---

## 7. API-Feed Readiness (per-`(tenant, supplier)` connector + ingestion pipeline)

Re-maps the existing two-phase idempotent pipeline (`TrainingSource → IngestRun → IngestedRecord → MatchCandidate → Training/CompletionRecord`, provenance `API_IMPORT`) from the old "facility-global supplier" model to the supplier-centric one. A feed belongs to a specific `(tenant, supplier)` pair. **Phase-3 build; the deltas here make it design-ready and the schema columns land in Phase 1 so RLS can be enabled without a later structural migration.**

**7.1 Thread `supplierId` + NOT-NULL `tenantId` (F7).** Add `supplierId` and NOT-NULL `tenantId` to `TrainingSource, Training, IngestRun, IngestedRecord, MatchCandidate, SourceSyncState` (`MatchCandidate/IngestRun/SourceSyncState` have neither today; `IngestedRecord.tenantId` is currently nullable). A supplier API feed = a `TrainingSource{tenantId NOT NULL, supplierId NOT NULL, kind=SUPPLIER, isTenantPrivate=true}`. Ingestion rows inherit `(tenantId, supplierId)` from their source **at run creation** (stamped before any Training is written), enforced by a trigger + `CHECK (kind='SUPPLIER' => supplierId IS NOT NULL)`. A supplier with two platforms = two source rows; the same supplier in N companies = N source rows (never a shared global source).

**7.2 RLS on ingestion tables (F7).** `IngestedRecord.rawPayload` can hold worker-completion PII. ENABLE+FORCE RLS on `IngestRun, IngestedRecord, MatchCandidate, SourceSyncState`; **no NULL-supplier escape** for supplier sessions:

```sql
CREATE POLICY tenant_supplier_isolation ON "IngestedRecord"
  USING (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "tenantId" = nullif(current_setting('app.tenant_id', true),'')
       AND "supplierId" = nullif(current_setting('app.supplier_id', true),''))  -- no NULL escape
    OR (coalesce(current_setting('app.session_kind', true),'') <> 'supplier'
        AND ("tenantId" = nullif(current_setting('app.tenant_id', true),'')
             OR current_setting('app.is_facility', true) = 'on')))              -- HR/facility conflict-resolution
  WITH CHECK (
    "tenantId" = nullif(current_setting('app.tenant_id', true),'')
      AND (current_setting('app.session_kind', true) <> 'supplier'
           OR "supplierId" = nullif(current_setting('app.supplier_id', true),'')));
```

Same shape on the other three. The `rawPayload` purge job runs per-source under `asSupplierSync` after retention (audited). Do NOT ship the nullable-tenantId + is-facility-only interim for tables holding external worker PII — defer the whole feature rather than ship that state.

**7.3 Idempotency keys scoped to `(tenant, supplier)` (F8).** Change the live `@@unique([sourceId, externalRef, contentHash])` on `IngestedRecord` to `@@unique([tenantId, supplierId, sourceId, externalRef, contentHash])` so the dedup key can never span companies even if a `sourceId` is misconfigured. Training keys:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_training_extref_supplier
  ON "Training" ("tenantId","supplierId","sourceId","externalRef")
  WHERE "supplierId" IS NOT NULL AND "externalRef" IS NOT NULL;
DROP INDEX IF EXISTS uq_training_extref_global;
CREATE UNIQUE INDEX uq_training_extref_global
  ON "Training" ("sourceId","externalRef")
  WHERE "externalRef" IS NOT NULL AND "tenantId" IS NULL AND "supplierId" IS NULL;
```

**7.4 Connector config + credentials, per `(tenant, supplier)` (F17).** Lives on the supplier-scoped `TrainingSource`: `connectorCode`, `connectorVersion`, `authType`, `baseConfig` (JSON), `syncEnabled`, `syncSchedule`, `syncDirection` (PULL_ONLY default). **Credentials never inline:** `credentialRef` is an opaque handle into the EU KMS-backed secret store, namespaced by `(tenantId, supplierId, sourceId)`. Inbound-push: `POST /api/v1/ingest/:sourceId` authenticates **atomically** — a single query `WHERE id=:sourceId AND ingestApiKeyHash=:hash`, rejecting if no row; `(tenantId, supplierId)` is derived ONLY from that authenticated row, then staging runs under `asSupplierSync`. A coarse **per-source rate limit** is de-deferred (was Open Decision #8) because sourceId enumeration + key-guessing would otherwise be unthrottled.

**7.5 Job flow.** `source.sync.schedule` (Vercel Cron MVP → pg-boss Phase 3) lists due feeds under a service/facility scope and **dispatches ONE `asSupplierSync(tenantId, supplierId)` job PER feed** (`singletonKey=sourceId`; never one transaction across suppliers — lint-enforced): resolve `(tenantId, supplierId)` from source → open IngestRun (stamped) → load `credentialRef` from KMS → `connector.fetchChanges` → stage (contentHash dedup) → match → upsert (deterministic 3-source merge: API + `manualOverrides` + `fieldPrecedence`) → persist cursor → close run.

**7.6 Manual↔API coexistence, `(tenant, supplier)`-constrained.** On first API match: keep `Training.id`, set `externalRef`, snapshot priors into `manualOverrides`, provenance→`API_IMPORT`. The fuzzy claim is **restricted to the same `(tenantId, supplierId, sourceId)`** — supplier A's feed can never claim supplier B's manually-typed training. HR-created "on a supplier's behalf" rows carry that supplier's `supplierId`, so the supplier's later feed upgrades them in place (enrollments/completions never move). **Completion ingest** matches worker by `(tenantId, employeeNo|email)` AND requires the worker already have an ACTIVE enrollment in one of THIS supplier's trainings — enforcing the GDPR enrolled-only rule at ingest time. A not-yet-enrolled worker's completion is held as a `MatchCandidate` (does NOT auto-create an enrollment, which would widen visibility — Decision #6).

---

## 8. Migration Sequencing

1. **LIVE audit (F19):** `SELECT count(*) FROM "Membership" WHERE "scopeType"='SUPPLIER'` in the deployed DB. If nonzero, backfill each to `(tenantId, supplierId)` before proceeding.
2. Create `Supplier` (+ Tenant back-relation, partial unique on `(tenantId, normalizedName)`).
3. Add nullable `supplierId` + composite FKs to TrainingSource/Training/TrainingSession/Enrollment/CompletionRecord/**Attachment**/**Certificate**; add NOT-NULL `tenantId`+`supplierId` (backfilled) to ingestion tables; add `shortCode`, `sessionCode`, `scheduleType`, `atClientPremises`, `Invitation.supplierId`.
4. Backfill tenant-private data; migrate any old global-supplier source rows into per-`(tenant, supplier)` rows.
5. Swap `chk_membership_scope_role`; add companion `supplierId IS NULL OR tenantId IS NOT NULL` CHECKs.
6. **Ship the `SUPPLIER_PORTAL` capability rewrite + `requireAuth` change + ESLint guards in this SAME PR** (F6, F14) — do not enable any SUPPLIER membership in any environment before this lands.
7. **Run `security.sql` AFTER `prisma migrate deploy`:** all new/edited RLS policies (Training, TrainingSource, TrainingSession, Enrollment, CompletionRecord, Worker, ConsentRecord, Attachment, Certificate, Supplier, ingestion tables), triggers 4d/4e/4f (+ extended 4a), `NOT VALID` session/supplier CHECKs, idempotency indexes, worker-self policy; re-run grants; CI asserts all triggers/policies exist.

---

## 9. Traceability — every refined-model requirement met

| Requirement | How it is met |
|---|---|
| Sold per COMPANY; companies never see each other | Existing tenant RLS (`app.tenant_id`) — unchanged. |
| ATEC is the VENDOR (super-admin onboarding companies) | FACILITY scope + `asFacility()`; Flow A. |
| ATEC can also be a SUPPLIER inside a company | Ordinary `Supplier` row (`isAtec=true`) + SUPPLIER membership; `asFacility` unreachable from a supplier session (F4). |
| HR creates login accounts for training suppliers | `supplier.account.manage` + `Invitation{SUPPLIER, supplierId}`; Flow B. |
| HR manages the company's workers | `worker.manage` under forTenant; Flow C — unchanged. |
| Each supplier inputs its own offers + ongoing/past trainings, per company | `/portal` self-serve → `forSupplier` writes stamp `supplierId`; Flow D. |
| **CRITICAL: a supplier MUST NOT see other suppliers' trainings in the same company** | `app.supplier_id`+`app.session_kind` GUCs + `supplierId = current_setting(...)` on Training/Session/Source/Enrollment/CompletionRecord/**Attachment**/**Certificate** (§3.3–3.11). Fail-closed on unset AND empty-string (F3) and on missing discriminator (F16). `WITH CHECK` + trigger 4e pin writes (F2). |
| **A supplier sees ONLY workers ACTIVELY enrolled in ITS OWN trainings (GDPR)** | Worker RLS EXISTS on denormalized `Enrollment.supplierId`, filtered to `deletedAt IS NULL AND status NOT IN (CANCELLED,NO_SHOW)` (§3.6, F5). Enforced under NOBYPASSRLS. Completion ingest applies the same gate (§7.6). PII masking on top. Consent/Attachment/Certificate scoped identically (F1, F10, F11). |
| Trainings/calendars created by BOTH suppliers (self-serve) AND HR (on a supplier's behalf, manual or API) | Supplier: `forSupplier`. HR: `forTenant`, sets `supplierId` (`HR_MANUAL`). API: `asSupplierSync` (`API_IMPORT`). Same write path; claim upgrades manual→API in place. |
| READY to pull suppliers' ACTIVE trainings via API | Per-`(tenant, supplier)` connector; ingestion chain stamped + RLS-scoped (F7); `(tenantId, supplierId, externalRef)` idempotency (F8); atomic inbound auth + rate limit (F17); `asSupplierSync` (§7). Phase-3 build, design-ready. |
| Bilingual pt-PT/en, mobile-first | next-intl namespaces (§6); table→card responsive; sidebar as Sheet drawer. |

**Defense-in-depth for the two critical rules:** (1) capability grants (supplier gets no tenant-wide worker/hours/catalog-manage caps — F14), (2) `forSupplier`/`asSupplierSync` as the ONLY sanctioned supplier entry points (ESLint-guarded — F15, F6), (3) RLS as the load-bearing net under NOBYPASSRLS with fail-closed GUC semantics (F3/F16) and write-side triggers (F2/F13). A failure at any one layer is contained by the others.

---

## 10. Open Decisions for Client (defaults chosen; one-line to flip)

1. **Global catalog to suppliers** — default: suppliers see ONLY their own offers (safer). Flip: add the `tenantId IS NULL AND status='PUBLISHED'` allowance to the supplier branch (§3.13).
2. **HR in-house trainings (`supplierId` NULL)** — default: HR-only, never shown to suppliers. Confirm.
3. **"Disappearing worker" (F5)** — default: when a supplier's last ACTIVE enrollment for a worker is cancelled/soft-deleted, the worker leaves the supplier's view (GDPR-correct AND defeats cancel-to-retain harvesting). Alternative: tie visibility to a non-superseded `CompletionRecord` for that supplier (retains visibility while real delivered history exists) rather than to dead enrollments. Confirm.
4. **Supplier self-serve enrollment (F9)** — default: suppliers may enroll workers into their own trainings (`supplier.enrollment.manage`), which is what grants visibility. Because a supplier could self-enroll an arbitrary `workerId` to unlock PII, the interim controls are: no supplier-facing endpoint returns not-yet-enrolled workerIds, and every supplier enrollment is audited with churn alerting. Stricter alternative: HR mediates every enrollment (drop the ability to name arbitrary workers). Confirm.
5. **Supplier PII depth** — default: name + enrollment status visible; national-ID-class fields masked pending per-company DPA toggle. Confirm whether email/department/employeeNo are needed for supplier attendance records.
6. **Completion ingest for not-yet-enrolled worker** — default: hold as `MatchCandidate` (do not auto-create an enrollment, which would widen visibility). Confirm lawful basis if auto-create is wanted.
7. **Does a supplier need ConsentRecord data at all (F10)?** — if not, exclude ConsentRecord from all supplier read paths entirely and keep it facility/tenant-only with an explicit supplier-deny. Confirm.
8. **MFA re-prompt** when an ATEC user switches from SUPPLIER into the FACILITY membership (which holds cross-tenant/audit/gdpr caps) — recommended per existing MFA policy. Confirm.