# Reference: Xata Agent — Autonomous Database SRE

> Blog: https://xata.io/blog/a-coding-agent-that-uses-postgres-branches
> GitHub: https://github.com/xataio/agent (open source)

## What Xata Agent Is

An open-source AI agent that acts as an autonomous DBA/SRE for Postgres:
- Creates its own database branches for each task
- Monitors database health, analyzes query performance
- Self-heals: identifies issues → creates branch → applies fix → human reviews

## Architecture

```
┌─────────────────┐
│   Xata Agent    │
│  (AI + Tools)   │
├─────────────────┤
│ Tools:          │
│ - query_db      │
│ - create_branch │
│ - run_migration │
│ - analyze_perf  │
│ - apply_fix     │
├─────────────────┤
│ Workflow:       │
│ 1. Detect issue │
│ 2. Branch DB    │
│ 3. Investigate  │
│ 4. Fix on branch│
│ 5. Human review │
│ 6. Merge or     │
│    discard      │
└─────────────────┘
```

## Key Innovation: Safe Agent Loop

The "branch first, fix second" pattern:
1. **Never modify production directly** — always branch first
2. **Agent experiments on branch** — can try multiple approaches
3. **Branch diff shows exact changes** — human can review
4. **Merge is explicit** — human approval required
5. **Rollback is free** — just delete the branch

## What MongoBranch Can Learn

1. **Agent safety pattern** — branch isolation is non-negotiable
2. **Tool-based architecture** — agent has specific DB tools, not raw access
3. **Self-healing loop** — monitor → detect → branch → fix → review
4. **Open source** — reference implementation for agent+DB branching

## What Xata DOESN'T Do (Our Opportunity)

- ❌ Postgres only (no MongoDB)
- ❌ No document-level diff (table row diffs)
- ❌ No multi-agent coordination
- ❌ No universal CLI (embedded in Xata platform)
- ❌ No MCP server (agent is embedded, not composable)
- ❌ No merge conflict resolution UI

## MongoBranch Feature Inspiration

| Xata Feature | MongoBranch Equivalent |
|-------------|----------------------|
| `create_branch` tool | `mb branch create` CLI + MCP tool |
| Query analysis | `mb analyze <branch>` for slow queries |
| Health monitoring | `mb health` for branch status |
| Auto-fix | Agent runs fixes on isolated branch |
| Branch diff | `mb diff` with document-level granularity |
