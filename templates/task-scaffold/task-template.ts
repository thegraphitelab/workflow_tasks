import { task, logger } from "@trigger.dev/sdk/v3";
import { z } from "zod";

// --- Payload Schema ---
const PayloadSchema = z.object({
  // [Define your payload fields here]
  // example: userId: z.string().uuid(),
});

type Payload = z.infer<typeof PayloadSchema>;

// --- Task Definition ---
export const [taskName] = task({
  id: "[task-id]",
  maxDuration: 60, // seconds — adjust per task
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10_000,
    factor: 2,
  },
  run: async (payload: Payload) => {
    // 1. Validate payload
    const validated = PayloadSchema.parse(payload);
    logger.info("Task started", { taskId: "[task-id]" });

    // 2. Fetch data
    // const data = await ...

    // 3. Process
    // const result = ...

    // 4. Write results
    // await ...

    // 5. Notify (if applicable)
    // await ...

    logger.info("Task completed", { taskId: "[task-id]" });
    return { success: true };
  },
});
