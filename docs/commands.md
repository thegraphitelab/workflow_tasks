# Commands

<!-- 
PURPOSE: Every command for dev, test, build, deploy.
LOAD WHEN: Running or testing anything.
-->

| Action | Command |
|--------|---------|
| Install dependencies | `pnpm install` |
| Dev server (Next.js) | `pnpm dev` |
| Trigger.dev dev mode | `npx trigger.dev@latest dev` |
| Run single task (test) | `npx trigger.dev@latest test [task-id]` |
| Trigger.dev deploy (manual) | `npx trigger.dev@latest deploy` |
| Type check | `pnpm tsc --noEmit` |
| Lint | `pnpm lint` |
| Lint fix | `pnpm lint --fix` |
| Supabase local start | `npx supabase start` |
| Supabase migrations | `npx supabase db push` |
| Supabase edge function serve | `npx supabase functions serve [name]` |
| Supabase edge function deploy | `npx supabase functions deploy [name]` |
| Generate Supabase types | `npx supabase gen types typescript --local > src/types/supabase.ts` |

## Development Workflow

1. Start Supabase local: `npx supabase start`
2. Start Next.js dev: `pnpm dev`
3. Start Trigger.dev dev: `npx trigger.dev@latest dev`
4. Task runs appear in the Trigger.dev dashboard at https://cloud.trigger.dev

## Environment Setup

- Required env vars: see `.env.example`
- Trigger.dev project ID and API key from https://cloud.trigger.dev
- Supabase project URL and service role key from Supabase dashboard
- Stripe, Slack, PostHog keys as needed per task
- **Never commit `.env` — it's gitignored**

## Deploying via GitHub

Production deploys happen through GitHub, not manual `trigger.dev deploy`:
1. Push to feature branch
2. Open PR
3. CI runs type check + lint
4. Merge to main → triggers production deploy
