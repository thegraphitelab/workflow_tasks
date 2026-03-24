import { task, logger } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import Firecrawl from "@mendable/firecrawl-js";
import sharp from "sharp";

let _firecrawl: Firecrawl | null = null;
function getFirecrawl(): Firecrawl {
  if (!_firecrawl) {
    _firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });
  }
  return _firecrawl;
}

// --- Payload ---

const PayloadSchema = z.object({
  domain: z.string().min(1),
  tenantId: z.string().optional(),
});

type Payload = z.infer<typeof PayloadSchema>;

// --- Output ---

interface CloudflareImage {
  id: string;
  url: string;
}

interface ButtonStyle {
  background: string | null;
  textColor: string | null;
  borderColor: string | null;
  borderRadius: string | null;
  shadow: string | null;
}

interface ExtractBrandOutput {
  domain: string;
  description: string | null;
  language: string | null;
  title: string | null;
  images: {
    logo: CloudflareImage | null;
    favicon: CloudflareImage | null;
    screenshot: CloudflareImage | null;
    ogImage: string | null;
    logoAlt: string | null;
  };
  colors: {
    scheme: "light" | "dark" | null;
    primary: string | null;
    secondary: string | null;
    accent: string | null;
    background: string | null;
    text: string | null;
    link: string | null;
  };
  typography: {
    fonts: { family: string; role: string }[];
    fontFamilies: {
      primary: string | null;
      heading: string | null;
    };
    fontStacks: {
      heading: string[];
      body: string[];
    };
    fontSizes: {
      h1: string | null;
      h2: string | null;
      body: string | null;
    };
  };
  spacing: {
    baseUnit: number | null;
    borderRadius: string | null;
  };
  components: {
    buttonPrimary: ButtonStyle | null;
    buttonSecondary: ButtonStyle | null;
  };
  personality: {
    tone: string | null;
    energy: string | null;
    targetAudience: string | null;
  };
  designSystem: {
    framework: string | null;
    componentLibrary: string | null;
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

function resolveImageUrl(imageUrl: string | undefined | null, baseUrl: string): string | null {
  if (!imageUrl) return null;
  try {
    return new URL(imageUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

function cfDeliveryUrl(imageId: string): string {
  const accountHash = process.env.CLOUDFLARE_IMAGES_ACCOUNT_HASH;
  return `https://imagedelivery.net/${accountHash}/${imageId}/public`;
}

// --- Image processing & upload ---

const CF_MAX_BYTES = 20_000_000;
const MAX_DIMENSION = 2048;

async function fetchAndProcessImage(sourceUrl: string): Promise<Buffer> {
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch image (${res.status}): ${sourceUrl}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const raw = Buffer.from(await res.arrayBuffer());

  logger.info("Image fetched", { sourceUrl, contentType, bytes: raw.byteLength });

  const isSvg = contentType.includes("svg") || sourceUrl.endsWith(".svg");
  if (isSvg || raw.byteLength > CF_MAX_BYTES) {
    const processed = await sharp(raw, isSvg ? { density: 300 } : {})
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: !isSvg })
      .png()
      .toBuffer();

    logger.info("Image processed", {
      originalBytes: raw.byteLength,
      processedBytes: processed.byteLength,
      wasSvg: isSvg,
    });

    return processed;
  }

  return raw;
}

async function uploadImage(
  sourceUrl: string,
  metadata: Record<string, string>
): Promise<CloudflareImage> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_IMAGES_API_TOKEN;

  if (!accountId || !apiToken) {
    throw new Error("Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_IMAGES_API_TOKEN");
  }

  const imageBuffer = await fetchAndProcessImage(sourceUrl);

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(imageBuffer)]), "image.png");
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

  const id = json.result.id;
  return { id, url: cfDeliveryUrl(id) };
}

// --- Extraction ---

function extractOutput(
  domain: string,
  branding: Record<string, unknown> | undefined,
  metadata: Record<string, unknown> | undefined,
  images: {
    logo: CloudflareImage | null;
    favicon: CloudflareImage | null;
    screenshot: CloudflareImage | null;
  },
  baseUrl: string
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
    description: (metadata?.description as string) ?? null,
    language: (metadata?.language as string) ?? null,
    title: (metadata?.title as string) ?? null,
    images: {
      logo: images.logo,
      favicon: images.favicon,
      screenshot: images.screenshot,
      ogImage: resolveImageUrl(brandImages.ogImage, baseUrl),
      logoAlt: brandImages.logoAlt ?? null,
    },
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
    designSystem: {
      framework: designSystem.framework ?? null,
      componentLibrary: designSystem.componentLibrary ?? null,
    },
  };
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

    // Step 1: Scrape with Firecrawl
    logger.info("Scraping domain", { url });
    const result = await getFirecrawl().scrapeUrl(url, {
      // "branding" is a valid API format but not yet in the SDK type definitions
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
      hasScreenshot: !!screenshot,
    });

    // Step 2: Upload images to Cloudflare
    const cfMeta: Record<string, string> = {
      domain: validated.domain,
      ...(validated.tenantId ? { tenant_id: validated.tenantId } : {}),
    };

    const rawLogoUrl = brandImages.logo || (branding?.logo as string | undefined);
    const logoSourceUrl = resolveImageUrl(rawLogoUrl, url);
    const faviconSourceUrl = resolveImageUrl(brandImages.favicon, url);

    let logo: CloudflareImage | null = null;
    if (logoSourceUrl) {
      logger.info("Uploading logo", { sourceUrl: logoSourceUrl });
      logo = await uploadImage(logoSourceUrl, { ...cfMeta, type: "logo" });
      logger.info("Logo uploaded", { id: logo.id, url: logo.url });
    }

    let favicon: CloudflareImage | null = null;
    if (faviconSourceUrl) {
      logger.info("Uploading favicon", { sourceUrl: faviconSourceUrl });
      favicon = await uploadImage(faviconSourceUrl, { ...cfMeta, type: "favicon" });
      logger.info("Favicon uploaded", { id: favicon.id, url: favicon.url });
    }

    let screenshotImage: CloudflareImage | null = null;
    if (screenshot) {
      logger.info("Uploading screenshot", { sourceUrl: screenshot });
      screenshotImage = await uploadImage(screenshot, { ...cfMeta, type: "screenshot" });
      logger.info("Screenshot uploaded", { id: screenshotImage.id, url: screenshotImage.url });
    }

    // Step 3: Assemble structured output
    const output = extractOutput(
      validated.domain,
      branding,
      metadata,
      { logo, favicon, screenshot: screenshotImage },
      url
    );

    logger.info("extract-brand complete", { domain: validated.domain });
    return output;
  },
});
