# Pipeline — The Task Development Workflow

## What This Folder Is
Four planning stages, each in its own folder. Work flows forward. Build output goes to `src/`, not here.

```
01-prds/ → 02-briefs/ → 03-specs/ → src/ (build + local test) → GitHub → prod
 (input)    (scope)      (contract)   (code)                      (ship)
```

---

## Agent Routing

| Your Task | Input | Also Load | Output | Skills at This Stage |
|-----------|-------|-----------|--------|---------------------|
| PRD → Brief(s) | PRD from `01-prds/` | `templates/brief-template.md` | Brief(s) in `02-briefs/` | — |
| Brief → Spec | Approved brief from `02-briefs/` | `docs/task-patterns.md`, `docs/integration-patterns.md` | Spec in `03-specs/` | Context7 MCP (Trigger.dev docs), Web Search |
| Spec → Build | Approved spec from `03-specs/` | `docs/conventions.md`, `docs/tech-standards.md`, `docs/integration-patterns.md` | Task code in `src/trigger/` | Trigger.dev MCP, Supabase MCP, Trigger.dev Rules, Context7 MCP |
| Build → Test | Completed build in `src/` | `docs/testing-guide.md`, `docs/commands.md` | Test results in `04-review/` | Trigger.dev MCP (local test runs) |
| Test → Deploy | Passing tests + review in `04-review/` | `docs/deploy-guide.md`, `docs/commands.md` | PR to GitHub | GitHub MCP |

---

## Stage Details

### 01-prds/ — The Input
You drop PRDs here. One PRD may produce multiple briefs if it describes multiple tasks.
File pattern: `[slug]-prd.md`

### 02-briefs/ — The Scope
Each brief = one buildable Trigger.dev task. Defines WHAT the task does, inputs/outputs, trigger type, and which integrations it touches.
File pattern: `[slug]-brief.md`

**Gate:** You review and approve briefs before spec writing begins.

### 03-specs/ — The Contract
Specs are CONTRACTS. They define the task signature, integration points, error handling strategy, and acceptance criteria. They do NOT include implementation code.
File pattern: `[slug]-spec.md`

**Gate:** You review and approve specs before building begins.

### 04-review/ — The Verification
Test results, review notes, deployment readiness checks. Nothing ships without passing tests locally.
File pattern: `[slug]-review.md`

**Gate:** Tests must pass locally via `npx trigger.dev@latest dev` before pushing to GitHub.

---

## Pipeline Rules

1. Flow is forward. No skipping stages.
2. Each agent loads only what it needs (see routing table).
3. Changed PRD → regenerate brief. Changed brief → regenerate spec.
4. Builder has creative freedom within `docs/conventions.md` and `docs/tech-standards.md`.
5. Nothing ships untested. Local Trigger.dev dev mode must verify the task runs.
6. Build output goes to `src/trigger/`, NOT to a pipeline folder.

---

## What NOT to Do

- Don't write implementation code in specs — specs define WHAT and acceptance criteria
- Don't build without an approved spec — even small tasks need a one-page spec
- Don't skip local testing — `npx trigger.dev@latest dev` before any PR
- Don't put task code in the pipeline folder — all code lives in `src/`
