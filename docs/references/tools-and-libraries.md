# Tools & Libraries Reference

> Libraries and tools we may use or learn from when building MongoBranch.

## JSON Diff Libraries (for Document Diff Engine)

### jsondiffpatch (⭐ 5.3K) — RECOMMENDED
- **GitHub**: https://github.com/benjamine/jsondiffpatch
- **Language**: TypeScript
- **What**: Diff & patch JavaScript objects with minimal delta format
- **Why**: Production-proven, TypeScript-native, handles nested objects, arrays
- **Install**: `npm install jsondiffpatch`
- **Key Features**:
  - Deep object comparison
  - Minimal delta format (only changes stored)
  - Reversible patches (can undo)
  - Array diff with LCS (longest common subsequence)
  - Text diff integration
  - Pluggable diff/patch pipeline

```typescript
import { diff, patch, reverse } from 'jsondiffpatch'

const before = { name: "Alice", age: 30, tags: ["dev"] }
const after = { name: "Alicia", age: 31, tags: ["dev", "lead"] }

const delta = diff(before, after)
// { name: ["Alice", "Alicia"], age: [30, 31], tags: { 1: ["lead"], _t: "a" } }

const restored = patch(structuredClone(before), delta) // === after
const undone = reverse(delta) // delta to go from after → before
```

### graphtage (⭐ 2.5K)
- **GitHub**: https://github.com/trailofbits/graphtage
- **Language**: Python
- **What**: Semantic diff for tree-like files (JSON, YAML, XML)
- **Why**: Excellent visualization, handles structural changes
- **Note**: Python-only, useful for inspiration but not direct integration

### jd (⭐ 2.2K)
- **GitHub**: https://github.com/josephburnett/jd
- **Language**: Go
- **What**: JSON diff and patch CLI
- **Why**: Clean diff format, supports YAML too
- **Note**: CLI tool, good for validation/testing

## Data Version Control Tools

### lakeFS (⭐ 5.2K)
- **GitHub**: https://github.com/treeverse/lakeFS
- **Language**: Go
- **What**: "Git for Data" — version control for data lakes
- **Why**: Pioneered branch/merge/diff for data at scale
- **Key Patterns**:
  - Copy-on-write with reference counting
  - Branch = pointer to commit, commit = pointer to data tree
  - Merge strategies: fast-forward, three-way
  - Garbage collection for orphaned data
  - Hook system (pre-commit, pre-merge)
- **Learning**: Their branching model is the gold standard for data versioning

### SirixDB (⭐ 1.2K)
- **GitHub**: https://github.com/sirixdb/sirix
- **Language**: Java/Kotlin
- **What**: Bitemporal, append-only database with versioning
- **Why**: Every write creates a new version, never overwrites
- **Key Pattern**: Append-only + structural sharing = efficient versioning
- **Learning**: Bitemporal model (transaction time + valid time)

## Change Data Capture (CDC)

### MongoDB Change Streams (Built-in)
- Native CDC for MongoDB (requires replica set)
- Pre/post images available since MongoDB 6.0
- This is our primary change tracking mechanism

### Debezium
- **GitHub**: https://github.com/debezium/debezium (⭐ 10K+)
- **What**: CDC platform for multiple databases including MongoDB
- **Why**: Captures MongoDB oplog changes and streams to Kafka
- **Learning**: Their MongoDB connector shows robust oplog tailing patterns
- **Note**: Overkill for MongoBranch but good reference for edge cases

## CLI Frameworks

### Commander.js — RECOMMENDED for v1
- Simple, widely used, TypeScript support
- Good for getting started quickly

### Oclif (by Salesforce)
- More structured, plugin system built-in
- Good for v2 if we need plugin architecture

## Agent Integration

### @modelcontextprotocol/sdk
- Official MCP SDK for building MCP servers
- TypeScript-native, well documented
- Required for our MCP server integration

### AgentAPI (Coder) (⭐ 1.3K)
- **GitHub**: https://github.com/coder/agentapi
- **What**: HTTP wrapper for CLI agents
- **Why**: Could wrap MongoBranch CLI for programmatic access
