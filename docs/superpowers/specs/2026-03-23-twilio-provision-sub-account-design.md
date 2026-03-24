# Twilio Provision Sub-Account — Design Spec

## Overview
A Trigger.dev task that provisions a Twilio sub-account for an organization and writes the SID back to Supabase. Fire-and-forget — the calling Edge Function returns immediately and the admin portal detects completion via Supabase Realtime.

## Architecture

```
Admin Portal → Edge Function (admin-manage-account)
                    ↓ tasks.trigger("twilio-provision-sub-account", { organization_id })
                    ↓ returns 202 + run_id
              Trigger.dev
                    ↓
              1. Fetch org from Supabase
              2. Guard: already provisioned? → succeed (no-op)
              3. POST Twilio /Accounts.json → new sub-account
              4. UPDATE organizations.twilio_sub_account_sid
                    ↓
              Admin Portal detects via Realtime / polling
```

## Task Signature

**Task ID:** `twilio-provision-sub-account`

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
  twilio_sub_account_sid: string;  // AC...
  already_provisioned: boolean;
}
```

## Data Flow

### Step 1 — Fetch Organization
- Query `public.organizations` by `organization_id` using Supabase client initialized with secret key (`sb_secret_...`)
- Extract `name`, `slug`, and `twilio_sub_account_sid`
- If org not found → throw (task fails)

### Step 2 — Idempotency Guard
- If `twilio_sub_account_sid` is already set → return `{ organization_id, twilio_sub_account_sid, already_provisioned: true }`
- Task succeeds as a no-op — no Twilio call, no DB write

### Step 3 — Create Twilio Sub-Account
- `POST https://api.twilio.com/2010-04-01/Accounts.json`
- Basic Auth: `TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN` (env vars)
- Body: `FriendlyName` derived from org name/slug (e.g., `"TGL - Acme Corp (acme)"`)
- Parse response for new sub-account `sid` (format: `AC...`)

### Step 4 — Write SID to Organization
- `UPDATE public.organizations SET twilio_sub_account_sid = $sid WHERE id = $organization_id`
- Supabase secret key client (bypasses RLS)

### Step 5 — Return Result
- `{ organization_id, twilio_sub_account_sid: newSid, already_provisioned: false }`

## Error Handling

| Failure | Behavior | Recovery |
|---------|----------|----------|
| Org not found | Throw immediately — task fails | Fix org ID and re-trigger |
| Twilio API error (transient) | Trigger.dev task-level retries (up to 3). Re-runs from the top — idempotency guard not yet passed so Twilio is called again. | Safe to retry — worst case orphan sub-account |
| Twilio API error (permanent, e.g., 400) | Throw after retries exhaust | Fix payload/credentials and re-trigger |
| DB write fails after Twilio success | **Inner retry loop** (up to 3 attempts) around the DB write only — does NOT re-run the Twilio step | If all inner retries fail, task throws. Orphan SID recoverable via `link_twilio_sub_account` |

### Retry Strategy Detail
- **Twilio call:** Retried via Trigger.dev task-level retry. The full task re-runs, hits the idempotency guard (SID not yet written), and re-attempts the Twilio call. May create orphan sub-accounts — acceptable per PRD.
- **DB write:** Retried via an **inner retry loop** within the task run. This isolates the DB write from the Twilio call so a write failure does not re-create a sub-account. If the inner retry exhausts, the task throws and Trigger.dev task-level retry kicks in — but at that point the idempotency guard won't help (SID not written), so a new Twilio sub-account may be created. This is the acknowledged worst case; orphans are recoverable.

## Environment Variables

| Var | Purpose |
|-----|---------|
| `TWILIO_ACCOUNT_SID` | Master account SID for Basic Auth |
| `TWILIO_AUTH_TOKEN` | Master account auth token for Basic Auth |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Secret key (`sb_secret_...`) — maps to `service_role` Postgres role, bypasses RLS |

## Integrations

| System | Operation | Auth |
|--------|-----------|------|
| Supabase | READ + UPDATE `public.organizations` | Secret key (`sb_secret_...`, bypasses RLS) |
| Twilio REST API | POST `/2010-04-01/Accounts.json` | Basic Auth (master SID + token) |

## Acceptance Criteria

1. New org (no SID) → Twilio sub-account created, SID written to org row, task returns SID
2. Already-provisioned org → task succeeds immediately, returns existing SID, `already_provisioned: true`
3. Non-existent org → task throws
4. Twilio transient failure → retried up to 3 times via Trigger.dev
5. DB write failure after Twilio success → write retried, orphan recoverable if all fail
6. FriendlyName in Twilio console matches org name/slug pattern
