# Technical Standards

<!-- 
PURPOSE: Minimum code quality bar for all Trigger.dev tasks.
LOAD WHEN: Writing or reviewing task code.
-->

## Code Quality

- All payloads validated with Zod at task entry — never trust incoming data
- All external API calls wrapped in try/catch with meaningful error messages
- No hardcoded secrets — environment variables only, documented in `.env.example`
- Every task must be idempotent — safe to retry without side effects
- TypeScript strict mode — no `any`, no `@ts-ignore` without a comment explaining why
- SDK clients initialized at module scope in the task file (see `docs/conventions.md`)

## Error Handling

- Use Trigger.dev's retry mechanism — configure `retry` in task options, don't build custom retry loops
- Distinguish retriable errors (network timeout, rate limit) from permanent errors (invalid payload, auth failure)
- Log the error context (task ID, payload summary, service name) before throwing
- Never swallow errors silently — if you catch it, log it or rethrow it
- For multi-step tasks: use `io.runTask()` for each step so partial progress is preserved on retry

## Task Configuration

- Always set `retry` config explicitly — don't rely on defaults
- Always set a reasonable `maxDuration` — no infinite-running tasks
- Scheduled tasks: use cron expressions, not interval timers
- Event-triggered tasks: validate the event payload schema before processing

## Logging

- Use `logger.info()` for task progress milestones (started, completed, items processed)
- Use `logger.warn()` for recoverable issues (rate limit hit, retrying)
- Use `logger.error()` for failures (API errors, validation failures)
- Never log: full API keys, passwords, PII, complete request/response bodies with sensitive data
- Do log: task IDs, record counts, durations, service names, error codes

## Security

- Service role keys (Supabase, Stripe) only used server-side in tasks — never exposed to client
- API keys stored in Trigger.dev environment variables, not in code
- Supabase queries: use service role client for background tasks, never the anon client
- Stripe webhooks: always verify webhook signatures
- Validate all external input — webhook payloads, API responses, user data
