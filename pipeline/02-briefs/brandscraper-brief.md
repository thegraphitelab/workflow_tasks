# Brand Extraction — Brief

## Task Summary
A Trigger.dev task (`extract-brand`) that accepts a domain, scrapes brand identity via Firecrawl (logo, favicon, colors, fonts, summary, screenshot), uploads the logo and favicon to Cloudflare Images, and returns a single structured payload. The task is stateless — it writes to no database, letting callers decide what to persist.

## Trigger Type
Event-triggered (invoked on demand by callers via `tasks.triggerAndWait`)

## Schedule (if applicable)
N/A — runs on demand when a caller triggers it.

## Input
```ts
{
  domain: string;       // e.g. "stripe.com"
  tenantId?: string;    // optional — attached as Cloudflare Images metadata for traceability
}
```

## Output
A flat, typed object containing:
- `domain` — echo of input
- `logoUrl` / `faviconUrl` — Cloudflare Images delivery URLs (null if extraction failed)
- `screenshotUrl` — Firecrawl-hosted URL (expires 24h, null if unavailable)
- `colorScheme`, `colorPrimary`, `colorSecondary`, `colorAccent`, `colorBackground` — brand colors (null if not detected)
- `fontPrimary`, `fontHeading` — detected font families (null if not detected)
- `summary` — Firecrawl-generated page summary (null if unavailable)
- `raw` — full Firecrawl branding + metadata objects for callers that need deeper data

## Integrations Touched
- [ ] Firecrawl — scrape domain for branding, summary, and screenshot (`POST /v2/scrape`)
- [ ] Cloudflare Images — upload logo and favicon via URL, receive delivery URLs
- ~~Supabase~~ — not used; task is stateless
- ~~Stripe~~ — not used
- ~~Slack~~ — not used
- ~~PostHog~~ — not used

## Success Criteria
1. Given a valid, reachable domain, the task returns a complete payload with Cloudflare-hosted logo/favicon URLs, extracted colors/fonts, and summary text.
2. When Firecrawl returns no logo or favicon, those fields are `null` and the task still succeeds (partial extraction is fine).
3. If Cloudflare Images rejects an upload after 3 retries, the output falls back to the raw Firecrawl source URL so the caller still gets something.
4. Relative logo/favicon URLs are normalized to absolute before upload.
5. The task throws on domain-unreachable or Firecrawl hard failure — callers handle errors.
6. The task writes to no database and has no side effects beyond Cloudflare Images uploads.

## Open Questions
1. **Cloudflare Images variants** — Are `public` and `thumbnail` variants already configured in the account, or do we need to set them up?
2. **Firecrawl credit cost** — `branding` + `summary` + `screenshot` in one call — how are credits counted (per format or per scrape)?
3. **Screenshot persistence** — Should the task also upload screenshots to Cloudflare Images / S3, or is the 24h Firecrawl URL sufficient for current callers?
4. **Shared-workers vs app-workers** — Will multiple apps call this task? Determines repo placement.

---

**Status:** approved
**PRD source:** `pipeline/01-prds/brandscraper.md`
