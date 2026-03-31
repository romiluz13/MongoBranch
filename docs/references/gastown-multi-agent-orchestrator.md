# Reference: Gas Town — Multi-Agent Orchestrator

> Author: Steve Yegge (ex-Google, ex-Amazon, Sourcegraph)
> Concept: Coordinate multiple AI coding agents working on the same project

## What Gas Town Is

A multi-agent workspace manager that:
- Runs Claude Code, Copilot, Codex, Gemini — all simultaneously
- Each agent gets isolated workspace + DB branch
- Uses "Beads" — a shared memory system backed by git
- Coordinates agents working on different aspects of a project

## Key Architecture Concepts

### Isolated Workspaces
```
Agent-1 (Backend):  /workspace/agent-1/  + db-branch-agent-1
Agent-2 (Frontend): /workspace/agent-2/  + db-branch-agent-2
Agent-3 (DB):       /workspace/agent-3/  + db-branch-agent-3
Coordinator:        Merges all branches when tasks complete
```

### Beads (Shared Memory)
- Git-backed key-value store
- Agents can read/write shared context
- Merge conflicts resolved by coordinator
- Acts as "team knowledge" across agents

### Coordination Loop
1. Coordinator receives task
2. Breaks into subtasks
3. Assigns each subtask to an agent
4. Each agent works on isolated workspace + DB branch
5. Agents signal completion
6. Coordinator reviews diffs
7. Merges all branches

## What MongoBranch Can Learn

1. **Multi-agent is the future** — single-agent is already outdated
2. **Per-agent DB isolation is required** — agents will corrupt shared state
3. **Merge coordination needs a brain** — not just auto-merge
4. **Shared memory enables collaboration** — agents need to communicate

## MongoBranch Multi-Agent Architecture

```
┌─────────────────────────────┐
│     MongoBranch Coordinator │
│  (assigns branches, merges) │
└─────┬───────┬───────┬───────┘
      │       │       │
┌─────┴──┐ ┌──┴──┐ ┌──┴──────┐
│Agent-1 │ │A-2  │ │Agent-3  │
│branch: │ │br:  │ │branch:  │
│feat-1  │ │ft-2 │ │feat-3   │
│(Claude)│ │(Gem)│ │(Codex)  │
└────────┘ └─────┘ └─────────┘
```

Each agent gets:
- Own MongoDB branch (isolated namespace)
- Own change stream (tracked modifications)
- Merge request when done
- Coordinator handles conflicts

## What Gas Town DOESN'T Do (Our Opportunity)

- ❌ No MongoDB-native branching (uses file system)
- ❌ No data-level conflict resolution
- ❌ No CLI tool (conceptual/embedded)
- ❌ No MCP server for coordination
