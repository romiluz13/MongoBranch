# MongoBranch — Agent Skill

> Git-like branching, diffing, merging, and version control for MongoDB data.
> 22 engines · 78 tools · Built for AI agents.

## Quick Start (2 calls)

**Start a task** — creates an isolated database branch:
```
start_task(agentId: "your-id", task: "what-you-are-doing")
```

**Complete the task** — diffs changes and optionally merges:
```
complete_task(agentId: "your-id", task: "what-you-are-doing", autoMerge: true)
```

That's it. Your changes are isolated, reviewed, and merged safely.

## When to Use MongoBranch

- **Any write to MongoDB** — always branch first, never touch production directly
- **Multi-agent work** — each agent gets its own isolated sandbox
- **Risky operations** — checkpoint before, rollback if needed
- **Data review** — diff shows exactly what changed, field by field
- **Compliance** — tamper-evident audit chain tracks everything

## All 78 Tools by Category

### 🚀 Quick Workflow (start here)
| Tool | Purpose |
|------|---------|
| `start_task` | Register agent + create branch in one call |
| `complete_task` | Diff + optional auto-merge in one call |

### 🌿 Branch Management
| Tool | Purpose |
|------|---------|
| `create_branch` | Create a named branch (with options: `from`, `readOnly`, `lazy`, `collections`, `schemaOnly`) |
| `list_branches` | List all branches with status |
| `delete_branch` | Drop a branch and its database |
| `rollback_branch` | Reset branch to match source (undo all changes) |
| `gc` | Garbage collect merged/deleted branches |
| `set_branch_ttl` | Auto-expire a branch after N minutes |
| `reset_from_parent` | Re-copy fresh data from parent branch |
| `materialization_status` | Check lazy branch copy-on-write status |
| `system_status` | System overview: active branches, storage, queue depth |

### 📊 Diff & Compare
| Tool | Purpose |
|------|---------|
| `diff_branch` | Field-level diff between two branches |
| `compare_branches` | N-way comparison matrix across multiple branches |

### 🔀 Merge
| Tool | Purpose |
|------|---------|
| `merge_branch` | Two-way merge (branch → target) with conflict strategies |
| `merge_three_way` | Git-like three-way merge using common ancestor |
| `enqueue_merge` | Add to ordered merge queue (for concurrent agents) |
| `process_merge_queue` | Process next (or all) queued merges |
| `merge_queue_status` | Show queue depth and pending merges |

### 📝 Commits & Tags
| Tool | Purpose |
|------|---------|
| `commit` | Create immutable SHA-256 commit on a branch |
| `get_commit` | Retrieve a commit by hash |
| `commit_log` | Walk commit history (most recent first) |
| `create_tag` | Named reference to a commit (immutable) |
| `list_tags` | List all tags |
| `delete_tag` | Remove a tag |
| `cherry_pick` | Apply a single commit's changes to another branch |
| `revert_commit` | Undo a commit by creating an inverse commit |

### ✏️ CRUD (Read & Write on Branches)
| Tool | Purpose |
|------|---------|
| `branch_insert` | Insert document into branch collection |
| `branch_update` | Update one document on branch |
| `branch_update_many` | Update multiple documents matching a filter |
| `branch_delete` | Delete document from branch |
| `branch_find` | Query documents on a branch |
| `branch_aggregate` | Run aggregation pipeline on branch data |
| `branch_count` | Count documents matching a filter |
| `branch_list_collections` | List all collections in a branch |
| `branch_schema` | Infer collection schema by sampling |
| `branch_oplog` | View operation log for a branch |
| `branch_undo` | Undo last N operations |

### 🕰️ Time Travel & Forensics
| Tool | Purpose |
|------|---------|
| `time_travel_query` | Query data at a past commit or timestamp |
| `blame` | Who changed each field, when, and why |
| `reflog` | Branch pointer history (survives deletion) |
| `record_snapshot` | Manually record an event in history |
| `branch_log` | Get event history for a branch |
| `export_audit_log` | Export history as JSON or CSV |

### 🚦 Deploy Requests (PR-like workflow for data)
| Tool | Purpose |
|------|---------|
| `open_deploy_request` | Propose merging source → target |
| `approve_deploy_request` | Approve a request |
| `reject_deploy_request` | Reject with reason |
| `execute_deploy_request` | Execute an approved merge |
| `list_deploy_requests` | List requests by status |

### 🛡️ Safety & Checkpoints
| Tool | Purpose |
|------|---------|
| `create_checkpoint` | Save point — snapshot current state |
| `restore_checkpoint` | Roll back to a checkpoint |
| `list_checkpoints` | List checkpoints on a branch |
| `guarded_execute` | Idempotent execution (dedup by requestId) |

### 🔒 Agent Permissions & Scoping
| Tool | Purpose |
|------|---------|
| `register_agent` | Register an agent identity |
| `create_agent_branch` | Create task branch for agent |
| `agent_status` | Agent's branches and activity |
| `set_agent_scope` | Set permissions, collection ACLs, quotas |
| `check_agent_permission` | Check if agent is allowed an operation |
| `get_agent_violations` | View permission violations |

### 🔐 Branch Protection & Hooks
| Tool | Purpose |
|------|---------|
| `protect_branch` | Protect branches by pattern (merge-only, no-delete) |
| `list_protections` | List protection rules |
| `remove_protection` | Remove a protection rule |
| `list_hooks` | List registered hooks |
| `remove_hook` | Remove a hook |
| `register_webhook` | HTTP POST on events (14 event types) |

### 📦 Stash
| Tool | Purpose |
|------|---------|
| `stash` | Save current branch state for later |
| `stash_pop` | Restore most recent stash |
| `stash_list` | List stashes |

### 🔒 Anonymize
| Tool | Purpose |
|------|---------|
| `create_anonymized_branch` | Branch with PII masked (hash/mask/null/redact) |

### 🔍 Search Indexes
| Tool | Purpose |
|------|---------|
| `list_search_indexes` | List Atlas Search/Vector indexes |
| `copy_search_indexes` | Copy index definitions between branches |
| `diff_search_indexes` | Compare index definitions |
| `merge_search_indexes` | Merge index definitions |

### 📜 Audit Chain (Tamper-Evident)
| Tool | Purpose |
|------|---------|
| `verify_audit_chain` | Verify SHA-256 hash chain integrity |
| `get_audit_chain` | View chain entries |
| `export_audit_chain_certified` | Export for compliance review |

### 👁️ Real-Time Monitoring
| Tool | Purpose |
|------|---------|
| `watch_branch` | Start change stream monitoring |
| `stop_watch` | Stop watching |
| `get_watch_events` | Get captured events |

## Workflow Examples

### Safe data modification (most common)
```
start_task(agentId: "agent-1", task: "update-prices")
branch_update(branchName: "agent-1/update-prices", collection: "products", filter: {category: "electronics"}, update: {$mul: {price: 0.9}})
complete_task(agentId: "agent-1", task: "update-prices", autoMerge: true)
```

### Checkpoint before risky operation
```
start_task(agentId: "agent-1", task: "schema-migration")
create_checkpoint(branchName: "agent-1/schema-migration", label: "before-migration")
// ... make risky changes ...
// If something goes wrong:
restore_checkpoint(branchName: "agent-1/schema-migration", checkpointId: "...")
```

### Deploy request for production
```
start_task(agentId: "agent-1", task: "fix-user-data")
// ... make changes ...
commit(branchName: "agent-1/fix-user-data", message: "Fix invalid emails")
open_deploy_request(sourceBranch: "agent-1/fix-user-data", targetBranch: "main", description: "Fix 12 invalid emails", createdBy: "agent-1")
// Human or another agent reviews and approves
approve_deploy_request(id: "...", reviewedBy: "admin")
execute_deploy_request(id: "...")
```

### Multi-agent parallel work
```
// Each agent gets isolated sandbox
Agent A: start_task(agentId: "a", task: "users")
Agent B: start_task(agentId: "b", task: "products")
// Work in parallel — no interference
Agent A: complete_task(agentId: "a", task: "users", autoMerge: true)
Agent B: complete_task(agentId: "b", task: "products", autoMerge: true)
```

## Configuration

Environment variables:
- `MONGOBRANCH_URI` — MongoDB connection string (default: `mongodb://localhost:27017`)
- `MONGOBRANCH_DB` — Source database name (default: `myapp`)

## How It Works

1. **Branch = separate MongoDB database** named `__mb_{branch-name}`
2. Data is copied server-side via `$merge` aggregation (zero client memory)
3. Changes are **completely isolated** — never affect production
4. Diff compares document-by-document with **field-level granularity**
5. Three-way merge uses common ancestor for clean auto-merge
6. Every operation is recorded in a tamper-evident SHA-256 audit chain
