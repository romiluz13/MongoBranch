# Reference: Neon — Copy-on-Write Database Branching

> GitHub: https://github.com/neondatabase/neon (16K+ stars)
> Docs: https://neon.com/docs/ai/ai-database-versioning

## What Neon Is

Neon is serverless Postgres with instant copy-on-write branching:
- Branch = instant copy of entire database (near zero cost)
- Uses page-level copy-on-write (only pages that change are duplicated)
- Acquired by Databricks for $1B+ (validates the model)

## Copy-on-Write Architecture

```
Main Branch: [Page1] [Page2] [Page3] [Page4]
                ↑       ↑       ↑       ↑
Feature Branch: [  ]   [  ]   [Page3'] [  ]
                (shared) (shared) (modified) (shared)
```

- Branch creation: O(1) — just create a pointer
- Storage: Only modified pages consume space
- Read path: Check branch first, fall back to parent

## Agent Workflow (from Neon docs)

```
1. Agent receives task
2. Neon creates instant DB branch for agent
3. Agent works on isolated branch (can't break production)
4. Agent completes work
5. Human reviews branch diff
6. Merge branch → main (or discard)
```

## Key API for Branching

```bash
# Create branch from main
neonctl branches create --name feature-1

# Get connection string for branch
neonctl connection-string feature-1

# Delete branch
neonctl branches delete feature-1

# Reset branch to parent state
neonctl branches reset feature-1 --parent
```

## What MongoBranch Can Learn

1. **Instant branching UX** — must feel instant even for large DBs
2. **Zero-cost until write** — copy-on-write is essential
3. **Agent-native mindset** — built FOR agents, not adapted
4. **Simple mental model** — branch = safe sandbox

## What Neon DOESN'T Do (Our Opportunity)

- ❌ Postgres only (no MongoDB)
- ❌ No document-level diff (row-level only)
- ❌ No CLI-native workflow (API/dashboard focused)
- ❌ No multi-agent coordination
- ❌ No MCP server for branching operations
- ❌ No merge conflict resolution (schema conflicts)
