# Training Hub — Vendor Super-Admin + Offer-Model Refactor: Final Design & Phased Plan

**Status:** Implementation-ready. Verified against the live `prisma/sql/security.sql`, `prisma/schema.prisma`, and `lib/db/index.ts`. **Scope:** Extends the deployed app without weakening the proven tenant + supplier RLS isolation. **Style constraint honored:** `app_user` NOBYPASSRLS, transaction-local GUC RLS, `nullif(...,'')` fail-closed, composite FKs carrying `tenantId`, unchanged `forTenant`/`forSupplier`/`asFacility` bodies. **No new GUC.**

> This revision **incorporates all critical/high security findings** discovered against the live code. The most consequential live-code facts driving the fixes: (a) trigger 4b `enforce_enrollment_training_tenant` treats `Training.tenantId IS NULL` as globally-enrollable with **no link check** (lines 273-294) — a critical leak once offers go shared; (b) `TrainingSession.supplier` is today a **single-column** FK `[supplierId] → [id]` (schema line 488), and `TrainingSession` has **no `tenantId` column**; (c) trigger 4d unconditionally clobbers `session.supplierId := parent Training.supplierId` (lines 556-562) → NULLs it for shared offers; (d) trigger 4e stamps `Enrollment.supplierId` from `app.supplier_id` (which HR sessions never set); (e) `Certificate`/`StatusTransition`/`CompletionCategory` have **no own tenantId** and are safe only by recursion into a tenant-keyed parent; (f) `chk_membership_scope_role` requires SUPPLIER memberships to carry BOTH `tenantId`+`supplierId`.

---

## 0. Executive summary & resolved architecture

### 0.1 The one architecture

1. **Keep the per-tenant `Supplier` row as the load-bearing isolation anchor.** It remains what `app.supplier_id` points to, what `Membership.supplier` composite-FKs to via `[supplierId, tenantId]`, and what every denormalized `supplierId` chain hangs off. Supplier-isolation policies are **untouched** except the two hardening AND-clauses called out in §2.4.
2. **Add `SupplierOrg` ABOVE `Supplier`** — the canonical, cross-tenant, vendor-curated master identity ("ATEC"). No `tenantId`; never in a per-tenant private-data predicate.
3. **Offers move UP to `SupplierOrg`** (shared across linked companies). **Ações (`TrainingSession`) stay DOWN, private per company↔supplier link, and gate on their OWN new `tenantId`.**
4. **`CompanySupplierLink(tenantId, supplierOrgId)`** is the bipartite edge and the *sole* grantor of a company's read of a supplier's shared offers — enforced by a **`SECURITY DEFINER` helper `has_active_link()`**, not a bare nested-RLS `EXISTS`.

### 0.2 Security thesis (revised)

Shared visibility is gated at **three layers**, not one, because the live code proved that "read gate on the offer table only" is insufficient:

- **Read layer:** a non-supplier session reads a shared offer iff `has_active_link(app.tenant_id, offer.supplierOrgId)`. Ações gate on their **own** `tenantId`.
- **Write/enrollment layer:** **trigger 4b is rewritten** so a shared offer (`supplierOrgId IS NOT NULL`) requires an ACTIVE link to enroll — closing the critical fail-open where `tenantId IS NULL` meant "everyone". This covers the session-less enrollment path that `enforce_session_offer_link` alone misses.
- **Integrity layer:** copy-and-**reject** (never silently overwrite) on `TrainingSession.tenantId`, `TrainingSession.supplierId`, and `Enrollment.supplierId`, so the RLS `WITH CHECK` clauses are genuine independent gates rather than tautologies.

Every private table keeps its existing test-proven policy; the transitive children (`Certificate`→`CompletionRecord`, `StatusTransition`→`Enrollment`, `TrainingModule`→`TrainingSession`, `CompletionCategory`→`CompletionRecord`) are **re-verified by explicit tests** under the new gates rather than asserted safe.

### 0.3 Key conflict resolutions

| # | Decision | Deciding live-code fact |
|---|----------|-------------------------|
| C1 | **Keep physical table `Training`** as the logical "Offer"; add columns. No rename. | A rename breaks every FK/index/trigger (4b/4d/4e), the partial-unique indexes, and the passing isolation suite that references `"Training"` by name. |
| C2 | **Add explicit `TrainingSession.tenantId`** and gate the HR branch on it. | Live `supplier_visibility` (lines 429-432) does `EXISTS(Training t WHERE t.tenantId IS NULL OR t.tenantId = GUC)`. Once offers share (`tenantId` NULL), this exposes **every** linked company's Ações. |
| C3 | **`app.supplier_id` is ALWAYS a per-tenant `Supplier.id`.** No org-level GUC ever. | `chk_membership_scope_role` requires SUPPLIER to carry both tenantId+supplierId; `forSupplier` asserts `tenantId !== supplierId`. |
| C4 | **One physical `CompanySupplierLink`** = authoritative edge; the per-tenant `Supplier` row is materialized *from* it (invariant enforced by trigger). | The vendor map needs one cross-tenant `asFacility` scan of all edges with lifecycle. |
| C5 | **Only supplier/vendor writes offers; HR writes only Ações.** | An HR-written offer would fan out to all linked companies. |
| C6 | **Mutual exclusivity: an offer has EITHER `tenantId` (legacy-private) OR `supplierOrgId` (shared), never both.** | Prevents the dual-identity ambiguity where the legacy `tenantId=GUC` read branch and the shared branch both fire on one row. |
| C7 | **Suspend hides shared offers + blocks new Ação/enrollment, but preserves owning company's private history.** Confirm as decision (Q3). | Ações/enrollments gate on `tenantId`, not the link. |

---

## 1. Data model

### 1.1 New: `SupplierOrg` (canonical, cross-tenant, vendor-curated — no PII, no tenantId)

```prisma
model SupplierOrg {
  id             String   @id @default(cuid())
  name           String
  normalizedName String
  slug           String   @unique
  legalName      String?
  vatNumber      String?  @unique     // canonical dedup key
  contactEmail   String?
  website        String?
  logoUrl        String?
  isAtec         Boolean  @default(false)
  status         String   @default("ACTIVE")   // ACTIVE | SUSPENDED

  suppliers Supplier[]            // per-tenant projections
  offers    Training[]            // shared offers (logical "Offer")
  links     CompanySupplierLink[]
  primaryMembershipId String?     // the ONE main supplier login (C6; single-row uniqueness)

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  @@index([normalizedName])
}
```

### 1.2 New: `CompanySupplierLink` (bipartite edge; sole grantor of shared-offer read)

```prisma
model CompanySupplierLink {
  tenantId              String
  supplierOrgId         String
  supplierId            String?   // materialized per-tenant Supplier.id (set when ACTIVE)
  status                String   @default("ACTIVE")  // ACTIVE | SUSPENDED
  createdByMembershipId String?
  approvedByUserId      String?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  tenant      Tenant      @relation(fields: [tenantId], references: [id])
  supplierOrg SupplierOrg @relation(fields: [supplierOrgId], references: [id])

  @@id([tenantId, supplierOrgId])                 // bipartite by construction
  @@index([supplierOrgId, tenantId, status])      // covers has_active_link()
}
```

Only `tenantId` (a company) and `supplierOrgId` (a supplier) exist → company↔company and supplier↔supplier edges are structurally unrepresentable (Req 4, 5).

### 1.3 Changed: `Supplier` gains one nullable pointer (isolation policies untouched)

```prisma
model Supplier {
  // ...all existing fields UNCHANGED (id, tenantId, @@unique([id, tenantId]), etc.)...
  supplierOrgId String?
  org           SupplierOrg? @relation(fields: [supplierOrgId], references: [id])
  @@index([supplierOrgId, tenantId])
}
```

### 1.4 Changed: `Training` (logical Offer) and `TrainingSession` (Ação)

```prisma
model Training {                     // physical name kept
  // ...existing fields...
  supplierOrgId String?              // NEW: shared owner
  tenantId      String?              // KEPT nullable: mutually exclusive with supplierOrgId (C6)
  supplierId    String?              // KEPT for legacy/transition/HR-in-house
  org           SupplierOrg? @relation(fields: [supplierOrgId], references: [id])
  @@unique([id, supplierOrgId])      // NEW composite-FK target for sessions
  @@index([supplierOrgId, status])
}

model TrainingSession {              // Ação — PRIVATE
  // ...existing fields...
  tenantId      String?              // NEW (backfilled → NOT NULL in PR3, folded per finding)
  supplierOrgId String?              // NEW: denormalized from offer via trigger
  // FK CHANGE: supplier relation single-column → composite [supplierId, tenantId] -> Supplier[id, tenantId]
  // NEW composite FK (trainingId, supplierOrgId) -> Training(id, supplierOrgId)
  @@index([tenantId, supplierId, startsAt])
}
// Enrollment/CompletionRecord/Attachment/Certificate/TrainingModule/ConsentRecord/Worker: shape unchanged.
```

**FK change to record explicitly (finding H3):** today `TrainingSession.supplier` is `@relation(fields: [supplierId], references: [id])` (single-column). It becomes composite `[supplierId, tenantId] → Supplier[id, tenantId]`. The migration adds it `NOT VALID` then `VALIDATE CONSTRAINT` after a pre-flight assertion (§4 PR3) to avoid a long lock and surface violators.

### 1.5 Changed: `Membership.isPrimary`

```prisma
model Membership { /* ... */ isPrimary Boolean @default(false) }
```

---

## 2. RLS — added/edited in `security.sql`, idempotent, fail-closed

### 2.0 The link helper (finding: decouple gate from nested RLS)

```sql
CREATE OR REPLACE FUNCTION has_active_link(p_tenant text, p_org text)
  RETURNS boolean AS $$
  SELECT p_tenant IS NOT NULL AND p_org IS NOT NULL AND EXISTS (
    SELECT 1 FROM "CompanySupplierLink" l
    WHERE l."tenantId" = p_tenant AND l."supplierOrgId" = p_org AND l."status" = 'ACTIVE');
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;
```

Using a `SECURITY DEFINER` helper (a) removes nested-RLS ambiguity/fail-blind coupling to `CompanySupplierLink`'s own read policy, (b) uses the covering index directly, (c) is auditable in one place. Every gate below calls it.

### 2.1 `SupplierOrg` — vendor curates; linked company reads; supplier reads own org; PLUS a PII-free catalog-browse branch for the picker

```sql
ALTER TABLE "SupplierOrg" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierOrg" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_visibility ON "SupplierOrg";
CREATE POLICY org_visibility ON "SupplierOrg"
  USING (
    current_setting('app.is_facility', true) = 'on'
    OR has_active_link(nullif(current_setting('app.tenant_id', true), ''), "SupplierOrg".id)
    -- PICKER: any authenticated CUSTOMER session may browse ACTIVE org IDENTITY to pick one (Req 1)
    OR (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
        AND nullif(current_setting('app.tenant_id', true), '') IS NOT NULL
        AND "status" = 'ACTIVE')
    -- supplier sees ONLY its own org
    OR (current_setting('app.session_kind', true) = 'supplier'
        AND EXISTS (SELECT 1 FROM "Supplier" s
                    WHERE s.id = nullif(current_setting('app.supplier_id', true), '')
                      AND s."supplierOrgId" = "SupplierOrg".id))
  )
  WITH CHECK (current_setting('app.is_facility', true) = 'on');
```

The picker query in the app selects **only** identity columns (`name, slug, vatNumber, logoUrl, status`) and never joins to `Supplier`/`links`/`offers` — enforced by a whitelisted `lib/db` function (finding: picker access path must be explicit and PII-free).

### 2.2 `CompanySupplierLink` — vendor mutates & sees the whole map; company sees ONLY its own edges; **supplier branch REMOVED** (anti-roster-leak)

```sql
ALTER TABLE "CompanySupplierLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanySupplierLink" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS link_visibility ON "CompanySupplierLink";
CREATE POLICY link_visibility ON "CompanySupplierLink"
  USING (
    current_setting('app.is_facility', true) = 'on'
    OR (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
        AND "tenantId" = nullif(current_setting('app.tenant_id', true), ''))
  )
  WITH CHECK (current_setting('app.is_facility', true) = 'on');
```

**A supplier session can NEVER read `CompanySupplierLink`** — a supplier enumerating "which companies use ATEC" is a company-vs-company confidentiality leak (Req 6.6 / prior DECISIONS). A supplier learns nothing from this table; it operates on its per-tenant `Supplier` rows. A CI structural test asserts a plain `forTenant` session **can** read its own ACTIVE links so nobody tightens this into a fail-blind for the offer gate.

### 2.3 `Training` (Offer) — link-gated shared read; mutual-exclusivity write; `PUBLISHED` filter

```sql
DROP POLICY IF EXISTS catalog_visibility ON "Training";
CREATE POLICY catalog_visibility ON "Training"
  USING (
    -- SUPPLIER: own offers (incl. its DRAFTs) — UNCHANGED
    (current_setting('app.session_kind', true) = 'supplier'
       AND "supplierId" = nullif(current_setting('app.supplier_id', true), ''))
    OR (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
        AND (
          current_setting('app.is_facility', true) = 'on'
          -- SHARED offer via ACTIVE link, PUBLISHED only (Req 2; finding: promote Q5 to required)
          OR ("supplierOrgId" IS NOT NULL AND "status" = 'PUBLISHED' AND "retiredAt" IS NULL
              AND has_active_link(nullif(current_setting('app.tenant_id', true), ''), "supplierOrgId"))
          -- LEGACY per-tenant offer — ONLY when NOT shared (C6; finding: bar dual-identity rows)
          OR ("supplierOrgId" IS NULL AND "tenantId" = nullif(current_setting('app.tenant_id', true), ''))
          -- GLOBAL public catalog (unchanged)
          OR ("supplierOrgId" IS NULL AND "tenantId" IS NULL)
        ))
  )
  WITH CHECK (
    -- SUPPLIER writes a SHARED offer: supplierOrgId set, tenantId NULL (target state), owns the supplier row
    (current_setting('app.session_kind', true) = 'supplier'
       AND "supplierId" = nullif(current_setting('app.supplier_id', true), '')
       AND ("supplierOrgId" IS NULL OR "tenantId" IS NULL))   -- mutual exclusivity (C6)
    OR current_setting('app.is_facility', true) = 'on'
  );
```

Plus a CHECK (PR1 `NOT VALID`, PR4 `VALIDATE`): `CHECK (NOT ("tenantId" IS NOT NULL AND "supplierOrgId" IS NOT NULL))` and a transition-guard CHECK `CHECK ("supplierOrgId" IS NULL OR "tenantId" IS NOT NULL)` that is **dropped only in PR4** so no shared offer becomes globally-readable under the OLD policy during soak (finding H: PR2 leak window).

### 2.4 `TrainingSession` (Ação) — the CRITICAL private gate on its OWN tenantId

```sql
DROP POLICY IF EXISTS supplier_visibility ON "TrainingSession";
CREATE POLICY supplier_visibility ON "TrainingSession"
  USING (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "supplierId" = nullif(current_setting('app.supplier_id', true), '')
       AND "tenantId"   = nullif(current_setting('app.tenant_id', true), ''))   -- HARDENED: AND tenantId (finding C1)
    OR (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
        AND (current_setting('app.is_facility', true) = 'on'
             OR "tenantId" = nullif(current_setting('app.tenant_id', true), '')))
  )
  WITH CHECK (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    AND (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
         OR "supplierId" = nullif(current_setting('app.supplier_id', true), ''))
  );
```

The supplier branch now **AND**s `tenantId` (finding C1) so that even if a shared `User` login ever pointed `app.supplier_id` at a row in the wrong tenant, the supplier is confined to its own `(supplier, tenant)` pair. The HR branch gates on the session's **own** `tenantId` — the single most important line: a company linked to org X sees X's shared offer but **zero** of another company's Ações.

**Supplier-isolation policies also gain the same `AND tenantId` hardening on their supplier branches** for `Enrollment`, `CompletionRecord`, `Attachment` (they already have it — verified lines 466-467, 485-486, 504-505), and `Certificate`'s supplier branch is tightened to also require the completion's tenant (see §2.6).

### 2.5 Trigger 4b rewrite (CRITICAL — closes the session-less enrollment fail-open)

```sql
CREATE OR REPLACE FUNCTION enforce_enrollment_training_tenant() RETURNS trigger AS $$
DECLARE t_tenant TEXT; t_org TEXT;
BEGIN
  SELECT "tenantId", "supplierOrgId" INTO t_tenant, t_org FROM "Training" WHERE id = NEW."trainingId";
  IF NOT FOUND THEN RAISE EXCEPTION 'Enrollment references non-existent training %', NEW."trainingId"; END IF;
  IF t_org IS NOT NULL THEN
    -- SHARED offer: require an ACTIVE link for THIS enrollment's tenant (Req 2 anti-leak)
    IF NOT has_active_link(NEW."tenantId", t_org) THEN
      RAISE EXCEPTION 'no ACTIVE link for tenant % to offer org % (enrollment blocked)', NEW."tenantId", t_org;
    END IF;
  ELSIF t_tenant IS NOT NULL AND t_tenant <> NEW."tenantId" THEN
    RAISE EXCEPTION 'Enrollment (tenant=%) cannot reference tenant-private training of tenant %', NEW."tenantId", t_tenant;
  END IF; -- only a truly public offer (org NULL AND tenant NULL) stays universally enrollable
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
```

This covers **both** the `sessionId`-set and `sessionId`-NULL enrollment paths (the latter is what `enforce_session_offer_link` misses).

### 2.6 Integrity triggers — copy-and-REJECT (never silent overwrite)

**`enforce_session_offer_link` (new), BEFORE INSERT/UPDATE ON TrainingSession** — reject a spoofed tenantId instead of clobbering it (finding H1: make `WITH CHECK` a real gate):

```sql
CREATE OR REPLACE FUNCTION enforce_session_offer_link() RETURNS trigger AS $$
DECLARE v_org TEXT; v_sorg TEXT;
BEGIN
  SELECT o."supplierOrgId" INTO v_org FROM "Training" o WHERE o.id = NEW."trainingId";
  NEW."supplierOrgId" := v_org;                     -- copy from parent, never trust input
  -- REJECT a spoofed tenantId; require caller to pass it for shared offers (no silent GUC stamp)
  IF NEW."tenantId" IS NOT NULL
     AND NEW."tenantId" IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '') THEN
    RAISE EXCEPTION 'session tenantId % does not match session context %',
      NEW."tenantId", current_setting('app.tenant_id', true);
  END IF;
  IF NEW."tenantId" IS NULL THEN
    IF v_org IS NOT NULL THEN RAISE EXCEPTION 'shared-offer Ação requires an explicit tenantId'; END IF;
    NEW."tenantId" := nullif(current_setting('app.tenant_id', true), '');   -- only public offers may infer
  END IF;
  IF v_org IS NOT NULL THEN
    SELECT s."supplierOrgId" INTO v_sorg FROM "Supplier" s
      WHERE s.id = NEW."supplierId" AND s."tenantId" = NEW."tenantId";
    IF v_sorg IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'Ação supplier % (org %) not in offer org %', NEW."supplierId", v_sorg, v_org;
    END IF;
    IF TG_OP = 'INSERT' AND NOT has_active_link(NEW."tenantId", v_org) THEN
      RAISE EXCEPTION 'no ACTIVE link for tenant % to offer org %', NEW."tenantId", v_org;
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
```

Runs **after** 4d; 4d is amended to copy `session.supplierId` from parent **only when the parent still has a supplier** (legacy path), never nulling it for shared offers:

```sql
-- 4d amended: only copy when parent has a supplier; leave app-supplied supplierId for shared offers
CREATE OR REPLACE FUNCTION enforce_session_supplier() RETURNS trigger AS $$
DECLARE t_sup TEXT;
BEGIN
  SELECT "supplierId" INTO t_sup FROM "Training" WHERE id = NEW."trainingId";
  IF t_sup IS NOT NULL THEN NEW."supplierId" := t_sup; END IF;   -- shared offer (t_sup NULL): keep app value
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
```

**`enforce_enrollment_supplier` (4e) rewrite — derive from the SESSION, never from the shared offer** (finding H: HR enrollments against a shared offer got NULL supplierId):

```sql
CREATE OR REPLACE FUNCTION enforce_enrollment_supplier() RETURNS trigger AS $$
DECLARE t_sup TEXT; s_sup TEXT; s_tenant TEXT;
BEGIN
  IF NEW."sessionId" IS NOT NULL THEN
    SELECT "supplierId", "tenantId" INTO s_sup, s_tenant FROM "TrainingSession" WHERE id = NEW."sessionId";
    IF s_tenant IS DISTINCT FROM NEW."tenantId" THEN
      RAISE EXCEPTION 'enrollment tenant % != session tenant %', NEW."tenantId", s_tenant;
    END IF;
    IF NEW."supplierId" IS NOT NULL AND NEW."supplierId" IS DISTINCT FROM s_sup THEN
      RAISE EXCEPTION 'enrollment supplierId % != session supplier %', NEW."supplierId", s_sup;
    END IF;
    NEW."supplierId" := s_sup;                              -- the Ação decides the delivering supplier
  ELSE
    SELECT "supplierId" INTO t_sup FROM "Training" WHERE id = NEW."trainingId";
    IF t_sup IS NOT NULL THEN NEW."supplierId" := t_sup;
    ELSIF nullif(current_setting('app.supplier_id', true), '') IS NOT NULL THEN
      NEW."supplierId" := nullif(current_setting('app.supplier_id', true), '');
    END IF;
  END IF;
  -- the stamped supplier must live in the enrollment's tenant (blocks cross-tenant supplier stamp)
  IF NEW."supplierId" IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "Supplier" x WHERE x.id = NEW."supplierId" AND x."tenantId" = NEW."tenantId") THEN
    RAISE EXCEPTION 'enrollment supplier % not in tenant %', NEW."supplierId", NEW."tenantId";
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
```

Now an HR-created enrollment against a shared-offer Ação delivered by supplier X correctly inherits X's per-tenant supplierId **from the session**, so supplier X sees the worker and supplier Y (same org, different Ação) does not.

### 2.7 Certificate / StatusTransition / TrainingModule / Attachment — re-verified, not assumed

- **Certificate** supplier branch tightened to also require the completion's tenant (defense in depth; keeps the recursion explicit): the non-supplier branch stays `EXISTS(CompletionRecord c WHERE c.id = completionId)` and is tenant-safe **because `CompletionRecord` is tenant-keyed** — documented, not hand-waved.
- **StatusTransition / CompletionCategory** — no own tenantId; safe only via recursion into `Enrollment`/`CompletionRecord`. Locked by explicit cross-company tests (§4).
- **TrainingModule** — inherits `TrainingSession` policy; the module tests are the canary for any session-policy regression.
- **Attachment `tenantId IS NULL` READ escape must be removed for company sessions BEFORE `sessionId` is wired** (finding H): keep the NULL branch only for facility-authored global templates gated on `is_facility` at write; add trigger stamping `Attachment.tenantId` from the parent session; add CHECK that any Attachment with `sessionId` or `completionId` has NON-NULL `tenantId`. Deferred to the Attachment-sessionId sub-phase but flagged as blocking that work.

### 2.8 Facility-write defense-in-depth (finding L)

Trigger on `Supplier` and `CompanySupplierLink` INSERT: when `is_facility='on'`, assert the materialized `Supplier.tenantId = link.tenantId` and `Supplier.supplierOrgId = link.supplierOrgId`, catching a panel bug that passes a mismatched pair before it creates a phantom cross-company link.

**New GUC needs: NONE.** `forTenant`/`forSupplier`/`asFacility` bodies unchanged.

---

## 3. Super-admin panel

Route `app/[locale]/admin/**` (already gates `scopeType==='FACILITY'`). All reads via `asFacility`; account mutations via `lib/db/facility-accounts.ts` (raw client on non-tenant-scoped `User`/`Membership`, kept in `lib/db/**`).

### 3.1 New capabilities (add to `lib/auth/capabilities.ts` + CI matrix test)

`facility.map.read` (ADMIN+STAFF), `facility.link.manage` (ADMIN), `facility.org.manage` (ADMIN), `facility.account.read` (ADMIN+STAFF), `facility.account.reset` (ADMIN).

### 3.2 The board (boxes + lines)

Hand-rolled **SVG**, no graph lib. Two columns (companies left, suppliers right), edges as quadratic `<path>`. **Loaded by a hardened, PII-free `lib/db` function** (finding M): selects only `SupplierOrg` identity, `Tenant` name/slug, `CompanySupplierLink` edges, and grouped `COUNT(*)` of memberships — **never** `Worker/Enrollment/TrainingSession/Attachment`. A schema-pii-scan test asserts the loader's selected columns contain no PII. Mobile: two stacked shadcn Cards. Interaction: explicit two-step **Link mode** (bipartite-safe by construction; from a company only suppliers are clickable).

### 3.3 Link management (server actions, `asFacility`, atomic, audited)

- `createLink(tenantId, supplierOrgId)` — cap `facility.link.manage`. **Single transaction**, idempotent upsert on `@@id([tenantId, supplierOrgId])`: set link ACTIVE → find-or-**undelete** the `Supplier` projection (reusing the SAME `Supplier.id` on re-link to preserve Ação/enrollment lineage) → set `link.supplierId` → audit `facility.link.create`. C4 invariant (every ACTIVE link has a live Supplier in that tenant with matching org) enforced by a nightly assertion + the §2.8 trigger.
- `suspendLink(...)` — set `status='SUSPENDED'` (never hard-delete). Confirm dialog states exactly what remains visible (private history survives; new Ações/enrollments blocked; shared offers hidden).

### 3.4 Account management — `lib/db/facility-accounts.ts` (raw client)

`resetPassword`/`resetEmail`/`resetMfa` target the shared `User`, each bumps `User.sessionVersion += 1`. **HARD PREREQUISITE (finding):** `sessionVersion` is NOT enforced in the live Auth.js callbacks — bumping it is inert until the JWT/session callback embeds and checks it. The three reset actions are **feature-flagged off** and a startup/CI assertion confirms the callback enforces `sessionVersion` before they enable. Recommended: **step-up re-auth** (admin re-enters own password) given takeover blast radius; **verify-before-swap** for email; audit field-names only (never the address value).

### 3.5 Main + sub accounts

- Company primary: partial-unique `UNIQUE(tenantId) WHERE isPrimary AND scopeType='CUSTOMER'`.
- Supplier primary: stored as **`SupplierOrg.primaryMembershipId`** (single-row uniqueness) rather than a cross-tenant trigger scan (finding: the cross-tenant trigger would be blinded by Supplier RLS unless SECURITY DEFINER; the pointer is simpler and unambiguous).
- Fail-closed: "no main account → assign one" blocking CTA; reset actions refuse to run with no primary (no silent pick).

---

## 4. Migration path (expand → backfill → dual-write → swap → contract)

Four independently-revertible PRs; `security.sql` re-run after each `prisma migrate deploy`. **`Training.tenantId` is never dropped before the link-based policy is live; the RLS swap only narrows.**

**PR1 — additive schema (app identical; both isolation suites green).** Add `SupplierOrg`, `CompanySupplierLink`, `has_active_link()`, nullable columns, `Membership.isPrimary`. Add the two `Training` CHECKs `NOT VALID`: `NOT (tenantId AND supplierOrgId both set)` and the transition-guard `supplierOrgId IS NULL OR tenantId IS NOT NULL`. Add the three new tables' RLS. **Do NOT swap** `Training`/`TrainingSession` policies. Live app unchanged.

**PR2 — backfill + dual-write (old columns still drive RLS; NO shared-NULL-tenant offers yet).** Under `asFacility`: create one `SupplierOrg` per distinct real supplier, **vendor-reviewed staged dedup** by `vatNumber`+`normalizedName` (avoid merging distinct suppliers). `UPDATE Supplier SET supplierOrgId`. `INSERT CompanySupplierLink SELECT DISTINCT tenantId, supplierOrgId, 'ACTIVE' FROM Supplier`. `UPDATE Training SET supplierOrgId = ...` (leave `tenantId`; the transition-guard CHECK keeps it non-NULL so the OLD policy never treats it as global). **Backfill `TrainingSession.tenantId` from the session's OWN enrollments' tenantId** (NOT from the parent offer — finding H3), falling back to the parent only where a session has no enrollments. Add the GUC-stamping trigger for new sessions. Nightly drift-check: every `TrainingSession.tenantId` = the DISTINCT enrollment tenant; flag any session with enrollments from >1 tenant; flag any `Training` with both `tenantId` and `supplierOrgId`.

**PR3 — the RLS swap + fold TrainingSession.tenantId NOT NULL (single migration; the ONE behavior change).** Pre-flight assertions that FAIL the migration if unclean: (a) zero `Training` rows with both `tenantId` and `supplierOrgId`; (b) zero `TrainingSession` with NULL tenantId or with a `supplierId` not resolving within its `tenantId`. Then in ONE transaction: apply §2.1–2.8 policies + `has_active_link` gates + rewritten 4b/4d/4e + `enforce_session_offer_link`; make `TrainingSession.tenantId` **NOT NULL**; add the composite FK `[supplierId, tenantId]` and `(trainingId, supplierOrgId)` as `NOT VALID` then `VALIDATE`. This guarantees no window where the new session policy sees a NULL-tenant row. Gated on the new test file + both regression suites green against `app_user`.

**PR4 — contract (after soak).** Null `Training.tenantId` for shared offers; **drop the transition-guard CHECK**; remove the legacy `tenantId=GUC` read branch once no shared offer carries a `tenantId`; `VALIDATE` remaining CHECKs; `Supplier.supplierOrgId` → NOT NULL.

**Live demo (Worten/ATEC) is an id-preserving relabel:** same `Training.id`/`TrainingSession.id`/child ids; `Training` gains `supplierOrgId=ATEC` (tenantId nulled PR4); sessions gain `tenantId=demo_tenant`+`supplierOrgId=ATEC`. A future FNAC link immediately sees the same shared offer but none of Worten's Ações.

### Test plan

**KEEP GREEN:** `tests/isolation/tenant-isolation.test.ts`, `tests/isolation/supplier-isolation.test.ts` (small PR-level additive updates to also set new columns).

**ADD `tests/isolation/shared-offer-links.test.ts`** (real-DB `app_user`):
1. Linked company sees shared PUBLISHED offer; DRAFT offer hidden from company, visible to supplier.
2. **Unlinked company sees zero offers AND cannot enroll** (both `sessionId`-set and `sessionId`-NULL paths — trigger 4b).
3. **Two companies, one offer, no cross-Ação/enrollment/module/certificate/statustransition leak** (assert the full transitive chain for company B returns zero of company A's rows).
4. Supplier↔supplier still isolated; a mismatched `(tenant, supplier)` pair sees zero.
5. Fail-closed: no link/no context → 0 rows; empty-string GUC → 0 rows.
6. Suspend: company loses offer read + is blocked from new Ação/enrollment, but retains its own history; **assert supplier-authored Attachments/Certificates behavior per the confirmed Q3 decision.**
7. HR enrolls in a shared-offer Ação delivered by supplier X → supplier X sees the worker; supplier Y (same org, other Ação) does not.
8. Spoof: supplier session with `app.tenant_id` set to company B while its Membership is company A → Ação write REJECTED (not silently written).
9. Deduped/merged offer across two companies → each surviving session+modules readable only by its original company.

**CI structural guards:** `TrainingSession` policy no longer references `Training.tenantId`; `TrainingSession.tenantId` is NOT NULL at swap; `SupplierOrg`/`CompanySupplierLink` have FORCE RLS; `has_active_link`, `enforce_session_offer_link`, rewritten 4b/4d/4e exist; a plain `forTenant` session CAN read its own ACTIVE links; capability matrix includes the five `facility.*` caps; admin map loader selects no PII columns.

---

## 5. Traceability

| Isolation rule | Mechanism | Test |
|---|---|---|
| Companies never see each other's Ações | `supplier_visibility` HR branch = `TrainingSession.tenantId=GUC`; shared read stops at the offer table | 3 |
| Companies can't ENROLL against an unlinked shared offer | rewritten trigger 4b requires `has_active_link` (covers session-less path) | 2 |
| Suppliers never see other suppliers' offers/rosters | supplier branch keyed on own `supplierId`+`tenantId`; supplier CANNOT read `CompanySupplierLink` | 4; §2.2 |
| Offers shared only to LINKED companies, PUBLISHED only | `has_active_link` + `status='PUBLISHED'` in read gate | 1, 2, 5 |
| Shared offer isn't a leak vector to private rows | children keyed on private `(tenantId, supplierId)` / recurse into tenant-keyed parents; re-verified | 3 |
| Correct delivering supplier on shared-offer enrollment | 4e derives supplierId from the SESSION, rejects cross-tenant | 7 |
| Spoofed tenant on write rejected | copy-and-reject in `enforce_session_offer_link`; `WITH CHECK tenantId=GUC` is a real gate | 8 |
| Suspend hides offers/blocks new work, keeps owning history | `status` filter + Ação gates on tenantId + INSERT trigger requires ACTIVE | 6 |
| Fail-closed everywhere | `nullif(...,'')` in every predicate; `has_active_link` returns false on NULL | 5 |
| Proven supplier isolation preserved | `app.supplier_id` still per-tenant `Supplier.id`; helpers unchanged; no new GUC | supplier suite through PR4 |

---

## 6. Key files

Schema `prisma/schema.prisma`; RLS `prisma/sql/security.sql`; DB helpers `lib/db/index.ts` (unchanged), new `lib/db/facility-accounts.ts` + hardened map/picker loaders; capabilities `lib/auth/capabilities.ts`; auth callbacks `lib/auth/index.ts`+`lib/auth/config.ts` (add `sessionVersion` enforcement — blocks §3.4); panel `app/[locale]/admin/**`+`components/admin/**`; tests `tests/isolation/shared-offer-links.test.ts` (new) + existing suites kept green.