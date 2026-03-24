# SendGrid Provision Sub-User — Design Spec

## Overview
A Trigger.dev task that provisions a SendGrid subuser for an organization and writes the username back to Supabase. Fire-and-forget — the calling Edge Function returns immediately and the admin portal detects completion via Supabase Realtime.

## Architecture

```
Admin Portal → Edge Function (admin-manage-account)
                    ↓ tasks.trigger("sendgrid-provision-sub-user", { organization_id })
                    ↓ returns 202 + run_id
              Trigger.dev
                    ↓
              1. Fetch org from Supabase
              2. Guard: sendgrid_sub_user already set? → succeed (no-op)
              3. GET /v3/ips/pools/marketing      → collect all IPs
              4. GET /v3/ips/pools/transactional   → collect all IPs
              5. Deduplicate IPs
              6. POST /v3/subusers (username from slug, retry on collision)
              7. UPDATE organizations.sendgrid_sub_user (inner retry)
                    ↓
              Admin Portal detects via Realtime / polling
```

## Task Signature

**Task ID:** `sendgrid-provision-sub-user`

**Input:**
```ts
{
  organization_id: string; // org_...
}
```

**Output:**
```ts
{
  organization_id: string;
  sendgrid_username: string;
  already_provisioned: boolean;
}
```

## Data Flow

### Step 1 — Fetch Organization
- Query `public.organizations` by `organization_id` using Supabase client initialized with secret key (`sb_secret_...`)
- Select `id`, `slug`, `sendgrid_sub_user`
- If org not found → throw (task fails)

### Step 2 — Idempotency Guard
- If `sendgrid_sub_user` is already set → return `{ organization_id, sendgrid_username: org.sendgrid_sub_user, already_provisioned: true }`
- Task succeeds as a no-op — no SendGrid calls, no DB write

### Step 3 — Resolve IPs from Pools
- `GET /v3/ips/pools/marketing` and `GET /v3/ips/pools/transactional` fired in parallel via `Promise.all`
- Auth: Bearer token using `SENDGRID_API_KEY` env var
- Extract IP address strings from both responses
- Deduplicate into a single array (an IP could theoretically exist in both pools)
- If either pool is empty or the endpoint returns an error → throw (don't create a subuser with no IPs)

### Step 4 — Create SendGrid Subuser
- Derive username from org slug (e.g., `acme`)
- Derive email: `info@{slug}.graphitelab.ai`
- Generate password: crypto-random 48-char string (used once at creation, never stored — subusers are machine-managed, no human login)
- `POST /v3/subusers` with `{ username, email, password, ips }`
- Auth: Bearer token using `SENDGRID_API_KEY`
- On username collision (400 or 429 with username-related error message):
  - Append random 4-char hex suffix: `acme-a3f1`
  - Email becomes `info@{slug}-{suffix}.graphitelab.ai` (email must also be unique per SendGrid)
  - Retry up to 3 total attempts before failing
- On success: extract `username` and `user_id` from response
- Validate response contains expected fields

### Step 5 — Write Username to Organization
- `UPDATE public.organizations SET sendgrid_sub_user = $username WHERE id = $organization_id`
- Supabase secret key client (bypasses RLS)
- Inner retry loop (up to 3 attempts with linear backoff) — isolates DB write from SendGrid call so a write failure does not re-create a subuser

### Step 6 — Return Result
- `{ organization_id, sendgrid_username: username, already_provisioned: false }`

## Error Handling

| Failure | Behavior | Recovery |
|---------|----------|----------|
| Org not found | Throw immediately — task fails | Fix org ID and re-trigger |
| IP pool empty or missing | Throw immediately — task fails | Add IPs to pool in SendGrid console |
| Username collision (all 3 attempts) | Throw after retries exhaust | Extremely unlikely — investigate manually |
| SendGrid API error (transient) | Trigger.dev task-level retries (up to 3). Re-runs from the top — idempotency guard catches if prior run wrote the username. | Safe to retry |
| SendGrid API error (permanent, e.g., 403) | Throw after retries exhaust | Check account tier / API key permissions |
| DB write fails after SendGrid success | Inner retry loop (up to 3 attempts) — does NOT re-run SendGrid calls | If all inner retries fail, task throws. Orphan subuser recoverable via manual `link_sendgrid_sub_user` |

### Retry Strategy Detail
- **SendGrid calls:** Retried via Trigger.dev task-level retry. The full task re-runs, hits the idempotency guard (username not yet written), and re-attempts the SendGrid calls. May create an orphan subuser — acceptable, recoverable manually.
- **DB write:** Retried via an inner retry loop within the task run. This isolates the DB write from the SendGrid calls so a write failure does not re-create a subuser. If the inner retry exhausts, the task throws and Trigger.dev task-level retry kicks in — but at that point the idempotency guard won't help (username not written), so a new subuser may be created. This is the acknowledged worst case; orphans are recoverable.

## Environment Variables

| Var | Purpose |
|-----|---------|
| `SENDGRID_API_KEY` | Master account API key for Bearer auth |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Secret key (`sb_secret_...`) — maps to `service_role` Postgres role, bypasses RLS |

## Integrations

| System | Operation | Auth |
|--------|-----------|------|
| Supabase | READ + UPDATE `public.organizations` | Secret key (`sb_secret_...`, bypasses RLS) |
| SendGrid REST API | GET `/v3/ips/pools/marketing` | Bearer token (master API key) |
| SendGrid REST API | GET `/v3/ips/pools/transactional` | Bearer token (master API key) |
| SendGrid REST API | POST `/v3/subusers` | Bearer token (master API key) |

## Task Configuration

| Setting | Value |
|---------|-------|
| `queue.concurrencyLimit` | 5 |
| `machine` | `"micro"` |
| `maxDuration` | 60 (seconds) |
| `retry.maxAttempts` | 3 |
| `retry.factor` | 2 |
| `retry.minTimeoutInMs` | 1000 |
| `retry.maxTimeoutInMs` | 10000 |
| `retry.randomize` | true |

## Acceptance Criteria

1. New org (no `sendgrid_sub_user`) → subuser created, username written to org row, task returns username
2. Already-provisioned org → task succeeds immediately, returns existing username, `already_provisioned: true`
3. Non-existent org → task throws
4. Username collision → retried with random suffix (up to 3 attempts)
5. Empty IP pool → task throws with clear error
6. SendGrid transient failure → retried via Trigger.dev task-level retry
7. DB write failure after SendGrid success → inner retry, orphan recoverable if all fail
8. Subuser visible in SendGrid console with IPs from both marketing and transactional pools
