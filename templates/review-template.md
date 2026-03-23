# [Task Name] — Review

## Task
- **Task ID:** `[task-id]`
- **Spec:** `pipeline/03-specs/[slug]-spec.md`
- **Code:** `src/trigger/[slug].ts`

## Local Test Results

### Test Run 1 — Happy Path
- **Payload:** `[what you sent]`
- **Result:** Pass / Fail
- **Duration:** [Xms]
- **Notes:** [what happened]

### Test Run 2 — Error Case
- **Payload:** `[bad/edge-case payload]`
- **Result:** Pass / Fail
- **Notes:** [did it fail gracefully?]

### Test Run 3 — Idempotency
- **Payload:** `[same payload as run 1]`
- **Result:** Pass / Fail
- **Notes:** [any duplicate side effects?]

## Acceptance Criteria Check

- [ ] [Criterion from spec]
- [ ] [Criterion from spec]
- [ ] [Criterion from spec]
- [ ] Idempotent — safe to run twice
- [ ] Error handling covers main failure modes
- [ ] Logging shows progress milestones
- [ ] Type check passes
- [ ] Lint passes

## Integration Verification

- [ ] Supabase: [verified reads/writes to correct tables]
- [ ] Stripe: [verified API calls work with test keys]
- [ ] Slack: [verified notifications land in correct channel]
- [ ] PostHog: [verified events captured]
- [ ] Edge Functions: [verified invocation works]

## Environment Variables

- [ ] All required env vars documented in `.env.example`
- [ ] All required env vars added to Trigger.dev dashboard (production)

## Ready to Deploy?
**Yes / No**

If no, what's blocking: [describe]

---

**Date:** [YYYY-MM-DD]
