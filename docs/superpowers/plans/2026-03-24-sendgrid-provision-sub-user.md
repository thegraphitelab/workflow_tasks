# SendGrid Provision Sub-User Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Trigger.dev task that creates a SendGrid subuser for an organization (with IPs from both marketing and transactional pools) and writes the username back to Supabase.

**Architecture:** Single-file event-triggered task at `src/trigger/sendgrid-provision-sub-user.ts`. Supabase client (secret key) at module scope. SendGrid REST API via native `fetch` with Bearer auth. IP addresses resolved from two named pools before subuser creation. Username collision retry with random suffix. Inner retry loop isolates DB write from SendGrid calls.

**Tech Stack:** Trigger.dev SDK v4, Supabase JS client (`@supabase/supabase-js`), Zod, native `fetch` for SendGrid REST API, Node.js `crypto` for password generation.

**Spec:** `docs/superpowers/specs/2026-03-24-sendgrid-provision-sub-user-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| Create: `src/trigger/sendgrid-provision-sub-user.ts` | Task definition — payload validation, org fetch, idempotency guard, IP pool resolution, SendGrid subuser creation with collision retry, DB write with inner retry |
| Modify: `.env.example` | Add `SENDGRID_API_KEY` |

Single task file. No shared utilities — self-contained per codebase conventions.

---

## Task 1: Add SENDGRID_API_KEY to .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add the SendGrid env var**

Add below the Twilio section in `.env.example`:

```
# SendGrid (master account)
SENDGRID_API_KEY=SG.your-api-key
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: add SENDGRID_API_KEY to .env.example"
```

---

## Task 2: Scaffold task with payload validation, org fetch, and idempotency guard

**Files:**
- Create: `src/trigger/sendgrid-provision-sub-user.ts`

- [ ] **Step 1: Write the task file with payload schema, clients, org fetch, and idempotency guard**

```typescript
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
```

- [ ] **Step 2: Type check**

Run: `pnpm tsc --noEmit`
Expected: PASS (no type errors)

- [ ] **Step 3: Commit**

```bash
git add src/trigger/sendgrid-provision-sub-user.ts
git commit -m "feat: scaffold sendgrid-provision-sub-user with payload validation and org fetch"
```

---

## Task 3: Implement IP pool resolution and SendGrid subuser creation

**Files:**
- Modify: `src/trigger/sendgrid-provision-sub-user.ts`

- [ ] **Step 1: Add the SendGrid helper functions above the task definition**

Add these helpers between the `// --- Output ---` section and the `// --- Task ---` section:

```typescript
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

interface SendGridErrorResponse {
  errors: { field: string | null; message: string }[];
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
```

- [ ] **Step 2: Replace the placeholder in the `run` function**

Replace the `throw new Error("Not implemented: SendGrid subuser creation")` line with:

```typescript
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
```

- [ ] **Step 3: Type check**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/trigger/sendgrid-provision-sub-user.ts
git commit -m "feat: implement SendGrid subuser creation with IP pool resolution and collision retry"
```

---

## Task 4: Local testing

**Files:**
- None created — testing via Trigger.dev dev mode

**Prereqs:** Set env vars in Trigger.dev dashboard (dev environment):
- `SENDGRID_API_KEY` — master account API key (must be Pro/Premier plan)

Existing vars should already be set: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`

- [ ] **Step 1: Start Trigger.dev dev mode**

Run: `npx trigger.dev@latest dev`
Expected: Task `sendgrid-provision-sub-user` appears in the dashboard

- [ ] **Step 2: Test happy path — new org without existing subuser**

Via Trigger.dev dashboard or CLI:
```bash
npx trigger.dev@latest test sendgrid-provision-sub-user --payload '{"organization_id": "<a-real-org-id-without-sendgrid-sub-user>"}'
```

Verify:
- Run completes successfully
- Logs show: "Resolving IPs from pools" → "IPs resolved" → "Attempting SendGrid subuser creation" → "SendGrid subuser created" → "complete"
- `organizations` row now has `sendgrid_sub_user` set to the org's slug
- Subuser visible in SendGrid console under master account with IPs from both pools

- [ ] **Step 3: Test idempotency — same org again**

Re-run with the same `organization_id` (which now has a subuser).

Verify:
- Run completes successfully
- Logs show: "Already provisioned, returning existing username"
- `already_provisioned: true` in output
- No new SendGrid subuser created

- [ ] **Step 4: Test error case — non-existent org**

```bash
npx trigger.dev@latest test sendgrid-provision-sub-user --payload '{"organization_id": "org_nonexistent_12345"}'
```

Verify:
- Run fails with "Organization not found" error

- [ ] **Step 5: Test error case — invalid payload**

```bash
npx trigger.dev@latest test sendgrid-provision-sub-user --payload '{}'
```

Verify:
- Run fails with Zod validation error

---

## Task 5: Write review notes and update .env.example

**Files:**
- Create: `docs/superpowers/reviews/sendgrid-provision-sub-user-review.md`

- [ ] **Step 1: Write review notes summarizing test results**

```markdown
# SendGrid Provision Sub-User — Review

## Test Results

| Test Case | Result | Notes |
|-----------|--------|-------|
| Happy path (new org) | PASS/FAIL | Subuser created, username written |
| Idempotency (existing subuser) | PASS/FAIL | No-op, returned existing username |
| Non-existent org | PASS/FAIL | Failed with clear error |
| Invalid payload | PASS/FAIL | Zod validation error |

## Environment Variables Verified
- `SUPABASE_URL` — connected
- `SUPABASE_SECRET_KEY` — authenticated
- `SENDGRID_API_KEY` — authenticated, Pro plan confirmed

## IP Pools Verified
- `marketing` — IPs resolved successfully
- `transactional` — IPs resolved successfully

## Notes
[Any observations, issues, or follow-ups from testing]

---

**Status:** review
**Spec source:** `docs/superpowers/specs/2026-03-24-sendgrid-provision-sub-user-design.md`
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/reviews/sendgrid-provision-sub-user-review.md
git commit -m "docs: add sendgrid-provision-sub-user review notes"
```
