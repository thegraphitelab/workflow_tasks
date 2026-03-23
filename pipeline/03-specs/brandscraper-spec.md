# Brand Extraction — Technical Spec

## Overview
A Trigger.dev task that takes a domain and returns a structured brand profile. Scrapes via Firecrawl, uploads images to Cloudflare Images. Stateless — no database writes. Predictable contract: image fields return Cloudflare image IDs — callers construct delivery URLs with flexible variants for whatever size they need. If any integration fails, the task fails — no fallbacks, no mixed sources.

## Task Configuration

```typescript
export const extractBrand = task({
  id: "extract-brand",
  queue: {
    concurrencyLimit: 5,
  },
  machine: "micro",
  maxDuration: 120,
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10000,
    randomize: true,
  },
  run: async (payload) => { /* ... */ },
});
```

| Property | Value | Rationale |
|----------|-------|-----------|
| Task ID | `extract-brand` | Matches PRD |
| Queue | `concurrencyLimit: 5` | Avoids Firecrawl rate limits while allowing parallel runs |
| Machine | `micro` | HTTP-only work, no CPU/memory pressure |
| Max Duration | `120s` | JS-heavy sites can take 30-60s to scrape; 2x headroom |
| Retry | 3 attempts, exponential 1-10s, randomized | Handles transient Firecrawl/Cloudflare failures |

## Payload Schema

```typescript
import { z } from "zod";

const PayloadSchema = z.object({
  domain: z.string().min(1),
  tenantId: z.string().optional(),
});

type Payload = z.infer<typeof PayloadSchema>;
```

## Output Schema

```typescript
interface ExtractBrandOutput {
  domain: string;

  // Images — Cloudflare image IDs, null if not found in source
  // Callers construct delivery URLs: https://imagedelivery.net/{account_hash}/{imageId}/{variants}
  logoImageId: string | null;
  faviconImageId: string | null;

  // Screenshot — Firecrawl-hosted, expires 24h, null if unavailable
  screenshotUrl: string | null;

  // Colors — null if not detected
  colorScheme: "light" | "dark" | null;
  colorPrimary: string | null;
  colorSecondary: string | null;
  colorAccent: string | null;
  colorBackground: string | null;

  // Fonts — null if not detected
  fontPrimary: string | null;
  fontHeading: string | null;

  // Page description from metadata — null if unavailable
  description: string | null;

  // Raw Firecrawl response for callers that need deeper data
  raw: {
    branding: Record<string, unknown>;
    metadata: Record<string, unknown>;
  };
}
```

**Output guarantees:**
- A non-null `logoImageId` or `faviconImageId` is a Cloudflare Images ID. Callers build delivery URLs using flexible variants:
  ```
  https://imagedelivery.net/{account_hash}/{imageId}/w=200,h=200,fit=contain
  ```
- Flexible variants give callers full control over dimensions, fit, and transformations — no pre-configured named variants needed
- A non-null `screenshotUrl` is a Firecrawl-hosted URL (expires 24h) — this is the only non-CDN URL in the output, and it's clearly documented
- `description` comes from Firecrawl's `metadata.description` (the page's meta description) — not an AI-generated summary
- `null` means "not found in the source domain" — never "upload failed"
- If Firecrawl or Cloudflare errors, the task throws — the caller gets an error, not partial garbage

**Caller example — constructing a delivery URL:**
```typescript
const ACCOUNT_HASH = process.env.CLOUDFLARE_IMAGES_ACCOUNT_HASH;

// Full-size logo
const logoUrl = `https://imagedelivery.net/${ACCOUNT_HASH}/${output.logoImageId}/w=400,fit=contain`;

// Thumbnail favicon
const faviconUrl = `https://imagedelivery.net/${ACCOUNT_HASH}/${output.faviconImageId}/w=32,h=32,fit=cover`;

// Or with a custom domain (if configured):
const logoUrl = `https://yourdomain.com/cdn-cgi/imagedelivery/${ACCOUNT_HASH}/${output.logoImageId}/w=400,fit=contain`;
```

## Integration Points

### Firecrawl
- **Operation:** Scrape domain for branding and screenshot
- **SDK:** `@mendable/firecrawl-js`
- **Auth:** `FIRECRAWL_API_KEY` (SDK auto-reads from env if not passed to constructor)
- **Init** (module scope in task file):
  ```typescript
  import Firecrawl from "@mendable/firecrawl-js";
  const firecrawl = new Firecrawl();  // reads FIRECRAWL_API_KEY from env
  ```
- **Usage:**
  ```typescript
  const result = await firecrawl.scrape(url, {
    formats: ["branding", "screenshot"],
  });
  ```
- **Response fields used:**
  - `result.branding` — colors, typography, images (logo, favicon)
  - `result.screenshot` — base64 or hosted URL (expires 24h)
  - `result.metadata` — includes `title`, `description`, `sourceURL`
- **Gotchas:**
  - `"summary"` is NOT a valid format — use `result.metadata.description` for page description instead
  - Logo URL can be at `branding.images.logo` or `branding.logo` — check both, prefer `images.logo`
  - Screenshot URLs expire after 24 hours
  - JS-heavy sites can take 30-60s to scrape
  - 429 responses are retriable via Trigger.dev task-level retry

### Cloudflare Images
- **Operation:** Upload image via URL, receive image ID for flexible variant delivery
- **Auth:** `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_IMAGES_API_TOKEN`
- **Endpoint:** `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/images/v1`
- **Upload response shape:**
  ```typescript
  {
    success: true,
    result: {
      id: string;              // ← this is what we return
      filename: string;
      uploaded: string;        // ISO-8601
      meta: Record<string, string>;
      variants: string[];      // full URLs — we ignore these, callers use flexible variants
      requireSignedURLs: boolean;
    }
  }
  ```
- **Usage** (helper function in the task file):
  ```typescript
  async function uploadImageByUrl(
    sourceUrl: string,
    metadata: Record<string, string>
  ): Promise<string> {
    const form = new FormData();
    form.append("url", sourceUrl);
    form.append("metadata", JSON.stringify(metadata));

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/images/v1`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_IMAGES_API_TOKEN}`,
        },
        body: form,
      }
    );

    if (!res.ok) throw new Error(`Cloudflare Images upload failed: ${res.status}`);

    const json = await res.json();
    return json.result.id;  // return image ID, not variant URL
  }
  ```
- **Gotchas:**
  - Upload-via-URL: Cloudflare fetches the image from the source URL, so the source must be publicly accessible
  - SVGs are accepted
  - Metadata is key-value strings only — no nested objects
  - The `variants` array in the response contains full URLs with named variants — we ignore it since callers use flexible variants to construct their own URLs
  - On failure: task throws. No fallback to raw URLs.

## Logic Flow

1. **Validate payload** — Parse input with `PayloadSchema`. Invalid input is a permanent failure.

2. **Normalize domain** — Ensure protocol prefix (`https://`). Strip trailing slashes.

3. **Scrape with Firecrawl** — Call `firecrawl.scrape()` with `["branding", "screenshot"]` formats. If the call throws or returns no data, Trigger.dev retry handles transient failures.

4. **Extract and normalize** — Pull branding, screenshot, and metadata from response. Use `metadata.description` for the page description. Resolve relative logo/favicon URLs to absolute using the domain.

5. **Upload logo to Cloudflare Images** — If logo URL exists, upload with metadata `{ domain, type: "logo", tenant_id: tenantId }`. Return the image ID from the response. If no logo in response, `logoImageId` is `null`. If upload fails, task throws.

6. **Upload favicon to Cloudflare Images** — Same as logo, `type: "favicon"`. If no favicon in response, `faviconImageId` is `null`. If upload fails, task throws.

7. **Assemble and return** — Map all fields into `ExtractBrandOutput`. Image fields are Cloudflare image IDs. Every field is either a valid value or `null`.

## Error Handling

| Error Case | Type | Behavior |
|-----------|------|----------|
| Invalid payload | Permanent | Zod validation error, task fails immediately |
| Domain unreachable | Permanent | Firecrawl returns `success: false`, task throws |
| Firecrawl 429 / timeout / network | Retriable | Trigger.dev retry with backoff |
| Cloudflare upload fails | Retriable | Trigger.dev retry with backoff — no fallback |
| No logo in Firecrawl response | Expected | `logoImageId: null`, task succeeds |
| No favicon in Firecrawl response | Expected | `faviconImageId: null`, task succeeds |
| No screenshot in response | Expected | `screenshotUrl: null`, task succeeds |
| Relative image URL | Handled | Normalize to absolute before upload |

**Design principle:** The task either succeeds with a clean payload or fails completely. There is no partial-success state where some URLs are CDN and others are raw source URLs.

## Idempotency Strategy

Naturally idempotent:
- **Firecrawl:** Re-scraping returns fresh data. No side effects.
- **Cloudflare Images:** Duplicate uploads create new records. Harmless — callers control which URL they persist.
- **No database writes:** No conflicting state.

Callers that need dedup should use `idempotencyKey` at trigger time:
```typescript
await extractBrand.trigger(payload, {
  idempotencyKey: `extract-brand:${domain}`,
});
```

## Environment Variables Required

| Variable | Purpose | Where to find |
|----------|---------|---------------|
| `FIRECRAWL_API_KEY` | Firecrawl scrape API | Firecrawl dashboard → API Keys (starts with `fc-`) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account for upload API | Cloudflare dashboard URL or Workers & Pages → Overview |
| `CLOUDFLARE_IMAGES_API_TOKEN` | Cloudflare Images upload API | My Profile → API Tokens → create with `Cloudflare Images: Edit` |
| `CLOUDFLARE_IMAGES_ACCOUNT_HASH` | Account hash for delivery URLs (different from account ID) | Cloudflare dashboard → Images → Overview (in the delivery URL example) |

Note: `CLOUDFLARE_IMAGES_ACCOUNT_HASH` is not used by the task itself — it's needed by callers to construct delivery URLs. Documented here so it gets set in the same env config pass.

## Acceptance Criteria

- [ ] Given a reachable domain, returns complete payload with Cloudflare image IDs for logo/favicon, colors, fonts, description
- [ ] Every non-null `logoImageId` / `faviconImageId` is a valid Cloudflare Images ID that resolves via `https://imagedelivery.net/{hash}/{id}/{variants}`
- [ ] When Firecrawl returns no logo/favicon/screenshot, corresponding field is `null` — task succeeds
- [ ] Relative image URLs normalized to absolute before Cloudflare upload
- [ ] Cloudflare upload failure causes task to throw (no fallback)
- [ ] Domain-unreachable errors throw
- [ ] Invalid payload fails immediately with validation error
- [ ] `raw` field contains full Firecrawl branding + metadata
- [ ] Idempotent — safe to run twice with same input
- [ ] Logger output at each step (scrape, logo upload, favicon upload, done)
- [ ] Type check passes
- [ ] Runs successfully in Trigger.dev dev mode

## Out of Scope

- Database writes (callers handle persistence)
- Job tracking / status management
- Bulk/batch domain imports
- Periodic re-scraping
- Screenshot persistence (callers download if needed beyond 24h)

---

**Status:** approved
**Brief source:** `pipeline/02-briefs/brandscraper-brief.md`
