# Code Conventions

<!-- 
PURPOSE: Code organization rules for Trigger.dev tasks in this repo.
LOAD WHEN: Any code task — building, reviewing, or modifying tasks.
-->

## File Organization

- Task definitions: `src/trigger/[slug].ts` — one file per task, self-contained
- Multi-file tasks: `src/trigger/[slug]/index.ts` + helpers in same folder
- Shared utilities: `src/trigger/utils/` — reusable helpers across tasks
- Types: `src/trigger/types/` — shared TypeScript interfaces
- Edge functions: `supabase/functions/[name]/index.ts` — Supabase Edge Functions

### Client Initialization

Initialize SDK clients and API clients at **module scope in the task file** — not in separate integration wrapper files. Each task should be readable top-to-bottom without jumping to other files.

```typescript
// ✅ Good — client lives in the task file
import Stripe from "stripe";
import { task } from "@trigger.dev/sdk/v3";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export const myTask = task({
  id: "my-task",
  run: async (payload) => {
    const invoice = await stripe.invoices.retrieve(payload.invoiceId);
    // ...
  },
});
```

If two tasks use the same service, each initializes its own client. The 2-3 lines of init are not worth abstracting into a shared file — readability and isolation matter more.

## Naming

| What | Convention | Example |
|------|-----------|---------|
| Task files | kebab-case | `stripe-sync.ts` |
| Task IDs | kebab-case | `stripe-invoice-sync` |
| Functions | camelCase | `syncStripeInvoices` |
| Types/Interfaces | PascalCase | `StripeInvoicePayload` |
| Constants | UPPER_SNAKE | `MAX_RETRY_ATTEMPTS` |
| Environment variables | UPPER_SNAKE | `SUPABASE_SERVICE_ROLE_KEY` |

## Patterns We Follow

- Every task has a single `task()` or `schedules.task()` export as default
- SDK clients initialized at module scope in the task file (see File Organization above)
- For raw HTTP calls, `fetch` is fine — no need to wrap it in a client class
- Environment variables accessed via `process.env` with validation at task init, not inline
- Payloads validated with Zod schemas defined at the top of the task file
- Idempotency: every task must be safe to retry. Use idempotency keys where the integration supports them.

## Patterns to Avoid

- No `any` types — use proper TypeScript interfaces for all payloads and responses
- No hardcoded secrets — environment variables only
- No side effects at import time — all logic inside the task `run()` function
- No `console.log` — use Trigger.dev's built-in `logger` or `io.logger`
- No synchronous loops for batch operations — use Trigger.dev's `batchTrigger` or chunked processing
