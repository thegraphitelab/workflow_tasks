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

// --- SendGrid Helpers ---

function sendgridHeaders(): Record<string, string> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    throw new Error("Missing SENDGRID_API_KEY");
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

interface PoolIpEntry {
  ip: string;
  warmup: boolean;
}

interface PoolResponse {
  pool_name: string;
  ips: PoolIpEntry[];
}

async function fetchPoolIps(poolName: string): Promise<string[]> {
  const res = await fetch(`${SENDGRID_API_BASE}/ips/pools/${poolName}`, {
    method: "GET",
    headers: sendgridHeaders(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SendGrid pool lookup failed for "${poolName}" (${res.status}): ${body}`);
  }

  const json = (await res.json()) as PoolResponse;
  const ips = json.ips.map((entry) => entry.ip);

  if (ips.length === 0) {
    throw new Error(`IP pool "${poolName}" has no IPs assigned`);
  }

  return ips;
}

async function resolveAllPoolIps(): Promise<string[]> {
  const results = await Promise.all(POOL_NAMES.map(fetchPoolIps));
  const allIps = results.flat();
  // Deduplicate — an IP could theoretically exist in both pools
  return [...new Set(allIps)];
}

function generatePassword(): string {
  return randomBytes(36).toString("base64url").slice(0, 48);
}

function deriveUsername(slug: string, suffix?: string): string {
  return suffix ? `${slug}-${suffix}` : slug;
}

function deriveEmail(username: string): string {
  return `info@${username}.graphitelab.ai`;
}

interface SendGridSubUserResponse {
  username: string;
  user_id: number;
  email: string;
  credit_allocation: { type: string };
}

function isUsernameCollision(status: number, body: string): boolean {
  // SendGrid returns 400 or sometimes 429 for duplicate usernames
  if (status !== 400 && status !== 429) return false;
  const lower = body.toLowerCase();
  return lower.includes("username") || lower.includes("already exists") || lower.includes("taken");
}

async function createSendGridSubUser(
  slug: string,
  ips: string[]
): Promise<{ username: string; user_id: number }> {
  const password = generatePassword();

  for (let attempt = 1; attempt <= MAX_USERNAME_ATTEMPTS; attempt++) {
    const suffix = attempt === 1 ? undefined : randomBytes(2).toString("hex");
    const username = deriveUsername(slug, suffix);
    const email = deriveEmail(username);

    logger.info("Attempting SendGrid subuser creation", { username, email, attempt });

    const res = await fetch(`${SENDGRID_API_BASE}/subusers`, {
      method: "POST",
      headers: sendgridHeaders(),
      body: JSON.stringify({ username, email, password, ips }),
    });

    if (res.ok) {
      const json = (await res.json()) as SendGridSubUserResponse;
      return { username: json.username, user_id: json.user_id };
    }

    const body = await res.text();

    if (isUsernameCollision(res.status, body) && attempt < MAX_USERNAME_ATTEMPTS) {
      logger.warn("Username collision, retrying with suffix", {
        username,
        attempt,
        status: res.status,
      });
      continue;
    }

    throw new Error(`SendGrid subuser creation failed (${res.status}): ${body}`);
  }

  throw new Error(`Failed to create SendGrid subuser after ${MAX_USERNAME_ATTEMPTS} attempts`);
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

    // Step 3: Resolve IPs from pools
    logger.info("Resolving IPs from pools", { pools: POOL_NAMES });
    const ips = await resolveAllPoolIps();
    logger.info("IPs resolved", { count: ips.length, ips });

    // Step 4: Create SendGrid subuser
    const { username, user_id } = await createSendGridSubUser(org.slug, ips);
    logger.info("SendGrid subuser created", {
      organization_id,
      username,
      user_id,
    });

    // Step 5: Write username to org (inner retry — isolate from SendGrid calls)
    let lastDbError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_DB_RETRIES; attempt++) {
      const { error: updateError } = await supabase
        .from("organizations")
        .update({ sendgrid_sub_user: username })
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

    logger.info("sendgrid-provision-sub-user complete", {
      organization_id,
      sendgrid_username: username,
    });

    return {
      organization_id,
      sendgrid_username: username,
      already_provisioned: false,
    };
  },
});
