# Managing database egress (Supabase)

"Egress" = data transferred **out** of the database (mostly query results flowing to the
app). Supabase meters it (Free tier ≈ 5 GB/month total; Pro includes 250 GB then bills
overage). This doc is the policy we follow so dev + showcase stay cheap and within limits.

## The biggest levers (in order of impact)

1. **Fetch only what you need (columns).**
   Always use Prisma `select` with an explicit column whitelist. Never load heavy columns
   (`description`, `rawPayload`, `manualOverrides`, base64, etc.) in list views — only on detail pages.

2. **Never fetch unbounded lists (rows).**
   Every list is **paginated**. Defaults: page size 20–50; cursor-based pagination for the
   timeline and long lists. No `findMany` without `take`. Review/lint rule to enforce this.

3. **Don't re-query unchanged data every request (cache).**
   - **Reference data** (categories, sources) and the **global catalog**: cache with
     `unstable_cache` / route `revalidate` (e.g. 300–3600s). These rarely change.
   - **Per-request dedupe** with React `cache()` so one request never queries the same thing twice.
   - **Tenant data** (workers, hours): short revalidate or on-demand `revalidateTag()` after writes.

4. **Aggregate in the database, not the app.**
   Use the SQL views (`v_worker_hours`, `v_company_hours`, …) and `count()` with indexes
   instead of pulling rows to the app to sum/count them. Avoid N+1 — prefer one query with
   `include`/joins over many small ones.

5. **Keep files out of the database.**
   Certificates/attachments live in object storage + CDN (already our design), never as DB
   blobs. Serving a file through the DB is huge egress.

6. **We don't use Supabase Realtime** (we use Prisma) — so no subscription egress. Keep it that way unless there's a clear need.

## Development phase

- Prefer the **no-DB unit tests** (capabilities, PII, schema-scan) for fast iteration; run the
  DB isolation test only when touching data access.
- Avoid full-table queries while iterating.
- **Optional but effective:** run a local Postgres (Docker) for heavy development and reserve
  Supabase for the showcase, so dev traffic doesn't consume the showcase budget. (Ask Claude to set this up.)

## Showcase / demo phase

- Seed a **realistic but modest** dataset, not a huge one.
- The catalog and landing pages are read-mostly during demos → cache them aggressively.
- Watch usage live during/after demos.

## Monitoring & guardrails (do these in Supabase)

- **Supabase Dashboard → Reports / Usage → Egress**: check it regularly.
- **Set a spend cap** (Settings → Billing) so there are never surprise charges.
- If egress ever grows a lot, consider **Prisma Accelerate** (edge query cache + pooling) as a drop-in.

## Related: co-locate compute with the database

Our DB is in **eu-central-1**. Configure Vercel functions to run in **Frankfurt (`fra1`)** so
queries don't cross the Atlantic on every request — better latency and keeps data in-region
(also good for GDPR). This doesn't reduce egress *volume* but improves everything else.

## Enforced in code (Phase 1 onward)

- [ ] All list queries paginated (`take` + cursor/offset), capped page size.
- [ ] Explicit `select` whitelists; heavy columns excluded from lists.
- [ ] Catalog + reference data cached with revalidation; writes trigger targeted revalidation.
- [ ] Aggregations via SQL views, not app-side row pulls.
- [ ] Review checklist item: "does this add an unbounded or over-fetching query?"
