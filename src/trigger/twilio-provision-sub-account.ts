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

// --- Twilio ---

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";
const MAX_FRIENDLY_NAME_LENGTH = 64;

function buildFriendlyName(name: string, slug: string): string {
  const full = `TGL - ${name} (${slug})`;
  if (full.length <= MAX_FRIENDLY_NAME_LENGTH) return full;
  const suffix = ` (${slug})`;
  const maxNameLen = MAX_FRIENDLY_NAME_LENGTH - "TGL - ".length - suffix.length;
  return `TGL - ${name.slice(0, maxNameLen)}${suffix}`;
}

interface TwilioSubAccountResponse {
  sid: string;
  friendly_name: string;
  status: string;
}

async function createTwilioSubAccount(friendlyName: string): Promise<TwilioSubAccountResponse> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
  }

  const res = await fetch(`${TWILIO_API_BASE}/Accounts.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ FriendlyName: friendlyName }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Twilio API error (${res.status}): ${body}`);
  }

  const json = (await res.json()) as TwilioSubAccountResponse;

  if (!json.sid?.startsWith("AC")) {
    throw new Error(`Unexpected Twilio SID format: ${json.sid}`);
  }

  return json;
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
      .schema("orgs").from("organizations")
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

    // Step 3: Create Twilio sub-account
    const friendlyName = buildFriendlyName(org.name, org.slug);
    logger.info("Creating Twilio sub-account", { organization_id, friendlyName });

    const twilioAccount = await createTwilioSubAccount(friendlyName);
    logger.info("Twilio sub-account created", {
      organization_id,
      twilio_sub_account_sid: twilioAccount.sid,
    });

    // Step 4: Write SID to org (inner retry — isolate from Twilio call)
    const MAX_DB_RETRIES = 3;
    let lastDbError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_DB_RETRIES; attempt++) {
      const { error: updateError } = await supabase
        .schema("orgs").from("organizations")
        .update({ twilio_sub_account_sid: twilioAccount.sid })
        .eq("id", organization_id);

      if (!updateError) {
        lastDbError = null;
        break;
      }

      lastDbError = new Error(`DB write failed (attempt ${attempt}/${MAX_DB_RETRIES}): ${updateError.message}`);
      logger.warn("DB write retry", {
        organization_id,
        attempt,
        error: updateError.message,
      });

      if (attempt < MAX_DB_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }

    if (lastDbError) {
      throw lastDbError;
    }

    logger.info("twilio-provision-sub-account complete", {
      organization_id,
      twilio_sub_account_sid: twilioAccount.sid,
    });

    return {
      organization_id,
      twilio_sub_account_sid: twilioAccount.sid,
      already_provisioned: false,
    };
  },
});
