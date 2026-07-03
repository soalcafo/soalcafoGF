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
