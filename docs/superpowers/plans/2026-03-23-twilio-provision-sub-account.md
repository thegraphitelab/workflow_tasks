# Twilio Provision Sub-Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Trigger.dev task that creates a Twilio sub-account for an organization and writes the SID back to Supabase.

**Architecture:** Single-file event-triggered task at `src/trigger/twilio-provision-sub-account.ts`. Supabase client (secret key) and Twilio REST API (fetch + Basic Auth) initialized at module scope. Payload validated with Zod. Inner retry loop isolates DB write from Twilio call.

**Tech Stack:** Trigger.dev SDK v4, Supabase JS client (`@supabase/supabase-js`), Zod, native `fetch` for Twilio REST API.

**Spec:** `docs/superpowers/specs/2026-03-23-twilio-provision-sub-account-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| Create: `src/trigger/twilio-provision-sub-account.ts` | Task definition — payload validation, org fetch, idempotency guard, Twilio API call, DB write, inner retry |

Single file. No shared utilities needed — the task is self-contained per conventions.

---

## Task 1: Install Supabase dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install `@supabase/supabase-js`**

Run: `pnpm add @supabase/supabase-js`

- [ ] **Step 2: Verify installation**

Run: `pnpm tsc --noEmit`
Expected: No new type errors (existing state preserved)

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add @supabase/supabase-js dependency"
```

---

## Task 2: Scaffold task with payload validation and Supabase org fetch

**Files:**
- Create: `src/trigger/twilio-provision-sub-account.ts`

- [ ] **Step 1: Write the task file with payload schema, clients, and org fetch**

```typescript
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

    // Validate credentials early
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
    }

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

    // Step 3: Create Twilio sub-account (Task 3)
    throw new Error("Not implemented: Twilio sub-account creation");
  },
});
```

- [ ] **Step 2: Type check**

Run: `pnpm tsc --noEmit`
Expected: PASS (no type errors)

- [ ] **Step 3: Commit**

```bash
git add src/trigger/twilio-provision-sub-account.ts
git commit -m "feat: scaffold twilio-provision-sub-account with payload validation and org fetch"
```

---

## Task 3: Implement Twilio sub-account creation

**Files:**
- Modify: `src/trigger/twilio-provision-sub-account.ts`

- [ ] **Step 1: Add the `createTwilioSubAccount` helper and wire it into the task**

Replace the `throw new Error("Not implemented: Twilio sub-account creation")` placeholder with the Twilio API call and DB write.

Add this helper above the task definition:

```typescript
// --- Twilio ---

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";
const MAX_FRIENDLY_NAME_LENGTH = 64;

function buildFriendlyName(name: string, slug: string): string {
  const full = `TGL - ${name} (${slug})`;
  if (full.length <= MAX_FRIENDLY_NAME_LENGTH) return full;
  // Truncate name, keep slug
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
```

- [ ] **Step 2: Replace the placeholder in the `run` function**

Replace the `throw new Error("Not implemented...")` line with:

```typescript
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
        .from("organizations")
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
```

- [ ] **Step 3: Type check**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/trigger/twilio-provision-sub-account.ts
git commit -m "feat: implement Twilio sub-account creation and DB write with inner retry"
```

---

## Task 4: Local testing

**Files:**
- None created — testing via Trigger.dev dev mode

**Prereqs:** Set env vars in Trigger.dev dashboard (dev environment):
- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_SECRET_KEY` — `sb_secret_...` key from Supabase API settings
- `TWILIO_ACCOUNT_SID` — master account SID
- `TWILIO_AUTH_TOKEN` — master auth token

Reference: `docs/testing-guide.md`, `docs/commands.md`

- [ ] **Step 1: Start Trigger.dev dev mode**

Run: `npx trigger.dev@latest dev`
Expected: Task `twilio-provision-sub-account` appears in the dashboard

- [ ] **Step 2: Test happy path — new org without existing SID**

Via Trigger.dev dashboard or CLI:
```bash
npx trigger.dev@latest test twilio-provision-sub-account --payload '{"organization_id": "<a-real-org-id-without-twilio-sid>"}'
```

Verify:
- Run completes successfully
- Logs show: "Creating Twilio sub-account" → "Twilio sub-account created" → "complete"
- `organizations` row now has `twilio_sub_account_sid` set to an `AC...` value
- Sub-account visible in Twilio console under master account

- [ ] **Step 3: Test idempotency — same org again**

Re-run with the same `organization_id` (which now has a SID).

Verify:
- Run completes successfully
- Logs show: "Already provisioned, returning existing SID"
- `already_provisioned: true` in output
- No new Twilio sub-account created

- [ ] **Step 4: Test error case — non-existent org**

```bash
npx trigger.dev@latest test twilio-provision-sub-account --payload '{"organization_id": "org_nonexistent_12345"}'
```

Verify:
- Run fails with "Organization not found" error

- [ ] **Step 5: Test error case — invalid payload**

```bash
npx trigger.dev@latest test twilio-provision-sub-account --payload '{}'
```

Verify:
- Run fails with Zod validation error

---

## Task 5: Write review notes and update .env.example

**Files:**
- Create: `pipeline/04-review/twilio-provision-sub-account-review.md`
- Modify: `.env.example` (if it exists)

- [ ] **Step 1: Write review notes summarizing test results**

```markdown
# Twilio Provision Sub-Account — Review

## Test Results

| Test Case | Result | Notes |
|-----------|--------|-------|
| Happy path (new org) | PASS/FAIL | Sub-account created, SID written |
| Idempotency (existing SID) | PASS/FAIL | No-op, returned existing SID |
| Non-existent org | PASS/FAIL | Failed with clear error |
| Invalid payload | PASS/FAIL | Zod validation error |

## Environment Variables Verified
- `SUPABASE_URL` — connected
- `SUPABASE_SECRET_KEY` — authenticated
- `TWILIO_ACCOUNT_SID` — authenticated
- `TWILIO_AUTH_TOKEN` — authenticated

## Notes
[Any observations, issues, or follow-ups from testing]

---

**Status:** review
**Spec source:** `docs/superpowers/specs/2026-03-23-twilio-provision-sub-account-design.md`
```

- [ ] **Step 2: Update .env.example with new vars (if file exists)**

Add these lines if not already present:
```
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
SUPABASE_URL=
SUPABASE_SECRET_KEY=
```

- [ ] **Step 3: Commit**

```bash
git add pipeline/04-review/twilio-provision-sub-account-review.md
git commit -m "docs: add twilio-provision-sub-account review notes"
```
