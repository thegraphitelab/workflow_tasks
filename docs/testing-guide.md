# Testing Guide

<!-- 
PURPOSE: How to test Trigger.dev tasks locally before deploying.
LOAD WHEN: After building a task, before it moves to deploy.
-->

## Framework

- Local testing: Trigger.dev dev mode (`npx trigger.dev@latest dev`)
- Test runs: Trigger.dev test command (`npx trigger.dev@latest test [task-id]`)
- Unit tests (optional): Vitest for pure utility functions
- Type checking: `pnpm tsc --noEmit`

## What Must Be Tested

- **Every task runs successfully** in Trigger.dev dev mode with a realistic payload
- **Error handling works** — send a bad payload, verify it fails gracefully
- **Idempotency** — run the same task twice with the same payload, verify no duplicate side effects
- **Integration connectivity** — task can reach Supabase, Stripe, Slack, etc. from local env
- **Retry behavior** — for tasks with retry config, verify retries happen on transient failures

## What Does NOT Need Tests

- Trigger.dev SDK internals (they test their own library)
- Simple environment variable reads
- Type definitions

## Testing Process

### 1. Start the local environment
```bash
npx supabase start          # local Supabase
pnpm dev                     # Next.js (if tasks need it)
npx trigger.dev@latest dev   # Trigger.dev dev mode
```

### 2. Trigger a test run
Option A — via CLI:
```bash
npx trigger.dev@latest test [task-id] --payload '{"key": "value"}'
```

Option B — via Trigger.dev dashboard:
1. Go to https://cloud.trigger.dev
2. Find the task in the dev environment
3. Click "Test" and provide a payload

Option C — via your app code:
Trigger the task from your Next.js app in dev mode.

### 3. Verify in the dashboard
- Check the run completed successfully
- Check log output for expected milestones
- Check the target system (Supabase, Stripe, Slack) for expected results

### 4. Test failure cases
- Send an invalid payload — should fail with a clear error, not crash
- Disconnect from an external service (bad API key) — should fail retriably or permanently as appropriate
- Send a duplicate payload — should be idempotent

## Pre-Deploy Checklist

- [ ] Task runs successfully in Trigger.dev dev mode
- [ ] Payload validation works (bad payloads rejected with clear error)
- [ ] Idempotent — safe to retry without duplicate side effects
- [ ] Error handling covers the main failure modes
- [ ] Logging shows task progress and error context
- [ ] Type check passes: `pnpm tsc --noEmit`
- [ ] Lint passes: `pnpm lint`
- [ ] Environment variables documented in `.env.example`
- [ ] Review notes written in `pipeline/04-review/[slug]-review.md`
