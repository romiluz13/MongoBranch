<div align="center">

# 🌿 MongoBranch

### Git for your MongoDB data — branch, commit, diff, merge, time-travel

[![Tests](https://img.shields.io/badge/tests-200%2B%20passing-brightgreen)]()
[![MongoDB](https://img.shields.io/badge/MongoDB-7.x-47A248?logo=mongodb&logoColor=white)]()
[![MCP Tools](https://img.shields.io/badge/MCP%20tools-48-blue)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Branch. Commit. Diff. Merge. Time-travel. Blame. Deploy.**

No more "oops I corrupted prod." No more prayer-driven deployments.

[Quick Start](#-quick-start) · [Why](#-why-this-exists) · [Features](#-what-you-get) · [MCP Server](#-mcp-server-for-ai-agents) · [CLI](#-cli) · [Architecture](#-how-it-works)

</div>

---

## 💡 Why This Exists

AI agents write to databases. They hallucinate. They retry. They run in parallel.

**Without MongoBranch:**
- 🙏 Hope the agent doesn't break anything
- 📸 Manually snapshot before every operation
- 🔒 Lock the entire database during agent work
- 🤷 "Who changed that field?" — nobody knows
- 😱 "Roll it back" — to when, exactly?

**With MongoBranch:**

```
Agent A: "I need to restructure the users collection"
         → branch → commit → diff → deploy request → approve → merge ✅

Agent B: "I'm updating product prices"  (same time, zero conflicts)
         → branch → commit → three-way merge → resolved ✅

Later:   "What did the data look like at 3pm yesterday?"
         → time-travel query → instant answer ✅

Debug:   "Who changed the user's email field?"
         → blame → commit abc123 by agent-b at 14:32 ✅
```

The database equivalent of `git` — branches, commits, diffs, merges, cherry-picks, reverts, tags, blame, and time travel. For MongoDB.

---

## ✨ What You Get

| Capability | What It Does | Competitors |
|------------|-------------|-------------|
| **Branching** | Isolated database per branch — full data + indexes | Neon ✅ Dolt ✅ |
| **Commits** | Content-addressed SHA-256, parent chains, merge commits | Neon ❌ Dolt ✅ |
| **Three-Way Merge** | Per-field conflict detection with ours/theirs/manual strategies | Neon ❌ Dolt ✅ |
| **Tags** | Immutable named refs — `v1.0`, `before-migration`, `last-known-good` | Neon ❌ Dolt ✅ |
| **Cherry-Pick & Revert** | Apply one commit anywhere. Undo any commit surgically. | Neon ❌ Dolt ✅ |
| **Time Travel** | Query data at any commit or timestamp. Like Dolt's `AS OF`. | Neon ✅ Dolt ✅ |
| **Blame** | Field-level: who changed what, when, in which commit | Neon ❌ Dolt ✅ |
| **Deploy Requests** | PR-like workflow: open → approve → execute. Like PlanetScale. | Neon ❌ Dolt ❌ |
| **Branch Protection** | Glob patterns, merge-only. No direct writes to `main`. | Neon ✅ Dolt ❌ |
| **Hooks** | 14 event types. Pre-hooks reject, post-hooks fire-and-forget. | Neon ❌ Dolt ❌ |
| **Branch TTL** | Auto-expire branches after N minutes. Self-cleaning. | Neon ✅ Dolt ❌ |
| **Multi-Agent** | Per-agent namespaced branches. Parallel work, zero interference. | Neon ❌ Dolt ❌ |
| **MCP Server** | 48 tools for AI agents. Drop into Claude, Cursor, any MCP client. | Neon ❌ Dolt ❌ |

> **MongoBranch is the only tool that gives MongoDB the full git experience — AND is built for AI agents.**

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

## 🤖 MCP Server — for AI Agents

MongoBranch ships a [Model Context Protocol](https://modelcontextprotocol.io) server with **48 tools**. Drop this into Claude Desktop, Cursor, or any MCP-compatible client:

```json
{
  "mcpServers": {
    "mongobranch": {
      "command": "bun",
      "args": ["mongobranch-mcp"],
      "env": {
        "MONGOBRANCH_URI": "mongodb://localhost:27018",
        "MONGOBRANCH_DB": "myapp"
      }
    }
  }
}
```

### The 2-Call Workflow

Most agents only need two calls:

```
1. start_task(agentId: "claude", task: "fix-user-emails")
   → Auto-registers agent + creates isolated branch with full DB copy

2. complete_task(agentId: "claude", task: "fix-user-emails", autoMerge: true)
   → Diffs every collection, field-by-field → merges to main
```

That's it. The agent works on a complete copy. Main is untouched until merge.

### All 48 MCP Tools

| Category | Tools | What They Do |
|----------|-------|-------------|
| **Workflow** | `start_task`, `complete_task` | One-call branch + one-call merge |
| **Branch** | `create_branch`, `list_branches`, `delete_branch`, `rollback_branch`, `gc` | Full branch lifecycle |
| **Diff & Merge** | `diff_branch`, `merge_branch`, `merge_three_way` | Field-level diff, three-way merge, conflict strategies |
| **Commits** | `commit`, `get_commit`, `commit_log` | Content-addressed SHA-256, parent chains |
| **Tags** | `create_tag`, `list_tags`, `delete_tag` | Immutable named refs to commits |
| **Cherry-Pick** | `cherry_pick`, `revert_commit` | Apply/undo specific commits surgically |
| **Time Travel** | `time_travel_query`, `blame` | Query at any commit/timestamp, field-level attribution |
| **Deploy** | `open_deploy_request`, `approve_deploy_request`, `reject_deploy_request`, `execute_deploy_request`, `list_deploy_requests` | PR-like workflow for data changes |
| **Safety** | `set_branch_ttl`, `protect_branch`, `list_protections`, `remove_protection` | TTL, protection rules |
| **Hooks** | `list_hooks`, `remove_hook` | 14 event types, pre-reject/post-fire-and-forget |
| **CRUD Proxy** | `branch_insert`, `branch_update`, `branch_delete`, `branch_find` | Direct data ops on any branch |
| **Multi-Agent** | `register_agent`, `create_agent_branch`, `agent_status` | Per-agent namespaced branches |
| **History** | `branch_log`, `record_snapshot`, `export_audit_log` | Full audit trail (JSON/CSV) |
| **Queue** | `enqueue_merge`, `process_merge_queue`, `merge_queue_status` | Ordered concurrent merges |
| **Ops** | `branch_oplog`, `branch_undo`, `materialization_status`, `reset_from_parent` | Oplog, undo, CoW, reset |

---

## 📟 CLI

```bash
# Branch lifecycle
mb branch create <name>           # Create isolated branch
mb branch list                    # List all branches
mb branch switch <name>           # Switch active branch
mb branch delete <name>           # Drop branch + database
mb branch reset <name>            # Re-copy from source

# Commits & tags
mb commit <branch> -m "message"   # Content-addressed commit (SHA-256)
mb commits <branch>               # Walk the commit log
mb tag create <name> <branch>     # Tag a commit — "v1.0", "before-migration"
mb tag list                       # All tags, newest first
mb tag delete <name>              # Remove a tag

# Diff & merge
mb diff <source> [target]         # Colored field-level diff
mb diff <source> --json           # Machine-readable JSON
mb merge <source> --into main     # Apply changes
mb merge <source> --dry-run       # Preview without applying

# Surgical operations
mb cherry-pick <hash> <target>    # Apply one commit to another branch
mb revert <hash> <branch>         # Undo a specific commit, history preserved

# History & cleanup
mb log [branch]                   # Event history
mb gc                             # Clean up stale branches
```

---

## ⚙️ How It Works

```
┌──────────────────────────────────────────────────────────────────┐
│                       Your App / AI Agent                        │
├──────────────────────────────────────────────────────────────────┤
│             CLI (mb)  ·  MCP Server (48 tools)  ·  SDK           │
├──────────────────────────────────────────────────────────────────┤
│  BranchManager  │ CommitEngine  │ DiffEngine    │ MergeEngine    │
│  TimeTravelEngine │ DeployRequestManager │ BranchProxy          │
│  ProtectionManager │ HookManager │ AgentManager │ MergeQueue    │
│  OperationLog   │ HistoryManager                                │
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
│  ├── branches    ├── commits    ├── tags    ├── commit_data      │
│  ├── protections ├── hooks      ├── deploy_requests              │
│  ├── agents      ├── oplog      ├── history ├── reflog           │
└──────────────────────────────────────────────────────────────────┘
```

**Each branch = a separate MongoDB database.** Full isolation. Real indexes. Zero mocks.

### Design Decisions

| Decision | Why |
|----------|-----|
| **DB-per-branch** | Complete isolation — branches can't leak into each other |
| **Content-addressed commits** | SHA-256 hashes, parent chains, merge commits — real version control |
| **Three-way merge** | Common ancestor via BFS, per-field conflict detection — no data loss |
| **Snapshot time travel** | Full document state stored per commit — query any point in history |
| **Lazy copy-on-write** | `lazy: true` → instant branch, data copied only on first write |
| **Source-centric diffing** | Only diffs source branch collections — prevents cascade data loss |
| **Deploy requests** | PR-like review workflow — open → approve → execute, not YOLO merge |
| **Pre/post hooks** | Pre-hooks reject synchronously, post-hooks fire-and-forget — lakeFS pattern |
| **Merge queue** | FIFO ordering for concurrent agent merges — no race conditions |
| **Real AI embeddings** | Stress-tested with real Voyage AI vectors (512-dim), not random floats |

### What Gets Diffed

MongoBranch doesn't just compare documents. It compares:

- **Documents** — added, removed, modified (field-level granularity via jsondiffpatch)
- **Indexes** — added/removed indexes between branches
- **Validation rules** — JSON Schema differences between branches
- **Vector embeddings** — real 512-dimensional embeddings survive branch→diff→merge intact

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

## 🧪 Testing

**198 tests. Real MongoDB. Zero mocks.** Every test runs against Atlas Local Docker.

```bash
bun test                                  # Full suite (198 tests, 17 files)
bun test tests/core/commit.test.ts        # 28 commit + tag tests
bun test tests/core/three-way-merge.test.ts  # Three-way merge + conflicts
bun test tests/core/timetravel.test.ts    # Time travel + blame
bun test tests/core/deploy.test.ts        # Deploy request workflow
bun test tests/core/lifecycle.test.ts     # TTL, protection, hooks
bun test tests/core/stress.test.ts        # 9 core stress scenarios
bun test tests/core/stress-ai.test.ts     # 6 real Voyage AI embedding tests
```

### Test Coverage

| Category | Tests | What's Validated |
|----------|-------|-----------------|
| Branch lifecycle | 20 | Create, list, switch, delete, data isolation |
| Diff & merge | 11 | Field-level diff, merge apply, multi-collection |
| Commits & tags | 28 | SHA-256, parent chains, tags, cherry-pick, revert |
| Three-way merge | 5 | Common ancestor, per-field conflicts, resolution strategies |
| Time travel & blame | 7 | Query at commit/timestamp, field-level blame attribution |
| Deploy requests | 10 | Open, approve, reject, execute, list, duplicate prevention |
| TTL + protection + hooks | 23 | Branch expiry, glob protection, 14 event hooks |
| Proxy & oplog | 22 | CRUD proxy, operation log, undo replay |
| Multi-agent & queue | 16 | Agent branches, merge queue, history, audit |
| Stress tests | 15 | Concurrent, large docs, real Voyage AI 512-dim vectors |
| MCP server | 24 | All tool handlers, end-to-end workflow |
| **Total** | **198** | **595 assertions, 0 failures** |

---

## 🔧 Configuration

### Environment Variables
```bash
MONGOBRANCH_URI=mongodb://localhost:27018   # MongoDB connection string
MONGOBRANCH_DB=myapp                        # Source database name
```

### Config File (`.mongobranch.yaml`)
```yaml
uri: mongodb://localhost:27018/?directConnection=true
sourceDatabase: myapp
metaDatabase: __mongobranch
branchPrefix: __mb_
```

Priority: env vars → config file → defaults.

---

## 🛠️ Development

```bash
# Prerequisites
bun install
docker compose up -d          # Atlas Local on port 27018

# Run all tests
bun test

# Run specific test file
bun test tests/core/branch.test.ts

# Start MCP server
bun src/mcp/server.ts

# Use CLI directly
bun src/cli.ts branch create my-feature
```

### Project Structure

```
src/
├── core/
│   ├── branch.ts         # BranchManager — create, list, switch, delete, TTL, reset, gc
│   ├── commit.ts         # CommitEngine — SHA-256 commits, tags, cherry-pick, revert
│   ├── diff.ts           # DiffEngine — documents + indexes + validation + three-way
│   ├── merge.ts          # MergeEngine — two-way, three-way, dry-run, conflicts
│   ├── timetravel.ts     # TimeTravelEngine — findAt, listCollectionsAt, blame
│   ├── deploy.ts         # DeployRequestManager — open, approve, reject, execute
│   ├── protection.ts     # ProtectionManager — branch protection rules, glob patterns
│   ├── hooks.ts          # HookManager — 14 event types, pre-reject/post-fire
│   ├── proxy.ts          # BranchProxy — CRUD with auto-materialization
│   ├── oplog.ts          # OperationLog — every write tracked, undo support
│   ├── queue.ts          # MergeQueue — FIFO concurrent merge ordering
│   ├── agent.ts          # AgentManager — per-agent branches
│   ├── history.ts        # HistoryManager — snapshots, audit export
│   └── types.ts          # TypeScript interfaces and config
├── cli.ts                # Commander.js CLI entry point
└── mcp/
    ├── server.ts         # MCP server (stdio transport, 48 tool registrations)
    ├── tools.ts          # 48 tool handlers
    └── mongobranch.agent.md  # Agent skill file — teaches AI agents to use MongoBranch
```

---

## 📖 Architecture Decisions

- [ADR-001: Storage Strategy](docs/architecture/adr-001-storage-strategy.md) — Why DB-per-branch
- [ADR-002: Diff Algorithm](docs/architecture/adr-002-diff-algorithm.md) — Operation log + snapshot diff

---

## 🗺️ Roadmap

| Wave | Version | What | Status |
|------|---------|------|--------|
| 1-3 | v0.1–v0.5 | Branch, diff, merge, agent, proxy, oplog, CoW, queue | ✅ Done |
| 4 | v0.7.0 | Commits, tags, three-way merge, cherry-pick, revert | ✅ Done |
| 5 | v0.8.0 | Branch TTL, reset, protection rules, hooks (14 events) | ✅ Done |
| 6 | v0.9.0 | Time travel, blame, deploy requests | ✅ Done |
| 7 | v1.0.0 | Agent scopes, branch compare, stash, anonymize, reflog | 🔜 Next |
| 8 | v1.1.0 | Atlas Search branching, npm publish, GitHub Actions, VS Code | 📋 Planned |

---

## License

MIT

---

<div align="center">

**Built for the age of AI agents writing to databases.**

*Stop hoping. Start branching.*

`198 tests · 595 assertions · 48 MCP tools · 0 mocks · real MongoDB only`

</div>
