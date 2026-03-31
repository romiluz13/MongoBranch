# MongoBranch — Roadmap

> Git-like branching, diffing, and merging for MongoDB data — built for AI agents.

## Vision

MongoBranch brings version-control semantics (branch, diff, merge, rollback) to MongoDB,
enabling AI agents to safely experiment with data in isolated branches, review changes,
and merge results — just like developers do with code in Git.

---

## ✅ COMPLETED — v0.1.0

### Wave 1: Foundation

#### Phase 1.1: Core Branch Engine ✅
- [x] Branch metadata store (branch name, parent, created_at, status)
- [x] `mb branch create <name>` — snapshot current DB state into a branch
- [x] `mb branch list` — show all branches with status
- [x] `mb branch switch <name>` — set active branch context
- [x] `mb branch delete <name>` — cleanup branch data

#### Phase 1.2: Data Isolation ✅
- [x] Separate database per branch (e.g. `__mb_feature-auth`)
- [x] Full data copy on branch create (snapshot isolation)
- [x] Index replication to branch databases

#### Phase 1.3: CLI Scaffold ✅
- [x] TypeScript CLI with Commander.js (`mb branch create/list/switch/delete`)
- [x] Environment variable config (MONGOBRANCH_URI, MONGOBRANCH_DB)
- [x] Config file (.mongobranch.yaml) for persistent settings
- [x] Interactive prompts for destructive operations (delete confirmation with `-y` flag)
- [x] Colored terminal output with status indicators (chalk)

### Wave 2: Diff & Merge

#### Phase 2.1: Diff Engine ✅
- [x] Document-level diff (field-by-field comparison via jsondiffpatch)
- [x] Collection-level diff (added/removed/modified documents)
- [x] `mb diff <branch-a> <branch-b>` — show all differences
- [x] Human-readable diff output (terminal)
- [x] Machine-readable diff output (`--json` flag)
- [x] Colored terminal output for diffs (chalk: green/red/yellow)

#### Phase 2.2: Merge Engine ✅
- [x] Fast-forward merge (apply branch changes to target)
- [x] Multi-collection merge (inserts + deletes + updates)
- [x] `mb merge <source> --into <target>` — merge branches
- [x] Branch marked as "merged" after successful merge

### Wave 3: Agent Integration

#### Phase 3.1: MCP Server ✅
- [x] MCP server exposing branch/diff/merge as tools via stdio
- [x] Tool: `create_branch` — agents can create isolated workspaces
- [x] Tool: `list_branches` — agents can see all branches
- [x] Tool: `diff_branch` — agents can inspect their changes
- [x] Tool: `merge_branch` — agents can submit changes for review
- [x] Tool: `delete_branch` — agents can clean up branches
- [x] 19 TDD tests for MCP tool handlers (real MongoDB)

#### Phase 3.2: Multi-Agent Support ✅
- [x] AgentManager class — register, create branches, track ownership
- [x] Per-agent branch isolation (`{agentId}/{task}` naming)
- [x] Agent registry with unique ID enforcement
- [x] Agent status tracking (active branches, last activity)
- [x] MCP tools: `register_agent`, `create_agent_branch`, `agent_status`
- [x] Multi-agent data isolation verified (agent-x ≠ agent-y)
- [x] 9 TDD tests for agent operations (real MongoDB)

#### Phase 3.3: Claude Code Integration ✅
- [x] Agent skill file (`mongobranch.agent.md`) — teaches agents to use MongoBranch
- [x] Workflow tools: `start_task` (auto-branch) + `complete_task` (auto-diff + merge)
- [x] Multi-agent collaboration examples in skill file
- [x] 5 TDD tests for workflow tools

#### v0.2.0 Quick Wins ✅
- [x] Merge dry-run preview (`mb merge --dry-run`, MCP `dryRun` param)
- [x] Schema diff — index comparison (added/removed indexes per collection)
- [x] Merge rollback safety (count before apply pattern)
- [x] 6 new TDD tests (3 merge dry-run, 3 schema diff)

#### History & Audit ✅
- [x] HistoryManager — snapshot recording and branch log
- [x] `mb log <branch>` CLI command with colored output
- [x] `mb log` (no branch) — global audit view with limit
- [x] MCP tools: `branch_log`, `record_snapshot`
- [x] Indexed snapshots collection (branchName + timestamp)
- [x] 5 TDD tests for history operations

#### Rollback & Cleanup ✅
- [x] `rollback_branch` — reset branch to source state (undo all changes)
- [x] MCP tool: `rollback_branch`
- [x] `gc` — garbage collect merged/deleted branch databases
- [x] MCP tool: `gc`, CLI: `mb gc`
- [x] 3 TDD tests for rollback

#### Production Packaging ✅
- [x] README.md — install, usage, MCP setup, CLI reference
- [x] package.json — exports, bin, keywords, license, v0.2.0
- [x] 14 MCP tools total

#### v0.3.0: Conflict Detection & Resolution ✅
- [x] Three-way merge with conflict detection (`detectConflicts: true`)
- [x] Conflict resolution strategies: `ours` (keep target), `theirs` (keep source), `abort` (skip)
- [x] Conflict reports with field-level detail in MCP output
- [x] Read-only branches (`readOnly: true` on create)
- [x] 3 TDD tests for conflict detection (detect, ours, theirs)

#### v0.3.0: Merge Queue ✅
- [x] MergeQueue — ordered queue backed by MongoDB atomic ops
- [x] FIFO processing — oldest entry processed first
- [x] Duplicate prevention — same branch can't be queued twice
- [x] Batch processing — `processAll()` for queue drain
- [x] MCP tools: `enqueue_merge`, `process_merge_queue`, `merge_queue_status`
- [x] 7 TDD tests for merge queue operations

#### v0.4.0: Production Hardening ✅
- [x] Lazy copy-on-write — instant branch creation, materialize on first write
- [x] Streaming diffs — cursor-based document iteration (memory-efficient)
- [x] Lazy branch awareness in DiffEngine — skip unmaterialized collections
- [x] Validation rule diff — compare JSON Schema validation rules between branches
- [x] Audit log export — JSON and CSV with branch/event/date filtering
- [x] MCP tools: `export_audit_log`, `materialization_status`
- [x] 9 new TDD tests (4 lazy CoW, 2 validation diff, 3 audit export)

#### v0.5.0: Advanced Data Isolation ✅
- [x] Operation log — track every insert/update/delete per branch
- [x] Operation summary — aggregate counts per type via MongoDB aggregation
- [x] Undo operations — reverse replay last N ops on a branch
- [x] Branch-scoped CRUD proxy — insert/update/delete/find through MongoBranch
- [x] Auto-materialization — lazy branches auto-copy on first write via proxy
- [x] Read-only enforcement — proxy rejects writes to read-only branches
- [x] Lazy read fallback — unmaterialized collections read from source DB
- [x] MCP tools: `branch_insert`, `branch_update`, `branch_delete`, `branch_find`, `branch_oplog`, `branch_undo`
- [x] 12 new TDD tests (6 oplog, 6 proxy)

### Test Coverage: 110 tests, 265 assertions, 0 failures

---

## 🚧 TODO — v0.6.0+

### Atlas Integration
- [ ] Atlas CLI plugin for MongoBranch
- [ ] Atlas Search index branching

---

## Architecture Decisions
- See: [docs/architecture/adr-001-storage-strategy.md](../docs/architecture/adr-001-storage-strategy.md)
- See: [docs/architecture/adr-002-diff-algorithm.md](../docs/architecture/adr-002-diff-algorithm.md)

## Key References
- [Dolt — Git for Data](https://github.com/dolthub/dolt) — Prolly Tree approach
- [Neon — Copy-on-Write Postgres](https://github.com/neondatabase/neon)
- [Xata Agent — Autonomous DB SRE](https://xata.io/blog/a-coding-agent-that-uses-postgres-branches)
- [Gas Town — Multi-Agent Orchestrator](https://github.com/steveyegge/gastown)
- [MongoDB MCP Server](https://github.com/mongodb-js/mongodb-mcp-server)
- [AgentAPI by Coder](https://github.com/coder/agentapi)
