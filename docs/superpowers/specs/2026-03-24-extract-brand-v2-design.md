# Extract Brand v2 — Design Spec

**Date:** 2026-03-24
**Task ID:** `extract-brand`
**Status:** Draft

---

## Overview

Rewrite the existing `extract-brand` Trigger.dev task to replace Cloudflare Images with Supabase Storage and add direct persistence to `utility.brands`. The task becomes self-contained: given a domain, it scrapes brand identity, stores high-quality PNG assets in Supabase Storage, and upserts the brand record.

---

## Input

```ts
{ domain: string }
```

`tenantId` is removed. The domain is the sole identifier.

---

## Domain Cleaning

The raw input is normalized to a bare root domain before any other work:

1. Trim whitespace
2. Remove protocol (`https://`, `http://`)
3. Remove paths, query strings, fragments
4. Remove `www.` prefix
5. Lowercase

Example: `https://www.Example.com/about?q=1` → `example.com`

The cleaned domain is used as:
- The primary key in `utility.brands`
- The storage path prefix (`brands/example.com/`)

---

## Scraping

Firecrawl scrapes the domain with `branding` and `screenshot` formats:

```ts
firecrawl.scrapeUrl(`https://${domain}`, {
  formats: ["branding", "screenshot"],
});
```

### Extracted data

| Source path | Usage |
|-------------|-------|
| `branding.images.logo` / `branding.logo` | Logo source URL |
| `branding.images.favicon` | Favicon source URL |
| `branding.images.ogImage` | OG image source URL |
| `screenshot` | Screenshot data URL |
| `branding.colors` | `colors` JSONB column |
| `branding.typography` | `typography` JSONB column |
| `branding.spacing` | `spacing` JSONB column |
| `branding.components` | `components` JSONB column |
| `branding.personality` | `personality` JSONB column |
| `branding.designSystem` | `design_system` JSONB column |
| `metadata.title` | `title` text column |
| `metadata.description` | `description` text column |
| `metadata.language` | `language` text column |

---

## Image Processing & Storage

All images are processed through sharp and stored as high-quality PNGs in the Supabase Storage bucket `utility`.

### Processing pipeline

- **SVGs:** Rendered at 600 DPI, resized to fit within 2048×2048, upscaling allowed for crisp rasterization
- **Favicons:** Resized to minimum 512×512 using lanczos3 kernel for clean upscaling from typical 16×16 or 32×32 source sizes
- **Other raster images:** Resized to fit within 2048×2048, `withoutEnlargement: true` (no upscaling of already-large images)
- **Output format:** PNG for everything, no lossy compression

### Storage layout

```
utility (bucket)
└── brands/
    └── {domain}/
        ├── logo.png
        ├── favicon.png
        ├── og-image.png
        └── screenshot.png
```

### Upload behavior

- All 4 uploads happen in parallel via `Promise.all`
- Each upload uses `upsert: true` so re-running overwrites cleanly
- Content type: `image/png`
- If a source image isn't available from Firecrawl, that upload is skipped

Image URLs are not stored in the database. Consumers reconstruct them from the domain using the predictable path pattern.

---

## Database Persistence

Upsert to `utility.brands` keyed on `domain`.

### Column mapping

| Column | Source |
|--------|--------|
| `domain` | Cleaned root domain (PK) |
| `title` | `metadata.title` |
| `description` | `metadata.description` |
| `language` | `metadata.language` (DB defaults to `en-US`) |
| `logo_alt` | `branding.images.logoAlt` |
| `colors` | `{ scheme, primary, secondary, accent, background, text, link }` |
| `typography` | `{ fonts, fontFamilies, fontStacks, fontSizes }` |
| `spacing` | `{ baseUnit, borderRadius }` |
| `components` | `{ buttonPrimary, buttonSecondary }` |
| `personality` | `{ tone, energy, targetAudience }` |
| `design_system` | `{ framework, componentLibrary }` |

### Upsert behavior

- `onConflict: 'domain'` — existing brands are fully overwritten with fresh data
- `updated_at` handled by DB trigger
- `created_at` handled by DB default on first insert

---

## Task Configuration

| Setting | Value |
|---------|-------|
| Task ID | `extract-brand` |
| Queue concurrency | 5 |
| Machine | `micro` |
| Max duration | 120s |
| Retry | 3 attempts, exponential backoff |

### Environment variables

| Variable | Purpose |
|----------|---------|
| `FIRECRAWL_API_KEY` | Scraping |
| `SUPABASE_URL` | Storage + DB |
| `SUPABASE_SECRET_KEY` | Storage + DB (service role) |

Removed: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_IMAGES_API_TOKEN`, `CLOUDFLARE_IMAGES_ACCOUNT_HASH`

---

## Error Handling

- **Firecrawl fails** → task throws, nothing stored
- **Individual image fetch/process fails** (URL exists but 403, corrupt, etc.) → log warning, skip that image, continue with others. Brand data is still valuable without every image.
- **Image source not found in Firecrawl response** → skip silently, not an error
- **Supabase Storage upload fails** → task throws. No point writing DB row if images didn't land.
- **DB upsert fails** → task throws. Trigger.dev retry handles it.

No partial state — the task either completes fully or throws for retry.

---

## Output

The task returns the upserted brand row shape so callers can use the result inline if needed. The primary purpose is the side effect (storage + DB persistence).

```ts
interface ExtractBrandOutput {
  domain: string;
  title: string | null;
  description: string | null;
  language: string | null;
  logo_alt: string | null;
  colors: { scheme, primary, secondary, accent, background, text, link } | null;
  typography: { fonts, fontFamilies, fontStacks, fontSizes } | null;
  spacing: { baseUnit, borderRadius } | null;
  components: { buttonPrimary, buttonSecondary } | null;
  personality: { tone, energy, targetAudience } | null;
  design_system: { framework, componentLibrary } | null;
}
```

---

## What Gets Removed

- `CloudflareImage` interface and all Cloudflare types
- `cfDeliveryUrl()` helper
- `uploadImage()` Cloudflare upload function
- `CF_MAX_BYTES` constant
- `tenantId` from payload
- All Cloudflare environment variable references
