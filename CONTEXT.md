# Trigger Tasks — Task Router

## Task Routing

| Your Task | Go Here | You'll Also Need |
|-----------|---------|-----------------|
| Process a PRD into briefs | `pipeline/CONTEXT.md` | PRD file in `pipeline/01-prds/` |
| Write a tech spec | `pipeline/CONTEXT.md` | Approved brief in `pipeline/02-briefs/` |
| Build a task | `pipeline/CONTEXT.md` → then `src/` | Approved spec + `docs/conventions.md`, `docs/tech-standards.md` |
| Test a task locally | `docs/testing-guide.md` | `docs/commands.md` |
| Deploy to production | `docs/deploy-guide.md` | `docs/commands.md` |
| Check task patterns | `docs/task-patterns.md` | `docs/integration-patterns.md` if external services |
| Understand an integration | `docs/integration-patterns.md` | — |

---

## Workspace Summary

| Area | Purpose | Skills & Tools |
|------|---------|---------------|
| `pipeline/` | Planning workflow: PRD → brief → spec → review | Context7 MCP (spec stage), Web Search (research) |
| `src/` | Production task code | Trigger.dev MCP, Supabase MCP, Trigger.dev Rules |
| `docs/` | Stable reference loaded per-task | — |
| `deploy/` | Trigger.dev deploy config | GitHub MCP (PRs, CI) |

---

## Cross-Workspace Flow

```
pipeline/01-prds/ → pipeline/02-briefs/ → pipeline/03-specs/ → src/ → GitHub → prod
   (PRD input)        (scoped briefs)       (tech contracts)    (build + test)   (ship)
```
