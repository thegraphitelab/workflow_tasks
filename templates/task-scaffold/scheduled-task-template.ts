import { schedules, logger } from "@trigger.dev/sdk/v3";

// --- Scheduled Task Definition ---
export const [taskName] = schedules.task({
  id: "[task-id]",
  cron: "[cron-expression]", // e.g., "0 */6 * * *" for every 6 hours
  maxDuration: 300, // seconds — adjust per task
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10_000,
    factor: 2,
  },
  run: async (payload) => {
    const { timestamp, lastTimestamp } = payload;
    logger.info("Scheduled task started", {
      taskId: "[task-id]",
      triggeredAt: timestamp,
      lastRanAt: lastTimestamp,
    });

    // Use lastTimestamp for incremental syncs:
    // const newRecords = await fetchRecordsSince(lastTimestamp);

    // 1. Fetch data (incremental since last run)
    // const data = await ...

    // 2. Process
    // const result = ...

    // 3. Write results
    // await ...

    logger.info("Scheduled task completed", { taskId: "[task-id]" });
    return { success: true };
  },
});
