<div align="center">

# 🌿 MongoBranch

### Git-like branching for MongoDB — built for AI agents

[![Tests](https://img.shields.io/badge/tests-125%20passing-brightgreen)]()
[![MongoDB](https://img.shields.io/badge/MongoDB-7.x-47A248?logo=mongodb&logoColor=white)]()
[![MCP Tools](https://img.shields.io/badge/MCP%20tools-25-blue)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Create a branch. Experiment freely. Diff what changed. Merge or discard.**

No more "oops I corrupted prod." No more prayer-driven deployments.

[Quick Start](#-quick-start) · [Why](#-why-this-exists) · [CLI](#-cli) · [MCP Server](#-mcp-server-for-ai-agents) · [Architecture](#-how-it-works)

</div>

---

## 💡 Why This Exists

AI agents write to databases. They hallucinate. They retry. They run in parallel.

**Without MongoBranch:**
- 🙏 Hope the agent doesn't break anything
- 📸 Manually snapshot before every operation
- 🔒 Lock the entire database during agent work

**With MongoBranch:**

```
Agent A: "I need to restructure the users collection"
         → branch → isolated sandbox → diff → merge ✅

Agent B: "I'm updating product prices"  (same time, zero conflicts)
         → branch → isolated sandbox → diff → merge ✅
```

The database equivalent of `git checkout -b feature && git diff && git merge`.

---

## 🚀 Quick Start

```bash
# 1. Start MongoDB (Atlas Local — includes search + vector support)
docker compose up -d

# 2. Install
bun install

# 3. Branch it
mb branch create experiment --description "testing new schema"

# 4. Work on your branch... then see what changed
mb diff experiment

# 5. Looks good? Merge. Changed your mind? Delete.
mb merge experiment          # apply to main
mb branch delete experiment  # or just throw it away
```

---

## 🤖 MCP Server — for AI Agents

MongoBranch ships a [Model Context Protocol](https://modelcontextprotocol.io) server with **25 tools**. Drop this into Claude Desktop, Cursor, or any MCP-compatible client:

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

### All 25 MCP Tools

| Category | Tools | What They Do |
|----------|-------|-------------|
| **Workflow** | `start_task`, `complete_task` | One-call branch + one-call merge |
| **Branch** | `create_branch`, `list_branches`, `delete_branch`, `rollback_branch`, `gc` | Full branch lifecycle |
| **Diff & Merge** | `diff_branch`, `merge_branch` | Field-level diff, dry-run, conflict strategies |
| **CRUD Proxy** | `branch_insert`, `branch_update`, `branch_delete`, `branch_find` | Direct data ops on any branch |
| **Multi-Agent** | `register_agent`, `create_agent_branch`, `agent_status` | Per-agent namespaced branches |
| **History** | `branch_log`, `record_snapshot`, `export_audit_log` | Full audit trail (JSON/CSV) |
| **Queue** | `enqueue_merge`, `process_merge_queue`, `merge_queue_status` | Ordered concurrent merges |
| **CoW** | `materialization_status` | Lazy copy-on-write tracking |
| **Ops** | `branch_oplog`, `branch_undo` | Operation log + reverse replay |

---

## 📟 CLI

```bash
mb branch create <name>           # Create isolated branch
mb branch list                    # List all branches
mb branch switch <name>           # Switch active branch
mb branch delete <name>           # Drop branch + database

mb diff <source> [target]         # Colored field-level diff
mb diff <source> --json           # Machine-readable JSON

mb merge <source> --into main     # Apply changes
mb merge <source> --dry-run       # Preview without applying

mb log [branch]                   # Event history
mb gc                             # Clean up stale branches
```

---

## ⚙️ How It Works

```
┌──────────────────────────────────────────────────────────────┐
│                     Your App / AI Agent                      │
├──────────────────────────────────────────────────────────────┤
│           CLI (mb)  ·  MCP Server  ·  TypeScript SDK         │
├──────────────────────────────────────────────────────────────┤
│  BranchManager │ DiffEngine  │ MergeEngine │ BranchProxy     │
│  OperationLog  │ MergeQueue  │ AgentManager│ HistoryManager  │
├──────────────────────────────────────────────────────────────┤
│                      MongoDB Driver                          │
├───────────────┬──────────────────┬───────────────────────────┤
│  main (myapp) │  __mb_feature-x  │  __mb_claude--fix-users   │
│  ───────────  │  ──────────────  │  ────────────────────── ──│
│  users        │  users (copy)    │  users (modified)          │
│  products     │  products        │  products                  │
│  orders       │  orders          │  orders (new docs)         │
└───────────────┴──────────────────┴───────────────────────────┘
```

**Each branch = a separate MongoDB database.** Full isolation. Real indexes. Zero mocks.

### Design Decisions

| Decision | Why |
|----------|-----|
| **DB-per-branch** | Complete isolation — branches can't leak into each other |
| **Lazy copy-on-write** | `lazy: true` → instant branch, data copied only on first write |
| **Source-centric diffing** | Only diffs collections on the source branch — prevents cascade data loss |
| **Operation log** | Every insert/update/delete recorded with before/after state |
| **Merge queue** | FIFO ordering for concurrent agent merges — no race conditions |
| **Real AI embeddings** | Stress-tested with real Voyage AI vectors (512-dim), not random floats |

### What Gets Diffed

MongoBranch doesn't just compare documents. It compares:

- **Documents** — added, removed, modified (field-level granularity via jsondiffpatch)
- **Indexes** — added/removed indexes between branches
- **Validation rules** — JSON Schema differences between branches
- **Vector embeddings** — real 512-dimensional embeddings survive branch→diff→merge intact

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

# Merge queue ensures sequential merge ordering
# Both sets of changes land on main without data loss
```

---

## 🧪 Testing

**125 tests. Real MongoDB. Zero mocks.** Every test runs against Atlas Local Docker.

```bash
bun test                          # Full suite (125 tests)
bun test tests/core/stress.test.ts      # 9 core stress scenarios
bun test tests/core/stress-ai.test.ts   # 6 real Voyage AI embedding tests
```

### Stress Test Coverage

| Scenario | What's Validated |
|----------|-----------------|
| Concurrent branch creation | 10 parallel branches, no collisions |
| Large documents | Deeply nested objects + large arrays |
| Rapid CRUD | 50 insert/update/delete cycles with oplog |
| Merge queue ordering | 5 branches, FIFO, no data loss |
| Lazy CoW lifecycle | Selective materialization → merge |
| Sequential merges | Branch A + Branch B → main preserves both |
| Real AI embeddings | Voyage AI 512-dim vectors → branch → merge → cosine similarity verified |
| Semantic similarity | Developer bios more similar to developers than designers (real vectors) |
| Cascade deletion fix | Sequential merges with real embeddings — validates the core data safety fix |

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
│   ├── branch.ts       # BranchManager — create, list, switch, delete, rollback, gc
│   ├── diff.ts         # DiffEngine — documents + indexes + validation, streaming
│   ├── merge.ts        # MergeEngine — dry-run, conflicts, strategies
│   ├── proxy.ts        # BranchProxy — CRUD with auto-materialization
│   ├── oplog.ts        # OperationLog — every write tracked, undo support
│   ├── queue.ts        # MergeQueue — FIFO concurrent merge ordering
│   ├── agent.ts        # AgentManager — per-agent branches
│   ├── history.ts      # HistoryManager — snapshots, audit export
│   └── types.ts        # TypeScript interfaces and config
├── cli.ts              # Commander.js CLI entry point
└── mcp/
    ├── server.ts       # MCP server (stdio transport)
    ├── tools.ts        # 25 tool handlers
    └── mongobranch.agent.md  # Agent skill file
```

---

## 📖 Architecture Decisions

- [ADR-001: Storage Strategy](docs/architecture/adr-001-storage-strategy.md) — Why DB-per-branch
- [ADR-002: Diff Algorithm](docs/architecture/adr-002-diff-algorithm.md) — Operation log + snapshot diff

---

## License

MIT

---

<div align="center">

**Built for the age of AI agents writing to databases.**

*Stop hoping. Start branching.*

</div>
