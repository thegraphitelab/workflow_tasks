# [Task Name] — Technical Spec

## Overview
[1-2 sentences. What this task does, derived from the brief.]

## Task Configuration

| Property | Value |
|----------|-------|
| Task ID | `[kebab-case-id]` |
| Type | [scheduled \| event-triggered \| batch] |
| Schedule | [cron expression, or "N/A" for event tasks] |
| Max Duration | [seconds] |
| Retry | [max attempts, backoff strategy] |

## Payload Schema

```typescript
// Zod schema for the task input
const PayloadSchema = z.object({
  // [define fields]
});
```

## Integration Points

### [Service Name, e.g., Supabase]
- **Operation:** [read/write/upsert]
- **Auth:** [which env var]
- **Init** (module scope in task file): [SDK client initialization]
- **Usage:** [how it's called in the task]
- **Gotchas:** [rate limits, response quirks, retry behavior]

### [Next Service]
- ...

## Logic Flow

1. [Step 1: Validate payload]
2. [Step 2: Fetch data from X]
3. [Step 3: Transform/process]
4. [Step 4: Write results to Y]
5. [Step 5: Notify via Z (if applicable)]

## Error Handling

| Error Case | Type | Response |
|-----------|------|----------|
| [Invalid payload] | Permanent | Fail with validation error |
| [Service X unavailable] | Retriable | Retry with backoff |
| [Rate limited by API] | Retriable | Retry after delay |
| [Record not found] | Permanent | Log warning, skip |

## Idempotency Strategy
[How this task is safe to retry. Upserts? Idempotency keys? Check-before-write?]

## Environment Variables Required

| Variable | Purpose |
|----------|---------|
| [VAR_NAME] | [what it's for] |

## Acceptance Criteria

- [ ] [Criterion 1: specific, testable]
- [ ] [Criterion 2]
- [ ] [Criterion 3]
- [ ] Idempotent — safe to run twice with same input
- [ ] Error handling covers main failure modes
- [ ] Logging shows progress milestones
- [ ] Type check passes
- [ ] Runs successfully in Trigger.dev dev mode

## Out of Scope
[What this task deliberately does NOT do. Prevents scope creep during build.]

---

**Status:** draft | review | approved
**Brief source:** `pipeline/02-briefs/[slug]-brief.md`
