# MongoBranch — Agent Methodology & Project Index

> This file defines how AI agents (Claude Code, Augment, etc.) should work on this project.
> Read this FIRST before making any changes.
>
> ⚡ **CRITICAL**: At the END of every prompt/task, re-read this file and UPDATE it
> if anything changed (new files, decisions, context, gotchas). Context engineering
> is the key to success. This file is the single source of truth.

## Project Identity

- **Name**: MongoBranch
- **Repo**: aeltas-cli-agent
- **What**: Git-like branching, diffing, and merging for MongoDB data — built for AI agents
- **Tagline**: "Give your MongoDB a branching superpower. Safe agent experimentation."

## Agent Rules

### 0. End-of-Prompt Protocol (MANDATORY)
At the END of every prompt, BEFORE responding to the user:
1. **RE-READ** this file (`AGENTS.md`)
2. **CHECK**: Did any files change? New files created? Files deleted?
3. **CHECK**: Were any architecture decisions made?
4. **CHECK**: Were any errors encountered and solved?
5. **UPDATE** this file's Source/Test/Infrastructure indexes if files changed
6. **UPDATE** `memory/active-context.md` if project state changed
7. **UPDATE** `memory/decisions.md` if decisions were made
8. **UPDATE** `memory/errors.md` if errors were solved
9. **UPDATE** `memory/gotchas.md` if new pitfalls were discovered
10. **UPDATE** `plan/roadmap.md` if tasks were completed

### 1. Memory Protocol
- **READ** `memory/active-context.md` at the start of every session
- **READ** `memory/gotchas.md` before making any MongoDB-related decisions
- **READ** `memory/decisions.md` before proposing architecture changes
- **WRITE** to `memory/errors.md` whenever you encounter and solve an error
- **WRITE** to `memory/decisions.md` whenever an architecture decision is made
- **UPDATE** `memory/active-context.md` whenever project state changes

### 2. Documentation Protocol
- **MongoDB docs** live in `docs/mongodb/` — organized by capability
- **Reference projects** live in `docs/references/` — competitive intelligence
- **Architecture decisions** live in `docs/architecture/` — ADR format
- When you need MongoDB API details, check `docs/mongodb/` FIRST
- If docs are insufficient, fetch from official MongoDB web docs and UPDATE local docs
- Never invent MongoDB API behavior — always verify against docs

### 3. Research Protocol
- Use web search for latest MongoDB features, competitor moves, ecosystem changes
- Use GitHub search (octocode) for implementation patterns and libraries
- Always check `docs/references/argon-mongodb-time-machine.md` for competitive positioning
- Document new findings in appropriate reference files

### 4. Code Protocol
- **Language**: TypeScript (strict mode)
- **Runtime**: Bun (NOT Node.js — use `bun` for everything)
- **Testing**: Vitest via `bun test` — real MongoDB only, ZERO mocks
- **Local MongoDB**: `docker compose up -d` → Atlas Local preview on port 27018
- **Files**: Max 200 lines for components, 400 lines for services
- **Source**: All code in `src/`
- **Tests**: All tests in `tests/`
- Always check `plan/roadmap.md` for current wave/phase before coding

### 5. Quality Protocol
- No placeholders, no TODOs, no "in a full implementation..."
- Every function must have error handling
- Every public API must have TypeScript types
- Tests use REAL MongoDB with REAL seed data — never mock the database
- Run `bun test` before claiming completion — all 20+ tests must pass
- Update `memory/errors.md` with any issues encountered

## Project File Index

### 📋 Planning
| File | Purpose |
|------|---------|
| `plan/roadmap.md` | Master roadmap — 4 waves, all phases and tasks |

### 📚 MongoDB Documentation
| File | Purpose |
|------|---------|
| `docs/mongodb/crud/crud-operations.md` | Insert, find, update, delete, bulkWrite |
| `docs/mongodb/change-streams/change-streams.md` | Watch, pre/post images, resume tokens |
| `docs/mongodb/transactions/transactions.md` | ACID, sessions, withTransaction |
| `docs/mongodb/aggregation/aggregation-pipeline.md` | $lookup, $merge, $out, pipeline stages |
| `docs/mongodb/indexes/indexes.md` | Index types, management, branch strategy |
| `docs/mongodb/schema-validation/schema-validation.md` | JSON Schema, validation levels |
| `docs/mongodb/views-collections/views-and-collections.md` | Views, capped, namespaces |
| `docs/mongodb/commands/admin-commands.md` | listDatabases, collMod, rename |
| `docs/mongodb/replication/replication.md` | Oplog, replica sets, read/write concerns |
| `docs/mongodb/driver-nodejs/driver-api.md` | Node.js driver classes and methods |
| `docs/mongodb/atlas-cli/atlas-cli.md` | Atlas CLI commands, local dev, plugins |
| `docs/mongodb/ai/automated-embeddings.md` | AutoEmbed index, Voyage AI, vectorSearch |
| `docs/mongodb/ai/hybrid-search.md` | $rankFusion, $scoreFusion, hybrid search |

### 🔗 References
| File | Purpose |
|------|---------|
| `docs/references/argon-mongodb-time-machine.md` | ⚠️ DIRECT COMPETITOR — study carefully |
| `docs/references/dolt-git-for-data.md` | Prolly Tree architecture, git-for-data model |
| `docs/references/neon-copy-on-write-branching.md` | Copy-on-write branching patterns |
| `docs/references/xata-agent-autonomous-db-sre.md` | Agent safety patterns, self-healing |
| `docs/references/gastown-multi-agent-orchestrator.md` | Multi-agent coordination |
| `docs/references/mongodb-mcp-server.md` | MCP integration architecture |
| `docs/references/tools-and-libraries.md` | jsondiffpatch, lakeFS, SirixDB, CLI frameworks |

### 🏗️ Architecture
| File | Purpose |
|------|---------|
| `docs/architecture/adr-001-storage-strategy.md` | Hybrid DB isolation (separate DB per branch) |
| `docs/architecture/adr-002-diff-algorithm.md` | Operation log + snapshot diff |

### 🧠 Memory
| File | Purpose |
|------|---------|
| `memory/active-context.md` | Current project state — read at session start |
| `memory/decisions.md` | All architecture decisions — append only |
| `memory/gotchas.md` | Known pitfalls — check before MongoDB operations |
| `memory/errors.md` | Error log — write when you solve errors |

### 💻 Source (Wave 1+)
| File | Purpose |
|------|---------|
| `src/core/branch.ts` | BranchManager class — create, list, switch, delete branches |
| `src/core/diff.ts` | DiffEngine class — document-level diff via jsondiffpatch |
| `src/core/merge.ts` | MergeEngine class — apply branch changes to target |
| `src/core/agent.ts` | AgentManager class — register agents, per-agent branches |
| `src/core/history.ts` | HistoryManager class — snapshot recording, branch log |
| `src/core/queue.ts` | MergeQueue class — ordered merge queue for concurrent agents |
| `src/core/oplog.ts` | OperationLog class — track every write op per branch |
| `src/core/proxy.ts` | BranchProxy class — CRUD proxy with auto-materialization |
| `src/core/commit.ts` | CommitEngine class — content-addressed commits, SHA-256, parent chains, tags, cherry-pick, revert |
| `src/core/protection.ts` | ProtectionManager class — branch protection rules, glob patterns |
| `src/core/hooks.ts` | HookManager class — 14 event types, pre-reject/post-fire-and-forget |
| `src/core/types.ts` | TypeScript types, interfaces, config, constants |
| `src/cli.ts` | Commander.js CLI entry point (`mb branch`, `mb commit` commands) |
| `src/mcp/server.ts` | MCP Server — stdio transport, tool registration |
| `src/mcp/tools.ts` | MCP tool handlers — create/list/diff/merge wired to engines |
| `src/mcp/mongobranch.agent.md` | Agent skill file — teaches AI agents to use MongoBranch |

### 🧪 Tests (TDD, real MongoDB, zero mocks)
| File | Purpose |
|------|---------|
| `tests/setup.ts` | MongoDB connection — Atlas Local Docker (port 27018) / fallback |
| `tests/seed.ts` | Realistic ecommerce data (users, products, orders) |
| `tests/core/branch.test.ts` | Branch create, validate, metadata, list tests |
| `tests/core/branch-operations.test.ts` | Switch, delete, data isolation tests |
| `tests/core/diff.test.ts` | Diff engine — detect added/removed/modified docs |
| `tests/core/merge.test.ts` | Merge engine — apply changes, multi-collection, status |
| `tests/core/agent.test.ts` | Agent registration, per-agent branches, isolation |
| `tests/core/history.test.ts` | Snapshot recording, branch log, audit trail |
| `tests/core/queue.test.ts` | Merge queue — enqueue, FIFO, processAll |
| `tests/core/oplog.test.ts` | Operation log — record, query, summary, undo |
| `tests/core/proxy.test.ts` | CRUD proxy — insert/update/delete, lazy auto-materialize |
| `tests/core/commit.test.ts` | Commit engine — create, chain, log, common ancestor, merge commits, tags |
| `tests/core/three-way-merge.test.ts` | Three-way merge — clean merge, conflict detection, resolution strategies |
| `tests/core/lifecycle.test.ts` | Branch TTL, reset from parent, protection rules, hooks — Wave 5 |
| `tests/core/stress.test.ts` | Stress tests — concurrent, large docs, queue, lazy CoW, lifecycle |
| `tests/core/stress-ai.test.ts` | AI stress tests — real Voyage AI embeddings, sequential merge, hybrid search |
| `tests/embedding.ts` | Voyage AI embedding helper — real API calls, cosine similarity |
| `tests/mcp/server.test.ts` | MCP tools — create/list/diff/merge via tool handlers |

### 🐳 Infrastructure
| File | Purpose |
|------|---------|
| `docker-compose.yml` | Atlas Local preview on port 27018 |
| `package.json` | Project config — mongobranch v0.1.0 |
| `tsconfig.json` | TypeScript strict config |
