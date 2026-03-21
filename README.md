# workflow_tasks

Repo for authoring, testing, and deploying Trigger.dev tasks in `thegraphitelab` org.

## Goals

- Build event-driven workflows using Trigger.dev
- Standardize task definitions, tests, and deployment.
- Integrate with GitHub Actions for CI/CD

## Quickstart

1. Install dependencies (Node/TS + trigger.dev SDK)
2. Add workflows in `src/tasks`
3. Use `npm run build` and `npm run deploy`

## Structure

- `src/` - code for tasks and workflows
- `tests/` - automated tests
- `deploy/` - deployment scripts and manifests
- `.github/workflows` - CI pipelines for trigger.dev deployments
