# Generate Brand Image — Design Spec

## Overview
A Trigger.dev task that generates a styled image using OpenAI's `images.edits` endpoint. The caller provides reference image URLs (for style context), a text prompt, and a storage destination. The task downloads the reference images, calls OpenAI, and stores the resulting PNG in the `brand-assets` Supabase storage bucket.

## Architecture

```
Caller → tasks.trigger("generate-brand-image", { images, prompt, path, filename, ... })
              ↓
        Trigger.dev
              ↓
        1. Validate payload (zod)
        2. Download reference image URLs → Buffers (parallel)
        3. POST /v1/images/edits (OpenAI) with images + prompt
        4. Decode base64 response → Buffer
        5. Upload PNG to Supabase storage: brand-assets/{path}/{filename}.png
              ↓
        Task succeeds (void) or throws
```

## Task Signature

**Task ID:** `generate-brand-image`

**Input:**
```ts
{
  images: string[];        // URLs to reference images (1–16)
  prompt: string;          // Describes the desired output
  path: string;            // Storage directory, e.g. "solar"
  filename: string;        // Without extension, e.g. "hero-image"
  model?: string;          // Default: "gpt-image-1.5"
  size?: string;           // Default: "1024x1024"
  quality?: string;        // Default: "auto"
  background?: string;     // Default: "auto"
  moderation?: string;     // Default: "auto"
  input_fidelity?: string; // Default: "high"
}
```

**Output:** `void` — task succeeds or throws.

## Data Flow

### Step 1 — Validate Payload
- Parse with zod schema
- `images`: array of 1–16 URL strings (non-empty)
- `prompt`: non-empty string
- `path`: non-empty string
- `filename`: non-empty string
- Optional fields validated against their allowed values

### Step 2 — Download Reference Images
- Fetch all image URLs in parallel via `Promise.all`
- Each fetch returns a `Buffer` with the raw image bytes
- If any fetch fails (non-200, timeout, etc.) → throw immediately
- Images must be PNG, WebP, or JPG and under 50MB each (OpenAI limit)

### Step 3 — Call OpenAI `images.edits`
- Initialize OpenAI client with `OPENAI_API_KEY`
- Convert downloaded Buffers to `File` objects (required by the SDK for multipart upload)
- Call `openai.images.edits()` with:
  - `image`: array of File objects (reference images)
  - `prompt`: caller's prompt
  - `model`: caller's model or `"gpt-image-1.5"`
  - `n`: always `1`
  - `size`: caller's size or `"1024x1024"`
  - `quality`: caller's quality or `"auto"`
  - `background`: caller's background or `"auto"`
  - `moderation`: caller's moderation or `"auto"`
  - `input_fidelity`: caller's input_fidelity or `"high"`
- Response contains `data[0].b64_json` (base64-encoded PNG)

### Step 4 — Decode Response
- Extract `b64_json` from `response.data[0]`
- Decode base64 string to a `Buffer`

### Step 5 — Upload to Supabase Storage
- Bucket: `brand-assets`
- Path: `{path}/{filename}.png`
- Content type: `image/png`
- `upsert: true` (overwrite if exists)
- Use Supabase secret key client (bypasses RLS)

## Error Handling

| Failure | Behavior | Recovery |
|---------|----------|----------|
| Invalid payload | Throw immediately — task fails | Fix input and re-trigger |
| Image URL fetch fails (network/404) | Throw — Trigger.dev task-level retry | Check URL validity |
| Image too large (>50MB) | Throw with clear error | Provide smaller images |
| OpenAI API error (transient, 500/503) | Throw — Trigger.dev task-level retry | Automatic |
| OpenAI content moderation rejection | Throw with moderation error message | Adjust prompt or set moderation to "low" |
| OpenAI rate limit (429) | Throw — Trigger.dev task-level retry with backoff | Automatic |
| Supabase upload fails | Throw — Trigger.dev task-level retry | Check bucket exists and permissions |

## Environment Variables

| Var | Purpose |
|-----|---------|
| `OPENAI_API_KEY` | OpenAI API key for `images.edits` endpoint |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Secret key for storage upload (bypasses RLS) |

## Integrations

| System | Operation | Auth |
|--------|-----------|------|
| OpenAI API | POST `/v1/images/edits` | Bearer token (`OPENAI_API_KEY`) |
| Supabase Storage | Upload to `brand-assets` bucket | Secret key (`SUPABASE_SECRET_KEY`) |

## Task Configuration

| Setting | Value |
|---------|-------|
| `queue.concurrencyLimit` | 5 |
| `machine` | `"micro"` |
| `maxDuration` | 120 (seconds) |
| `retry.maxAttempts` | 3 |
| `retry.factor` | 2 |
| `retry.minTimeoutInMs` | 1000 |
| `retry.maxTimeoutInMs` | 10000 |
| `retry.randomize` | true |

## Dependencies

- `openai` — OpenAI Node.js SDK (new dependency, must be added to `package.json`)
- `@supabase/supabase-js` — already installed
- `zod` — already installed
- `@trigger.dev/sdk` — already installed

## Acceptance Criteria

1. Valid payload with 1 image URL + prompt → image generated and stored at `brand-assets/{path}/{filename}.png`
2. Valid payload with multiple image URLs → all passed as reference images to OpenAI
3. Missing or invalid image URLs → task throws
4. OpenAI transient failure → retried via Trigger.dev
5. Supabase upload failure → retried via Trigger.dev
6. Image visible in Supabase storage dashboard at expected path
7. Optional params (model, size, quality, etc.) respected when provided, defaults used when omitted
