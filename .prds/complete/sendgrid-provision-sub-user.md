# Workflow Request: SendGrid Provision Sub-User

> **Status:** Ready for Implementation
> **Date:** 2026-03-23
> **Requested by:** supabase_management repo
> **Target task ID:** `sendgrid-provision-sub-user` (matches filename in `workflow_tasks/src/trigger/`)

---

## Summary

Creates a new SendGrid subuser under the TGL master account and links it to an organization. Triggered by an admin action in the admin portal via the `admin-manage-account` Edge Function.

## Trigger

- [x] **Edge Function dispatch** — `admin-manage-account` action `create_sendgrid_sub_user` calls `triggerTask("sendgrid-provision-sub-user", { organization_id })`

## Payload

```ts
interface Payload {
  organization_id: string; // org_...
}
```

## Steps

1. **Fetch org** — Read `organizations` row by `organization_id`. Fail fast if `sendgrid_sub_user` is already set. Use org `slug` to derive username.
2. **Create SendGrid subuser** — `POST https://api.sendgrid.com/v3/subusers` with username derived from org slug, a generated email, and a random password. Authenticate with master API key from env var (`SENDGRID_API_KEY`). If username is taken, append a short random suffix and retry (up to 3 attempts).
3. **Write username to org** — Update `organizations.sendgrid_sub_user` with the created username via service_role Supabase client.

## Supabase Tables Touched

| Table | Operation | Notes |
|-------|-----------|-------|
| `public.organizations` | READ | Fetch org details, verify no existing subuser |
| `public.organizations` | UPDATE | Write `sendgrid_sub_user` |

## Error Handling

- **Org already has subuser:** Fail immediately, do not call SendGrid. Return error.
- **Username collision:** Append random 4-char suffix to org slug and retry (up to 3 attempts before failing).
- **SendGrid API failure:** Retry up to 3 times (Trigger.dev built-in retry).
- **DB write failure after SendGrid success:** Retry the DB write. The subuser exists but isn't linked — admin can use `link_sendgrid_sub_user` as manual recovery.

## Credentials

Master SendGrid API key from Trigger.dev env vars. No per-org credentials.

## Success Criteria

- `organizations.sendgrid_sub_user` is set to the created username
- The subuser is visible in the SendGrid console under the master account
