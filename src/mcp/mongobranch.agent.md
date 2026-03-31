# MongoBranch — Agent Skill

> Git-like branching for MongoDB data. Safe experimentation for AI agents.

## When to Use

Use MongoBranch whenever you need to modify MongoDB data and want:
- **Safety** — work in an isolated copy, never touch production
- **Review** — see exactly what changed before committing
- **Rollback** — discard changes by deleting the branch
- **Multi-agent** — multiple agents work concurrently without conflicts

## Quick Start (2 calls)

### 1. Start a task
```
start_task(agentId: "your-agent-id", task: "describe-what-you-are-doing")
```
This creates an isolated branch with a **full copy** of the database.
All your reads and writes happen on `__mb_{agentId}--{task}` database.

### 2. Complete the task
```
complete_task(agentId: "your-agent-id", task: "describe-what-you-are-doing", autoMerge: true)
```
This diffs your changes against main and merges them if `autoMerge: true`.
Set `autoMerge: false` to review the diff first without merging.

## All Available Tools

| Tool | Purpose |
|------|---------|
| `start_task` | **Recommended entry point** — register + branch in one call |
| `complete_task` | **Recommended exit point** — diff + optional merge in one call |
| `create_branch` | Create a named branch (manual control) |
| `list_branches` | List all branches with status |
| `diff_branch` | Compare two branches (field-level detail) |
| `merge_branch` | Apply branch changes to a target |
| `delete_branch` | Drop a branch and its database |
| `register_agent` | Register an agent identity |
| `create_agent_branch` | Create a task branch for a registered agent |
| `agent_status` | Check agent's active branches and activity |

## Workflow Examples

### Safe data migration
```
1. start_task(agentId: "migrator", task: "add-email-index")
2. // Connect to __mb_migrator--add-email-index database
3. // Run your migration scripts against that database
4. complete_task(agentId: "migrator", task: "add-email-index")
5. // Review the diff output
6. merge_branch(source: "migrator/add-email-index", into: "main")
```

### Multi-agent collaboration
```
Agent A: start_task(agentId: "agent-a", task: "update-users")
Agent B: start_task(agentId: "agent-b", task: "update-products")
// Both work in parallel on isolated branches
Agent A: complete_task(agentId: "agent-a", task: "update-users", autoMerge: true)
Agent B: complete_task(agentId: "agent-b", task: "update-products", autoMerge: true)
```

### Inspect before merge
```
1. start_task(agentId: "careful-agent", task: "risky-change")
2. // Make changes
3. complete_task(agentId: "careful-agent", task: "risky-change", autoMerge: false)
4. // Read the diff JSON — decide if it looks right
5. merge_branch(source: "careful-agent/risky-change", into: "main")
// OR: delete_branch(name: "careful-agent/risky-change")  // discard
```

## Configuration

MCP server config via environment variables:
- `MONGOBRANCH_URI` — MongoDB connection string (default: `mongodb://localhost:27018`)
- `MONGOBRANCH_DB` — Source database name (default: `myapp`)

Or create `.mongobranch.yaml` in the project root:
```yaml
uri: mongodb://localhost:27018/?directConnection=true
sourceDatabase: myapp
metaDatabase: __mongobranch
branchPrefix: __mb_
```

## How Branching Works

1. **Branch = separate MongoDB database** named `__mb_{branch-name}`
2. On create, all collections + indexes are **fully copied** from source
3. Changes on a branch are **completely isolated** — they never affect main
4. Diff compares document-by-document with **field-level granularity**
5. Merge applies inserts, deletes, and updates from branch → target

## Agent Identity

- Each agent gets a unique `agentId` (e.g., `claude-code-1`, `codex-prod`)
- Branches are namespaced: `{agentId}/{task}`
- One agent can have multiple active branches (parallel tasks)
- Agent registry tracks activity and branch ownership
