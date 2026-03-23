# Environment Setup

Everything you need to install to use this workspace with Claude Code.

---

## MCP Servers to Install

Run these in your terminal to add MCP servers to Claude Code:

```bash
# Trigger.dev — task development, test runs, deployment
claude mcp add trigger-dev -- npx trigger.dev@latest mcp --dev-only

# Supabase — DB queries, schema, migrations, edge functions, type generation
claude mcp add supabase --url "https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_REF&read_only=true"

# GitHub — PRs, issues, CI status, code review
claude mcp add github -- npx -y @modelcontextprotocol/server-github
# requires env: GITHUB_PERSONAL_ACCESS_TOKEN=ghp_your_token

# Context7 — current Trigger.dev, Supabase, Stripe, Next.js docs in context
claude mcp add context7 -- npx -y @upstash/context7-mcp@latest
```

## MCP Routing (where each one activates)

| MCP | Pipeline Stage | Trigger |
|-----|---------------|---------|
| Context7 | Spec writing, Build | Looking up current API docs for Trigger.dev, Supabase, Stripe |
| Trigger.dev | Build, Test | Running dev mode, testing tasks, checking run status |
| Supabase | Build | Schema queries, writing migrations, generating types |
| GitHub | Deploy | Opening PRs, checking CI status |

## Skills to Install

```bash
# Trigger.dev agent rules — optimal task patterns for Claude Code
npx trigger.dev@latest install-rules
```

## Post-Install Checklist

- [ ] Trigger.dev MCP connected — `claude mcp list` shows `trigger-dev`
- [ ] Supabase MCP connected — replace `YOUR_PROJECT_REF` with actual project ref
- [ ] GitHub MCP connected — set `GITHUB_PERSONAL_ACCESS_TOKEN` env var
- [ ] Context7 MCP connected
- [ ] Trigger.dev rules installed
- [ ] `.env` file has all required keys (copy from `.env.example`)
- [ ] `npx supabase start` works locally
- [ ] `npx trigger.dev@latest dev` connects to your Trigger.dev project

## Optional MCP Servers

Add these if/when you need them:

```bash
# Slack — if your tasks send Slack notifications and you want to debug channels/messages
# (Not needed for building tasks — only for debugging Slack integration issues)
# Available at: https://mcp.slack.com/mcp (connect via claude.ai settings)

# Stripe — if you want to query Stripe data directly during spec/build
# Available at: https://mcp.stripe.com (connect via claude.ai settings)

# PostHog — if you want to query analytics or manage feature flags during build
# Available at: https://mcp.posthog.com/mcp (connect via claude.ai settings)
```
