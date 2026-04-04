# Architecture Decisions Log

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
