# Active Context

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
