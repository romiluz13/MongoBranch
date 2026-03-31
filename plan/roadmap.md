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

### Test Coverage: 110 tests, 265 assertions, 0 failures (Wave 1-3 baseline)

---

## 🚧 WAVE 4 — v0.7.0: Commit Graph & True Version Control
> **Goal**: Transform from "branching tool" → "version control system"
> **Competitive target**: Dolt's commit graph + Neon's instant branching = best of both
> **Methodology**: MongoDB docs → local docs → TDD → real MongoDB tests → zero mocks

### Phase 4.1: Commit Engine ✅ COMPLETE
> Every change gets a commit. Every commit gets a hash. Every hash is immutable.
> This is the backbone of everything else — tags, cherry-pick, revert, time-travel all need commits.

**MongoDB docs needed**: Transactions (for atomic commits), Indexes (for commit hash lookups)

- [x] `CommitEngine` class (`src/core/commit.ts`) — 255 lines
- [x] Commit object: `{ hash, branchName, parentHashes[], message, author, timestamp, snapshot }`
- [x] Content-addressed commit hash (SHA-256 of branch + parents + timestamp + snapshot)
- [x] `commit(branchName, message, author)` — snapshot current branch state into a commit
- [x] `getCommit(hash)` — retrieve a single commit by hash
- [x] `getLog(branchName, limit)` — walk commit chain from HEAD backward
- [x] `getCommonAncestor(branchA, branchB)` — BFS walk to find merge base
- [x] HEAD pointer per branch — `headCommit` field on BranchMetadata
- [x] Merge commit support — `parentOverrides` for two-parent commits
- [x] Indexed `__mongobranch.commits` collection (hash unique, branchName + timestamp compound)
- [x] Types: `Commit`, `CommitOptions`, `CommitLog`, `CommitSnapshot`, `CollectionSnapshot` in `types.ts`
- [x] MCP tools: `commit`, `get_commit`, `commit_log` — 3 new tools (total: 28)
- [x] CLI: `mb commit <branch> -m "message"`, `mb commits <branch>` — 2 new commands
- [x] Tests: 13 TDD tests — all passing (138 total across 13 files, zero failures)

### Phase 4.2: Tags & Refs ✅ COMPLETE
> Named immutable references to commits — "v1.0", "before-migration", "last-known-good"
> Critical for production checkpoints and rollback targets.

- [x] Tag methods on `CommitEngine` in `src/core/commit.ts` (tightly coupled to commits)
- [x] Tag object: `{ name, commitHash, createdAt, createdBy, message }`
- [x] `createTag(name, commitHashOrBranch, options)` — tag a commit or branch HEAD
- [x] `deleteTag(name)` — remove a tag
- [x] `listTags()` — list all tags sorted by creation date
- [x] `getTag(name)` — resolve tag to `{ tag, commit }`
- [x] Immutability enforcement — duplicate tag names rejected, must delete to retag
- [x] Indexed `__mongobranch.tags` collection (name unique)
- [x] MCP tools: `create_tag`, `list_tags`, `delete_tag` — 3 new tools (total: 31)
- [x] CLI: `mb tag create`, `mb tag list`, `mb tag delete` — 3 new subcommands
- [x] Tests: 9 TDD tests — all passing (147 total across 13 files, zero failures)

### Phase 4.3: Three-Way Merge ✅ COMPLETE
> The #1 thing Neon can't do. The #1 thing that makes MongoBranch a real VCS.
> Uses common ancestor (from commit graph) to distinguish "added" vs "deleted" vs "modified".

**Research source**: Dolt's three-way merge algorithm (validated 2026-03-31)

- [x] `DiffEngine.diff3(base, ours, theirs)` — three-way diff with per-field comparison
- [x] Find merge base using `CommitEngine.getCommonAncestor()` (BFS on commit graph)
- [x] Diff base→ours + base→theirs, auto-merge non-overlapping changes
- [x] Per-field conflict detection: same _id + same field + different values = conflict
- [x] Structured conflict objects: `{ collection, documentId, field, base, ours, theirs }`
- [x] `MergeEngine.threeWayMerge()` — coordinates ancestor + diff3 + apply + merge commit
- [x] Conflict strategies: `manual` (report), `ours`, `theirs` (auto-resolve)
- [x] Merge commit with two parents created on successful merge
- [x] Fallback: 2-way merge when no common ancestor exists
- [x] MCP tool: `merge_three_way` with dryRun, conflictStrategy, author, message (total: 32)
- [x] Tests: 5 TDD tests — clean merge, conflict detection, theirs strategy, merge commit, fallback

### Phase 4.4: Cherry-Pick & Revert ✅ COMPLETE
> Surgical operations — apply ONE commit, or undo ONE commit, without touching anything else.
> Critical for agents: "I want just the user fix from that experiment, not the product changes"

- [x] `cherryPick(targetBranch, commitHash, author)` — apply a single commit's changes to target
- [x] Cherry-pick creates a new commit with message referencing source commit
- [x] Cherry-pick compares commit snapshot to parent snapshot for change detection
- [x] `revert(branchName, commitHash, author)` — create revert commit with inverse changes
- [x] Revert drops collections added by the commit, tracks reverted document count
- [x] Revert creates a new "Revert: ..." commit (history preserved, not rewritten)
- [x] MCP tools: `cherry_pick`, `revert_commit` — 2 new tools (total: 34)
- [x] CLI: `mb cherry-pick <target> <hash>`, `mb revert <branch> <hash>` — 2 new commands
- [x] Tests: 6 TDD tests — all passing (151 total across 14 files, zero new failures)

---

## 🚧 WAVE 5 — v0.8.0: Safety & Lifecycle
> **Goal**: Production-grade guardrails — branches expire, hooks validate, protection prevents disasters
> **Competitive target**: lakeFS hooks + Neon TTL + PlanetScale deploy requests

### Phase 5.1: Branch TTL & Expiration ✅ COMPLETE
> Agents leave orphan branches. Neon solved this with TTL. We must too.
> Uses MongoDB TTL indexes for automatic cleanup — zero application-side cron.

**MongoDB docs needed**: TTL Indexes (`expireAfterSeconds`), `createIndex` on date fields

- [x] `expiresAt` field on BranchMetadata (optional Date)
- [x] `BranchCreateOptions.ttl` — set branch lifetime in hours/days
- [x] TTL index on `__mongobranch.branches.expiresAt` — MongoDB auto-deletes expired metadata
- [x] Expiration hook: on TTL trigger, also drop the branch database (via change stream or polling)
- [x] `extendBranch(name, additionalHours)` — push back expiration
- [x] `setBranchExpiration(name, expiresAt)` — set/update expiration
- [x] Branch listing shows TTL status and time remaining
- [x] MCP tools: `set_branch_ttl`, `extend_branch`
- [x] CLI: `mb branch create <name> --ttl 24h`, `mb branch extend <name> 12h`
- [x] Tests: 6 TDD tests — all passing

### Phase 5.2: Reset from Parent ✅ COMPLETE
> Stale branches drift from production. Neon's "reset from parent" refreshes them.
> Our version: re-materialize from source DB, preserving branch identity.

- [x] `resetFromParent(branchName)` — drop branch data, re-copy from source
- [x] Reset preserves: branch metadata, commit history, tags pointing to this branch
- [x] Reset creates a "reset" commit in history for audit
- [ ] Option: `resetFromParent(branchName, { keepChanges: ['collection1'] })` — partial reset (deferred to v1.0)
- [x] MCP tool: `reset_from_parent`
- [x] CLI: `mb branch reset <name>`
- [x] Tests: 2 TDD tests — all passing

### Phase 5.3: Branch Protection Rules ✅ COMPLETE
> Prevent direct writes to `main`. Only merges can modify protected branches.
> lakeFS has this. GitHub has this. We need this.

- [x] `ProtectionRule` type: `{ pattern, requireMergeOnly, preventDelete, createdBy, createdAt }`
- [x] `protectBranch(pattern, rules)` — set protection rules (supports glob: `main`, `prod-*`)
- [x] `isProtected(branchName)` — checks branch against all rules (exact + glob)
- [x] Merge bypass — merges are allowed even on protected branches
- [x] `listProtections()`, `removeProtection(pattern)`
- [x] Protection stored in `__mongobranch.protections` collection
- [x] MCP tools: `protect_branch`, `list_protections`, `remove_protection`
- [x] Tests: 7 TDD tests — all passing

### Phase 5.4: Hooks & Webhooks ✅ COMPLETE
> Pre-merge validation, pre-commit data quality checks, post-merge notifications.
> lakeFS pioneered this for data lakes (18 event types validated). We bring it to MongoDB.
> **Research validated**: lakeFS pre-hooks return error (can reject), post-hooks fire-and-forget.

**MongoDB docs needed**: Change Streams (for event-driven hooks)

- [x] `HookManager` class (`src/core/hooks.ts`)
- [x] Hook types (14 events, validated against lakeFS):
  - `pre-commit`, `post-commit` — commit validation & notification
  - `pre-merge`, `post-merge` — merge quality gates & notification
  - `pre-create-branch`, `post-create-branch` — branch lifecycle
  - `pre-delete-branch`, `post-delete-branch` — branch lifecycle
  - `pre-create-tag`, `post-create-tag` — tag lifecycle
  - `pre-delete-tag`, `post-delete-tag` — tag lifecycle
  - `pre-revert`, `pre-cherry-pick` — surgical operation gates
- [x] Hook registration: `registerHook(name, event, handler, options)` with priority ordering
- [x] Pre-hooks can reject operations (return `{ allow: false, reason }`) — fail-fast
- [x] Post-hooks are fire-and-forget (swallow errors silently)
- [ ] Webhook support: `registerWebhook(event, url, secret?)` — deferred to Wave 6
- [x] Hook context includes: branch name, user, event, runId
- [x] Hook execution is ordered (priority field) and fail-fast (first rejection stops)
- [x] Hook registry stored in `__mongobranch.hooks` collection
- [x] MCP tools: `list_hooks`, `remove_hook`
- [x] Tests: 8 TDD tests — all passing

---

## 🚧 WAVE 6 — v0.9.0: Time Travel & Audit
> **Goal**: Query any point in history. Know who changed what and when.
> **Competitive target**: Neon time-travel queries + Dolt blame + PlanetScale deploy requests

### Phase 6.1: Time Travel Queries ✅ COMPLETE
> Query data at any past commit point. "What did the users collection look like yesterday?"
> Neon's killer feature — we build it better because we have commits (they only have restore windows).

- [x] `findAt(branchName, collection, filter, commitHash)` — query at a specific commit
- [x] `findAt(branchName, collection, filter, timestamp)` — query at a point in time
- [x] Implementation: snapshot-based — full document state stored per commit in `commit_data`
- [ ] Optimization: cache recent snapshots, lazy rebuild for old commits *(deferred)*
- [x] Return data in same format as `branch_find` (transparent to agents)
- [x] MCP tool: `time_travel_query` (branch, collection, filter, at: commitHash | timestamp)
- [x] CLI: `mb query <branch> <collection> --at <hash> --timestamp <iso> --filter '{}'`
- [x] Tests: 5 TDD tests (query at commit, query at timestamp, query after modification, no-filter, multi-collection)

### Phase 6.2: Blame ✅ COMPLETE
> Who changed which document/field and when? Follow the trail.
> Dolt has `dolt_blame_<table>`. We build `blame(collection, documentId)`.

- [x] `blame(branchName, collection, documentId)` — returns change history per field
- [x] Blame output: `{ field: [{ value, commitHash, author, timestamp }] }`
- [x] Walk commit chain backward, tracking per-field changes
- [x] Optimization: stop walking when all fields have been attributed
- [x] MCP tool: `blame`
- [x] CLI: `mb blame <branch> <collection> <documentId>`
- [x] Tests: 4 TDD tests (multi-field, unchanged doc, multi-change same field, new doc blame)

### Phase 6.3: Deploy Requests ✅ COMPLETE
> PR-like workflow for data changes. Agent proposes → human reviews diff → approves → merge executes.
> PlanetScale pioneered this for schema changes. We build it for data + schema.

- [x] `DeployRequest` type: `{ id, sourceBranch, targetBranch, status, diff, createdBy, reviewedBy, createdAt }`
- [x] Status flow: `open` → `approved` | `rejected` | `merged`
- [x] `open(source, target, description)` — opens a request with auto-diff
- [x] `approve(id, reviewedBy)` — marks as approved
- [x] `execute(id)` — runs the merge (only if approved)
- [x] `reject(id, reason)` — rejects with reason
- [x] Deploy request stores the diff snapshot at creation time
- [x] Integration with hooks — pre-merge hooks run on execute, post-merge fire-and-forget
- [x] Integration with protection — `isTargetProtected` flag on deploy request
- [x] Stored in `__mongobranch.deploy_requests` collection
- [x] MCP tools: `open_deploy_request`, `approve_deploy_request`, `execute_deploy_request`, `reject_deploy_request`, `list_deploy_requests`
- [x] CLI: `mb deploy create`, `mb deploy list`, `mb deploy approve <id>`, `mb deploy reject <id>`, `mb deploy execute <id>`
- [x] Tests: 10 TDD tests (create, duplicate prevention, missing branch, approve, reject, state validation, execute, merge verify, list filtering, get by ID)

---

## 🚧 WAVE 7 — v1.0.0: Agent Intelligence & Platform
> **Goal**: Agent-specific features that no competitor has. Ship-to-production ready.
> **This is what shocks the industry.**

### Phase 7.1: Agent Permissions & Scopes ⬜
> Multi-agent safety — don't let a rogue agent delete the users collection.

- [ ] `AgentScope` type: `{ collections: string[], operations: OpType[], maxDocuments?, maxBranches? }`
- [ ] `setAgentScope(agentId, scope)` — define what an agent can touch
- [ ] Proxy enforcement — `BranchProxy` checks agent scope before CRUD
- [ ] Collection-level: agent can only read/write specific collections
- [ ] Operation-level: agent can only insert (not delete), or only read
- [ ] Quota enforcement: max documents per branch, max active branches per agent
- [ ] Scope violations logged in oplog with `violation` type
- [ ] MCP tools: `set_agent_scope`, `get_agent_scope`
- [ ] Tests: 8+ TDD tests (allow, reject collection, reject op, quota limit, violation logging)

### Phase 7.2: Branch Comparison Matrix ⬜
> "3 agents experimented with different approaches — which one is best?"

- [ ] `compareBranches(branchNames: string[])` — N-way comparison
- [ ] Output: per-collection, per-document matrix showing which branches have what
- [ ] Summary stats: total changes, overlap percentage, unique changes per branch
- [ ] Diff matrix: show which branches agree/disagree on same documents
- [ ] MCP tool: `compare_branches`
- [ ] Tests: 4+ TDD tests (2-way, 3-way, identical branches, disjoint changes)

### Phase 7.3: Stash ⬜
> Agent interrupted mid-task. Save work, switch branches, come back later.

- [ ] `stash(branchName, message?)` — save uncommitted changes to stash stack
- [ ] `stashPop(branchName)` — restore most recent stash
- [ ] `stashList(branchName)` — show stash stack
- [ ] `stashDrop(branchName, index?)` — discard a stash entry
- [ ] Stash stored in `__mongobranch.stashes` collection
- [ ] MCP tools: `stash`, `stash_pop`, `stash_list`
- [ ] Tests: 5+ TDD tests (stash, pop, list, multiple stashes, pop order)

### Phase 7.4: Schema-Only Branching & Data Anonymization ⬜
> Branch structure without data (sensitive data protection).
> Branch with data but PII fields redacted (compliance).

- [ ] `BranchCreateOptions.schemaOnly` — copy collection structure + indexes, no documents
- [ ] `BranchCreateOptions.anonymize` — copy data with PII fields redacted/masked
- [ ] Anonymization config: `{ fields: { 'users.email': 'hash', 'users.name': 'faker' } }`
- [ ] Built-in strategies: `hash` (SHA-256), `mask` (***), `faker` (realistic fake data), `null`
- [ ] Schema-only branches useful for testing migrations without data exposure
- [ ] MCP tools: enhanced `create_branch` with `schemaOnly` and `anonymize` options
- [ ] Tests: 6+ TDD tests (schema-only empty, schema-only indexes, anonymize hash, anonymize mask)

### Phase 7.5: Reflog ⬜
> Track all branch pointer movements — "what happened to my branch?"

- [ ] `Reflog` entries: `{ branchName, fromCommit, toCommit, action, timestamp, actor }`
- [ ] Actions: `commit`, `merge`, `reset`, `cherry-pick`, `revert`, `delete`, `create`
- [ ] `getReflog(branchName, limit)` — show pointer history
- [ ] Reflog survives branch deletion (recovery aid)
- [ ] Stored in `__mongobranch.reflog` collection
- [ ] MCP tool: `reflog`
- [ ] CLI: `mb reflog <branch>`
- [ ] Tests: 5+ TDD tests (commit, merge, reset, delete recovery, ordering)

---

## 🚧 WAVE 8 — v1.1.0: Atlas Integration & Ecosystem
> **Goal**: First-class Atlas citizen. npm publish. GitHub Actions. VS Code extension.

### Phase 8.1: Atlas Search Index Branching ⬜
> Branch Atlas Search indexes alongside data. Query vector search on branches.

**MongoDB docs needed**: Atlas Search index management, Vector Search, autoEmbed

- [ ] Copy Atlas Search index definitions to branch databases
- [ ] Diff search index definitions between branches
- [ ] Merge search index changes (add/remove/modify indexes)
- [ ] Vector search queries work on branch data
- [ ] Tests: require Atlas Local Docker (`preview` tag)

### Phase 8.2: npm Package & GitHub Actions ⬜
> Ship it. Let people install it. Let CI/CD use it.

- [ ] `npm publish` as `mongobranch`
- [ ] GitHub Action: `mongobranch/setup` — install and configure in CI
- [ ] GitHub Action: `mongobranch/branch` — create branch per PR
- [ ] GitHub Action: `mongobranch/merge` — merge on PR approval
- [ ] Vercel/Netlify integration guide

### Phase 8.3: VS Code Extension ⬜
> Visual branch management, diff viewer, merge UI.

- [ ] Branch tree view in sidebar
- [ ] Visual diff (document-level, field-level highlighting)
- [ ] One-click merge with conflict resolution UI
- [ ] Commit history timeline
- [ ] Deploy request review UI

---

## Feature Count Summary

| Wave | Version | Features | Tests (est.) | Status |
|------|---------|----------|-------------|--------|
| 1-3 | v0.1–v0.5 | 8 engines, 25 MCP tools, CLI | 125 tests | ✅ Complete |
| 4 | v0.7.0 | Commits ✅, Tags ✅, 3-way Merge ✅, Cherry-pick ✅, Revert ✅ | 33 tests | ✅ Complete |
| 5 | v0.8.0 | TTL ✅, Reset ✅, Protection ✅, Hooks ✅ | 23 tests | ✅ Complete |
| 6 | v0.9.0 | Time Travel, Blame, Deploy Requests | 17 tests | ✅ |
| 7 | v1.0.0 | Scopes, Compare, Stash, Anonymize, Reflog | ~28 tests | ⬜ |
| 8 | v1.1.0 | Atlas Search, npm, GitHub Actions, VS Code | ~10 tests | ⬜ |
| **Total** | | **~40 features** | **~240 tests** | |

---

## Architecture Decisions
- See: [docs/architecture/adr-001-storage-strategy.md](../docs/architecture/adr-001-storage-strategy.md)
- See: [docs/architecture/adr-002-diff-algorithm.md](../docs/architecture/adr-002-diff-algorithm.md)

## Key References
- [Dolt — Git for Data](https://github.com/dolthub/dolt) — Prolly Tree, three-way merge, commit graph, blame
- [Neon — Copy-on-Write Postgres](https://github.com/neondatabase/neon) — Instant branching, TTL, time travel, reset
- [lakeFS — Data Version Control](https://lakefs.io/) — Hooks, branch protection, pre-merge validation
- [PlanetScale — Deploy Requests](https://planetscale.com/) — PR-like workflow for data/schema changes
- [Xata — Postgres Branching](https://xata.io/) — Schema diff, data anonymization, preview environments
- [Gas Town — Multi-Agent Orchestrator](https://github.com/steveyegge/gastown)
- [MongoDB MCP Server](https://github.com/mongodb-js/mongodb-mcp-server)

## Research Validation Log (2026-03-31)

### ✅ Dolt Three-Way Merge (dolthub.com/blog/2024-06-19-threeway-merge)
- **6-step merge process**: Find merge base → Schema merge → Schema conflict resolution → Data merge → Data conflict resolution → Constraint violation resolution
- **Key insight**: Data merge uses primary key (`_id` in our case) to walk sorted sets. If same `[pk, column]` modified to different values → conflict
- **JSON column special case**: Dolt auto-merges JSON if different keys modified (maps directly to our MongoDB documents)
- **Merge base**: BFS from both branch HEADs until common ancestor found. Dolt pre-computes closure for speed
- **Applied to MongoBranch**: Phase 4.3 three-way merge, Phase 4.1 commit graph with BFS ancestor search

### ✅ lakeFS Hooks (treeverse/lakeFS/pkg/graveler/hooks_handler.go)
- **18 event types** across 9 operations: commit, merge, create-tag, delete-tag, create-branch, delete-branch, revert, cherry-pick, plus `prepare-commit`
- **Pre-hooks return error** (can reject operation). **Post-hooks return void** (fire-and-forget notification only)
- **HookRecord** includes: RunID, EventType, Repository, SourceRef, BranchID, Commit, CommitID, TagID, MergeSource
- **Applied to MongoBranch**: Phase 5.4 expanded from 6 → 14 event types

### ✅ Neon PII Anonymization (neon.com/blog/branching-environments-anonymized-pii)
- **Static masking v1**: Runs once at branch creation, parent data untouched
- **Masking strategies**: Dummy email, dummy name, dummy phone, random value
- **Future: Dynamic masking**: Query-time masking (no storage delta) — more efficient
- **Branch-specific rules**: Each branch can have different anonymization rules
- **Applied to MongoBranch**: Phase 7.4 schema-only branching + data anonymization

### ✅ Neon Architecture (neon.com/blog/branching-environments-anonymized-pii)
- **No merge, no diff**: Branches are disposable environments, not version control
- **CoW on storage layers**: Efficient but one-directional (diverge only, never converge)
- **Scale to zero**: Compute detaches when idle — not applicable to MongoDB but TTL is
- **MongoBranch advantage**: We have full merge + diff + conflict resolution + commit history
