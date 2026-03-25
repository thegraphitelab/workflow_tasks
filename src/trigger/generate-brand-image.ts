import { task, logger } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

// --- Payload ---

const PayloadSchema = z.object({
  id: z.string().min(1),
  images: z.array(z.string().url()).min(1).max(16),
  prompt: z.string().min(1),
  path: z.string().min(1),
  filename: z.string().min(1),
  model: z
    .enum(["gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"])
    .default("gpt-image-1.5"),
  size: z
    .enum(["1024x1024", "1536x1024", "1024x1536", "auto"])
    .default("1024x1024"),
  quality: z.enum(["low", "medium", "high", "auto"]).default("auto"),
  background: z.enum(["transparent", "opaque", "auto"]).default("auto"),
  input_fidelity: z.enum(["high", "low"]).default("high"),
});

type Payload = z.infer<typeof PayloadSchema>;

// --- Helpers ---

async function downloadImage(
  url: string
): Promise<{ buffer: Buffer; name: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch image (${res.status}): ${url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > 50 * 1024 * 1024) {
    throw new Error(`Image exceeds 50MB limit: ${url}`);
  }
  // Derive a filename from the URL for the File object
  const name =
    url.split("/").pop()?.split("?")[0] || `image.png`;
  logger.info("Image downloaded", { url, bytes: buffer.byteLength });
  return { buffer, name };
}

// --- Status tracking ---

async function updateStatus(
  id: string,
  status: "processing" | "complete" | "error",
  errorText?: string
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    error: status === "error" ? (errorText ?? null) : null,
  };

  const { error } = await supabase
    .schema("utility")
    .from("image_generator")
    .update(update)
    .eq("id", id);

  if (error) {
    logger.warn("Failed to update status", { id, status, error: error.message });
  }
}

// --- Task ---

export const generateBrandImage = task({
  id: "generate-brand-image",
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
  run: async (payload: Payload): Promise<void> => {
    const validated = PayloadSchema.parse(payload);

    logger.info("generate-brand-image started", {
      id: validated.id,
      imageCount: validated.images.length,
      path: validated.path,
      filename: validated.filename,
      model: validated.model,
    });

    await updateStatus(validated.id, "processing");

    try {
      // Step 1: Download all reference images in parallel
      const downloads = await Promise.all(
        validated.images.map((url) => downloadImage(url))
      );

      // Step 2: Convert to File objects for OpenAI multipart upload
      const files = downloads.map(
        ({ buffer, name }) =>
          new File([new Uint8Array(buffer)], name, { type: "image/png" })
      );

      logger.info("Calling OpenAI images.edits", {
        model: validated.model,
        size: validated.size,
        quality: validated.quality,
        imageCount: files.length,
      });

      // Step 3: Call OpenAI images.edits
      const response = await getOpenAI().images.edit({
        image: files.length === 1 ? files[0] : files,
        prompt: validated.prompt,
        model: validated.model,
        n: 1,
        size: validated.size,
        quality: validated.quality,
        background: validated.background,
        input_fidelity: validated.input_fidelity,
      });

      const b64 = response.data?.[0]?.b64_json;
      if (!b64) {
        throw new Error("OpenAI response missing b64_json data");
      }

      // Step 4: Decode base64 to buffer
      const imageBuffer = Buffer.from(b64, "base64");
      logger.info("Image generated", { bytes: imageBuffer.byteLength });

      // Step 5: Upload to Supabase storage
      const storagePath = `${validated.path}/${validated.filename}.png`;
      const { error } = await supabase.storage
        .from("brand-assets")
        .upload(storagePath, imageBuffer, {
          contentType: "image/png",
          upsert: true,
        });

      if (error) {
        throw new Error(
          `Storage upload failed for ${storagePath}: ${error.message}`
        );
      }

      await updateStatus(validated.id, "complete");
      logger.info("generate-brand-image complete", { storagePath });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await updateStatus(validated.id, "error", errorMessage);
      logger.error("generate-brand-image failed", { id: validated.id, error: errorMessage });
      throw err;
    }
  },
});
