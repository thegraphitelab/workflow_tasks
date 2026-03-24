import { task, logger } from "@trigger.dev/sdk/v3";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

// --- Clients ---

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

// --- Payload ---

const PayloadSchema = z.object({
  organization_id: z.string().min(1),
});

type Payload = z.infer<typeof PayloadSchema>;

// --- Output ---

interface ProvisionResult {
  organization_id: string;
  twilio_sub_account_sid: string;
  already_provisioned: boolean;
}

// --- Task ---

export const twilioProvisionSubAccount = task({
  id: "twilio-provision-sub-account",
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

    logger.info("twilio-provision-sub-account started", { organization_id });

    // Step 1: Fetch org
    const { data: org, error: fetchError } = await supabase
      .from("organizations")
      .select("id, name, slug, twilio_sub_account_sid")
      .eq("id", organization_id)
      .single();

    if (fetchError || !org) {
      throw new Error(`Organization not found: ${organization_id}`);
    }

    // Step 2: Idempotency guard
    if (org.twilio_sub_account_sid) {
      logger.info("Already provisioned, returning existing SID", {
        organization_id,
        twilio_sub_account_sid: org.twilio_sub_account_sid,
      });
      return {
        organization_id,
        twilio_sub_account_sid: org.twilio_sub_account_sid,
        already_provisioned: true,
      };
    }

    // Validate Twilio credentials before calling API
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
    }

    // Step 3: Create Twilio sub-account (Task 3)
    throw new Error("Not implemented: Twilio sub-account creation");
  },
});
