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
