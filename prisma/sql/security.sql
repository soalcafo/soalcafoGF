-- ════════════════════════════════════════════════════════════════════════════
-- security.sql — Postgres-level guarantees Prisma cannot express.
--
-- Apply AFTER `prisma migrate deploy` (or `prisma migrate dev`), e.g.:
--   pnpm db:security
-- It is IDEMPOTENT and re-runnable: run it again after every schema migration.
--
-- Contents:
--   1. Row-Level Security (RLS) — tenant isolation backstop (the load-bearing safety net)
--   2. Partial UNIQUE indexes — idempotency + "one active" invariants Prisma can't express
--   3. CHECK constraints — single-table invariants
--   4. Triggers — cross-row tenant consistency + append-only enforcement
--
-- Tenant context is provided per transaction by the app via:
--   SELECT set_config('app.tenant_id', '<tenantId>', true);   -- transaction-local
--   SELECT set_config('app.is_facility', 'on', true);         -- only for verified facility sessions
-- An unset GUC reads as NULL → every comparison fails closed (returns no rows).
-- ════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- 1. ROW-LEVEL SECURITY
-- ──────────────────────────────────────────────────────────────────────────
-- Helper: a policy that scopes a table by its own tenantId column, with an
-- explicit, opt-in facility read-bypass for cross-tenant aggregates/timeline.
-- (FORCE makes the policy apply even to the table owner.)

-- Worker (PII) ---------------------------------------------------------------
ALTER TABLE "Worker" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Worker" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Worker";
CREATE POLICY tenant_isolation ON "Worker"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.is_facility', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- ConsentRecord --------------------------------------------------------------
ALTER TABLE "ConsentRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsentRecord" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ConsentRecord";
CREATE POLICY tenant_isolation ON "ConsentRecord"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.is_facility', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Enrollment -----------------------------------------------------------------
ALTER TABLE "Enrollment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Enrollment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Enrollment";
CREATE POLICY tenant_isolation ON "Enrollment"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.is_facility', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- CompletionRecord (append-only) --------------------------------------------
ALTER TABLE "CompletionRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompletionRecord" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CompletionRecord";
CREATE POLICY tenant_isolation ON "CompletionRecord"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.is_facility', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Attachment (file metadata; tenantId nullable for facility/global) ----------
ALTER TABLE "Attachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attachment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Attachment";
CREATE POLICY tenant_isolation ON "Attachment"
  USING ("tenantId" IS NULL
         OR "tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.is_facility', true) = 'on')
  WITH CHECK ("tenantId" IS NULL
              OR "tenantId" = current_setting('app.tenant_id', true));

-- Invitation (tenantId nullable for facility-staff invites) ------------------
ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invitation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Invitation";
CREATE POLICY tenant_isolation ON "Invitation"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.is_facility', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
              OR current_setting('app.is_facility', true) = 'on');

-- CatalogEntitlement ---------------------------------------------------------
ALTER TABLE "CatalogEntitlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CatalogEntitlement" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CatalogEntitlement";
CREATE POLICY tenant_isolation ON "CatalogEntitlement"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.is_facility', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
              OR current_setting('app.is_facility', true) = 'on');

-- CustomerEmailDomain --------------------------------------------------------
ALTER TABLE "CustomerEmailDomain" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerEmailDomain" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CustomerEmailDomain";
CREATE POLICY tenant_isolation ON "CustomerEmailDomain"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.is_facility', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
              OR current_setting('app.is_facility', true) = 'on');

-- TenantIdentityProvider -----------------------------------------------------
ALTER TABLE "TenantIdentityProvider" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantIdentityProvider" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TenantIdentityProvider";
CREATE POLICY tenant_isolation ON "TenantIdentityProvider"
  USING ("tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.is_facility', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
              OR current_setting('app.is_facility', true) = 'on');

-- Training (global catalog rows have tenantId NULL; tenant-private rows are scoped)
ALTER TABLE "Training" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Training" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_visibility ON "Training";
CREATE POLICY catalog_visibility ON "Training"
  USING ("tenantId" IS NULL
         OR "tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.is_facility', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
              OR current_setting('app.is_facility', true) = 'on');

-- TrainingSource (same global/private rule) ----------------------------------
ALTER TABLE "TrainingSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingSource" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS source_visibility ON "TrainingSource";
CREATE POLICY source_visibility ON "TrainingSource"
  USING ("tenantId" IS NULL
         OR "tenantId" = current_setting('app.tenant_id', true)
         OR current_setting('app.is_facility', true) = 'on')
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
              OR current_setting('app.is_facility', true) = 'on');

-- Child tables without their own tenantId — scoped via their parent ----------
ALTER TABLE "StatusTransition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StatusTransition" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StatusTransition";
CREATE POLICY tenant_isolation ON "StatusTransition"
  USING (EXISTS (SELECT 1 FROM "Enrollment" e
                 WHERE e.id = "StatusTransition"."enrollmentId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Enrollment" e
                      WHERE e.id = "StatusTransition"."enrollmentId"));

ALTER TABLE "Certificate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Certificate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Certificate";
CREATE POLICY tenant_isolation ON "Certificate"
  USING (EXISTS (SELECT 1 FROM "CompletionRecord" c
                 WHERE c.id = "Certificate"."completionId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "CompletionRecord" c
                      WHERE c.id = "Certificate"."completionId"));

ALTER TABLE "CompletionCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompletionCategory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CompletionCategory";
CREATE POLICY tenant_isolation ON "CompletionCategory"
  USING (EXISTS (SELECT 1 FROM "CompletionRecord" c
                 WHERE c.id = "CompletionCategory"."completionId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "CompletionRecord" c
                      WHERE c.id = "CompletionCategory"."completionId"));

-- NOTE (Phase 1 hardening): translation/link tables and the ingestion tables
-- (IngestRun/IngestedRecord/MatchCandidate) are not yet RLS-scoped — they hold
-- shared catalog data / Phase-3 integration data with no tenant PII yet.

-- ──────────────────────────────────────────────────────────────────────────
-- 2. PARTIAL UNIQUE INDEXES (idempotency + "one active" invariants)
-- ──────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "uq_source_slug_global"
  ON "TrainingSource" ("slug") WHERE "tenantId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_source_slug_tenant"
  ON "TrainingSource" ("tenantId", "slug") WHERE "tenantId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_source_normname_tenant"
  ON "TrainingSource" ("tenantId", "normalizedName") WHERE "tenantId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_training_extref_global"
  ON "Training" ("sourceId", "externalRef")
  WHERE "externalRef" IS NOT NULL AND "tenantId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_training_extref_tenant"
  ON "Training" ("tenantId", "sourceId", "externalRef")
  WHERE "tenantId" IS NOT NULL AND "externalRef" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "ix_training_public_catalog"
  ON "Training" ("status")
  WHERE "tenantId" IS NULL AND "status" = 'PUBLISHED' AND "retiredAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_session_extref"
  ON "TrainingSession" ("trainingId", "externalRef") WHERE "externalRef" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_enroll_sessionless"
  ON "Enrollment" ("workerId", "trainingId")
  WHERE "sessionId" IS NULL AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_enroll_session"
  ON "Enrollment" ("workerId", "trainingId", "sessionId")
  WHERE "sessionId" IS NOT NULL AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_enroll_active_seat"
  ON "Enrollment" ("sessionId", "workerId")
  WHERE "sessionId" IS NOT NULL AND "deletedAt" IS NULL
        AND "status" NOT IN ('CANCELLED', 'NO_SHOW');

CREATE UNIQUE INDEX IF NOT EXISTS "uq_completion_active"
  ON "CompletionRecord" ("enrollmentId") WHERE "supersededById" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_completion_extref_tenant"
  ON "CompletionRecord" ("tenantId", "externalRef") WHERE "externalRef" IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. CHECK CONSTRAINTS (single-table invariants; added idempotently)
-- ──────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Membership: scope/role consistency.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_membership_scope_role') THEN
    ALTER TABLE "Membership" ADD CONSTRAINT chk_membership_scope_role CHECK (
         ("scopeType" = 'FACILITY' AND "tenantId" IS NULL  AND "supplierId" IS NULL
            AND "role" IN ('FACILITY_ADMIN', 'FACILITY_STAFF'))
      OR ("scopeType" = 'CUSTOMER' AND "tenantId" IS NOT NULL AND "supplierId" IS NULL
            AND "role" IN ('COMPANY_ADMIN', 'HR_MANAGER', 'WORKER'))
      OR ("scopeType" = 'SUPPLIER' AND "supplierId" IS NOT NULL AND "tenantId" IS NULL
            AND "role" = 'SUPPLIER_PORTAL')
    );
  END IF;

  -- TrainingSource: tenant-private iff a tenantId is set.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_source_tenant_private') THEN
    ALTER TABLE "TrainingSource" ADD CONSTRAINT chk_source_tenant_private CHECK (
      "isTenantPrivate" = ("tenantId" IS NOT NULL)
    );
  END IF;

  -- Hours are non-negative.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_enrollment_minutes') THEN
    ALTER TABLE "Enrollment" ADD CONSTRAINT chk_enrollment_minutes CHECK ("plannedMinutes" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_completion_minutes') THEN
    ALTER TABLE "CompletionRecord" ADD CONSTRAINT chk_completion_minutes CHECK ("actualMinutes" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_session_dates') THEN
    ALTER TABLE "TrainingSession" ADD CONSTRAINT chk_session_dates CHECK ("endsAt" >= "startsAt");
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. TRIGGERS (cross-row tenant consistency + append-only enforcement)
-- ──────────────────────────────────────────────────────────────────────────

-- 4a. A CompletionRecord must belong to the same (tenant, worker) as its enrollment.
CREATE OR REPLACE FUNCTION enforce_completion_consistency() RETURNS trigger AS $$
DECLARE
  e_tenant TEXT;
  e_worker TEXT;
BEGIN
  SELECT e."tenantId", e."workerId" INTO e_tenant, e_worker
  FROM "Enrollment" e WHERE e.id = NEW."enrollmentId";
  IF e_tenant IS NULL THEN
    RAISE EXCEPTION 'CompletionRecord references a non-existent enrollment %', NEW."enrollmentId";
  END IF;
  IF e_tenant <> NEW."tenantId" OR e_worker <> NEW."workerId" THEN
    RAISE EXCEPTION 'CompletionRecord (tenant=%, worker=%) does not match its enrollment (tenant=%, worker=%)',
      NEW."tenantId", NEW."workerId", e_tenant, e_worker;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_completion_consistency ON "CompletionRecord";
CREATE TRIGGER trg_completion_consistency
  BEFORE INSERT OR UPDATE ON "CompletionRecord"
  FOR EACH ROW EXECUTE FUNCTION enforce_completion_consistency();

-- 4b. An Enrollment may only reference a global Training (tenantId NULL) or one
--     owned by the same tenant.
CREATE OR REPLACE FUNCTION enforce_enrollment_training_tenant() RETURNS trigger AS $$
DECLARE
  t_tenant TEXT;
  t_exists BOOLEAN;
BEGIN
  SELECT ("tenantId" IS NOT NULL), "tenantId" INTO t_exists, t_tenant
  FROM "Training" WHERE id = NEW."trainingId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment references a non-existent training %', NEW."trainingId";
  END IF;
  IF t_tenant IS NOT NULL AND t_tenant <> NEW."tenantId" THEN
    RAISE EXCEPTION 'Enrollment (tenant=%) cannot reference tenant-private training of tenant %',
      NEW."tenantId", t_tenant;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enrollment_training_tenant ON "Enrollment";
CREATE TRIGGER trg_enrollment_training_tenant
  BEFORE INSERT OR UPDATE ON "Enrollment"
  FOR EACH ROW EXECUTE FUNCTION enforce_enrollment_training_tenant();

-- 4c. Append-only: CompletionRecord and AuditLog rows may never be deleted.
CREATE OR REPLACE FUNCTION forbid_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Rows in % are append-only and cannot be deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_no_delete_completion ON "CompletionRecord";
CREATE TRIGGER trg_no_delete_completion
  BEFORE DELETE ON "CompletionRecord"
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();

DROP TRIGGER IF EXISTS trg_no_delete_audit ON "AuditLog";
CREATE TRIGGER trg_no_delete_audit
  BEFORE DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- ════════════════════════════════════════════════════════════════════════════
-- SUPPLIER-LEVEL RLS (Phase 1.1) — a SECOND isolation dimension AND-ed under tenant.
--
-- HR/facility sessions never set app.session_kind='supplier' and behave exactly as before.
-- A SUPPLIER session (forSupplier) sets app.tenant_id + app.supplier_id + app.session_kind
-- in one batch; it is confined to its OWN supplier-owned rows and to workers ACTIVELY
-- enrolled in its OWN trainings. Every predicate uses nullif(...,'') so an empty-string GUC
-- fails CLOSED, and the supplier branch requires app.session_kind='supplier' so a supplier
-- session that lost its supplier id matches NOTHING instead of "all suppliers".
-- Re-runnable / idempotent, like the rest of this file.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Membership scope/role CHECK: SUPPLIER now requires BOTH tenantId + supplierId (F19) ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Membership" WHERE "scopeType" = 'SUPPLIER' AND ("tenantId" IS NULL OR "supplierId" IS NULL))
  THEN RAISE EXCEPTION 'backfill legacy SUPPLIER memberships to (tenantId, supplierId) before applying this constraint'; END IF;
END $$;

ALTER TABLE "Membership" DROP CONSTRAINT IF EXISTS chk_membership_scope_role;
ALTER TABLE "Membership" ADD CONSTRAINT chk_membership_scope_role CHECK (
     ("scopeType" = 'FACILITY' AND "tenantId" IS NULL     AND "supplierId" IS NULL
        AND "role" IN ('FACILITY_ADMIN', 'FACILITY_STAFF'))
  OR ("scopeType" = 'CUSTOMER' AND "tenantId" IS NOT NULL AND "supplierId" IS NULL
        AND "role" IN ('COMPANY_ADMIN', 'HR_MANAGER', 'WORKER'))
  OR ("scopeType" = 'SUPPLIER' AND "tenantId" IS NOT NULL AND "supplierId" IS NOT NULL
        AND "role" = 'SUPPLIER_PORTAL')
);

-- ── Companion CHECKs: a supplier-owned row is ALWAYS inside a company (F19) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_training_supplier_tenant') THEN
    ALTER TABLE "Training" ADD CONSTRAINT chk_training_supplier_tenant CHECK ("supplierId" IS NULL OR "tenantId" IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_source_supplier_tenant') THEN
    ALTER TABLE "TrainingSource" ADD CONSTRAINT chk_source_supplier_tenant CHECK ("supplierId" IS NULL OR "tenantId" IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_attachment_supplier_tenant') THEN
    ALTER TABLE "Attachment" ADD CONSTRAINT chk_attachment_supplier_tenant CHECK ("supplierId" IS NULL OR "tenantId" IS NOT NULL);
  END IF;
END $$;

-- ── Partial index serving the enrolled-only Worker subquery (F5) ──
CREATE INDEX IF NOT EXISTS "ix_enroll_active_supplier"
  ON "Enrollment" ("supplierId", "workerId", "tenantId")
  WHERE "deletedAt" IS NULL AND "status" NOT IN ('CANCELLED', 'NO_SHOW');

-- ── SupplierOrg (master list): the global supplier identity. Managed ONLY by the
--    super-admin (facility). No tenant owns it; no company/supplier session may read or
--    write it. Companies interact with their per-tenant "Supplier" row instead. ──
ALTER TABLE "SupplierOrg" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierOrg" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS facility_only ON "SupplierOrg";
CREATE POLICY facility_only ON "SupplierOrg"
  USING (current_setting('app.is_facility', true) = 'on')
  WITH CHECK (current_setting('app.is_facility', true) = 'on');

-- ── Supplier table: a supplier session sees ONLY its own row (never other suppliers) ──
ALTER TABLE "Supplier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Supplier" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Supplier";
CREATE POLICY tenant_isolation ON "Supplier"
  USING (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "id" = nullif(current_setting('app.supplier_id', true), ''))
    OR (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
        AND ("tenantId" = nullif(current_setting('app.tenant_id', true), '')
             OR current_setting('app.is_facility', true) = 'on'))
  )
  WITH CHECK (
    coalesce(current_setting('app.session_kind', true), '') <> 'supplier' -- suppliers never write Supplier rows
    AND ("tenantId" = nullif(current_setting('app.tenant_id', true), '')
         OR current_setting('app.is_facility', true) = 'on')
  );

-- ── Training: supplier sees only its own offers; HR/facility see catalog + global ──
DROP POLICY IF EXISTS catalog_visibility ON "Training";
CREATE POLICY catalog_visibility ON "Training"
  USING (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "supplierId" = nullif(current_setting('app.supplier_id', true), ''))
    OR (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
        AND ("tenantId" IS NULL
             OR "tenantId" = nullif(current_setting('app.tenant_id', true), '')
             OR current_setting('app.is_facility', true) = 'on'))
  )
  WITH CHECK (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "tenantId" = nullif(current_setting('app.tenant_id', true), '')
       AND "supplierId" = nullif(current_setting('app.supplier_id', true), ''))
    OR (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
        AND ("tenantId" = nullif(current_setting('app.tenant_id', true), '')
             OR current_setting('app.is_facility', true) = 'on'))
  );

-- ── TrainingSource: same shape as Training ──
DROP POLICY IF EXISTS source_visibility ON "TrainingSource";
CREATE POLICY source_visibility ON "TrainingSource"
  USING (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "supplierId" = nullif(current_setting('app.supplier_id', true), ''))
    OR (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
        AND ("tenantId" IS NULL
             OR "tenantId" = nullif(current_setting('app.tenant_id', true), '')
             OR current_setting('app.is_facility', true) = 'on'))
  )
  WITH CHECK (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "tenantId" = nullif(current_setting('app.tenant_id', true), '')
       AND "supplierId" = nullif(current_setting('app.supplier_id', true), ''))
    OR (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
        AND ("tenantId" = nullif(current_setting('app.tenant_id', true), '')
             OR current_setting('app.is_facility', true) = 'on'))
  );

-- ── TrainingSession: denormalized supplierId (trigger-copied from parent Training) ──
ALTER TABLE "TrainingSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingSession" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_visibility ON "TrainingSession";
CREATE POLICY supplier_visibility ON "TrainingSession"
  USING (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "supplierId" = nullif(current_setting('app.supplier_id', true), ''))
    OR (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
        AND (current_setting('app.is_facility', true) = 'on'
             OR EXISTS (SELECT 1 FROM "Training" t
                        WHERE t.id = "TrainingSession"."trainingId"
                          AND (t."tenantId" IS NULL
                               OR t."tenantId" = nullif(current_setting('app.tenant_id', true), '')))))
  )
  WITH CHECK (
    coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
    OR "supplierId" = nullif(current_setting('app.supplier_id', true), '')
  );

-- ── Worker: HR sees full roster; SUPPLIER sees ONLY its ACTIVELY-enrolled workers (F5) ──
DROP POLICY IF EXISTS tenant_isolation ON "Worker";
CREATE POLICY tenant_isolation ON "Worker"
  USING (
    (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
       AND (current_setting('app.is_facility', true) = 'on'
            OR "tenantId" = nullif(current_setting('app.tenant_id', true), '')))
    OR (current_setting('app.session_kind', true) = 'supplier'
        AND "tenantId" = nullif(current_setting('app.tenant_id', true), '')
        AND EXISTS (
          SELECT 1 FROM "Enrollment" e
          WHERE e."workerId" = "Worker".id
            AND e."tenantId" = "Worker"."tenantId"
            AND e."supplierId" = nullif(current_setting('app.supplier_id', true), '')
            AND e."deletedAt" IS NULL
            AND e."status" NOT IN ('CANCELLED', 'NO_SHOW')
        ))
    OR (nullif(current_setting('app.worker_id', true), '') IS NOT NULL -- worker self (F18)
        AND "Worker".id = nullif(current_setting('app.worker_id', true), ''))
  )
  WITH CHECK ("tenantId" = nullif(current_setting('app.tenant_id', true), '')); -- suppliers never write Worker rows

-- ── Enrollment: supplier narrows on its own denormalized supplierId ──
DROP POLICY IF EXISTS tenant_isolation ON "Enrollment";
CREATE POLICY tenant_isolation ON "Enrollment"
  USING (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "tenantId" = nullif(current_setting('app.tenant_id', true), '')
       AND "supplierId" = nullif(current_setting('app.supplier_id', true), ''))
    OR (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
        AND ("tenantId" = nullif(current_setting('app.tenant_id', true), '')
             OR current_setting('app.is_facility', true) = 'on'))
  )
  WITH CHECK (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "tenantId" = nullif(current_setting('app.tenant_id', true), '')
       AND "supplierId" = nullif(current_setting('app.supplier_id', true), ''))
    OR (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
        AND "tenantId" = nullif(current_setting('app.tenant_id', true), ''))
  );

-- ── CompletionRecord: supplier narrows on its own denormalized supplierId ──
DROP POLICY IF EXISTS tenant_isolation ON "CompletionRecord";
CREATE POLICY tenant_isolation ON "CompletionRecord"
  USING (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "tenantId" = nullif(current_setting('app.tenant_id', true), '')
       AND "supplierId" = nullif(current_setting('app.supplier_id', true), ''))
    OR (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
        AND ("tenantId" = nullif(current_setting('app.tenant_id', true), '')
             OR current_setting('app.is_facility', true) = 'on'))
  )
  WITH CHECK (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "tenantId" = nullif(current_setting('app.tenant_id', true), '')
       AND "supplierId" = nullif(current_setting('app.supplier_id', true), ''))
    OR (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
        AND "tenantId" = nullif(current_setting('app.tenant_id', true), ''))
  );

-- ── Attachment (F1): supplier sees ONLY its own; NO tenantId-NULL escape for suppliers ──
DROP POLICY IF EXISTS tenant_isolation ON "Attachment";
CREATE POLICY tenant_isolation ON "Attachment"
  USING (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "tenantId" = nullif(current_setting('app.tenant_id', true), '')
       AND "supplierId" = nullif(current_setting('app.supplier_id', true), ''))
    OR (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
        AND ("tenantId" IS NULL
             OR "tenantId" = nullif(current_setting('app.tenant_id', true), '')
             OR current_setting('app.is_facility', true) = 'on'))
  )
  WITH CHECK (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "tenantId" = nullif(current_setting('app.tenant_id', true), '')
       AND "supplierId" = nullif(current_setting('app.supplier_id', true), ''))
    OR (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
        AND ("tenantId" IS NULL OR "tenantId" = nullif(current_setting('app.tenant_id', true), '')))
  );

-- ── Certificate (F11): explicit supplier deliverable, scoped directly by supplierId ──
ALTER TABLE "Certificate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Certificate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Certificate";
CREATE POLICY tenant_isolation ON "Certificate"
  USING (
    (current_setting('app.session_kind', true) = 'supplier'
       AND "supplierId" = nullif(current_setting('app.supplier_id', true), ''))
    OR (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
        AND EXISTS (SELECT 1 FROM "CompletionRecord" c WHERE c.id = "Certificate"."completionId"))
  )
  WITH CHECK (
    coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
    OR "supplierId" = nullif(current_setting('app.supplier_id', true), '')
  );

-- ── ConsentRecord (F10): supplier sees consents only for its actively-enrolled workers ──
DROP POLICY IF EXISTS tenant_isolation ON "ConsentRecord";
CREATE POLICY tenant_isolation ON "ConsentRecord"
  USING (
    (coalesce(current_setting('app.session_kind', true), '') <> 'supplier'
       AND (current_setting('app.is_facility', true) = 'on'
            OR "tenantId" = nullif(current_setting('app.tenant_id', true), '')))
    OR (current_setting('app.session_kind', true) = 'supplier'
        AND "tenantId" = nullif(current_setting('app.tenant_id', true), '')
        AND EXISTS (SELECT 1 FROM "Enrollment" e
                    WHERE e."workerId" = "ConsentRecord"."workerId"
                      AND e."tenantId" = "ConsentRecord"."tenantId"
                      AND e."supplierId" = nullif(current_setting('app.supplier_id', true), '')
                      AND e."deletedAt" IS NULL
                      AND e."status" NOT IN ('CANCELLED', 'NO_SHOW')))
  )
  WITH CHECK ("tenantId" = nullif(current_setting('app.tenant_id', true), ''));

-- ── Triggers: keep denormalized supplierId consistent (copy from lineage, reject forgery) ──

-- 4d. TrainingSession.supplierId := parent Training.supplierId
CREATE OR REPLACE FUNCTION enforce_session_supplier() RETURNS trigger AS $$
DECLARE t_sup TEXT;
BEGIN
  SELECT "supplierId" INTO t_sup FROM "Training" WHERE id = NEW."trainingId";
  NEW."supplierId" := t_sup;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_session_supplier ON "TrainingSession";
CREATE TRIGGER trg_session_supplier
  BEFORE INSERT OR UPDATE ON "TrainingSession"
  FOR EACH ROW EXECUTE FUNCTION enforce_session_supplier();

-- 4e. Enrollment.supplierId := parent Training.supplierId; if the training has no supplier
--     (global catalog / HR in-house) and a supplier session is enrolling, stamp the supplier
--     from the GUC so the enrollment grants visibility. Rejects any forged mismatch (F2).
CREATE OR REPLACE FUNCTION enforce_enrollment_supplier() RETURNS trigger AS $$
DECLARE t_sup TEXT;
BEGIN
  SELECT "supplierId" INTO t_sup FROM "Training" WHERE id = NEW."trainingId";
  IF t_sup IS NOT NULL THEN
    IF NEW."supplierId" IS NOT NULL AND NEW."supplierId" IS DISTINCT FROM t_sup THEN
      RAISE EXCEPTION 'enrollment supplierId % does not match parent training supplier %', NEW."supplierId", t_sup;
    END IF;
    NEW."supplierId" := t_sup;
  ELSIF nullif(current_setting('app.supplier_id', true), '') IS NOT NULL THEN
    NEW."supplierId" := nullif(current_setting('app.supplier_id', true), '');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_enrollment_supplier ON "Enrollment";
CREATE TRIGGER trg_enrollment_supplier
  BEFORE INSERT OR UPDATE ON "Enrollment"
  FOR EACH ROW EXECUTE FUNCTION enforce_enrollment_supplier();

-- Extend the existing completion-consistency trigger to ALSO derive supplierId from the
-- enrollment (copy, reject mismatch) — keeps CompletionRecord.supplierId authoritative (F2).
CREATE OR REPLACE FUNCTION enforce_completion_consistency() RETURNS trigger AS $$
DECLARE
  e_tenant TEXT;
  e_worker TEXT;
  e_sup    TEXT;
BEGIN
  SELECT e."tenantId", e."workerId", e."supplierId" INTO e_tenant, e_worker, e_sup
  FROM "Enrollment" e WHERE e.id = NEW."enrollmentId";
  IF e_tenant IS NULL THEN
    RAISE EXCEPTION 'CompletionRecord references a non-existent enrollment %', NEW."enrollmentId";
  END IF;
  IF e_tenant <> NEW."tenantId" OR e_worker <> NEW."workerId" THEN
    RAISE EXCEPTION 'CompletionRecord (tenant=%, worker=%) does not match its enrollment (tenant=%, worker=%)',
      NEW."tenantId", NEW."workerId", e_tenant, e_worker;
  END IF;
  IF NEW."supplierId" IS NOT NULL AND NEW."supplierId" IS DISTINCT FROM e_sup THEN
    RAISE EXCEPTION 'CompletionRecord supplierId % does not match its enrollment supplier %', NEW."supplierId", e_sup;
  END IF;
  NEW."supplierId" := e_sup;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4f. Attachment.supplierId := parent CompletionRecord.supplierId (F1)
CREATE OR REPLACE FUNCTION enforce_attachment_supplier() RETURNS trigger AS $$
DECLARE c_sup TEXT;
BEGIN
  IF NEW."completionId" IS NOT NULL THEN
    SELECT "supplierId" INTO c_sup FROM "CompletionRecord" WHERE id = NEW."completionId";
    NEW."supplierId" := c_sup;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_attachment_supplier ON "Attachment";
CREATE TRIGGER trg_attachment_supplier
  BEFORE INSERT OR UPDATE ON "Attachment"
  FOR EACH ROW EXECUTE FUNCTION enforce_attachment_supplier();

-- Certificate.supplierId := parent CompletionRecord.supplierId (F11)
CREATE OR REPLACE FUNCTION enforce_certificate_supplier() RETURNS trigger AS $$
DECLARE c_sup TEXT;
BEGIN
  SELECT "supplierId" INTO c_sup FROM "CompletionRecord" WHERE id = NEW."completionId";
  NEW."supplierId" := c_sup;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_certificate_supplier ON "Certificate";
CREATE TRIGGER trg_certificate_supplier
  BEFORE INSERT OR UPDATE ON "Certificate"
  FOR EACH ROW EXECUTE FUNCTION enforce_certificate_supplier();

-- ── TrainingModule (Módulo): isolation inherited from its parent Ação (TrainingSession).
--    Postgres applies TrainingSession's RLS inside the subquery, so a supplier only ever
--    sees modules of its own sessions, and HR sees all in-tenant. ──
ALTER TABLE "TrainingModule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingModule" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TrainingModule";
CREATE POLICY tenant_isolation ON "TrainingModule"
  USING (EXISTS (SELECT 1 FROM "TrainingSession" s WHERE s.id = "TrainingModule"."sessionId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "TrainingSession" s WHERE s.id = "TrainingModule"."sessionId"));
