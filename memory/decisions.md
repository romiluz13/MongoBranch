# Architecture Decisions Log

## 2026-04-05: Release `1.0.1` Carries The External-Consumer Hardening Slice
- **Decision**: Publish a patch release with the new external-consumer onboarding and safety proof instead of leaving those fixes unreleased behind npm `1.0.0`
- **Context**: The repo now includes `mb init --start-local`, the `./drift` package export, stronger Atlas Local approval criteria, and a successful 22/22 external dogfood run in an auth-enabled Bun consumer app
- **Implication**: npm `latest` is now `1.0.1`, which matches the stronger install-to-ready and production-approval story
- **Status**: ✅ Accepted and published

## 2026-04-05: `mb init --start-local` Is The Default External Onboarding Path
- **Decision**: Prefer `mb init --db <name> --start-local` over telling external users to manually run repo-local `docker compose up -d`
- **Context**: External dogfooding showed that the old README quick start assumed the user had the repo’s compose file, which is false for npm-installed consumers
- **Implication**: New workspaces now get a generated `.mongobranch.yaml`, an auth-enabled Atlas Local compose file, and a live `doctor`/RBAC proof path immediately after install
- **Status**: ✅ Accepted and implemented

## 2026-04-05: Atlas Local Production Approval Is Scoped To Enforced RBAC Environments
- **Decision**: Treat Atlas Local `preview` as production-approved only when:
  - `mb doctor` passes
  - `mb access status` reports `enforced: true`
  - the install path has been proven from an external Bun consumer workspace
- **Context**: Earlier local proof showed user/role provisioning without real enforcement. A later auth-enabled workspace created via `mb init --start-local` proved least-privilege enforcement and passed a 22/22 end-to-end dogfood suite
- **Implication**: MongoBranch now has a real, bounded production approval for core AI-agent workflows on Atlas Local preview, while still avoiding blanket claims for every deployment profile
- **Status**: ✅ Accepted and implemented

## 2026-04-05: Package Subpath Exports Are Part Of The Production Contract
- **Decision**: Export `mongobranch/drift` from the package just like the rest of the public engines used by external consumers
- **Context**: The new external dogfood app failed immediately because `DriftManager` existed in-repo but was not exported through `package.json`
- **Implication**: External install validation must cover package subpath exports, not only the CLI bins
- **Status**: ✅ Accepted and implemented

## 2026-04-05: Active Context Must Stay Current, Not Historical
- **Decision**: Treat `memory/active-context.md` as a clean current-state snapshot and keep public surfaces aligned with the latest verified evidence
- **Context**: The file had accumulated older milestone snapshots and stale counts, which made it conflict with the actual repo state, external dogfood evidence, and production-readiness wording
- **Implication**: Historical decisions stay in `memory/decisions.md`, but current status, Atlas Local defaults, test totals, and enforcement caveats must live in one truthful active snapshot
- **Status**: ✅ Accepted and implemented

## 2026-04-05: Access Control Must Be Probed, Not Assumed
- **Decision**: Add `AccessControlManager` to provision least-privilege branch/deployer MongoDB identities and run a live restricted-user enforcement probe
- **Context**: Official MongoDB docs are clear that RBAC only protects data when access control is actually enabled and enforced. Live Atlas Local probing in this workspace showed that the deployment accepts `createUser` and `createRole`, but still allows forbidden writes from the restricted user
- **Implication**: MongoBranch now distinguishes between:
  - identity provisioning succeeded
  - server-side least privilege is truly enforced
- **Operational rule**: do not claim production-grade direct-write prevention from successful user/role creation alone; trust `mb access status` / `access_control_status` / `mb doctor`
- **Status**: ✅ Accepted and implemented

## 2026-04-05: Drift Baselines Use Review-Time `operationTime` Fences
- **Decision**: Add a first-class `DriftManager` that captures branch freshness baselines by storing the MongoDB `operationTime` of a metadata write, then checks later branch changes with `startAtOperationTime` change streams
- **Context**: Protected deploys already used approval fences, but AI agents also need a reusable way to ask "did `main` or this branch change since review?" outside the deploy-request workflow
- **Implication**: MongoBranch now has a portable stale-state primitive for CLI, MCP, and external consumer apps instead of hiding drift logic inside deploy execution only
- **Status**: ✅ Accepted and implemented

## 2026-04-05: Protected Deploy Approval Uses An Operation-Time Fence
- **Decision**: Use the MongoDB `operationTime` of the approval write itself as the deploy-review fence, then detect post-approval drift with `startAtOperationTime` change streams on the source and target databases
- **Context**: Resume-token equality on idle change streams produced false positives in Atlas Local because cold cursors can advance metadata without reflecting a user-visible write
- **Implication**: Protected deploy execution now fails closed if either side changed after approval, even when the merge might otherwise be conflict-free
- **Status**: ✅ Accepted and implemented

## 2026-04-05: Atlas Local Preview Needs Live Capability Proof
- **Decision**: Treat Atlas Local `preview` as a first-class runtime and probe the exact MongoDB capabilities MongoBranch depends on instead of assuming they are ready
- **Context**: Atlas Local preview is the target environment, and preview surfaces such as pre-images, Atlas Search, and Atlas Vector Search are too important to trust via static assumptions alone
- **Decision**: Add `EnvironmentDoctor` and expose it through both CLI (`mb doctor`) and MCP (`environment_doctor`)
- **Context**: Human operators and AI agents need the same ground-truth capability report before relying on Atlas Local preview features
- **Status**: ✅ Accepted and implemented

## 2026-04-05: Transaction-Aware Commit Semantics
- **Decision**: `CommitEngine.commit()` must be session-aware, and transactional callers must pass the same `ClientSession` through commit creation so the commit snapshot and `commit_data` reflect the same transactional view as the branch writes
- **Context**: Merge, three-way merge, cherry-pick, and revert were creating commits from inside a transaction, but `commit()` was reading and writing outside that session, which could produce stale pre-transaction snapshots while the live data committed correctly
- **Decision**: Stored commit snapshots are no longer "best effort" for successful commits; they are part of commit correctness and should fail the commit if they cannot be written
- **Context**: Time travel, merge-base reconstruction, cherry-pick, and revert now all depend on `commit_data`, so silently skipping snapshot persistence creates semantically broken commits
- **Decision**: Precompute collection names outside the transaction, then read/write those collections inside the shared session
- **Context**: MongoDB rejected `listCollections()` inside multi-document transactions during live verification, so transactional commits need an explicit collection-set handoff
- **Decision**: Use a compact hashed temp DB name for ancestor materialization instead of embedding `metaDatabase`
- **Context**: MongoDB database names must be less than 64 bytes; long custom `metaDatabase` values caused three-way merge temp DB names to exceed that limit
- **Status**: ✅ Accepted and implemented

## 2026-04-05: Post-Audit Semantic Hardening
- **Decision**: Enforce protection rules and agent scopes in the central `BranchProxy` write path, and thread `agentId` through MCP CRUD tools so policy checks apply to real agent writes
- **Context**: Protection and scope managers existed, but they were bypassable because the primary write path only enforced `readOnly`
- **Decision**: Treat parent branch `headCommit` as inherited branch ancestry and require ancestor-backed merges to materialize the actual stored merge-base snapshot from `commit_data`
- **Context**: Nested branches should naturally participate in `getCommonAncestor()`, and three-way merge semantics are only trustworthy when the merge base is the real ancestor snapshot rather than the drifting root source DB
- **Decision**: Make commit snapshots content-sensitive and drive cherry-pick/revert from stored per-collection documents applied via `bulkWrite`/`replaceOne`/`deleteOne`
- **Context**: `_id`-only checksums missed field-only mutations, which caused cherry-pick and revert to silently no-op on content changes
- **Decision**: In parallel Vitest runs, clear the shared `__mongobranch` metadata collections instead of dropping the metadata database
- **Context**: Dropping the shared metadata DB created cross-file races where another suite could not create collections because the database was still being dropped
- **Status**: ✅ Accepted and implemented

## 2026-04-05: Strategic Direction — Agent Control Plane, Not Infrastructure Clone
- **Decision**: Strategically position MongoBranch as an agent-control plane for MongoDB rather than a broad reimplementation of database infrastructure
- **Context**: Fresh official-source research across MongoDB, Neon, PlanetScale, Dolt, Xata, Argon, OpenAI, Anthropic, and durable workflow tooling showed that MongoDB already provides major primitives (search, vector search, automated embeddings, streaming, local deployments, MCP connectivity), while competitors cover parts of branching/versioning without solving agent governance end-to-end
- **Implication**: MongoBranch should focus product energy on reviewable agent workflows: branch ownership, explainable diffs, approval-gated merges, replay-safe mutation IDs, resumable long-running jobs, audit/event ledgers, and privacy-safe branch execution
- **Anti-scope rule**: Do not build a second search stack, generic workflow engine, or replacement for deprecated Atlas App Services / Data API surfaces as the primary product foundation
- **Status**: ✅ Accepted as current product strategy recommendation

## 2026-04-05: Conflict-Abort Merge Semantics + Standalone Verification Harness
- **Decision**: 2-way `merge()` with `detectConflicts: true` and `conflictStrategy: "abort"` must preserve the full pre-merge state: no writes applied, no branch status transition to `merged`, and `success: false` returned to the caller
- **Context**: This matches Git’s documented abort semantics (reconstruct pre-merge state) and MongoDB transaction atomicity (discard all uncommitted changes on abort/error)
- **Decision**: Keep `scripts/realworld-10turn.ts` as a standalone verification harness outside Vitest for adversarial validation after full DB cleanup
- **Context**: It exercises branch/proxy/diff/merge/commit/checkpoint/scope/audit/reflog/time-travel behavior in a realistic sequence and caught an incorrect script assertion during validation
- **Decision**: For repo-wide validation, use `bun run test` as the canonical full-suite command because it maps to `vitest run` in `package.json`
- **Status**: ✅ Accepted and implemented

## 2026-04-04: Validation Sync — Atlas Local Port + Watcher Shutdown
- **Decision**: Standardize local Atlas Local documentation and Docker usage on port `27017`, while keeping `27018` only as a legacy/custom fallback in test detection
- **Context**: Official Atlas Local Docker docs show `docker run -p 27017:27017 mongodb/mongodb-atlas-local`, and this repo's `docker-compose.yml` already maps `27017:27017`
- **Decision**: Treat intentional `changeStream.close()` during watcher shutdown as an expected control-flow path, not a runtime warning condition
- **Context**: Official Node.js driver docs state `close()` is the correct way to stop processing change streams and free resources
- **Status**: ✅ Accepted and implemented

## 2026-04-02: MongoDB-Native Full Harmony Integration
### Core Engine (P0)
- **Transactions**: merge/threeWayMerge/cherryPick/revert wrapped in `session.withTransaction()`
- **bulkWrite**: Batch operations in merge + cherryPick replace individual CRUD calls
- **$graphLookup**: `getCommonAncestor()` — server-side ancestry traversal, O(2) round trips
- **$merge**: `copyCollections()` + `materializeCollection()` — zero client memory copies
- **findOneAndUpdate/Delete**: proxy.ts — atomic before-state capture (race condition fix)
- **Bug fix**: `merge()` was passing `strategy` instead of `conflictStrategy`

### Indexes & Validation (P1)
- **Partial indexes**: `parentHashes` for graphLookup, deploy requests `status: open/approved`
- **Collation**: Branch name unique index with `{locale:'en',strength:2}` — case-insensitive safety net
- **TTL indexes**: Oplog 30d, reflog 90d, scope violations 30d — bounded growth
- **$jsonSchema**: Branch metadata + commits collections validated (`moderate` level)

### Server-Side Operations (P1)
- **$currentDate**: All 13 `updatedAt: new Date()` replaced with server-side `$currentDate:{updatedAt:true}`
- **$lookup**: `getBranchWithHead()` — join branch metadata + commit info in single query
- **$collStats**: `getBranchStats()` — per-collection storage stats, doc counts, sizes
- **estimatedDocumentCount**: `getBranchSummary()` — fast approximate branch totals

### Ecosystem (P2)
- **Change Streams**: `BranchWatcher` class with `fullDocument:updateLookup` + `fullDocumentBeforeChange:whenAvailable`
- **CLIENT_OPTIONS**: `retryWrites:true`, `retryReads:true`, `w:"majority"`, `appName:"mongobranch"`

### Test validation: All 247 tests pass across 24 files

## 2026-03-31: Wave 6 Complete — Time Travel, Blame, Deploy Requests
- **Time Travel**: Snapshot-based, full doc state per commit, query at commit hash or timestamp
- **Blame**: Backward commit walk with per-field tracking, findCreationCommit checks actual data
- **Deploy Requests**: PR-like flow (open→approve→execute), stores diff at creation, hook integration
- **Test runner**: Use `npx vitest run` NOT `bun test` — vitest is the project's runner per package.json
- **Hook integration in Deploy**: Pre-merge hooks can reject execute, post-merge hooks fire-and-forget

> Record of every significant decision. Never delete entries — only append.

## ADR-001: Project Name — MongoBranch
- **Date**: 2026-03-30
- **Decision**: Name the project "MongoBranch"
- **Context**: Descriptive, memorable, conveys the core concept (MongoDB + branching)
- **Alternatives**: MongoGit, MongoFork, BranchDB, AeltasDB
- **Status**: ✅ Accepted

## ADR-002: TypeScript as Primary Language
- **Date**: 2026-03-30
- **Decision**: Use TypeScript for all source code
- **Context**: MongoDB Node.js driver is first-class; TypeScript provides type safety;
  MCP SDK is TypeScript-native; CLI frameworks (Commander, Oclif) are TypeScript-native
- **Alternatives**: Go (Dolt uses Go), Rust (performance), Python (AI ecosystem)
- **Status**: ✅ Accepted

## ADR-003: Triple Distribution — CLI + MCP + Atlas Plugin
- **Date**: 2026-03-30
- **Decision**: Ship as standalone CLI, MCP server, AND Atlas CLI plugin
- **Context**: CLI for humans, MCP for AI agents, Atlas plugin for Atlas users
- **Status**: ✅ Accepted

## ADR-004: Separate Database per Branch
- **Date**: 2026-03-30
- **Decision**: Each branch gets its own MongoDB database (`__mb_{branchName}`)
- **Context**: MongoDB doesn't have native branching — we simulated with separate DBs
- **Options Evaluated**:
  - Option A: Collection prefix (`users__branch_feat1`) — rejected: messy namespace
  - **Option B: Separate database per branch** ← CHOSEN
  - Option C: Hybrid — partially adopted (metadata in `__mongobranch` DB)
- **Implementation**: `branchPrefix: "__mb_"` → branch "feature-auth" → DB `__mb_feature-auth`
- **Metadata**: Stored in `__mongobranch.branches` collection (central registry)
- **Cleanup**: `dropDatabase()` for instant branch deletion
- **Status**: ✅ Accepted — implemented in `src/core/branch.ts`

## ADR-005: Snapshot Copy for Branch Creation
- **Date**: 2026-03-30
- **Decision**: Full snapshot copy on branch create (all documents + indexes)
- **Context**: We needed a working isolation strategy for Wave 1
- **What it does**:
  - `createBranch()` copies ALL documents from source to branch DB
  - Copies ALL indexes (except `_id_`)
  - Records branch metadata (parent, collections, timestamps)
- **Trade-off**: O(n) copy is expensive for large DBs, but simple and correct
- **Future**: Wave 4 will add lazy copy-on-write (only copy on first write)
- **Status**: ✅ Accepted — implemented in `src/core/branch.ts`

## ADR-006: Atlas Local Preview on Port 27018
- **Date**: 2026-03-30
- **Decision**: Use `mongodb/mongodb-atlas-local:preview` on port 27018 for dev/test
- **Context**: Dev machine has other MongoDB instances on default port 27017
- **Why `preview`**: Includes mongot (Atlas Search), Vector Search, auto-embedding
- **Why 27018**: Avoids port conflicts with existing MongoDB instances
- **Fallback**: Tests auto-detect Docker → fall back to mongodb-memory-server
- **Status**: ✅ Accepted — implemented in `docker-compose.yml` and `tests/setup.ts`


## ADR-008: Commit Graph Architecture
- **Date**: 2026-03-31
- **Decision**: Add a commit graph layer on top of existing oplog/history
- **Context**: Neon has no merge/diff. Dolt has full Git-style commit graph with three-way merge.
  MongoBranch needs commits to enable: tags, cherry-pick, revert, time travel, blame.
- **Design**: Content-addressed SHA-256 hashes, parent chain, merge commits with two parents
- **Stored in**: `__mongobranch.commits` collection with unique hash index
- **Impact**: Commits become the backbone for all advanced features
- **Status**: ✅ Implemented — Wave 4, Phase 4.1

## ADR-009: Three-Way Merge Algorithm
- **Date**: 2026-03-31
- **Decision**: Implement three-way merge using common ancestor from commit graph
- **Context**: Current merge is 2-way (source vs target) — misses concurrent changes.
  Dolt's three-way merge: find merge base → diff base→ours + diff base→theirs → auto-merge non-overlapping → conflict on same doc+field with different values.
- **For MongoDB**: Primary key = `_id`, per-field conflict granularity, structured conflict table
- **Conflict resolution**: `ours`, `theirs`, `custom` (provide specific value)
- **Impact**: This is the #1 feature Neon lacks — makes MongoBranch a true VCS
- **Status**: ✅ Implemented — Wave 4, Phase 4.3

## ADR-010: Branch TTL via MongoDB TTL Indexes
- **Date**: 2026-03-31
- **Decision**: Use MongoDB native TTL indexes for automatic branch expiration
- **Context**: Agents leave orphan branches. Neon has branch TTL. lakeFS has garbage collection.
  MongoDB TTL indexes auto-delete documents when `expiresAt` passes — zero application-side cron.
- **Gotcha**: TTL index only deletes the metadata doc. Need a poller/hook to also drop the branch DB.
- **Status**: ✅ Implemented — Wave 5, Phase 5.1

## ADR-011: Hook System Design (Updated after lakeFS validation)
- **Date**: 2026-03-31 (validated 2026-03-31)
- **Decision**: Synchronous pre-hooks (can reject), fire-and-forget post-hooks, 14 event types
- **Context**: lakeFS source code (`pkg/graveler/hooks_handler.go`) validates this exact pattern:
  - Pre-hooks return error (can reject operation) — fail-fast execution
  - Post-hooks return void (notification only, cannot reject)
  - lakeFS has 18 event types across 9 operations (we adopt 14 for our scope)
- **Events (14)**: pre/post-commit, pre/post-merge, pre/post-create-branch, pre/post-delete-branch,
  pre/post-create-tag, pre/post-delete-tag, pre-revert, pre-cherry-pick
- **Execution**: Ordered by priority, first rejection stops the chain
- **Hook context**: runId, eventType, branchName, user, diff summary, commit info
- **Webhook support**: HTTP POST to external URLs (async, fire-and-forget for post-events)
- **Status**: ✅ Implemented — Wave 5, Phase 5.4

## ADR-013: Three-Way Merge — 6-Step Process (Validated from Dolt)
- **Date**: 2026-03-31
- **Decision**: Implement 6-step three-way merge adapted from Dolt's SQL approach to MongoDB documents
- **Source**: dolthub.com/blog/2024-06-19-threeway-merge (Tim Sehn, 23 min deep dive)
- **Steps**:
  1. Find merge base (BFS common ancestor from commit graph)
  2. Schema merge (collection-level: added/removed collections)
  3. Schema conflict resolution (if both sides modify same collection structure)
  4. Data merge (document-level: walk sorted `_id` sets from base→ours and base→theirs)
  5. Data conflict resolution (same `_id` + same field + different values = conflict)
  6. Constraint validation (check indexes, validation rules post-merge)
- **Key insight from Dolt**: JSON columns auto-merge if different keys modified — directly maps to MongoDB embedded documents
- **MongoDB adaptation**: No Prolly Trees needed — use oplog diffs + snapshot comparison
- **Conflict granularity**: Per-field within a document (not per-document)
- **Status**: ✅ Implemented — Wave 4, Phase 4.3

## ADR-014: PII Anonymization Strategy (Validated from Neon)
- **Date**: 2026-03-31
- **Decision**: Static masking at branch creation time, with path to dynamic masking
- **Source**: neon.com/blog/branching-environments-anonymized-pii (Nov 2025)
- **V1 (Static)**: Masking runs once at branch creation. Parent data untouched. Branch-specific rules.
- **Strategies**: hash (SHA-256), mask (***), faker (realistic fake), null, custom function
- **V2 (Dynamic, future)**: Query-time masking, no storage delta, zero additional cost
- **MongoDB adaptation**: Use aggregation pipeline with $addFields for dynamic, $merge for static
- **Status**: ✅ Implemented — Wave 7, Phase 7.4

## ADR-012: Competitive Positioning
- **Date**: 2026-03-31
- **Decision**: Position MongoBranch as "the missing piece for MongoDB" — what Neon did for Postgres, but with merge
- **Neon gaps**: No merge, no diff, no conflict detection, branches are disposable dead-ends
- **Dolt gap**: Only works with MySQL/SQL, not MongoDB/documents
- **MongoBranch advantage**: Full Git workflow (branch→commit→diff→merge) + MongoDB's native JSON/vector/hybrid search
- **Tagline**: "Neon gave Postgres branching. We gave MongoDB version control."
- **Status**: ✅ Accepted

## ADR-015: `main` Must Participate In The Commit Graph
- **Date**: 2026-04-05
- **Decision**: Treat `main` as a first-class ancestry source by bootstrapping a baseline commit the first time a branch is created from `main`
- **Context**: External dogfooding showed that stale deploy conflict detection could not work reliably because branches from `main` had no shared ancestor with `main`
- **Implementation**:
  - first branch-from-`main` creates a bootstrap `main` commit if none exists
  - branches inherit that bootstrap/main head commit on creation
  - `CommitEngine` resolves head commits for both `main` and named branches
- **Impact**: Three-way merge and deploy safety now work against `main` instead of only against branch-to-branch scenarios
- **Status**: ✅ Implemented

## ADR-016: Deploy Requests Use Three-Way Merge With Conflict Blocking
- **Date**: 2026-04-05
- **Decision**: Execute deploy requests through `threeWayMerge(..., { conflictStrategy: "manual" })` rather than the blind 2-way merge path
- **Context**: External dogfooding proved a stale feature branch could overwrite a newer hotfix on `main`
- **Implementation**:
  - deploy execution now detects conflicts against the real merge base
  - stale/conflicting deploy requests stay `approved` and fail closed instead of merging
  - successful deploys still mark the source branch merged and update target history
- **Impact**: Protected-target deploys are now aligned with real PR safety semantics
- **Status**: ✅ Implemented

## ADR-017: Installed CLIs Are Bun-First
- **Date**: 2026-04-05
- **Decision**: Ship `mb` and `mongobranch-mcp` as Bun-first entrypoints instead of implicitly relying on whatever Node runtime is on PATH
- **Context**: External CLI smoke showed the installed package was launching under Node despite the repo/runtime contract being Bun
- **Implementation**:
  - CLI/MCP shebangs now use `#!/usr/bin/env bun`
  - `package.json` no longer advertises generic Node runtime support
- **Impact**: Installed CLIs now match the repo's validated runtime model and avoid accidental dependence on Node TS execution behavior
- **Status**: ✅ Implemented
