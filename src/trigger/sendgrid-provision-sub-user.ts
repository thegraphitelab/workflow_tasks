import { task, logger } from "@trigger.dev/sdk/v3";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { z } from "zod";

// --- Clients ---

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

// --- Constants ---

const SENDGRID_API_BASE = "https://api.sendgrid.com/v3";
const POOL_NAMES = ["marketing", "transactional"] as const;
const MAX_USERNAME_ATTEMPTS = 3;
const MAX_DB_RETRIES = 3;

// --- Payload ---

const PayloadSchema = z.object({
  organization_id: z.string().min(1),
});

type Payload = z.infer<typeof PayloadSchema>;

// --- Output ---

interface ProvisionResult {
  organization_id: string;
  sendgrid_username: string;
  already_provisioned: boolean;
}

// --- Task ---

export const sendgridProvisionSubUser = task({
  id: "sendgrid-provision-sub-user",
  queue: { concurrencyLimit: 5 },
  machine: "micro",
  maxDuration: 60,
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10000,
    randomize: true,
  },
  run: async (payload: Payload): Promise<ProvisionResult> => {
    const validated = PayloadSchema.parse(payload);
    const { organization_id } = validated;

    logger.info("sendgrid-provision-sub-user started", { organization_id });

    // Step 1: Fetch org
    const { data: org, error: fetchError } = await supabase
      .from("organizations")
      .select("id, slug, sendgrid_sub_user")
      .eq("id", organization_id)
      .single();

    if (fetchError || !org) {
      throw new Error(`Organization not found: ${organization_id}`);
    }

    // Step 2: Idempotency guard
    if (org.sendgrid_sub_user) {
      logger.info("Already provisioned, returning existing username", {
        organization_id,
        sendgrid_username: org.sendgrid_sub_user,
      });
      return {
        organization_id,
        sendgrid_username: org.sendgrid_sub_user,
        already_provisioned: true,
      };
    }

    // Step 3: Resolve IPs, create subuser, write to DB (Task 3)
    throw new Error("Not implemented: SendGrid subuser creation");
  },
});
