# Deployment

<!-- 
PURPOSE: How task code goes from local to production.
LOAD WHEN: Task is tested and ready to ship.
-->

## Process

1. Task code in `src/trigger/` passes local testing (see `testing-guide.md`)
2. Review notes written in `pipeline/04-review/[slug]-review.md`
3. Create feature branch: `git checkout -b task/[slug]`
4. Commit task code + any new integration clients + updated types
5. Push and open PR to `main`
6. CI runs type check + lint
7. PR review (you or team)
8. Merge to `main` → triggers production deploy via GitHub Actions

## GitHub Actions Deploy

The deploy workflow should:
1. Install dependencies
2. Run type check
3. Run lint
4. Deploy to Trigger.dev: `npx trigger.dev@latest deploy`

Example workflow (`.github/workflows/deploy-trigger.yml`):
```yaml
name: Deploy Trigger.dev Tasks
on:
  push:
    branches: [main]
    paths:
      - 'src/trigger/**'
      - 'deploy/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm tsc --noEmit
      - run: pnpm lint
      - run: npx trigger.dev@latest deploy
        env:
          TRIGGER_ACCESS_TOKEN: ${{ secrets.TRIGGER_ACCESS_TOKEN }}
```

## Supabase Edge Function Deploy

Edge functions deploy separately:
```bash
npx supabase functions deploy [function-name]
```

Or via GitHub Actions on changes to `supabase/functions/`.

## Rollback

- Trigger.dev: Redeploy a previous commit by reverting the merge or re-running deploy on a prior SHA
- Edge functions: `npx supabase functions deploy [name]` from a prior commit
- Database: Supabase migrations — never modify applied migrations, create a new one to undo

## Pre-Deploy Checklist

- [ ] Local testing passes (see `testing-guide.md`)
- [ ] Review notes in `pipeline/04-review/[slug]-review.md`
- [ ] Feature branch created and pushed
- [ ] PR opened with description of what the task does
- [ ] CI passes (type check + lint)
- [ ] Environment variables added to Trigger.dev dashboard (production)
- [ ] PR approved and merged

## Rules

- No manual `trigger.dev deploy` to production — always through GitHub
- All new environment variables added to Trigger.dev dashboard AND documented in `.env.example`
- Database migrations applied to production Supabase before deploying tasks that depend on new schema
