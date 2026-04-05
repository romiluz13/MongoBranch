<div align="center">

# 🌿 MongoBranch

### Git-level version control for MongoDB — built for AI agents

[![Tests](https://img.shields.io/badge/tests-340%20passing-brightgreen)]()
[![MongoDB](https://img.shields.io/badge/MongoDB-7.x-47A248?logo=mongodb&logoColor=white)]()
[![MCP Tools](https://img.shields.io/badge/MCP%20tools-87-blue)]()
[![CLI Commands](https://img.shields.io/badge/CLI-62%20commands-orange)]()
[![Engines](https://img.shields.io/badge/engines-26-purple)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

```
branch → commit → diff → merge → checkpoint → audit → deploy
```

**340 tests. 87 MCP tools. 26 engines. Zero mocks. Real MongoDB only.**

[Quick Start](#-quick-start) · [Why](#-the-problem) · [Features](#-feature-matrix) · [MCP Server](#-mcp-server--87-tools-for-ai-agents) · [CLI](#-cli--62-commands) · [Architecture](#%EF%B8%8F-architecture)

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
| MCP Server for AI agents | ✅ **87 tools** | ✅ ~10 tools | ❌ |
| CLI | ✅ **62 commands** | ✅ | ✅ |
| Atlas Search index branching | ✅ | N/A | N/A |
| Branch TTL (auto-expire) | ✅ | ✅ | ❌ |
| **Tamper-evident audit chain** | ✅ SHA-256 hash-chain | ❌ | ❌ |
| **Checkpoints (instant save/restore)** | ✅ Zero-ceremony | ✅ Snapshots API | ❌ |
| **Idempotent execution guard** | ✅ requestId dedup | ❌ | ❌ |
| **Branch-from-branch (nested)** | ✅ Depth-tracked | ✅ | ✅ |
| **Webhooks (HMAC-signed)** | ✅ Pre/post + HMAC-SHA256 | ❌ | ❌ |
| **Real-time change streams** | ✅ Branch watchers | ❌ | ❌ |

**MongoBranch: 28/28. Neon: 8/28. Dolt: 11/28.**

> The only tool that gives MongoDB full `git` semantics **and** is purpose-built for AI agents.

---

## 🚀 Quick Start

```bash
# 0. Prerequisite: Bun 1.0+ must be installed on your machine
#    MongoBranch ships Bun-based CLI and MCP entrypoints.

# 1. Install globally
npm install -g mongobranch

# 2. Bootstrap a fresh app workspace with auth-enabled Atlas Local preview
mkdir my-agent-app && cd my-agent-app
mb init --db myapp --start-local

# 3. Prove the environment before touching data
mb doctor
mb access status

# 4. Branch → Work → Commit → Merge
mb branch create experiment --description "testing new schema"
# ... make your changes ...
mb commit experiment -m "restructured user fields"
mb diff experiment
mb merge experiment          # apply to main

# Or tag a known-good state and time-travel later
mb tag create v1.0 experiment
mb branch delete experiment  # done — branch is disposable
```

Scoped approval rule:

- Use `mb init --start-local` for new external workspaces.
- Treat `mb doctor` + `mb access status` as the install-to-ready gate.
- The current strongest proof is an auth-enabled Atlas Local preview consumer app that passed **22/22** install-to-restore dogfood checks.

---

## 🤖 MCP Server — 87 Tools for AI Agents

MongoBranch ships a [Model Context Protocol](https://modelcontextprotocol.io) server with **87 tools**. Drop into Claude Desktop, Cursor, Windsurf, or any MCP client:

> Bun must be available on the host machine because `mongobranch-mcp` is shipped as a Bun entrypoint.

```json
{
  "mcpServers": {
    "mongobranch": {
      "command": "npx",
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

### All 87 MCP Tools

| Category | Tools | What They Do |
|----------|-------|-------------|
| **Workflow** | `start_task`, `complete_task` | One-call branch + one-call merge |
| **Branch** | `create_branch`, `list_branches`, `delete_branch`, `rollback_branch`, `gc`, `system_status` | Full lifecycle + garbage collection |
| **Diff & Merge** | `diff_branch`, `merge_branch`, `merge_three_way` | Field-level diff, conflict strategies |
| **Commits** | `commit`, `get_commit`, `commit_log` | SHA-256, parent chains, merge commits |
| **Tags** | `create_tag`, `list_tags`, `delete_tag` | Immutable named refs |
| **Cherry-Pick** | `cherry_pick`, `revert_commit` | Surgical apply/undo |
| **Time Travel** | `time_travel_query`, `blame` | Any commit or timestamp |
| **Deploy** | `open/approve/reject/execute/list_deploy_request` | PR-like workflow for data |
| **Access Control** | `access_control_status`, `provision_branch_access`, `provision_deployer_access`, `revoke_access_identity`, `list_access_profiles` | Least-privilege MongoDB users + live enforcement probe |
| **Protection** | `protect_branch`, `list_protections`, `remove_protection` | Glob patterns, merge-only |
| **Hooks** | `list_hooks`, `remove_hook`, `register_webhook` | 14 events + HTTP webhooks |
| **TTL** | `set_branch_ttl`, `reset_from_parent` | Auto-expire + re-copy from source |
| **Stash** | `stash`, `stash_pop`, `stash_list` | Save/resume work |
| **Reflog** | `reflog` | Branch pointer history |
| **Scope** | `set_agent_scope`, `check_agent_permission`, `get_agent_violations` | Per-agent collection ACLs |
| **Compare** | `compare_branches` | N-way branch comparison matrix |
| **Anonymize** | `create_anonymized_branch` | hash/mask/null/redact PII |
| **Search Index** | `list/copy/diff/merge_search_indexes` | Atlas Search on branches |
| **CRUD Proxy** | `branch_insert/update/delete/find`, `branch_aggregate`, `branch_count`, `branch_update_many`, `branch_list_collections`, `branch_schema` | Full database ops on any branch |
| **Agent** | `register_agent`, `create_agent_branch`, `agent_status` | Per-agent sandboxes |
| **History** | `branch_log`, `record_snapshot`, `export_audit_log` | Full audit trail (JSON/CSV) |
| **Queue** | `enqueue_merge`, `process_merge_queue`, `merge_queue_status` | FIFO atomic merges |
| **Ops** | `branch_oplog`, `branch_undo`, `materialization_status` | Oplog, undo, CoW status |
| **Audit Chain** | `verify_audit_chain`, `export_audit_chain_certified`, `get_audit_chain` | Tamper-evident hash chain (EU AI Act) |
| **Checkpoints** | `create_checkpoint`, `restore_checkpoint`, `list_checkpoints` | Lightweight save/restore points |
| **Execution Guard** | `guarded_execute` | Idempotent ops — dedup via requestId |
| **Watcher** | `watch_branch`, `stop_watch`, `get_watch_events` | Real-time change stream events |

---

## 📟 CLI — 62 Commands

```bash
# System
mb status                         # Active branches, storage, recent activity
mb doctor                         # Live environment probe for Atlas Local capabilities
mb access status                  # Verify whether MongoDB access control is actually enforced

# Branch lifecycle
mb branch create <name>           # Isolated DB copy — indexes, data, validators
mb branch list                    # All branches with metadata + TTL
mb branch switch <name>           # Switch active branch context
mb branch delete <name>           # Drop branch database

# Version control
mb commit <branch> -m "message"   # SHA-256 content-addressed commit
mb commits <branch>               # Walk the commit graph
mb tag create <name> <branch>     # Immutable ref: "v1.0", "pre-migration"
mb tag list                       # All tags with commit hashes
mb tag delete <name>              # Remove tag (commit preserved)
mb cherry-pick <target> <hash>    # Apply one commit to another branch
mb revert <branch> <hash>         # Undo a commit, history preserved

# Diff & merge
mb diff <source> [target]         # Colored field-level diff
mb merge <source> --into main     # Three-way merge with conflict detection
mb merge <source> --dry-run       # Preview without applying

# Time travel & forensics
mb query <branch> <collection>            # Query data at any commit/timestamp
mb blame <branch> <collection> <docId>    # Who changed what field, when

# Deploy & safety
mb deploy create                  # Create deploy request (data PR)
mb deploy list                    # List all deploy requests
mb deploy approve <id>            # Approve for production
mb deploy reject <id>             # Reject with reason
mb deploy execute <id>            # Ship it
mb stash save <branch>            # Save work-in-progress
mb stash pop <branch>             # Restore it
mb stash list <branch>            # View stash stack
mb drift capture <branch>         # Review fence using MongoDB operationTime
mb drift check --branch <name>    # Detect post-review raw writes
mb access provision-branch <name> # Least-privilege branch-scoped MongoDB user
mb access provision-deployer      # Protected-target deploy identity
mb access revoke <username>       # Drop provisioned user/role

# Agent coordination
mb anonymize <branch> --strategy mask         # PII redaction
mb compare <branch1> <branch2> <branch3>      # N-way comparison matrix
mb reflog <branch>                # Branch pointer history

# Atlas Search indexes on branches
mb search-index list <branch>     # List indexes on branch
mb search-index copy <src> <tgt>  # Copy indexes between branches
mb search-index diff <src> <tgt>  # Compare index definitions
mb search-index merge <src> <tgt> # Merge index definitions

# Operations
mb gc                             # Clean stale branches
mb log [branch]                   # History log with filtering

# Agent Safety (Wave 9)
mb checkpoint create <branch> --label "before-migration"
mb checkpoint restore <branch> <id>
mb checkpoint list <branch>
mb audit verify                   # Verify tamper-evident hash chain
mb audit export --format json     # Export for compliance auditors
mb audit log --branch <name>      # View audit trail
```

---

## ⚙️ Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       Your App / AI Agent                        │
├──────────────────────────────────────────────────────────────────┤
│           CLI (62 cmds) · MCP Server (87 tools) · SDK            │
├──────────────────────────────────────────────────────────────────┤
│  BranchManager   CommitEngine     DiffEngine      MergeEngine    │
│  TimeTravelEngine DeployManager   BranchProxy     ScopeManager   │
│  ProtectionManager HookManager   AgentManager     MergeQueue     │
│  OperationLog    HistoryManager   StashManager    ReflogManager  │
│  BranchComparator AnonymizeEngine SearchIndexManager              │
│  AuditChainMgr   CheckpointMgr   ExecutionGuard  BranchWatcher   │
│  AccessControlManager                                           │
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
| **Access control probe** | Restricted-user live check proves whether MongoDB is enforcing least privilege |

### What Gets Diffed

- **Documents** — added, removed, modified (field-level via jsondiffpatch)
- **Indexes** — structural changes between branches
- **Validation rules** — JSON Schema differences
- **Atlas Search indexes** — search index definitions branched and diffed
- **Vector embeddings** — 512-dim Voyage AI embeddings survive branch→diff→merge intact

---

## 🛡️ Agent Safety (Wave 9)

Production-hardened features for AI agents operating on real data.

### Checkpoints — Instant Save/Restore

```typescript
// Agent creates a save point before risky work
const cp = await checkpointManager.create("feature-branch", { label: "before-migration" });

// Agent does aggressive operations...
await proxy.insertOne("feature-branch", "products", bulkData);
await proxy.updateMany("feature-branch", "users", {}, { $set: { role: "pending" } });

// Something went wrong? Instantly restore to the save point
await checkpointManager.restore("feature-branch", cp.id);
// Data is exactly as it was before — every collection, every document
```

### Audit Chain — Tamper-Evident Compliance

```typescript
// Every operation is hash-chained (SHA-256). Tampering breaks the chain.
const verification = await auditChain.verify();
// { valid: true, totalEntries: 847, firstEntry: genesis, lastEntry: ... }

// Export for compliance auditors (EU AI Act Article 12)
const report = await auditChain.exportChain("json");
// Includes cryptographic verification header + full hash chain
```

### Execution Guard — Exactly-Once Operations

```typescript
// LLM retries the same tool call? No duplicate side effects.
const result = await guard.execute(
  "req-abc-123",  // Deterministic request ID
  "branch_insert", "my-branch", args,
  async () => proxy.insertOne("my-branch", "orders", newOrder),
);
// result.cached === true on retry — same result, zero duplicate writes
```

### Nested Branches — Hierarchical Agent Teams

```bash
mb branch create feature                     # depth 0 (from main)
mb branch create experiment --from feature    # depth 1
mb branch create sub-test --from experiment   # depth 2
# Max depth enforced (default 5) — prevents runaway nesting
```

### Webhooks — HMAC-Signed HTTP Notifications

```typescript
// Pre-merge webhook — blocks merge if policy violated
await hookManager.registerWebhook("policy-check", "pre-merge",
  "https://api.example.com/hooks/review",
  { secret: "my-signing-key", timeout: 3000 }
);
// POST with X-MongoBranch-Signature: <HMAC-SHA256> header
```

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

## 🔐 Access Control — Managed vs Enforced

MongoBranch now provisions least-privilege MongoDB users for branch and deploy workflows, but it does **not** blindly assume that `createUser` means the server is enforcing RBAC.

```bash
mb access status
# Shows authenticated user context and runs a restricted-user probe
```

If MongoDB accepts a forbidden write from that restricted probe user, MongoBranch reports the environment as `not enforced`.

```bash
mb access provision-branch feature-x \
  --username agent_feature_x \
  --password secret123 \
  --collections users,orders \
  --by codex
```

This produces:

- a MongoDB role scoped to the branch database
- a MongoDB user assigned to that role
- a connection string agents can use for that branch
- metadata in MongoBranch so the identity can be listed and revoked later

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

## 📡 Real-Time Branch Watcher

React to branch changes in real time via MongoDB Change Streams — with resume token support for crash recovery.

```typescript
const watcher = new BranchWatcher(client, config);

// Watch a branch for live changes
await watcher.watch("feature-x", async (event) => {
  console.log(`${event.operationType} on ${event.collection}: ${event.documentId}`);
  // → "insert on products: 507f1f77bcf86cd799439011"
}, {
  fullDocument: true,          // Include the full document in events
  fullDocumentBeforeChange: true,  // Include pre-image (what it looked like before)
});

// Resume after disconnect — no missed events
const token = watcher.getResumeToken("feature-x");
await watcher.watch("feature-x", handler, { resumeAfter: token });

await watcher.stop("feature-x");
```

Use cases: CI triggers on branch data changes, agent coordination signals, audit stream forwarding.

---

## 🧪 Testing — 340 Tests, Zero Mocks

Every test runs against **real MongoDB** (Atlas Local Docker). No mocking. No faking. If it passes here, it works in production.

```bash
bun run test                                 # Full suite — 340 tests, 32 files
bun test tests/core/commit.test.ts           # Commits, tags, cherry-pick, revert
bun test tests/core/three-way-merge.test.ts  # Three-way merge + conflict resolution
bun test tests/core/timetravel.test.ts       # Time travel queries + blame
bun test tests/core/deploy.test.ts           # Deploy request workflow
bun test tests/core/scope.test.ts            # Agent permissions + ACLs
bun test tests/core/access-control.test.ts   # MongoDB users, roles, RBAC enforcement probe
bun test tests/core/stress-ai.test.ts        # Real Voyage AI 512-dim embeddings
```

Current verification highlights:

- branch + nested-branch lifecycle against real MongoDB
- three-way merge, deploy drift gates, and time travel semantics
- access control provisioning plus live restricted-user enforcement probe
- Atlas Search / Vector Search capability checks on Atlas Local preview
- MCP tool handlers and end-to-end consumer-app dogfooding
- fresh external auth-enabled Atlas Local consumer app passed **22/22** install, branch, deploy, drift, backup/restore, and CLI/MCP/library checks

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
docker compose up -d              # Atlas Local on port 27017 (repo contributors)
bun run test                      # 340 tests, ~220 seconds
bun src/mcp/server.ts             # Start MCP server
bun src/cli.ts branch create my-feature   # CLI
```

### 27 Core Modules

```
src/core/
├── access-control.ts  AccessControlManager — branch/deployer users, roles, RBAC enforcement probe
├── branch.ts          BranchManager — create, list, switch, delete, TTL, nested branches, CoW, gc
├── commit.ts          CommitEngine — SHA-256 commits, parent chains, tags, cherry-pick, revert
├── diff.ts            DiffEngine — documents + indexes + validation rules + three-way
├── merge.ts           MergeEngine — two-way, three-way, branch-to-branch, dry-run, strategies
├── doctor.ts          EnvironmentDoctor — live Atlas Local capability probes
├── drift.ts           DriftManager — operationTime review fences + stale-state detection
├── timetravel.ts      TimeTravelEngine — findAt (commit/timestamp), listCollectionsAt, blame
├── deploy.ts          DeployRequestManager — open, approve, reject, execute, list, get
├── protection.ts      ProtectionManager — branch protection rules, glob patterns
├── hooks.ts           HookManager — 14 event types, pre/post hooks, HTTP webhooks (HMAC-SHA256)
├── scope.ts           ScopeManager — agent permissions, collection ACLs, quota enforcement
├── compare.ts         BranchComparator — N-way branch comparison, presence matrix
├── stash.ts           StashManager — stash/pop/list/drop, ordered stash stack
├── anonymize.ts       AnonymizeEngine — hash/mask/null/redact PII strategies
├── reflog.ts          ReflogManager — branch pointer tracking, survives deletion
├── search-index.ts    SearchIndexManager — Atlas Search index branching
├── audit-chain.ts     AuditChainManager — SHA-256 hash-chained tamper-evident log (EU AI Act)
├── checkpoint.ts      CheckpointManager — lightweight save points, instant restore, TTL prune
├── execution-guard.ts ExecutionGuard — idempotent agent ops, requestId dedup, exactly-once
├── watcher.ts         BranchWatcher — real-time change stream monitoring per branch
├── proxy.ts           BranchProxy — CRUD, aggregate, count, schema with lazy auto-materialization
├── oplog.ts           OperationLog — every write tracked, undo support
├── queue.ts           MergeQueue — FIFO concurrent merge ordering
├── agent.ts           AgentManager — per-agent namespaced branches
├── history.ts         HistoryManager — snapshots, branch log, audit export (JSON/CSV)
└── types.ts           TypeScript interfaces, config, constants
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
| 8 | Atlas Search index branching, MCP server, CLI, CI | ✅ Shipped |
| **9** | **Audit chain (EU AI Act), checkpoints, execution guard, nested branches, webhooks, watchers** | **✅ Shipped** |
| **10** | **Ship It — npm publish, release workflow, .npmignore, v1.0.0** | **✅ Shipped** |

**All 10 waves shipped.** 🚀 **87 MCP tools · 62 CLI commands · 26 engines · 340 tests**

---

## License

MIT

---

<div align="center">

**Built for the age of AI agents writing to databases.**

*Stop hoping. Start branching.*

```
340 tests · 87 MCP tools · 62 CLI commands · 26 engines · 0 mocks · real MongoDB only
```

</div>
