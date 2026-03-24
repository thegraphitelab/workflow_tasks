# Extract Brand v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `extract-brand` to store images in Supabase Storage and persist brand data to `utility.brands`.

**Architecture:** Single-file rewrite of `src/trigger/extract-brand.ts`. Cloudflare code is fully replaced with Supabase client for both storage uploads and DB upsert. The task becomes self-contained — scrape, store images, persist brand record.

**Tech Stack:** Trigger.dev v3, Firecrawl (`@mendable/firecrawl-js`), sharp, `@supabase/supabase-js`, zod

**Spec:** `docs/superpowers/specs/2026-03-24-extract-brand-v2-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/trigger/extract-brand.ts` | Rewrite | All task logic — domain cleaning, scraping, image processing, storage upload, DB upsert |

This is a single-file rewrite. No new files needed.

---

### Task 1: Strip Cloudflare code and update payload/types

**Files:**
- Modify: `src/trigger/extract-brand.ts`

- [ ] **Step 1: Remove Cloudflare types, constants, and helpers**

Remove these items from the file:
- `CloudflareImage` interface (lines 25-28)
- `cfDeliveryUrl()` function (lines 113-116)
- `CF_MAX_BYTES` constant (line 120)
- `uploadImage()` function (lines 153-191)
- `tenantId` from `PayloadSchema` (line 18)

Keep:
- `ButtonStyle` interface
- `resolveImageUrl()` helper
- `getFirecrawl()` lazy singleton
- `fetchAndProcessImage()` (will be modified in Task 2)
- `extractOutput()` (will be modified in Task 3)

- [ ] **Step 2: Add Supabase client**

Add import at top of file:
```ts
import { createClient } from "@supabase/supabase-js";
```

Add client after the Firecrawl singleton (follows the pattern in `sendgrid-provision-sub-user.ts`):
```ts
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);
```

- [ ] **Step 3: Update `PayloadSchema` and `Payload` type**

```ts
const PayloadSchema = z.object({
  domain: z.string().min(1),
});

type Payload = z.infer<typeof PayloadSchema>;
```

- [ ] **Step 4: Replace `ExtractBrandOutput` interface**

Replace the existing `ExtractBrandOutput` with the new shape that mirrors the DB row:

```ts
interface ExtractBrandOutput {
  domain: string;
  title: string | null;
  description: string | null;
  language: string | null;
  logo_alt: string | null;
  colors: {
    scheme: "light" | "dark" | null;
    primary: string | null;
    secondary: string | null;
    accent: string | null;
    background: string | null;
    text: string | null;
    link: string | null;
  } | null;
  typography: {
    fonts: { family: string; role: string }[];
    fontFamilies: { primary: string | null; heading: string | null };
    fontStacks: { heading: string[]; body: string[] };
    fontSizes: { h1: string | null; h2: string | null; body: string | null };
  } | null;
  spacing: {
    baseUnit: number | null;
    borderRadius: string | null;
  } | null;
  components: {
    buttonPrimary: ButtonStyle | null;
    buttonSecondary: ButtonStyle | null;
  } | null;
  personality: {
    tone: string | null;
    energy: string | null;
    targetAudience: string | null;
  } | null;
  design_system: {
    framework: string | null;
    componentLibrary: string | null;
  } | null;
}
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: Errors from `extractOutput()` and the task `run()` function referencing removed types — confirms the old code is properly gutted. These will be fixed in subsequent tasks.

- [ ] **Step 6: Commit**

```bash
git add src/trigger/extract-brand.ts
git commit -m "refactor: strip Cloudflare code and update types for brand v2"
```

---

### Task 2: Rewrite domain cleaning and image processing

**Files:**
- Modify: `src/trigger/extract-brand.ts`

- [ ] **Step 1: Replace `normalizeDomain()` with `cleanDomain()`**

The old function just added `https://` and stripped trailing slashes. The new one extracts the bare root domain:

```ts
function cleanDomain(raw: string): string {
  let d = raw.trim().toLowerCase();
  // Remove protocol
  d = d.replace(/^https?:\/\//, "");
  // Remove paths, query strings, fragments
  d = d.split(/[/?#]/)[0];
  // Remove www. prefix
  d = d.replace(/^www\./, "");
  // Remove trailing dots/slashes
  d = d.replace(/[./]+$/, "");
  return d;
}
```

- [ ] **Step 2: Rewrite image processing functions**

Replace `fetchAndProcessImage()` with two functions — one for URL-sourced images, one for the base64 screenshot:

```ts
const MAX_DIMENSION = 2048;
const FAVICON_SIZE = 512;

async function fetchImageBuffer(sourceUrl: string): Promise<{ buffer: Buffer; isSvg: boolean }> {
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch image (${res.status}): ${sourceUrl}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  const buffer = Buffer.from(await res.arrayBuffer());
  const isSvg = contentType.includes("svg") || sourceUrl.endsWith(".svg");
  logger.info("Image fetched", { sourceUrl, contentType, bytes: buffer.byteLength });
  return { buffer, isSvg };
}

function decodeScreenshotBuffer(dataUrl: string): Buffer {
  // Screenshot comes as base64 data URL from Firecrawl
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  return Buffer.from(base64, "base64");
}

async function processImage(
  buffer: Buffer,
  opts: { isSvg?: boolean; isFavicon?: boolean }
): Promise<Buffer> {
  const { isSvg = false, isFavicon = false } = opts;

  if (isFavicon) {
    return sharp(buffer, isSvg ? { density: 600 } : {})
      .resize(FAVICON_SIZE, FAVICON_SIZE, {
        fit: "inside",
        withoutEnlargement: false,
        kernel: sharp.kernel.lanczos3,
      })
      .png()
      .toBuffer();
  }

  return sharp(buffer, isSvg ? { density: 600 } : {})
    .resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit: "inside",
      withoutEnlargement: !isSvg,
    })
    .png()
    .toBuffer();
}
```

- [ ] **Step 3: Add Supabase Storage upload function**

```ts
async function uploadToStorage(
  domain: string,
  fileName: string,
  pngBuffer: Buffer
): Promise<void> {
  const path = `brands/${domain}/${fileName}`;
  const { error } = await supabase.storage
    .from("utility")
    .upload(path, pngBuffer, {
      contentType: "image/png",
      upsert: true,
    });

  if (error) {
    throw new Error(`Storage upload failed for ${path}: ${error.message}`);
  }

  logger.info("Image uploaded to storage", { path, bytes: pngBuffer.byteLength });
}
```

- [ ] **Step 4: Add safe image pipeline function**

This wraps the fetch → process → upload pipeline with error handling that logs and skips on failure (per spec: individual image failures don't kill the task):

```ts
async function processAndUploadImage(
  domain: string,
  fileName: string,
  sourceUrl: string | null,
  opts: { isFavicon?: boolean }
): Promise<boolean> {
  if (!sourceUrl) return false;

  try {
    const { buffer, isSvg } = await fetchImageBuffer(sourceUrl);
    const png = await processImage(buffer, { isSvg, isFavicon: opts.isFavicon });
    await uploadToStorage(domain, fileName, png);
    return true;
  } catch (err) {
    logger.warn("Image processing failed, skipping", {
      domain,
      fileName,
      sourceUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function processAndUploadScreenshot(
  domain: string,
  dataUrl: string | undefined
): Promise<boolean> {
  if (!dataUrl) return false;

  try {
    const buffer = decodeScreenshotBuffer(dataUrl);
    const png = await processImage(buffer, {});
    await uploadToStorage(domain, "screenshot.png", png);
    return true;
  } catch (err) {
    logger.warn("Screenshot processing failed, skipping", {
      domain,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: Still errors from `extractOutput()` and task `run()` — those are fixed next.

- [ ] **Step 6: Commit**

```bash
git add src/trigger/extract-brand.ts
git commit -m "feat: add domain cleaning, image processing, and supabase storage upload"
```

---

### Task 3: Rewrite `extractOutput()` and DB upsert

**Files:**
- Modify: `src/trigger/extract-brand.ts`

- [ ] **Step 1: Rewrite `extractOutput()` to return DB row shape**

Replace the existing function. It no longer takes image arguments — images are stored separately.

```ts
function buildBrandRow(
  domain: string,
  branding: Record<string, unknown> | undefined,
  metadata: Record<string, unknown> | undefined
): ExtractBrandOutput {
  const colors = (branding?.colors ?? {}) as Record<string, string>;
  const typography = (branding?.typography ?? {}) as Record<string, unknown>;
  const fontFamilies = (typography?.fontFamilies ?? {}) as Record<string, string>;
  const fontStacks = (typography?.fontStacks ?? {}) as Record<string, string[]>;
  const fontSizes = (typography?.fontSizes ?? {}) as Record<string, string>;
  const brandImages = (branding?.images ?? {}) as Record<string, string>;
  const spacing = (branding?.spacing ?? {}) as Record<string, unknown>;
  const components = (branding?.components ?? {}) as Record<string, Record<string, string>>;
  const personality = (branding?.personality ?? {}) as Record<string, string>;
  const designSystem = (branding?.designSystem ?? {}) as Record<string, string>;
  const fonts = (branding?.fonts ?? []) as { family: string; role: string }[];

  const parseButton = (btn: Record<string, string> | undefined): ButtonStyle | null => {
    if (!btn) return null;
    return {
      background: btn.background ?? null,
      textColor: btn.textColor ?? null,
      borderColor: btn.borderColor ?? null,
      borderRadius: btn.borderRadius ?? null,
      shadow: btn.shadow ?? null,
    };
  };

  return {
    domain,
    title: (metadata?.title as string) ?? null,
    description: (metadata?.description as string) ?? null,
    language: (metadata?.language as string) ?? null,
    logo_alt: brandImages.logoAlt ?? null,
    colors: {
      scheme: (branding?.colorScheme as "light" | "dark") ?? null,
      primary: colors.primary ?? null,
      secondary: colors.secondary ?? null,
      accent: colors.accent ?? null,
      background: colors.background ?? null,
      text: colors.textPrimary ?? null,
      link: colors.link ?? null,
    },
    typography: {
      fonts,
      fontFamilies: {
        primary: fontFamilies.primary ?? null,
        heading: fontFamilies.heading ?? null,
      },
      fontStacks: {
        heading: fontStacks.heading ?? [],
        body: fontStacks.body ?? [],
      },
      fontSizes: {
        h1: fontSizes.h1 ?? null,
        h2: fontSizes.h2 ?? null,
        body: fontSizes.body ?? null,
      },
    },
    spacing: {
      baseUnit: (spacing.baseUnit as number) ?? null,
      borderRadius: (spacing.borderRadius as string) ?? null,
    },
    components: {
      buttonPrimary: parseButton(components.buttonPrimary),
      buttonSecondary: parseButton(components.buttonSecondary),
    },
    personality: {
      tone: personality.tone ?? null,
      energy: personality.energy ?? null,
      targetAudience: personality.targetAudience ?? null,
    },
    design_system: {
      framework: designSystem.framework ?? null,
      componentLibrary: designSystem.componentLibrary ?? null,
    },
  };
}
```

- [ ] **Step 2: Add DB upsert function**

```ts
async function upsertBrand(row: ExtractBrandOutput): Promise<void> {
  const { error } = await supabase
    .from("brands")
    .upsert(row, { onConflict: "domain" })
    .schema("utility");

  if (error) {
    throw new Error(`Brand upsert failed for ${row.domain}: ${error.message}`);
  }

  logger.info("Brand upserted", { domain: row.domain });
}
```

Note: The supabase client targets `utility` schema via `.schema("utility")` since the table is `utility.brands`, not `public.brands`.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: Still errors in the task `run()` function — it references the old flow. Fixed in Task 4.

- [ ] **Step 4: Commit**

```bash
git add src/trigger/extract-brand.ts
git commit -m "feat: add buildBrandRow and upsertBrand for supabase persistence"
```

---

### Task 4: Rewrite the task `run()` function

**Files:**
- Modify: `src/trigger/extract-brand.ts`

- [ ] **Step 1: Replace the entire `run()` body**

```ts
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
    const domain = cleanDomain(validated.domain);

    logger.info("extract-brand started", { domain });

    // Step 1: Scrape with Firecrawl
    const scrapeUrl = `https://${domain}`;
    logger.info("Scraping domain", { url: scrapeUrl });

    const result = await getFirecrawl().scrapeUrl(scrapeUrl, {
      formats: ["branding" as "screenshot", "screenshot"],
    });

    const resultObj = result as unknown as Record<string, unknown>;
    const branding = resultObj.branding as Record<string, unknown> | undefined;
    const metadata = resultObj.metadata as Record<string, unknown> | undefined;
    const screenshot = resultObj.screenshot as string | undefined;
    const brandImages = (branding?.images ?? {}) as Record<string, string>;

    logger.info("Scrape complete", {
      hasLogo: !!brandImages.logo || !!branding?.logo,
      hasFavicon: !!brandImages.favicon,
      hasOgImage: !!brandImages.ogImage,
      hasScreenshot: !!screenshot,
    });

    // Step 2: Process and upload images in parallel
    const rawLogoUrl = brandImages.logo || (branding?.logo as string | undefined);
    const logoSourceUrl = resolveImageUrl(rawLogoUrl, scrapeUrl);
    const faviconSourceUrl = resolveImageUrl(brandImages.favicon, scrapeUrl);
    const ogImageSourceUrl = resolveImageUrl(brandImages.ogImage, scrapeUrl);

    const [logoOk, faviconOk, ogImageOk, screenshotOk] = await Promise.all([
      processAndUploadImage(domain, "logo.png", logoSourceUrl, {}),
      processAndUploadImage(domain, "favicon.png", faviconSourceUrl, { isFavicon: true }),
      processAndUploadImage(domain, "og-image.png", ogImageSourceUrl, {}),
      processAndUploadScreenshot(domain, screenshot),
    ]);

    logger.info("Image uploads complete", { logoOk, faviconOk, ogImageOk, screenshotOk });

    // Step 3: Build brand row and upsert to DB
    const row = buildBrandRow(domain, branding, metadata);
    await upsertBrand(row);

    logger.info("extract-brand complete", { domain });
    return row;
  },
});
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS — all types should now be consistent.

- [ ] **Step 3: Commit**

```bash
git add src/trigger/extract-brand.ts
git commit -m "feat: rewrite extract-brand task to use supabase storage and persistence"
```

---

### Task 5: Final cleanup and verification

**Files:**
- Modify: `src/trigger/extract-brand.ts`

- [ ] **Step 1: Remove any dead code**

Scan the file for any leftover Cloudflare references, unused imports, or unused functions. Remove them.

- [ ] **Step 2: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS with no errors.

- [ ] **Step 3: Review the final file end-to-end**

Read the entire file and verify:
- No Cloudflare references remain
- No `tenantId` references remain
- Supabase client is instantiated correctly
- `cleanDomain()` strips protocol, path, www, lowercases
- All 4 images go through sharp → PNG → Supabase Storage
- Favicons use lanczos3 kernel at 512×512
- SVGs render at 600 DPI
- `buildBrandRow()` maps all fields correctly
- `upsertBrand()` targets `utility` schema with `onConflict: "domain"`
- Task `run()` follows scrape → upload images → upsert DB flow
- Individual image failures log warnings and skip, don't throw

- [ ] **Step 4: Commit if any cleanup was needed**

```bash
git add src/trigger/extract-brand.ts
git commit -m "chore: final cleanup of extract-brand v2"
```
