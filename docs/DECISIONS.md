# Decision Log

Resolutions to the open questions from [ARCHITECTURE.md](ARCHITECTURE.md) §13. Newest round appended at the bottom.

## Round 1 — 2026-06-28

| # | Question | Decision | Impact on build |
|---|---|---|---|
| 1 | Timeline scope — include catalog trainings with no session/enrollment? | **No** — timeline shows only dated items (sessions, dated enrollments, completions). No "Unscheduled" lane. | Drop unscheduled-lane logic; simpler timeline queries. |
| 3 | Do workers log in? | **Yes** — workers can have their own logins. | Wire `WORKER` role + invitation onboarding into Phase 0 auth; worker portal screens stay in Phase 1b. |
| 4 | Catalog visibility | **Full published catalog (`ALL_PUBLISHED`)** for every customer. | Defer entitled-subset logic (`CatalogEntitlement`) until a customer needs it. |
| 5 | GDPR retention / lawful basis per category (PT/EU) | **Deferred — needs client DPO.** Safe EU defaults used meanwhile: retention 5 years; mandatory training = `LEGAL_OBLIGATION`; national ID NOT collected. | Values are configurable; confirm with DPO before go-live. No Phase 0 block. |
| 6 | Existing-platform integration shape | **Deferred to Phase 4.** Design stays integration-ready. | No Phase 0 impact. |
| 7 | Hosting / processors | **Deferred**, with one firm constraint: **EU data residency**. Default plan = EU-region managed services (e.g. Vercel `fra1` + Neon EU) with SCCs; fully-EU self-host remains a fallback. Decide before first production deploy. | No application-code impact; decide before deploy. |
| 2 | Facility ↔ customer worker-PII default | **Top admins only** — `FACILITY_ADMIN` may view customer worker PII directly (every access audited); `FACILITY_STAFF` see only anonymized/aggregated data. The owning customer's HR always sees their own workers. | Phase 0 builds role-based PII masking: PII unmasked for `FACILITY_ADMIN` (audited) + owning-tenant HR; masked for `FACILITY_STAFF`. RLS still enforces tenant isolation underneath. |

## Deployment note — 2026-06-28 — Database connection role (CRITICAL for security)

Supabase's default `postgres` user **bypasses Row-Level Security**, which would defeat tenant
isolation. This was caught by the isolation test: 2 of 3 checks failed when connecting as `postgres`.

**Resolution:** the application connects as a dedicated restricted role **`app_user`**
(`NOSUPERUSER NOBYPASSRLS`, granted CRUD on schema `public`). With `app_user`, all 3 isolation
checks pass against the live Supabase database.

- **`DATABASE_URL`** (app runtime — local **and Vercel**) → MUST use **`app_user`** (pooler, port 6543).
- **`DIRECT_URL`** (migrations / DDL only) → uses `postgres` (owner, port 5432).
- If the database is ever recreated, re-create `app_user` and re-grant before relying on isolation.

## Round 2 — 2026-07-03 — Supplier-centric model (refined objective)

The product is a **multi-tenant SaaS sold per company**. Refinements from the client:

- **Company (tenant)** = the buyer; companies never see each other (tenant RLS — already built & verified).
- **ATEC** = the software **vendor** (super-admin that onboards companies) **AND** can also appear as a **supplier** inside accounts.
- **HR (company admin)** creates **Supplier** login accounts and manages the company's workers.
- **Suppliers** are **per-company** entities with their own logins. Each supplier inputs its **available offers** and its **ongoing/past trainings** for that company — building its own dataset per company (incentive: keep the customer happy, showcase offers).
- 🔒 **Supplier-level isolation (NEW — IMPORTANT):** a supplier must not see other suppliers' trainings within the same company. Adds a second RLS dimension (`supplierId`) on top of `tenantId`.
- **Supplier → worker visibility:** a supplier sees **only the workers enrolled in that supplier's own trainings**, never the company's full staff list (GDPR).
- **Trainings created by BOTH** suppliers (self-serve) **and** HR (on a supplier's behalf / manual / via API).
- **API-ready:** pull suppliers' active trainings from their own platforms where available.

**Architecture impact:** `Supplier` becomes a per-tenant entity; a `SUPPLIER` membership carries both `tenantId` + `supplierId`; trainings/offers carry `supplierId`; new RLS scopes suppliers to their own rows and to enrolled workers only. The existing multi-tenant RLS foundation (app_user, tenant GUC, roles, schema) holds — this is an extension, not a rewrite.

**UI reference (client's existing platform screenshots):** worker-trainings list with columns Duração / Local / Início / Fim / Horário / Sigla / Situação (statuses e.g. "A iniciar", "Cancelada"), per-row ⋮ menu, search-by-field, CSV export; user-area sidebar (Perfil, Alterar password, Foto de perfil, Pagamentos, Controlo de Horas, Os meus colaboradores, Ações dos meus colaboradores, Inscrições dos meus colaboradores); section menu (Assiduidade, Cronograma, Colaboradores, Documentos dos colaboradores).

### Supplier identity across companies (2026-07-03)

Core principle: companies must feel the app is "theirs and only theirs" → **no cross-company visibility of anything**, including which suppliers exist in other companies. Therefore:

- **Each company creates its own supplier record.** Worten's "ATEC" ≠ another company's "ATEC" — fully isolated. **No global supplier directory is shown to companies**, and a company can never discover that a supplier already works with someone else. (Explicitly REJECT "show existing companies / prevent cross-company duplicates" — it would leak a supplier's client list and break the ownership feeling.)
- **Supplier logins are reused via email invitation** (Slack / Google-Docs pattern): HR adds a supplier + enters its contact email → the app emails an invite. If that email already has a login (from another company), accepting simply adds this company to the supplier's account (one login; a company switcher shows only the companies that invited them). If not, they create a login on accept. The inviting company's experience is identical either way and reveals nothing about prior existence.
- **Within a company**, prevent duplicate supplier records (unique by VAT number / normalized name) — a same-tenant check only, never cross-tenant.
- Implication: a `User` (login identity) may hold `SUPPLIER` memberships in multiple tenants; the `Supplier` **record/data** is always per-tenant and isolated.

## Round 3 — 2026-07-04 — Training structure (3 levels) + vendor super-admin

**Training structure** (real PT vocational-training shape):
- **Formação / Curso (Course)** = reusable definition: objectives, programmatic contents, duration, type (presencial / e-learning / b-learning). → `Training` (+ `objectives`, `programmaticContents`; `modality`=type, `nominalMinutes`=duration).
- **Ação de Formação** = a scheduled run of a course; **pre-filled from the course, editable**; start/end dates; optional **Módulos**; a **DTP** (document dossier) + **Certificados**. Workers enrol in an Ação. → `TrainingSession` (+ `name`/`objectives`/`programmaticContents`/`nominalMinutes`/`modality` overrides).
- **Módulo** = optional sub-unit of an Ação: **name + duration + contents**. → new `TrainingModule` (RLS inherited from parent session via EXISTS).
- **DTP + Certificates** = document areas on the Ação. Structure now; **file uploads (Supabase Storage) next**.

**Vendor super-admin (QUEUED — build after the supplier training UI):**
- Super-admin sees a **bipartite company↔supplier map** (many-to-many; NO company↔company or supplier↔supplier links).
- **Master supplier list (DECIDED):** the vendor curates a canonical supplier registry; companies **pick from it** (not free-create). This canonical identity lets the map show one supplier → many companies while companies stay isolated. → introduces a vendor-level `SupplierOrg` that per-company `Supplier` rows link to. **Replaces the current free-create HR supplier flow** (built in Phase 1.2 as a placeholder).
- **Main + sub accounts:** each company and each supplier has one "main" account (super-admin visible) + scoped sub-accounts (employees/trainers). → likely an `isPrimary` flag on `Membership`.
