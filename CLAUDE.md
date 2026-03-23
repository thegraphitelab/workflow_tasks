# Trigger Tasks

## What This Is
A pipeline for developing, testing, and deploying Trigger.dev tasks. PRDs go in, tested production tasks come out. Built with Next.js + Supabase + TypeScript.

---

## Folder Structure

```
trigger-tasks/
├── CLAUDE.md              ← You are here
├── CONTEXT.md             ← Task router
├── src/                   ← Production task code (deploys via GitHub)
├── deploy/                ← Trigger.dev deploy config
├── docs/                  ← Reference docs (loaded on demand)
│   ├── conventions.md
│   ├── commands.md
│   ├── tech-standards.md
│   ├── task-patterns.md
│   ├── integration-patterns.md
│   ├── testing-guide.md
│   └── deploy-guide.md
├── pipeline/              ← Planning & spec workflow
│   ├── CONTEXT.md         ← Pipeline routing
│   ├── 01-prds/           ← PRD intake
│   ├── 02-briefs/         ← Scoped briefs
│   ├── 03-specs/          ← Technical specs
│   └── 04-review/         ← Test results, review notes
└── templates/             ← Brief, spec, task scaffolds
    ├── brief-template.md
    ├── spec-template.md
    └── task-scaffold/
```

---

## Quick Navigation

| Want to... | Go here |
|------------|---------|
| Start from a PRD | `pipeline/CONTEXT.md` → Stage 01 |
| Write a brief from a PRD | `pipeline/CONTEXT.md` → Stage 02 |
| Write a tech spec from a brief | `pipeline/CONTEXT.md` → Stage 03 |
| Build a task from a spec | `pipeline/CONTEXT.md` → Build stage |
| Test a task locally | `docs/commands.md` + `docs/testing-guide.md` |
| Deploy to production | `docs/deploy-guide.md` |
| Check conventions | `docs/conventions.md` |
| Understand integration wiring | `docs/integration-patterns.md` |

---

## Cross-Workspace Flow

```
pipeline/01-prds/ → pipeline/02-briefs/ → pipeline/03-specs/ → src/ → GitHub → prod
   (PRD input)        (scoped briefs)       (tech contracts)    (build + local test)  (ship)
```

Review gates: You approve briefs before specs. You approve specs before build. Tests pass before deploy.

---

## ID & Naming Conventions

| Content Type | Pattern | Example |
|-------------|---------|---------|
| PRDs | `[slug]-prd.md` | `stripe-sync-prd.md` |
| Briefs | `[slug]-brief.md` | `stripe-sync-brief.md` |
| Specs | `[slug]-spec.md` | `stripe-sync-spec.md` |
| Task files | `[slug].ts` | `stripe-sync.ts` |
| Review notes | `[slug]-review.md` | `stripe-sync-review.md` |

**Statuses:** `draft` → `review` → `approved`

---

## File Placement Rules

### Pipeline (planning)
- **PRDs:** `pipeline/01-prds/[slug]-prd.md`
- **Briefs:** `pipeline/02-briefs/[slug]-brief.md`
- **Specs:** `pipeline/03-specs/[slug]-spec.md`
- **Reviews:** `pipeline/04-review/[slug]-review.md`

### Code (building)
- **Task code:** `src/trigger/[slug].ts` (self-contained — clients initialized at module scope)
- **Shared utilities:** `src/trigger/utils/`

---

## Token Management

**Each stage is siloed.** Don't load everything.
- Writing briefs? → Load PRD + `templates/brief-template.md`. Skip `docs/tech-standards.md`.
- Writing specs? → Load brief + `docs/task-patterns.md` + `docs/integration-patterns.md`. Skip PRD.
- Building? → Load spec + `docs/conventions.md` + `docs/tech-standards.md`. Skip pipeline/.
- Deploying? → Load `docs/deploy-guide.md` + `docs/commands.md`. Skip pipeline/.

---

## Skills & Tools Available

| Tool | Type | Used In |
|------|------|---------|
| Trigger.dev MCP | MCP | Build stage (task development), deploy stage |
| Supabase MCP | MCP | Build stage (DB queries, schema, edge functions) |
| GitHub MCP | MCP | Deploy stage (PRs, CI status) |
| Context7 MCP | MCP | Spec + build stages (current Trigger.dev & Supabase docs) |
| Trigger.dev Rules | Skill | Build stage (optimal task patterns) |
| Web Search | Built-in | Spec stage (researching API patterns) |
