# Workflow Request: Twilio Provision Sub-Account

> **Status:** Ready for Implementation
> **Date:** 2026-03-23
> **Requested by:** supabase_management repo
> **Target task ID:** `twilio-provision-sub-account` (matches filename in `workflow_tasks/src/trigger/`)

---

## Summary

Creates a new Twilio sub-account under the TGL master account and links it to an organization. Triggered by an admin action in the admin portal via the `admin-manage-account` Edge Function.

## Trigger

- [x] **Edge Function dispatch** — `admin-manage-account` action `create_twilio_sub_account` calls `triggerTask("twilio-provision-sub-account", { organization_id })`

## Payload

```ts
interface Payload {
  organization_id: string; // org_...
}
```

## Steps

1. **Fetch org** — Read `organizations` row by `organization_id`. If `twilio_sub_account_sid` is already set, succeed immediately (no-op). Use org `name` and `slug` to build a friendly name.
2. **Create Twilio sub-account** — `POST https://api.twilio.com/2010-04-01/Accounts.json` with `FriendlyName` derived from org name/slug. Authenticate with master account SID + auth token from env vars (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`).
3. **Write SID to org** — Update `organizations.twilio_sub_account_sid` with the new sub-account's SID via Supabase secret key client (`sb_secret_...`).

## Supabase Tables Touched

| Table | Operation | Notes |
|-------|-----------|-------|
| `public.organizations` | READ | Fetch org details, verify no existing SID |
| `public.organizations` | UPDATE | Write `twilio_sub_account_sid` |

## Error Handling

- **Org already has SID:** Succeed immediately as a no-op — return existing SID. Do not call Twilio. (Soft idempotency prevents noisy failures from double-clicks or retries.)
- **Twilio API failure:** Retry up to 3 times (Trigger.dev built-in retry). Twilio sub-account creation is safe to retry — worst case creates an orphan sub-account that can be cleaned up manually.
- **DB write failure after Twilio success:** Retry the DB write. The Twilio sub-account exists but isn't linked — admin can use `link_twilio_sub_account` as manual recovery.

## Credentials

Master Twilio Account SID + Auth Token from Trigger.dev env vars. No per-org credentials — the parent account manages all sub-accounts.

## Success Criteria

- `organizations.twilio_sub_account_sid` is set to the new `AC...` SID
- The sub-account is visible in the Twilio console under the master account
