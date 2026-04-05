# Active Context

## Current State (2026-04-05)

### Truthful Snapshot
- MongoBranch now has a **scoped production approval** for:
  - Atlas Local `preview`
  - auth enabled
  - `mb doctor` passing
  - `mb access status` reporting `enforced: true`
  - Bun-based core AI-agent workflows
- npm registry latest:
  - `mongobranch@1.0.1`
- It is **not** a blanket sign-off for every MongoDB deployment profile

### Verified Repo State
- `bun run lint` -> exit `0`
- `bun run test` -> **32 files, 340 tests, 0 failures**
- Latest full-suite duration:
  - `210.65s`

### External Dogfood Evidence
- First external workspace:
  - `/Users/rom.iluz/Dev/mongobranch-production-lab`
  - base scenario report: `/Users/rom.iluz/Dev/mongobranch-production-lab/reports/dogfood-report.json`
  - environment doctor report: `/Users/rom.iluz/Dev/mongobranch-production-lab/reports/atlas-local-doctor.json`
  - drift gate report: `/Users/rom.iluz/Dev/mongobranch-production-lab/reports/drift-gate-report.json`
  - drift baseline report: `/Users/rom.iluz/Dev/mongobranch-production-lab/reports/drift-baseline-report.json`
  - access-control reports:
    - `/Users/rom.iluz/Dev/mongobranch-production-lab/reports/access-provision-report.json`
    - `/Users/rom.iluz/Dev/mongobranch-production-lab/reports/access-list-report.json`
    - `/Users/rom.iluz/Dev/mongobranch-production-lab/reports/access-revoke-report.json`
- Second external workspace:
  - `/Users/rom.iluz/Dev/mongobranch-auth-dogfood`
  - init report: `/Users/rom.iluz/Dev/mongobranch-auth-dogfood/reports-init.json`
  - dogfood report: `/Users/rom.iluz/Dev/mongobranch-auth-dogfood/reports/production-dogfood-report.json`
  - approval artifact: `/Users/rom.iluz/Dev/mongobranch-auth-dogfood/reports/production-approval.json`
  - backup archive: `/Users/rom.iluz/Dev/mongobranch-auth-dogfood/reports/customer_ops_app.archive.gz`

### Strongest Current Proof
- Fresh external Bun consumer app used the installed `mb` CLI plus library/MCP surfaces
- `mb init --start-local` bootstrapped an auth-enabled Atlas Local preview workspace
- `mb doctor --json` passed **7/7** checks
- `mb access status --json` reported `enforced: true`
- Full external production dogfood passed **22/22** checks, including:
  - install/bootstrap artifacts
  - CLI doctor and RBAC enforcement probe
  - branch creation and lazy reads
  - scope violation blocking
  - least-privilege branch identity provisioning, denial, and revoke
  - checkpoint restore
  - stash/pop
  - safe protected deploy
  - deploy drift gate
  - stale conflict blocking
  - time travel
  - anonymized branch
  - execution guard
  - tamper-evident audit verification
  - CLI drift baselines
  - external CLI + MCP smoke
  - backup/restore drill via `mongodump` / `mongorestore`

### Product Status
- Approved now:
  - Atlas Local preview
  - auth-enabled local deployment
  - least-privilege-enforced core agent workflows
- Still not universal:
  - arbitrary MongoDB deployments without proven RBAC enforcement
  - production-scale benchmark envelope
  - fully packaged observability rollout

### Practical Rules
- For new external workspaces, the preferred onboarding flow is:
  - `mb init --db <name> --start-local`
  - `mb doctor`
  - `mb access status`
- Do not claim server-side protection from user/role provisioning alone
- Only treat Atlas Local as approval-grade when the live enforcement probe says `enforced: true`

### Immediate Next Wave
1. Re-run final repo lint/test after the packaging/docs sync in this turn
2. Add benchmark harness and measurable load envelope
3. Package observability guidance and runtime diagnostics
4. Consider deploy-service identity + optional write-block cutover as the next hardening slice
