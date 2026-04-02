<div align="center">

# 🌿 MongoBranch

### Git-level version control for MongoDB — built for AI agents

[![Tests](https://img.shields.io/badge/tests-239%20passing-brightgreen)]()
[![MongoDB](https://img.shields.io/badge/MongoDB-7.x-47A248?logo=mongodb&logoColor=white)]()
[![MCP Tools](https://img.shields.io/badge/MCP%20tools-57-blue)]()
[![CLI Commands](https://img.shields.io/badge/CLI-37%20commands-orange)]()
[![Engines](https://img.shields.io/badge/engines-19-purple)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

```
branch → commit → diff → merge → time-travel → blame → deploy
```

**239 tests. 57 MCP tools. 19 engines. Zero mocks. Real MongoDB only.**

[Quick Start](#-quick-start) · [Why](#-the-problem) · [Features](#-feature-matrix) · [MCP Server](#-mcp-server--57-tools-for-ai-agents) · [CLI](#-cli--37-commands) · [Architecture](#%EF%B8%8F-architecture)

</div>

---

## 🧠 The Problem

AI agents write to databases. They hallucinate. They retry. They run in parallel. And when they break your data, you have no undo button.

```
❌ Without MongoBranch                    ✅ With MongoBranch
─────────────────────────                 ─────────────────────────
Hope the agent doesn't break anything     Agent works on isolated branch copy
Manually snapshot before every op         Commits are automatic + content-addressed
Lock the entire database                  Parallel agents, zero interference
"Who changed that?" — nobody knows        blame → agent-b, commit abc123, 14:32
"Roll it back" — to when, exactly?        time-travel → any commit or timestamp
"Did the merge break anything?"           three-way merge + conflict detection
"Ship it to prod" → YOLO                  deploy request → review → approve → merge
```

MongoBranch gives MongoDB the full `git` experience: **branches, commits, diffs, three-way merges, cherry-picks, reverts, tags, blame, stash, reflog, and time travel.** Every operation tracked. Every change reversible. Every agent sandboxed.

---

## 📊 Feature Matrix

> Neon raised **$100M+** and their branches **can never merge back**. MongoBranch does three-way merge with per-field conflict resolution. On MongoDB.

| Feature | MongoBranch | Neon (Postgres) | Dolt (MySQL) |
|---------|:-----------:|:---------------:|:------------:|
| Branch isolation | ✅ DB-per-branch | ✅ CoW fork | ✅ Working copy |
| **Merge back to parent** | ✅ Three-way | ❌ **Impossible** | ✅ Three-way |
| Content-addressed commits | ✅ SHA-256 | ❌ WAL-based | ✅ Prolly tree |
| Cherry-pick & revert | ✅ | ❌ | ✅ |
| Field-level blame | ✅ | ❌ | ✅ Row-level |
| Time travel queries | ✅ Commit + timestamp | ✅ LSN-based | ✅ AS OF |
| Tags & refs | ✅ | ❌ | ✅ |
| Deploy requests (data PRs) | ✅ | ❌ | ❌ |
| Branch protection + globs | ✅ | ✅ | ❌ |
| Pre/post hooks (14 events) | ✅ | ❌ | ❌ |
| Stash / pop | ✅ | ❌ | ❌ |
| Reflog (survives deletion) | ✅ | ❌ | ❌ |
| Operation log + undo | ✅ | ❌ | ❌ |
| N-way branch comparison | ✅ | ❌ | ❌ |
| PII anonymization | ✅ hash/mask/null/redact | ❌ | ❌ |
| Agent scopes + quotas | ✅ Collection-level ACLs | ❌ | ❌ |
| Multi-agent isolation | ✅ Per-agent sandboxes | ❌ | ❌ |
| Merge queue (FIFO atomic) | ✅ | ❌ Can't merge | ❌ |
| MCP Server for AI agents | ✅ **57 tools** | ✅ ~10 tools | ❌ |
| CLI | ✅ **37 commands** | ✅ | ✅ |
| Atlas Search index branching | ✅ | N/A | N/A |
| Branch TTL (auto-expire) | ✅ | ✅ | ❌ |

**MongoBranch: 22/22. Neon: 6/22. Dolt: 10/22.**

> The only tool that gives MongoDB full `git` semantics **and** is purpose-built for AI agents.

---

## 🚀 Quick Start

```bash
# 1. Start MongoDB (Atlas Local — includes search + vector support)
docker compose up -d

# 2. Install
bun install

# 3. Branch → Work → Commit → Merge
mb branch create experiment --description "testing new schema"
# ... make your changes ...
mb commit experiment -m "restructured user fields"
mb diff experiment
mb merge experiment          # apply to main

# Or tag a known-good state and time-travel later
mb tag create v1.0 experiment
mb branch delete experiment  # done — branch is disposable
```

---

## 🤖 MCP Server — 57 Tools for AI Agents

MongoBranch ships a [Model Context Protocol](https://modelcontextprotocol.io) server with **57 tools**. Drop into Claude Desktop, Cursor, Windsurf, or any MCP client:

```json
{
  "mcpServers": {
    "mongobranch": {
      "command": "bun",
      "args": ["mongobranch-mcp"],
      "env": {
        "MONGOBRANCH_URI": "mongodb://localhost:27017",
        "MONGOBRANCH_DB": "myapp"
      }
    }
  }
}
```

### Two Calls. That's It.

```
1. start_task(agentId: "claude", task: "fix-user-emails")
   → Creates isolated branch with full DB copy. Agent works freely.

2. complete_task(agentId: "claude", task: "fix-user-emails", autoMerge: true)
   → Diffs every collection → three-way merges → main updated atomically.
```

Main is **never touched** until merge. If the agent fails, delete the branch. Zero damage.

### All 57 MCP Tools

| Category | Tools | What They Do |
|----------|-------|-------------|
| **Workflow** | `start_task`, `complete_task` | One-call branch + one-call merge |
| **Branch** | `create_branch`, `list_branches`, `delete_branch`, `rollback_branch`, `gc` | Full lifecycle + garbage collection |
| **Diff & Merge** | `diff_branch`, `merge_branch`, `merge_three_way` | Field-level diff, conflict strategies |
| **Commits** | `commit`, `get_commit`, `commit_log` | SHA-256, parent chains, merge commits |
| **Tags** | `create_tag`, `list_tags`, `delete_tag` | Immutable named refs |
| **Cherry-Pick** | `cherry_pick`, `revert_commit` | Surgical apply/undo |
| **Time Travel** | `time_travel_query`, `list_collections_at`, `blame` | Any commit or timestamp |
| **Deploy** | `open/approve/reject/execute/list/get_deploy_request` | PR-like workflow for data |
| **Protection** | `protect_branch`, `list_protections`, `remove_protection` | Glob patterns, merge-only |
| **Hooks** | `register_hook`, `list_hooks`, `remove_hook` | 14 event types |
| **Stash** | `stash`, `stash_pop`, `stash_list`, `stash_drop` | Save/resume work |
| **Reflog** | `reflog`, `reflog_last_state` | Branch pointer history |
| **Scope** | `set_scope`, `check_scope`, `get_violations` | Per-agent collection ACLs |
| **Compare** | `compare_branches` | N-way branch comparison matrix |
| **Anonymize** | `anonymize_branch` | hash/mask/null/redact PII |
| **Search Index** | `list/copy/diff/merge_search_indexes` | Atlas Search on branches |
| **CRUD Proxy** | `branch_insert/update/delete/find` | Direct ops on any branch |
| **Agent** | `register_agent`, `create_agent_branch`, `agent_status` | Per-agent sandboxes |
| **History** | `branch_log`, `record_snapshot`, `export_audit_log` | Full audit trail (JSON/CSV) |
| **Queue** | `enqueue_merge`, `process_queue`, `queue_status` | FIFO atomic merges |
| **Ops** | `branch_oplog`, `branch_undo`, `materialization_status`, `reset_from_parent` | Oplog, undo, CoW, reset |

---

## 📟 CLI — 37 Commands

```bash
# Branch lifecycle
mb branch create <name>           # Isolated DB copy — indexes, data, validators
mb branch list                    # All branches with metadata + TTL
mb branch switch <name>           # Switch active branch context
mb branch delete <name>           # Drop branch database
mb branch reset <name>            # Re-copy from source (fresh start)

# Version control
mb commit <branch> -m "message"   # SHA-256 content-addressed commit
mb commits <branch>               # Walk the commit graph
mb tag create <name> <branch>     # Immutable ref: "v1.0", "pre-migration"
mb cherry-pick <hash> <target>    # Apply one commit to another branch
mb revert <hash> <branch>         # Undo a commit, history preserved

# Diff & merge
mb diff <source> [target]         # Colored field-level diff
mb merge <source> --into main     # Three-way merge with conflict detection
mb merge <source> --dry-run       # Preview without applying

# Time travel & forensics
mb time-travel <branch> --at <commit>   # Query data at any point in history
mb blame <branch> <collection> <docId>  # Who changed what field, when

# Deploy & safety
mb deploy open <branch>           # Create deploy request (data PR)
mb deploy approve <id>            # Approve for production
mb deploy execute <id>            # Ship it
mb protect <branch> --merge-only  # No direct writes allowed
mb stash <branch>                 # Save work-in-progress
mb stash pop <branch>             # Restore it

# Agent coordination
mb agent register <id>            # Register an AI agent
mb scope set <agent> --allow products,orders  # Collection-level ACLs
mb anonymize <branch> --strategy mask         # PII redaction

# Operations
mb gc                             # Clean stale branches
mb reflog <branch>                # Branch pointer history
mb compare <branch1> <branch2> <branch3>      # N-way comparison matrix
```

---

## ⚙️ Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       Your App / AI Agent                        │
├──────────────────────────────────────────────────────────────────┤
│           CLI (37 cmds) · MCP Server (57 tools) · SDK            │
├──────────────────────────────────────────────────────────────────┤
│  BranchManager   CommitEngine     DiffEngine      MergeEngine    │
│  TimeTravelEngine DeployManager   BranchProxy     ScopeManager   │
│  ProtectionManager HookManager   AgentManager     MergeQueue     │
│  OperationLog    HistoryManager   StashManager    ReflogManager  │
│  BranchComparator AnonymizeEngine SearchIndexManager              │
├──────────────────────────────────────────────────────────────────┤
│                        MongoDB Driver                            │
├────────────────┬──────────────────┬──────────────────────────────┤
│  main (myapp)  │  __mb_feature-x  │  __mb_claude--fix-users      │
│  ────────────  │  ──────────────  │  ──────────────────────────  │
│  users         │  users (copy)    │  users (modified)             │
│  products      │  products        │  products                     │
│  orders        │  orders          │  orders (new docs)            │
├────────────────┴──────────────────┴──────────────────────────────┤
│  __mongobranch (metadata)                                        │
│  ├── branches    commits     tags           commit_data          │
│  ├── protections hooks       deploy_requests agents              │
│  ├── oplog       history     reflog         scopes               │
│  ├── stashes     violations  merge_queue    search_indexes       │
└──────────────────────────────────────────────────────────────────┘
```

**Each branch = a separate MongoDB database.** Full isolation. Real indexes. Real data. Zero mocks.

### Design Decisions

| Decision | Why |
|----------|-----|
| **DB-per-branch** | Complete isolation — branches can't leak into each other |
| **Content-addressed commits** | SHA-256 hashes ensure integrity, parent chains enable graph traversal |
| **Three-way merge** | BFS common ancestor, per-field conflict detection — no silent data loss |
| **Lazy copy-on-write** | `lazy: true` → instant branch, data copied only on first write |
| **Deploy requests** | PR-like review: open → approve → execute (not YOLO merge) |
| **Pre/post hooks** | Pre-hooks reject synchronously, post-hooks fire-and-forget |
| **Merge queue** | FIFO ordering for concurrent agent merges — no race conditions |
| **Batched cursor iteration** | Large collections copied in 1000-doc batches — no memory blowup |
| **Agent scopes** | Collection-level ACLs + quotas — agents can't touch what they shouldn't |

### What Gets Diffed

- **Documents** — added, removed, modified (field-level via jsondiffpatch)
- **Indexes** — structural changes between branches
- **Validation rules** — JSON Schema differences
- **Atlas Search indexes** — search index definitions branched and diffed
- **Vector embeddings** — 512-dim Voyage AI embeddings survive branch→diff→merge intact

---

## ⏰ Time Travel & Blame

Query your data at any point in history. Like Dolt's `AS OF` or Neon's Time Travel — but for MongoDB.

```typescript
// "What did the users collection look like at commit abc123?"
const users = await timeTravelEngine.findAt({
  branchName: "main",
  collection: "users",
  commitHash: "abc123",
});

// "What did it look like yesterday at 3pm?"
const snapshot = await timeTravelEngine.findAt({
  branchName: "main",
  collection: "users",
  timestamp: new Date("2026-03-30T15:00:00Z"),
});

// "Who changed the email field on user 42?"
const blame = await timeTravelEngine.blame("main", "users", "user-42");
// → { fields: { email: { commitHash: "abc123", author: "agent-b", message: "fix emails" } } }
```

Every commit snapshots the full document state. No WAL parsing. No reconstruction. Instant lookup.

---

## 🚦 Deploy Requests — PRs for Your Data

Don't YOLO merge to production. Open a deploy request, review the diff, approve, then execute.

Inspired by [PlanetScale's deploy requests](https://planetscale.com/blog/how-planetscale-makes-schema-changes) — but for document data, not just schema.

```
1. open_deploy_request(source: "feature-x", target: "main", description: "Add premium users")
   → DR #a1b2c3d4 opened. Diff computed automatically.

2. approve_deploy_request(id: "a1b2c3d4", reviewedBy: "alice")
   → Approved. Ready to execute.

3. execute_deploy_request(id: "a1b2c3d4")
   → Merged! feature-x → main. 3 added, 0 removed, 1 modified.
```

Duplicate protection, rejection with reasons, status filtering. The full PR workflow.

---

## 🛡️ Branch Protection & Hooks

```typescript
// Nobody writes to main directly. Period.
await protectionManager.protectBranch("main", { requireMergeOnly: true, preventDelete: true });
await protectionManager.protectBranch("prod-*", { requireMergeOnly: true });  // glob patterns

// Hooks fire on 14 different events
await hookManager.addHook({
  name: "validate-before-merge",
  event: "pre-merge",
  callback: async (ctx) => {
    if (ctx.targetBranch === "main" && !ctx.approved) {
      throw new Error("Merge to main requires deploy request approval");
    }
  },
});
// Pre-hooks reject synchronously. Post-hooks fire-and-forget. (lakeFS pattern)
```

### Hook Events

`pre-create`, `post-create`, `pre-delete`, `post-delete`, `pre-merge`, `post-merge`,
`pre-commit`, `post-commit`, `pre-reset`, `post-reset`, `pre-cherry-pick`, `post-cherry-pick`,
`pre-revert`, `post-revert`

---

## 🔒 Multi-Agent Isolation

```
Agent A: start_task(agentId: "agent-a", task: "update-users")
Agent B: start_task(agentId: "agent-b", task: "update-products")

# Completely isolated databases:
#   __mb_agent-a--update-users    (Agent A's sandbox)
#   __mb_agent-b--update-products (Agent B's sandbox)

# Both work in parallel — zero interference

Agent A: complete_task(agentId: "agent-a", task: "update-users", autoMerge: true)
Agent B: complete_task(agentId: "agent-b", task: "update-products", autoMerge: true)

# Three-way merge handles conflicts automatically
# Merge queue ensures sequential ordering — no race conditions
```

---

## 🧪 Testing — 239 Tests, Zero Mocks

Every test runs against **real MongoDB** (Atlas Local Docker). No mocking. No faking. If it passes here, it works in production.

```bash
bun test                                     # Full suite — 239 tests, 23 files
bun test tests/core/commit.test.ts           # Commits, tags, cherry-pick, revert
bun test tests/core/three-way-merge.test.ts  # Three-way merge + conflict resolution
bun test tests/core/timetravel.test.ts       # Time travel queries + blame
bun test tests/core/deploy.test.ts           # Deploy request workflow
bun test tests/core/scope.test.ts            # Agent permissions + ACLs
bun test tests/core/stress-ai.test.ts        # Real Voyage AI 512-dim embeddings
```

| Category | Tests | What's Validated |
|----------|-------|-----------------|
| Branch lifecycle | 20 | Create, list, switch, delete, data isolation |
| Diff & merge | 11 | Field-level diff, multi-collection merge |
| Commits & tags | 28 | SHA-256, parent chains, cherry-pick, revert |
| Three-way merge | 5 | Common ancestor, per-field conflicts, strategies |
| Time travel & blame | 7 | Query at commit/timestamp, field attribution |
| Deploy requests | 10 | Open, approve, reject, execute, duplicate prevention |
| TTL + protection + hooks | 23 | Branch expiry, glob patterns, 14 event hooks |
| Proxy & oplog | 22 | CRUD proxy, operation log, undo replay |
| Agent scopes & quotas | 8 | Collection ACLs, violation tracking |
| Branch compare | 4 | N-way comparison, presence matrix |
| Stash & reflog | 15 | Stash/pop, reflog survives deletion |
| Anonymization | 6 | hash/mask/null/redact PII strategies |
| Search indexes | 6 | Atlas Search index branching (when mongot available) |
| Multi-agent & queue | 16 | Agent branches, FIFO merge queue, history |
| Stress tests | 15 | Concurrent ops, large docs, real AI embeddings |
| MCP server | 24 | All 57 tool handlers end-to-end |
| **Total** | **239** | **Zero failures** |

---

## 🔧 Configuration

```bash
MONGOBRANCH_URI=mongodb://localhost:27017   # MongoDB connection string
MONGOBRANCH_DB=myapp                        # Source database name
```

```yaml
# .mongobranch.yaml
uri: mongodb://localhost:27017/?directConnection=true
sourceDatabase: myapp
metaDatabase: __mongobranch
branchPrefix: __mb_
```

---

## 🛠️ Development

```bash
bun install                       # Install dependencies
docker compose up -d              # Atlas Local on port 27017
bun test                          # 239 tests, ~30 seconds
bun src/mcp/server.ts             # Start MCP server
bun src/cli.ts branch create my-feature   # CLI
```

### 19 Core Engines

```
src/core/
├── branch.ts         BranchManager — create, list, switch, delete, TTL, reset, CoW, gc
├── commit.ts         CommitEngine — SHA-256 commits, parent chains, tags, cherry-pick, revert
├── diff.ts           DiffEngine — documents + indexes + validation rules + three-way
├── merge.ts          MergeEngine — two-way, three-way, dry-run, conflict strategies
├── timetravel.ts     TimeTravelEngine — findAt (commit/timestamp), listCollectionsAt, blame
├── deploy.ts         DeployRequestManager — open, approve, reject, execute, list, get
├── protection.ts     ProtectionManager — branch protection rules, glob patterns
├── hooks.ts          HookManager — 14 event types, pre-reject / post-fire-and-forget
├── scope.ts          ScopeManager — agent permissions, collection ACLs, quota enforcement
├── compare.ts        BranchComparator — N-way branch comparison, presence matrix
├── stash.ts          StashManager — stash/pop/list/drop, ordered stash stack
├── anonymize.ts      AnonymizeEngine — hash/mask/null/redact PII strategies
├── reflog.ts         ReflogManager — branch pointer tracking, survives deletion
├── search-index.ts   SearchIndexManager — Atlas Search index branching
├── proxy.ts          BranchProxy — CRUD with lazy auto-materialization
├── oplog.ts          OperationLog — every write tracked, undo support
├── queue.ts          MergeQueue — FIFO concurrent merge ordering
├── agent.ts          AgentManager — per-agent namespaced branches
├── history.ts        HistoryManager — snapshots, branch log, audit export (JSON/CSV)
└── types.ts          TypeScript interfaces, config, constants
```

### Architecture Decisions

- [ADR-001: Storage Strategy](docs/architecture/adr-001-storage-strategy.md) — Why DB-per-branch (not collections)
- [ADR-002: Diff Algorithm](docs/architecture/adr-002-diff-algorithm.md) — Operation log + snapshot diff

---

## 🗺️ Roadmap

| Wave | What | Status |
|------|------|--------|
| 1-3 | Branch, diff, merge, agent, proxy, oplog, CoW, queue | ✅ Shipped |
| 4 | Commits (SHA-256), tags, three-way merge, cherry-pick, revert | ✅ Shipped |
| 5 | Branch TTL, reset from parent, protection rules, hooks (14 events) | ✅ Shipped |
| 6 | Time travel, blame, deploy requests | ✅ Shipped |
| 7 | Agent scopes, branch compare, stash, anonymize, reflog | ✅ Shipped |
| 8 | Atlas Search index branching, MCP server (57 tools), CLI (37 commands), CI | ✅ Shipped |

**All 8 waves shipped.** 🚀

---

## License

MIT

---

<div align="center">

**Built for the age of AI agents writing to databases.**

*Stop hoping. Start branching.*

```
239 tests · 57 MCP tools · 37 CLI commands · 19 engines · 0 mocks · real MongoDB only
```

</div>
