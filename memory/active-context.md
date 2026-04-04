# Active Context

## Current State (2026-04-04)

### v1.0.0 PUBLISHED — Production Ready
- **npm**: `mongobranch` v1.0.0 live on npmjs.com
- **GitHub**: https://github.com/romiluz13/MongoBranch
- **Stats**: 308 tests · 78 MCP tools · 44 CLI commands · 22 engines · 0 mocks
- **All 10 waves complete** — branching, commits, diff, merge, time travel, deploy requests, agent scoping, anonymization, search indexes, CI/CD
- **v1.0.1 in progress**: Added 5 database operations (aggregate, count, listCollections, updateMany, inferSchema) to close gaps vs MongoDB MCP Server

### ✅ Phase 4.1: Commit Engine — COMPLETE
- `CommitEngine` class in `src/core/commit.ts` — 255 lines
- Content-addressed SHA-256 hashes, parent chains, merge commits (two parents)
- `commit()`, `getCommit()`, `getLog()`, `getCommonAncestor()`, `getCommitCount()`
- HEAD pointer tracked via `headCommit` on BranchMetadata
- 13 TDD tests, all passing (138 total, zero failures)
- 3 MCP tools added: `commit`, `get_commit`, `commit_log` (total: 28 tools)
- 2 CLI commands added: `mb commit <branch> -m`, `mb commits <branch>`

### ✅ Phase 4.2: Tags & Refs — COMPLETE
- Tag methods added to `CommitEngine` (createTag, deleteTag, listTags, getTag)
- Immutability enforced: duplicate tag names rejected
- 9 TDD tests, all passing (147 total, zero failures)
- 3 MCP tools: `create_tag`, `list_tags`, `delete_tag` (total: 31 tools)
- CLI: `mb tag create/list/delete` — 3 subcommands

### ✅ Phase 4.3: Three-Way Merge — COMPLETE
- `DiffEngine.diff3()` — three-way diff with per-field comparison
- `MergeEngine.threeWayMerge()` — coordinates ancestor + diff3 + apply + merge commit
- Conflict strategies: manual (report), ours, theirs (auto-resolve)
- 5 TDD tests, all passing. 1 MCP tool: `merge_three_way` (total: 32 tools)
- Uses sourceDatabase as merge base (both branches fork from it)

### ✅ Phase 4.4: Cherry-Pick & Revert — COMPLETE
- `cherryPick()` — applies single commit's changes via snapshot diff, creates new commit
- `revert()` — creates inverse commit that undoes changes (drops added collections)
- 6 TDD tests, all passing. 2 MCP tools: `cherry_pick`, `revert_commit` (total: 34 tools)
- 2 CLI commands: `mb cherry-pick`, `mb revert`

### 🎉 WAVE 4 COMPLETE — v0.7.0
- All 4 phases done: Commits ✅, Tags ✅, Three-Way Merge ✅, Cherry-Pick & Revert ✅
- 33 new tests (151 total across 14 files)
- 9 new MCP tools (34 total)
- 9 new CLI commands

### 🎉 WAVE 5 COMPLETE — v0.8.0
- **Phase 5.1**: Branch TTL — `expiresAt`, `extendBranch()`, `setBranchExpiration()` — 6 tests
- **Phase 5.2**: Reset from Parent — `resetFromParent()` drops & re-copies — 2 tests
- **Phase 5.3**: Branch Protection — `ProtectionManager` class, glob patterns, merge-only — 7 tests
- **Phase 5.4**: Hooks & Webhooks — `HookManager` class, 14 event types, pre-reject/post-fire — 8 tests
- New files: `src/core/protection.ts`, `src/core/hooks.ts`, `tests/core/lifecycle.test.ts`
- 7 new MCP tools: `set_branch_ttl`, `reset_from_parent`, `protect_branch`, `list_protections`, `remove_protection`, `list_hooks`, `remove_hook` (total: 41 tools)

### 🎉 WAVE 6 COMPLETE — v0.9.0
- **Phase 6.1**: Time Travel — `TimeTravelEngine.findAt()` (commit hash + timestamp), `listCollectionsAt()` — 5 tests
- **Phase 6.2**: Blame — `TimeTravelEngine.blame()` field-level attribution — 2 tests
- **Phase 6.3**: Deploy Requests — `DeployRequestManager` (open/approve/reject/execute/list/get) — 10 tests
- New files: `src/core/timetravel.ts`, `src/core/deploy.ts`, `tests/core/timetravel.test.ts`, `tests/core/deploy.test.ts`
- 7 new MCP tools: `time_travel_query`, `blame`, `open_deploy_request`, `approve_deploy_request`, `reject_deploy_request`, `execute_deploy_request`, `list_deploy_requests` (total: 48 tools)
- Deep research: Dolt AS OF queries, Neon Time Travel (ephemeral branches), PlanetScale Deploy Requests
- CLI: `mb query` (time travel), `mb blame`, `mb deploy create/list/approve/reject/execute`
- Deploy requests fire pre-merge hooks (reject) + post-merge hooks (fire-and-forget)
- Fixed blame `findCreationCommit` to check actual commit data, not just oldest commit
- Fixed test imports: vitest instead of bun:test for proper discovery
- **200+ tests, 0 failures, 17 test files — vitest run exit 0**

### 🎉 WAVE 7 COMPLETE — v1.0.0
- **Phase 7.1**: Agent Scopes — ScopeManager, permissions, collection ACLs, quota, violation logging — 10 tests
- **Phase 7.2**: Branch Compare — BranchComparator, N-way matrix, overlap stats — 5 tests
- **Phase 7.3**: Stash — StashManager, stash/pop/list/drop, stack — 6 tests
- **Phase 7.4**: Anonymize — AnonymizeEngine, hash/mask/null/redact — 5 tests
- **Phase 7.5**: Reflog — ReflogManager, survives deletion, action filter — 5 tests
- New files: `src/core/{scope,compare,stash,anonymize,reflog}.ts`
- 11 new MCP tools (59 total)
- CLI: stash save/pop/list, compare, reflog, anonymize
- **220+ tests, 22 test files, all pass (npx vitest run exit 0)**

### 🎉 WAVE 8 IN PROGRESS — v1.1.0
- **Phase 8.1**: Atlas Search Index Branching — SearchIndexManager (list/copy/diff/merge) — COMPLETE
- **Phase 8.2**: npm Package & GitHub Actions — exports map, CI/CD pipeline — COMPLETE
- New files: `src/core/search-index.ts`, `tests/core/search-index.test.ts`, `.github/workflows/ci.yml`
- 4 new MCP tools: `list_search_indexes`, `copy_search_indexes`, `diff_search_indexes`, `merge_search_indexes`
- CLI: `mb search-index list/copy/diff/merge`
- Package.json: full exports map (20+ modules), `files` field, `prepublishOnly` script

### Key Architecture Decisions Made
- Three-way merge: 6-step process (Dolt-validated) — merge base via BFS, per-field conflicts
- Hook execution: sync pre-hooks (fail-fast rejection), async post-hooks (lakeFS-validated)
- Time travel: Snapshot-based (full document state stored per commit in `commit_data` collection)
- Deploy requests: Diff stored at creation time (PlanetScale pattern), status flow: open → approved → merged/rejected
- Blame: Backward commit walk with per-field change tracking, stops when all fields attributed

> Living document — updated as we work. Read this FIRST at session start.

## Project Name
**MongoBranch** (repo: aeltas-cli-agent)

## What We're Building
Git-like branching, diffing, and merging for MongoDB data — built for AI agents.
First-ever version control for MongoDB document data.

## Current Phase
**v0.6.0-alpha — AI/Search Integration + Real Embedding Stress Tests**
125 tests passing across 12 files — 15 stress tests including 6 REAL Voyage AI embedding tests.

**Completed**: autoEmbed docs, hybrid search docs, real Voyage AI stress tests (product vectors, re-embed, semantic similarity, hybrid search, lazy+AI, sequential merge with real vectors)
**Next up**: npm publish + GitHub release, then explore pi-mono for LLM integration

## Key Decisions Made
1. ✅ Name: MongoBranch
2. ✅ Language: TypeScript (strict mode)
3. ✅ Target: MongoDB (not Postgres — that's already done by Neon/Xata)
4. ✅ Distribution: CLI + MCP Server + Atlas CLI Plugin
5. ✅ Isolation: Separate database per branch (`__mb_{name}`) — ADR-004
6. ✅ Branch creation: Full snapshot copy (all docs + indexes) — ADR-005
7. ✅ Driver: Official MongoDB Node.js driver (v7)
8. ✅ Dev environment: Atlas Local Docker `preview` on port 27018 — ADR-006
9. ✅ Testing: TDD, real MongoDB only, zero mocks, realistic seed data

## Key Decisions Pending
- [ ] Change tracking: change streams vs operation log proxy (v2)
- [ ] Large collection handling: streaming copy vs lazy copy-on-write (v2)
- [ ] Three-way merge ancestor tracking strategy (v2)

## Tech Stack (Active)
- **Runtime**: Bun
- **Language**: TypeScript (strict)
- **CLI Framework**: Commander.js (v14)
- **MongoDB Driver**: mongodb (official, v7)
- **Testing**: Vitest via `bun test` — against REAL Atlas Local Docker
- **Local MongoDB**: `mongodb/mongodb-atlas-local:preview` on port 27018
- **Test fallback**: mongodb-memory-server (when Docker not available)
- **Docker**: docker-compose.yml manages Atlas Local container

## Competitive Intelligence

### ⚠️ Argon (argon-lab/argon) — DIRECT COMPETITOR
- "MongoDB Time Machine" — git-like branching + time travel for MongoDB
- Written in Go, has npm/pip SDKs
- WAL-based architecture, change stream capture, ZSTD compressed storage
- **Our differentiation**: Agent-native (MCP), multi-agent support, TypeScript ecosystem,
  document-level deep diff, Atlas CLI plugin, no import step required
- See: `docs/references/argon-mongodb-time-machine.md`

### Key Libraries Identified
- **jsondiffpatch** (5.3K⭐) — TypeScript JSON diff/patch, PERFECT for our diff engine
- **lakeFS** (5.2K⭐) — Gold standard for data branching patterns
- **SirixDB** (1.2K⭐) — Bitemporal append-only versioning

## Source Files (Current)
| File | Purpose |
|------|---------|
| `src/core/branch.ts` | BranchManager — create, list, switch, delete |
| `src/core/diff.ts` | DiffEngine — document-level diff via jsondiffpatch |
| `src/core/merge.ts` | MergeEngine — apply branch changes to target |
| `src/core/types.ts` | TypeScript types, config, constants |
| `src/cli.ts` | Commander CLI — branch, diff, merge (chalk, yaml config, confirm) |
| `src/mcp/server.ts` | MCP Server — stdio transport, 5 tools |
| `src/mcp/tools.ts` | MCP tool handlers — decoupled from transport |
| `tests/setup.ts` | Real MongoDB test setup (Atlas Local / fallback) |
| `tests/seed.ts` | Realistic ecommerce seed data |
| `tests/core/branch.test.ts` | Branch create/list tests (9 tests) |
| `tests/core/branch-operations.test.ts` | Switch/delete/isolation tests (11 tests) |
| `tests/core/diff.test.ts` | Diff engine tests (6 tests) |
| `tests/core/merge.test.ts` | Merge engine tests (6 tests) |
| `tests/mcp/server.test.ts` | MCP tool tests (13 tests) |

## Completed Milestones
1. ✅ Docs infrastructure (11 MongoDB docs, 7 references, 2 ADRs)
2. ✅ Competitive analysis (Argon = direct competitor)
3. ✅ TypeScript project scaffold (Bun + Vitest + Commander)
4. ✅ Branch engine — create/list/switch/delete with full data copy
5. ✅ Diff engine — jsondiffpatch for field-level document diff
6. ✅ Merge engine — apply branch changes to target (insert/delete/update)
7. ✅ CLI — `mb branch`, `mb diff`, `mb merge` commands
8. ✅ MCP Server — 8 tools (branch + agent ops) via stdio transport
9. ✅ CLI polish — chalk colors, interactive confirm, .mongobranch.yaml config
10. ✅ Multi-Agent Support — AgentManager, per-agent branches, data isolation
11. ✅ Claude Code Integration — skill file, workflow tools (start_task/complete_task)
12. ✅ Merge dry-run, schema diff (indexes), merge rollback safety
13. ✅ History & Audit — HistoryManager, `mb log`, branch_log/record_snapshot MCP tools
14. ✅ Rollback — reset branch to source, reject main, 3 tests
15. ✅ GC — garbage collect merged/deleted branches, CLI `mb gc`
16. ✅ README.md + package.json exports/bin/keywords
17. ✅ Conflict detection — ours/theirs/abort strategies
18. ✅ Read-only branches, merge queue (FIFO, atomic, batch drain)
19. ✅ Lazy copy-on-write — instant branch creation, materialize on demand
20. ✅ Streaming diffs — cursor-based, memory-efficient
21. ✅ Validation rule diff — JSON Schema comparison between branches
22. ✅ Audit log export — JSON/CSV with filtering
23. ✅ Operation log — track every write, summary, undo
24. ✅ CRUD proxy — insert/update/delete/find through MongoBranch
25. ✅ 110 TDD tests, 265 assertions, 0 failures — 25 MCP tools
26. ✅ Source-centric diffing — prevents cascade deletions in sequential merges
27. ✅ Stress tests — 9 scenarios: concurrent branches, large docs, CRUD, queue, lazy CoW, agent lifecycle, conflicts, undo
28. ✅ 119 TDD tests, 334 assertions, 0 failures — 11 test files
29. ✅ AI docs — autoEmbed (Voyage AI) + hybrid search ($rankFusion) documented locally
30. ✅ Real Voyage AI stress tests — 6 tests using REAL API (voyage-3-lite, 512 dims)
31. ✅ Tests: product vectors, re-embed lifecycle, semantic similarity, hybrid search, lazy+AI, sequential merge
32. ✅ Sequential merge with real embeddings — validates the cascade deletion fix with real vector data
33. ✅ 125 TDD tests, 0 failures — 15 stress tests across 12 files

## Next Steps
1. npm publish + GitHub release
2. Explore pi-mono repo for LLM integration ideas
