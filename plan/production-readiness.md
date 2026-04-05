# Production Readiness Checklist

## Meaning

For MongoBranch, "production ready" does not mean "the tests are green."
It means an external consumer can install it, boot a real Atlas Local environment,
run AI-agent workflows safely, and see protection, deploy safety, drift detection,
history, and recovery behave correctly outside the repo.

## Evidence Snapshot (2026-04-05)

- Repo verification:
  - `bun run lint` -> exit `0`
  - `bun run test` -> **32/32 files**, **340/340 tests**
  - latest full-suite duration:
    - `210.65s`
- External Bun consumer app #1:
  - Workspace: `/Users/rom.iluz/Dev/mongobranch-production-lab`
  - Base scenario: `/Users/rom.iluz/Dev/mongobranch-production-lab/reports/dogfood-report.json`
  - Result: **13/13 checks passed**
  - Drift gate: `/Users/rom.iluz/Dev/mongobranch-production-lab/reports/drift-gate-report.json`
  - Drift baseline: `/Users/rom.iluz/Dev/mongobranch-production-lab/reports/drift-baseline-report.json`
- External Bun consumer app #2:
  - Workspace: `/Users/rom.iluz/Dev/mongobranch-auth-dogfood`
  - Init artifact: `/Users/rom.iluz/Dev/mongobranch-auth-dogfood/reports-init.json`
  - Dogfood report: `/Users/rom.iluz/Dev/mongobranch-auth-dogfood/reports/production-dogfood-report.json`
  - Approval artifact: `/Users/rom.iluz/Dev/mongobranch-auth-dogfood/reports/production-approval.json`
  - Backup archive: `/Users/rom.iluz/Dev/mongobranch-auth-dogfood/reports/customer_ops_app.archive.gz`
  - Result: **22/22 checks passed**
  - Approval scope:
    - Atlas Local `preview`
    - auth enabled
    - least-privilege enforcement probe returns `true`
    - Bun-based core AI-agent workflows

## Checklist

### 1. Installability

- [x] Local package installs into an external Bun workspace
- [x] Installed `mb` CLI runs from the external workspace
- [x] Installed package exports work from the external workspace
- [x] `mb init --start-local` writes config + compose artifacts and launches Atlas Local preview

### 2. Environment Proof

- [x] `mb doctor --json` passes on the approved Atlas Local profile
- [x] `mb access status --json` proves whether MongoDB is enforcing least privilege
- [x] Approval now requires `enforced: true`, not just successful user/role provisioning

### 3. Core Branch Semantics

- [x] Creating a branch from `main` bootstraps real commit ancestry
- [x] Child branches inherit the parent branch head commit
- [x] Lazy branches read inherited data correctly
- [x] Checkpoints restore branch state after a bad write
- [x] Stash/pop restores work-in-progress branch data
- [x] Time travel returns the stored document snapshot for a commit
- [x] Anonymized branches mask/redact PII correctly

### 4. Data Safety

- [x] Protected targets can use deploy requests to merge into `main`
- [x] Scope violations block unauthorized writes and are logged
- [x] Three-way merge detects stale concurrent edits against `main`
- [x] Deploy execution refuses stale conflicting merges instead of overwriting newer data
- [x] Deploy execution refuses post-approval drift even for otherwise non-conflicting writes
- [x] CLI drift baselines detect post-review raw writes on `main`
- [x] Least-privilege branch-scoped identities can write only within their allowed branch/collection scope when enforcement is enabled

### 5. Agent Surfaces

- [x] Library API works from an external consumer app
- [x] MCP tool handlers work from an external consumer app
- [x] CLI commands work from an external consumer app
- [x] CLI can provision/list/revoke MongoDB identities from an external consumer app

### 6. Recovery

- [x] Backup/restore drill succeeded via `mongodump` / `mongorestore` in the approved Atlas Local profile
- [x] Tamper-evident audit chain verifies after real operations
- [x] Execution guard deduplicates retried requestIds

### 7. Verification Quality

- [x] Full repo test suite passed before the final docs/package sync in this wave
- [x] Two external dogfood scenarios passed against real Atlas Local
- [x] Real Atlas Local preview was used instead of mocks for all dogfood evidence

## Approval

### Approved Now

MongoBranch is now **approved for Atlas Local preview, auth-enabled, least-privilege-enforced, Bun-based core AI-agent workflows**.

That approval is backed by a fresh external consumer app that:

- installed the local package
- bootstrapped with `mb init --start-local`
- passed `mb doctor`
- passed live RBAC enforcement probing
- completed 22/22 real install-to-restore checks

### Not A Blanket Approval

MongoBranch is still **not** universally signed off for every deployment profile:

- environments where `mb access status` reports `enforced: false`
- non-Atlas-Local targets not yet validated to the same standard
- production-scale benchmark/load envelopes
- observability/monitoring packaging beyond the current code-level capabilities

## Practical Status

Current status: **scoped production approval for Atlas Local preview enforced-profile core agent workflows; broader deployment profiles still require separate proof**
