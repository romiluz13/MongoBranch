# Reference: Dolt — Git for Data

> GitHub: https://github.com/dolthub/dolt (18K+ stars)
> Blog: https://www.dolthub.com/blog/2025-12-09-ai-database/

## What Dolt Is

Dolt is a SQL database (MySQL-compatible) that implements Git semantics for data:
- `dolt branch` — create data branches
- `dolt diff` — see what changed in your data
- `dolt merge` — merge data branches
- `dolt log` — history of all data changes
- `dolt clone` — clone an entire database

## Core Architecture: Prolly Trees

Dolt uses **Prolly Trees** (probabilistic B-trees) as its core data structure:
- Content-addressed storage (like Git's object model)
- Efficient structural diff between tree versions
- O(changes) diff, not O(total data)
- Enables branch/merge without copying entire database

## Why It Matters for MongoBranch

Dolt proves the model works. Key lessons:
1. **Branch = pointer to tree root** — lightweight, instant creation
2. **Diff = structural tree comparison** — only walk changed paths
3. **Merge = three-way tree merge** — common ancestor + two branches
4. **History = linked list of commits** — each pointing to tree root

## What Dolt Gets Right
- Version control semantics are natural for developers
- AI agents can safely experiment on branches
- Human review of data changes before merge
- Full audit trail of who changed what and when

## What MongoBranch Can Learn
- Copy-on-write is essential (don't duplicate entire DB)
- Diff algorithm determines merge quality
- Conflict resolution strategy must be explicit
- CLI UX should mirror Git (familiar to devs)

## What Dolt DOESN'T Do (Our Opportunity)
- ❌ No MongoDB support (MySQL only)
- ❌ No document/JSON-native diff
- ❌ No agent-native workflows
- ❌ No MCP integration
- ❌ No Atlas/cloud-native deployment
