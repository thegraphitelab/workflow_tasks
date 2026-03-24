# PRD: Brand Extraction Workflow

**Status:** Draft
**Author:** Product
**Last Updated:** March 21, 2026

---

## 1. Overview

A Trigger.dev task that accepts a domain, uses Firecrawl to extract brand identity (logo, favicon, colors, fonts, summary, screenshot), uploads the logo and favicon to Cloudflare Images, and returns a single structured payload with everything the caller needs. The task does not write to any database — callers decide what to do with the output.

This keeps the task reusable across contexts: internal onboarding tooling, customer-facing brand import features, or any future workflow that needs brand data from a domain.

---

## 2. Problem

Multiple parts of the platform need to go from "a domain" to "a usable brand profile with hosted images." Right now that's manual. We need a single, reusable extraction primitive that any workflow can call.

---

## 3. Scope

**In scope:**
- Scrape a domain with Firecrawl (`branding`, `summary`, `screenshot` formats)
- Upload logo and favicon to Cloudflare Images
- Return a structured payload with Cloudflare delivery URLs, brand details, summary text, and screenshot URL

**Out of scope:**
- Writing to any database (callers handle persistence)
- Job tracking tables or status management (callers handle this if they need it)
- Bulk/batch domain imports
- Periodic re-scraping

---

## 4. Task Interface

### Input

```ts
{
  domain: string;          // e.g. "stripe.com"
  tenantId?: string;       // optional — passed as Cloudflare Images metadata for traceability
}
```

### Output

```ts
{
  domain: string;

  // Images — Cloudflare delivery URLs (null if extraction failed)
  logoUrl: string | null;
  faviconUrl: string | null;
  screenshotUrl: string | null;  // Firecrawl-hosted, expires after 24h

  // Colors
  colorScheme: "light" | "dark" | null;
  colorPrimary: string | null;
  colorSecondary: string | null;
  colorAccent: string | null;
  colorBackground: string | null;

  // Fonts
  fontPrimary: string | null;
  fontHeading: string | null;

  // Summary
  summary: string | null;        // Firecrawl-generated page summary

  // Raw Firecrawl response (for callers that want the full BrandingProfile)
  raw: {
    branding: object;
    metadata: object;
  };
}
```

The caller gets back a flat, typed object. Most consumers use the top-level fields. Callers that need deeper data (typography sizes, spacing, font weights) can dig into `raw.branding`.

---

## 5. How Callers Use It

### Internal onboarding tool

```ts
// In a Next.js API route or another Trigger.dev task
const handle = await tasks.triggerAndWait("extract-brand", {
  domain: "acme.com",
  tenantId: tenant.id,
});

// Write the result to whatever table you need
await supabase.from("brands").upsert({
  tenant_id: tenant.id,
  domain: handle.output.domain,
  logo_url: handle.output.logoUrl,
  favicon_url: handle.output.faviconUrl,
  color_primary: handle.output.colorPrimary,
  // ...
});
```

### Customer-facing brand preview

```ts
// Fire the task, show the user a preview, let them confirm before saving
const handle = await tasks.triggerAndWait("extract-brand", {
  domain: customerInput,
});

// Return the payload to the frontend for preview — nothing persisted yet
return Response.json(handle.output);
```

### Chained in another Trigger.dev workflow

```ts
// A larger onboarding workflow that does many things
const brand = await extractBrand.triggerAndWait({
  domain: newTenant.domain,
  tenantId: newTenant.id,
});

// Use the output in subsequent steps
await provisionTenantBranding(brand.output);
await generateWelcomeEmail(brand.output);
```

---

## 6. Workflow Steps

```
Trigger.dev Task: "extract-brand"

  Input: { domain, tenantId? }

  Step 1 — Scrape with Firecrawl
    POST /v2/scrape
      { url: domain, formats: ["branding", "summary", "screenshot"] }
    Extract branding, summary, and screenshot from response

  Step 2 — Upload logo to Cloudflare Images
    Take URL from branding.images.logo (fall back to branding.logo)
    POST Cloudflare Images upload-via-URL
    Receive delivery URL
    (Skip if no logo URL in response)

  Step 3 — Upload favicon to Cloudflare Images
    Take URL from branding.images.favicon
    Same upload-via-URL flow
    (Skip if no favicon URL in response)

  Step 4 — Return payload
    Assemble the flat output object
    Map Cloudflare delivery URLs for logo/favicon
    Pass through screenshot URL from Firecrawl (note: expires 24h)
    Pass through summary text
    Map color and font fields from branding response
    Include raw branding + metadata for callers that want it

  On failure:
    Throw — let the caller handle the error however they need to
```

---

## 7. Integration Details

### Firecrawl

**Endpoint:** `POST https://api.firecrawl.dev/v2/scrape`

```json
{
  "url": "https://example.com",
  "formats": ["branding", "summary", "screenshot"]
}
```

**Response (relevant fields):**

```json
{
  "success": true,
  "data": {
    "summary": "Acme Corp is a B2B SaaS platform that helps...",
    "screenshot": "https://service.firecrawl.dev/storage/v1/...",
    "branding": {
      "colorScheme": "dark",
      "logo": "https://example.com/logo.svg",
      "colors": {
        "primary": "#FF6B35",
        "secondary": "#004E89",
        "accent": "#F77F00",
        "background": "#1A1A1A"
      },
      "typography": {
        "fontFamilies": {
          "primary": "Inter",
          "heading": "Inter"
        }
      },
      "images": {
        "logo": "https://example.com/logo.svg",
        "favicon": "https://example.com/favicon.ico"
      }
    },
    "metadata": {
      "title": "Acme Corp",
      "description": "...",
      "sourceURL": "https://example.com"
    }
  }
}
```

**SDK:** `@mendable/firecrawl-js` — `scrapeUrl(domain, { formats: ["branding", "summary", "screenshot"] })`.

**Note on screenshots:** Firecrawl screenshot URLs expire after 24 hours. If a caller needs the screenshot persisted, they should download and store it themselves (e.g., to S3) after receiving the output. The extraction task does not persist screenshots — only the logo and favicon get uploaded to Cloudflare Images since those are the long-lived assets.

### Cloudflare Images

**Endpoint:** `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/images/v1`

Upload via URL — pass the logo/favicon URL directly, no download needed.

```
Content-Type: multipart/form-data

url=https://example.com/logo.svg
metadata={"tenant_id":"...","domain":"example.com","type":"logo"}
```

Returns delivery URLs like `https://imagedelivery.net/{acct}/{id}/public`.

---

## 8. Edge Cases

| Scenario | Handling |
|----------|----------|
| No logo returned | `logoUrl` is null in the output. Task still succeeds |
| No favicon returned | `faviconUrl` is null. Task still succeeds |
| Logo URL is relative | Normalize to absolute using the domain before uploading |
| SVG logo | Cloudflare Images accepts SVG. Upload as-is |
| Cloudflare rejects the image | Retry 3x. If still failing, fall back to the raw Firecrawl source URL so the caller at least gets something |
| Domain unreachable | Firecrawl returns `success: false`. Task throws with the error message |
| Firecrawl rate limit (429) | Trigger.dev step retry with backoff handles this |
| Screenshot unavailable | `screenshotUrl` is null. Not a failure |

---

## 9. Environment Variables

| Variable | Used by |
|----------|---------|
| `FIRECRAWL_API_KEY` | Step 1 |
| `CLOUDFLARE_ACCOUNT_ID` | Steps 2–3 |
| `CLOUDFLARE_IMAGES_API_TOKEN` | Steps 2–3 |
| `TRIGGER_SECRET_KEY` | Callers (to invoke the task) |

Note: No `SUPABASE_*` variables needed in this task. The task doesn't touch the database.

---

## 10. Task Config

```
Repo:           {app}-workers (or shared-workers if multiple apps use it)
Task ID:        "extract-brand"
Queue:          "brand-extraction" (concurrency: 5)
Retry:          3 attempts per step, exponential backoff
Step timeout:   60s (Firecrawl can be slow on JS-heavy sites)
```

Since this task is reusable across contexts, consider putting it in `shared-workers` if more than one app will call it.

---

## 11. Open Questions

1. **Cloudflare Images variants** — Are `public` and `thumbnail` variants already configured?
2. **Firecrawl credit cost** — `branding` + `summary` + `screenshot` in one call — confirm how credits are counted (per format or per scrape).
3. **Screenshot persistence** — Should the task also upload screenshots to S3/Cloudflare, or is the 24h Firecrawl URL sufficient for all current callers?
4. **Shared-workers vs app-workers** — Will multiple apps call this task, or is it single-app for now?