# Integration Patterns

<!-- 
PURPOSE: How each external service is structured. Clients, auth, gotchas.
LOAD WHEN: Building any task that talks to Supabase, Stripe, Slack, PostHog, or Supabase Edge Functions.
-->

## General Rules

- Clients are initialized at **module scope in the task file** — no separate wrapper files (see `docs/conventions.md`)
- Credentials stored in Trigger.dev environment variables (not `.env` for production)
- All calls include error handling with retriable vs permanent error classification
- All responses typed — no `any` on API responses

---

## Supabase

- Auth: Service role key (`SUPABASE_SERVICE_ROLE_KEY`) — NOT the anon key
- Use: Database reads/writes, realtime subscriptions (rare in tasks), storage
- Init pattern (module scope in task file):

```typescript
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

export const supabaseAdmin = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
```

- Gotchas:
  - Service role bypasses RLS — be careful with what you read/write
  - Use `.upsert()` for idempotent writes, not `.insert()`
  - Batch inserts: chunk into groups of 500 (Supabase limit per request)
  - Always use generated types from `npx supabase gen types` — never hand-write table types
  - For edge functions called from tasks: use `supabaseAdmin.functions.invoke()`

---

## Supabase Edge Functions

- Location: `supabase/functions/[name]/index.ts`
- Deploy: `npx supabase functions deploy [name]`
- Called from tasks via: `supabaseAdmin.functions.invoke("function-name", { body: payload })`
- Auth: Edge functions can use the service role key passed in the Authorization header, or use their own env vars
- Gotchas:
  - Edge functions have a 150s default timeout (can be extended)
  - Memory limit: 256MB default
  - Cold starts: first invocation is slower — not a problem for background tasks
  - If the edge function is just a wrapper around a DB query, skip it — query directly from the task

---

## Stripe

- Auth: Secret key (`STRIPE_SECRET_KEY`)
- Use: Invoice syncing, subscription management, payment processing, webhook handling
- Init pattern (module scope in task file):

```typescript
import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-12-18.acacia", // [pin to your version]
});
```

- Gotchas:
  - Always pass `idempotencyKey` for write operations
  - Rate limit: 100 read requests/sec, 25 write requests/sec in live mode
  - Webhook signatures: verify with `stripe.webhooks.constructEvent()`
  - Pagination: use `stripe.invoices.list({ limit: 100, starting_after: lastId })`
  - Test mode vs live mode: separate API keys, separate webhook endpoints

---

## Slack

- Auth: Bot token (`SLACK_BOT_TOKEN`)
- Use: Status notifications, alerts, report delivery
- Init pattern (module scope in task file):

```typescript
import { WebClient } from "@slack/web-api";

export const slack = new WebClient(process.env.SLACK_BOT_TOKEN!);
```

- Gotchas:
  - Rate limits vary by method — `chat.postMessage` is 1 per second per channel
  - Use `blocks` for rich formatting, not `text` with markdown
  - Bot must be invited to the channel before posting
  - For scheduled messages: use Slack's `chat.scheduleMessage`, not Trigger.dev scheduling

---

## PostHog

- Auth: API key (`POSTHOG_API_KEY`) + project ID
- Use: Event tracking, feature flag evaluation, analytics queries
- Init pattern (module scope in task file):

```typescript
import { PostHog } from "posthog-node";

export const posthog = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
});
```

- Gotchas:
  - Call `posthog.shutdown()` at end of task to flush events
  - Feature flag evaluation in tasks: use `posthog.getFeatureFlag()` — server-side, not client
  - Batch capture: `posthog.capture()` buffers automatically, but flush before task ends
  - Rate limits: 10 requests/sec for query API, capture is generous
