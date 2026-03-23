import { task, logger } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import Firecrawl from "@mendable/firecrawl-js";

const firecrawl = new Firecrawl({}); // reads FIRECRAWL_API_KEY from env

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

function resolveImageUrl(imageUrl: string | undefined | null, baseUrl: string): string | null {
  if (!imageUrl) return null;
  try {
    return new URL(imageUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

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
    // "branding" is a valid API format but not yet in the SDK type definitions
    const result = await firecrawl.scrapeUrl(url, {
      formats: ["branding" as "screenshot", "screenshot"],
    });

    const resultObj = result as unknown as Record<string, unknown>;
    const branding = resultObj.branding as Record<string, unknown> | undefined;
    const metadata = resultObj.metadata as Record<string, unknown> | undefined;
    const screenshot = resultObj.screenshot as string | undefined;

    logger.info("Scrape complete", {
      hasLogo: !!branding?.images || !!branding?.logo,
      hasFavicon: !!(branding?.images as Record<string, unknown>)?.favicon,
      hasScreenshot: !!screenshot,
    });

    // Step 2: Extract and normalize fields
    const fields = extractBrandingFields(branding, metadata, screenshot, url);

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

    // Step 4: Assemble output
    const output: ExtractBrandOutput = {
      domain: validated.domain,
      logoImageId,
      faviconImageId,
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
  },
});
