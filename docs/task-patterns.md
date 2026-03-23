# Task Patterns

<!-- 
PURPOSE: Trigger.dev-specific patterns for each task type.
LOAD WHEN: Writing specs or building tasks. Especially useful at spec stage to pick the right pattern.
-->

## Task Types

### Scheduled Task (Cron)
Runs on a schedule. Good for: data syncs, report generation, cleanup jobs.

```typescript
import { schedules } from "@trigger.dev/sdk/v3";

export const myScheduledTask = schedules.task({
  id: "my-scheduled-task",
  cron: "0 */6 * * *", // every 6 hours
  maxDuration: 300, // 5 minutes
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10000,
    factor: 2,
  },
  run: async (payload) => {
    // payload.timestamp — when the schedule triggered
    // payload.lastTimestamp — when it last ran (use for incremental syncs)
  },
});
```

### Event-Triggered Task
Fires when triggered by your app code. Good for: webhook processing, user actions, async workflows.

```typescript
import { task } from "@trigger.dev/sdk/v3";
import { z } from "zod";

const PayloadSchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(["created", "updated", "deleted"]),
});

export const myEventTask = task({
  id: "my-event-task",
  maxDuration: 60,
  retry: {
    maxAttempts: 3,
    factor: 2,
  },
  run: async (payload) => {
    const validated = PayloadSchema.parse(payload);
    // process...
  },
});
```

### Batch Task
Processes many items. Good for: bulk syncs, migrations, mass notifications.

```typescript
import { task, batch } from "@trigger.dev/sdk/v3";

export const processBatch = task({
  id: "process-batch",
  maxDuration: 600,
  run: async (payload: { items: string[] }) => {
    // Trigger child tasks for each item
    const results = await batch.trigger(
      payload.items.map((item) => ({
        task: processItem,
        payload: { itemId: item },
      }))
    );
    return { processed: results.length };
  },
});

export const processItem = task({
  id: "process-item",
  retry: { maxAttempts: 3 },
  run: async (payload: { itemId: string }) => {
    // process single item
  },
});
```

### Multi-Step Task
Orchestrates several sequential steps with checkpoints. Good for: complex workflows, data pipelines.

```typescript
import { task, logger } from "@trigger.dev/sdk/v3";

export const multiStepTask = task({
  id: "multi-step-task",
  maxDuration: 300,
  run: async (payload) => {
    // Step 1: Fetch data
    logger.info("Fetching data", { source: payload.source });
    const data = await fetchData(payload.source);

    // Step 2: Transform
    logger.info("Transforming", { count: data.length });
    const transformed = await transformData(data);

    // Step 3: Write results
    logger.info("Writing results", { count: transformed.length });
    await writeResults(transformed);

    return { processed: transformed.length };
  },
});
```

## Common Patterns

### Idempotency
Every task must be safe to retry. Strategies:
- **Database upserts** instead of inserts (Supabase: `upsert()`)
- **Idempotency keys** for payment APIs (Stripe: `idempotencyKey`)
- **Check-before-write** — query if the work was already done before doing it again
- **Trigger.dev's `idempotencyKey`** on task trigger to prevent duplicate runs

### Rate Limiting
When calling rate-limited APIs:
- Use `await new Promise(r => setTimeout(r, ms))` between calls
- Implement exponential backoff on 429 responses
- Track rate limit headers and pause before hitting limits
- For bulk operations: chunk into smaller batches with delays between chunks

### Pagination
When syncing data from paginated APIs:
- Always use cursor-based pagination when available (more reliable than offset)
- Process each page before fetching the next
- Store the cursor/checkpoint so retries can resume from where they left off
- Log page number and total for progress tracking

### Error Classification
```typescript
function isRetriable(error: unknown): boolean {
  if (error instanceof Error) {
    // Network errors, timeouts, rate limits
    if (error.message.includes("ECONNRESET")) return true;
    if (error.message.includes("timeout")) return true;
  }
  // HTTP 429 (rate limit), 502/503/504 (server errors)
  if ("status" in (error as any)) {
    const status = (error as any).status;
    return [429, 502, 503, 504].includes(status);
  }
  return false;
}
```
