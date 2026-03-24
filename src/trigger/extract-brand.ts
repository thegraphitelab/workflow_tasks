import { task, logger } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import Firecrawl from "@mendable/firecrawl-js";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

let _firecrawl: Firecrawl | null = null;
function getFirecrawl(): Firecrawl {
  if (!_firecrawl) {
    _firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });
  }
  return _firecrawl;
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

// --- Payload ---

const PayloadSchema = z.object({
  domain: z.string().min(1),
});

type Payload = z.infer<typeof PayloadSchema>;

// --- Output ---

interface ButtonStyle {
  background: string | null;
  textColor: string | null;
  borderColor: string | null;
  borderRadius: string | null;
  shadow: string | null;
}

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

// --- Helpers ---

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

function resolveImageUrl(imageUrl: string | undefined | null, baseUrl: string): string | null {
  if (!imageUrl) return null;
  try {
    return new URL(imageUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

// --- Image processing ---

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

// --- Extraction ---

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

async function upsertBrand(row: ExtractBrandOutput): Promise<void> {
  const { error } = await supabase
    .schema("utility")
    .from("brands")
    .upsert(row, { onConflict: "domain" });

  if (error) {
    throw new Error(`Brand upsert failed for ${row.domain}: ${error.message}`);
  }

  logger.info("Brand upserted", { domain: row.domain });
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
