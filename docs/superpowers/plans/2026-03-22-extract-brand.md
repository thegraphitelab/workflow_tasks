# Extract Brand Task — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `extract-brand` Trigger.dev task — takes a domain, scrapes brand identity via Firecrawl, uploads logo/favicon to Cloudflare Images, returns a predictable structured payload.

**Architecture:** Single self-contained task file with Firecrawl SDK init at module scope and a `uploadImageByUrl` helper function. No separate client files. Task either succeeds with a clean payload or fails completely — no fallbacks.

**Tech Stack:** Trigger.dev v3, `@mendable/firecrawl-js`, Cloudflare Images REST API, Zod, TypeScript

**Spec:** `pipeline/03-specs/brandscraper-spec.md`

---

## File Structure

| File | Purpose |
|------|---------|
| `package.json` | Project dependencies and scripts |
| `tsconfig.json` | TypeScript config (strict mode) |
| `trigger.config.ts` | Trigger.dev project config |
| `src/trigger/extract-brand.ts` | The task — Firecrawl init, upload helper, task definition |
| `.env.example` | Required env vars documented |
| `.gitignore` | Standard Node ignores |

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `trigger.config.ts`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "workflow-tasks",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "npx trigger.dev@latest dev",
    "deploy": "npx trigger.dev@latest deploy",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@trigger.dev/sdk": "^3",
    "@mendable/firecrawl-js": "^1",
    "zod": "^3"
  },
  "devDependencies": {
    "typescript": "^5"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": ".",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*", "trigger.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create trigger.config.ts**

```typescript
import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "<project-ref>",
  dirs: ["./src/trigger"],
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
});
```

Note: Replace `<project-ref>` with the actual Trigger.dev project ref from the dashboard.

- [ ] **Step 4: Create .env.example**

```
# Firecrawl
FIRECRAWL_API_KEY=fc-your-api-key

# Cloudflare Images
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_IMAGES_API_TOKEN=your-api-token
CLOUDFLARE_IMAGES_ACCOUNT_HASH=your-account-hash

# Trigger.dev
TRIGGER_SECRET_KEY=tr_dev_your-secret-key
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
.env
.trigger/
```

- [ ] **Step 6: Install dependencies**

Run: `pnpm install`

- [ ] **Step 7: Verify TypeScript compiles**

Run: `pnpm typecheck`
Expected: No errors (empty project compiles clean)

- [ ] **Step 8: Commit scaffolding**

```bash
git add package.json pnpm-lock.yaml tsconfig.json trigger.config.ts .env.example .gitignore
git commit -m "feat: scaffold trigger.dev project for extract-brand task"
```

---

## Task 2: Payload Validation & Domain Normalization

**Files:**
- Create: `src/trigger/extract-brand.ts`

This task creates the file with the Zod schema, domain normalizer, output type, and a minimal task shell that validates input and returns a stub output. We build the skeleton first so every subsequent task adds to a working, type-checked file.

- [ ] **Step 1: Create the task file with schema, types, and stub**

Create `src/trigger/extract-brand.ts`:

```typescript
import { task, logger } from "@trigger.dev/sdk/v3";
import { z } from "zod";

// --- Payload ---

const PayloadSchema = z.object({
  domain: z.string().min(1),
  tenantId: z.string().optional(),
});

type Payload = z.infer<typeof PayloadSchema>;

// --- Output ---

interface ExtractBrandOutput {
  domain: string;
  logoImageId: string | null;
  faviconImageId: string | null;
  screenshotUrl: string | null;
  colorScheme: "light" | "dark" | null;
  colorPrimary: string | null;
  colorSecondary: string | null;
  colorAccent: string | null;
  colorBackground: string | null;
  fontPrimary: string | null;
  fontHeading: string | null;
  description: string | null;
  raw: {
    branding: Record<string, unknown>;
    metadata: Record<string, unknown>;
  };
}

// --- Helpers ---

function normalizeDomain(domain: string): string {
  let url = domain.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
  }
  return url.replace(/\/+$/, "");
}

// --- Task ---

export const extractBrand = task({
  id: "extract-brand",
  queue: { concurrencyLimit: 5 },
  machine: "micro",
  maxDuration: 120,
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10000,
    randomize: true,
  },
  run: async (payload: Payload): Promise<ExtractBrandOutput> => {
    const validated = PayloadSchema.parse(payload);
    const url = normalizeDomain(validated.domain);

    logger.info("extract-brand started", { domain: url, tenantId: validated.tenantId });

    // TODO: Firecrawl scrape (Task 3)
    // TODO: Cloudflare upload (Task 4)

    throw new Error("Not implemented");
  },
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/trigger/extract-brand.ts
git commit -m "feat: add extract-brand task shell with payload validation and output types"
```

---

## Task 3: Firecrawl Scrape Integration

**Files:**
- Modify: `src/trigger/extract-brand.ts`

This task adds the Firecrawl SDK init at module scope, the scrape call, and response field extraction. After this, the task scrapes a domain and logs what it found — but doesn't upload images yet.

- [ ] **Step 1: Add Firecrawl SDK init at module scope**

Add after the imports at the top of the file:

```typescript
import Firecrawl from "@mendable/firecrawl-js";

const firecrawl = new Firecrawl(); // reads FIRECRAWL_API_KEY from env
```

- [ ] **Step 2: Add image URL resolver helper**

Add after `normalizeDomain`:

```typescript
function resolveImageUrl(imageUrl: string | undefined | null, baseUrl: string): string | null {
  if (!imageUrl) return null;
  try {
    return new URL(imageUrl, baseUrl).toString();
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Add Firecrawl branding response extractor**

Add after `resolveImageUrl`:

```typescript
function extractBrandingFields(
  branding: Record<string, unknown> | undefined,
  metadata: Record<string, unknown> | undefined,
  screenshot: string | undefined,
  baseUrl: string
) {
  const colors = (branding?.colors ?? {}) as Record<string, string>;
  const typography = (branding?.typography ?? {}) as Record<string, unknown>;
  const fontFamilies = (typography?.fontFamilies ?? {}) as Record<string, string>;
  const images = (branding?.images ?? {}) as Record<string, string>;

  // Logo: prefer images.logo, fall back to branding.logo
  const rawLogoUrl = images?.logo || (branding?.logo as string | undefined);
  const logoUrl = resolveImageUrl(rawLogoUrl, baseUrl);

  // Favicon: from images.favicon
  const rawFaviconUrl = images?.favicon;
  const faviconUrl = resolveImageUrl(rawFaviconUrl, baseUrl);

  return {
    logoUrl,
    faviconUrl,
    screenshotUrl: screenshot ?? null,
    colorScheme: (branding?.colorScheme as "light" | "dark") ?? null,
    colorPrimary: colors?.primary ?? null,
    colorSecondary: colors?.secondary ?? null,
    colorAccent: colors?.accent ?? null,
    colorBackground: colors?.background ?? null,
    fontPrimary: fontFamilies?.primary ?? null,
    fontHeading: fontFamilies?.heading ?? null,
    description: (metadata?.description as string) ?? null,
  };
}
```

- [ ] **Step 4: Wire scrape into the task run function**

Replace the `// TODO` block and `throw` in the `run` function with:

```typescript
    // Step 1: Scrape with Firecrawl
    logger.info("Scraping domain", { url });
    const result = await firecrawl.scrape(url, {
      formats: ["branding", "screenshot"],
    });

    const branding = result.branding as Record<string, unknown> | undefined;
    const metadata = result.metadata as Record<string, unknown> | undefined;
    const screenshot = result.screenshot as string | undefined;

    logger.info("Scrape complete", {
      hasLogo: !!branding?.images || !!branding?.logo,
      hasFavicon: !!(branding?.images as Record<string, unknown>)?.favicon,
      hasScreenshot: !!screenshot,
    });

    // Step 2: Extract and normalize fields
    const fields = extractBrandingFields(branding, metadata, screenshot, url);

    // TODO: Cloudflare upload (Task 4)

    // Step 4: Assemble output
    const output: ExtractBrandOutput = {
      domain: validated.domain,
      logoImageId: null,       // placeholder until Task 4
      faviconImageId: null,    // placeholder until Task 4
      screenshotUrl: fields.screenshotUrl,
      colorScheme: fields.colorScheme,
      colorPrimary: fields.colorPrimary,
      colorSecondary: fields.colorSecondary,
      colorAccent: fields.colorAccent,
      colorBackground: fields.colorBackground,
      fontPrimary: fields.fontPrimary,
      fontHeading: fields.fontHeading,
      description: fields.description,
      raw: {
        branding: branding ?? {},
        metadata: metadata ?? {},
      },
    };

    logger.info("extract-brand complete", { domain: validated.domain });
    return output;
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/trigger/extract-brand.ts
git commit -m "feat: add Firecrawl scrape and branding field extraction"
```

---

## Task 4: Cloudflare Images Upload

**Files:**
- Modify: `src/trigger/extract-brand.ts`

This task adds the `uploadImageByUrl` helper and wires the logo/favicon uploads into the task. After this, the task is functionally complete.

- [ ] **Step 1: Add the Cloudflare Images upload helper**

Add after `extractBrandingFields`:

```typescript
async function uploadImageByUrl(
  sourceUrl: string,
  metadata: Record<string, string>
): Promise<string> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_IMAGES_API_TOKEN;

  if (!accountId || !apiToken) {
    throw new Error("Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_IMAGES_API_TOKEN");
  }

  const form = new FormData();
  form.append("url", sourceUrl);
  form.append("metadata", JSON.stringify(metadata));

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}` },
      body: form,
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cloudflare Images upload failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as {
    success: boolean;
    result: { id: string };
  };

  return json.result.id;
}
```

- [ ] **Step 2: Wire uploads into the task run function**

Replace the `// TODO: Cloudflare upload (Task 4)` comment and the placeholder `logoImageId: null` / `faviconImageId: null` with upload logic:

```typescript
    // Step 3: Upload images to Cloudflare
    const cfMetadata: Record<string, string> = {
      domain: validated.domain,
      ...(validated.tenantId ? { tenant_id: validated.tenantId } : {}),
    };

    let logoImageId: string | null = null;
    if (fields.logoUrl) {
      logger.info("Uploading logo to Cloudflare Images", { sourceUrl: fields.logoUrl });
      logoImageId = await uploadImageByUrl(fields.logoUrl, { ...cfMetadata, type: "logo" });
      logger.info("Logo uploaded", { imageId: logoImageId });
    }

    let faviconImageId: string | null = null;
    if (fields.faviconUrl) {
      logger.info("Uploading favicon to Cloudflare Images", { sourceUrl: fields.faviconUrl });
      faviconImageId = await uploadImageByUrl(fields.faviconUrl, { ...cfMetadata, type: "favicon" });
      logger.info("Favicon uploaded", { imageId: faviconImageId });
    }
```

And update the output assembly to use the real values:

```typescript
      logoImageId,
      faviconImageId,
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/trigger/extract-brand.ts
git commit -m "feat: add Cloudflare Images upload for logo and favicon"
```

---

## Task 5: Local Testing

**Files:**
- Create: `pipeline/04-review/brandscraper-review.md`

Ref: `docs/testing-guide.md`, `docs/commands.md`

- [ ] **Step 1: Create .env with real credentials**

Copy `.env.example` to `.env` and fill in:
- `FIRECRAWL_API_KEY` — from Firecrawl dashboard
- `CLOUDFLARE_ACCOUNT_ID` — from Cloudflare dashboard
- `CLOUDFLARE_IMAGES_API_TOKEN` — from Cloudflare API Tokens
- `TRIGGER_SECRET_KEY` — from Trigger.dev dashboard

- [ ] **Step 2: Start Trigger.dev dev mode**

Run: `npx trigger.dev@latest dev`
Expected: Task `extract-brand` appears in the dev dashboard

- [ ] **Step 3: Test with a real domain**

Run: `npx trigger.dev@latest test extract-brand --payload '{"domain": "stripe.com"}'`

Expected:
- Run completes successfully
- Output contains non-null `logoImageId` and/or `faviconImageId`
- Output contains color values
- `raw.branding` is populated
- Logger shows: "Scraping domain" → "Scrape complete" → "Uploading logo" → "Logo uploaded" → "extract-brand complete"

- [ ] **Step 4: Test with tenantId**

Run: `npx trigger.dev@latest test extract-brand --payload '{"domain": "github.com", "tenantId": "test-tenant-123"}'`

Expected: Same as above, metadata on uploaded images includes `tenant_id`

- [ ] **Step 5: Test invalid payload**

Run: `npx trigger.dev@latest test extract-brand --payload '{"domain": ""}'`

Expected: Task fails immediately with Zod validation error

- [ ] **Step 6: Test unreachable domain**

Run: `npx trigger.dev@latest test extract-brand --payload '{"domain": "thisdomaindoesnotexist12345.xyz"}'`

Expected: Task fails with Firecrawl error

- [ ] **Step 7: Test idempotency — run same domain twice**

Run the stripe.com test again. Verify:
- Second run also succeeds
- Returns a new `logoImageId` (Cloudflare creates a new image — expected behavior)

- [ ] **Step 8: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 9: Write review notes**

Create `pipeline/04-review/brandscraper-review.md` with test results:

```markdown
# Brand Extraction — Review

## Test Results

| Test | Result | Notes |
|------|--------|-------|
| Real domain (stripe.com) | ✅/❌ | [notes] |
| With tenantId | ✅/❌ | [notes] |
| Invalid payload | ✅/❌ | [notes] |
| Unreachable domain | ✅/❌ | [notes] |
| Idempotency | ✅/❌ | [notes] |
| Typecheck | ✅/❌ | |

## Acceptance Criteria

- [ ] Cloudflare image IDs resolve via delivery URL
- [ ] Colors/fonts populated for test domains
- [ ] Logger output shows all milestones
- [ ] No fallback URLs in output — all image fields are CF IDs or null

---

**Status:** draft
**Spec source:** `pipeline/03-specs/brandscraper-spec.md`
```

- [ ] **Step 10: Commit review notes**

```bash
git add pipeline/04-review/brandscraper-review.md
git commit -m "docs: add brandscraper test review notes"
```
