# ⚠️ Reference: Argon — MongoDB Time Machine (DIRECT COMPETITOR)

> GitHub: https://github.com/argon-lab/argon
> Website: https://www.argonlabs.tech
> Language: Go (core) + Python (API) + npm/pip SDKs
> Status: Active (last push July 2025)

## CRITICAL: This is the closest existing project to MongoBranch

Argon is a "Git-like version control for MongoDB" with time travel.
We MUST study it deeply and differentiate clearly.

## What Argon Does

| Feature | Description |
|---------|-------------|
| Branching | `argon branches create staging` — instant DB clone |
| Time Travel | `argon time-travel query --lsn 1000` — query historical state |
| Restore | `argon restore reset --time "5 min ago"` — disaster recovery |
| Import | `argon import database --uri ... --database myapp` — onboard existing DB |
| Diff | `argon time-travel diff --from X --to Y` — compare across time |

## Argon Architecture

```
Client Layer:  CLI (Go) | REST API (Python/FastAPI) | SDKs (Python/JS/Go)
                                    ↓
Service Layer: Branch Engine (Go) | Storage Engine (Go) | Worker Pool (Go)
                                    ↓
Data Layer:    MongoDB (change streams + metadata) | Object Storage (S3/GCS/local)
```

### Core Components:
1. **Branch Engine** — Branch CRUD, merge, conflict resolution
2. **Storage Engine** — ZSTD compression, content-addressable, dedup
3. **Worker Pool** — Change stream processing, background tasks, GC
4. **WAL (Write-Ahead Log)** — Records all operations for time travel

### How it works:
1. App writes to MongoDB normally
2. Change stream captures the operation
3. Worker pool receives change → determines affected branches
4. Compresses and stores change in object storage
5. Updates branch metadata

## Where Argon Falls Short (OUR OPPORTUNITY)

| Gap | MongoBranch Differentiator |
|-----|---------------------------|
| ❌ No MCP server | ✅ MCP-native: agents can branch/diff/merge via tools |
| ❌ No multi-agent coordination | ✅ Per-agent branch isolation with swarm support |
| ❌ No Atlas CLI plugin | ✅ `atlas mongobranch create` integration |
| ❌ No agent identity tracking | ✅ Track which agent made which changes |
| ❌ Written in Go (harder for JS ecosystem) | ✅ TypeScript-native, npm-first |
| ❌ Requires import step | ✅ Zero-config: works on existing MongoDB directly |
| ❌ No merge conflict resolution UI | ✅ Interactive CLI conflict resolution |
| ❌ No document-level field diff | ✅ Deep document diff (field-by-field with jsondiffpatch) |
| ❌ Focused on disaster recovery | ✅ Focused on agent-native workflows |
| ❌ No hook system | ✅ Pre/post hooks for branch lifecycle events |

## Key Learnings from Argon

1. **WAL approach is validated** — intercepting writes via change streams works
2. **Object storage for branch data** — separating metadata (MongoDB) from change data (S3/local) is smart
3. **ZSTD compression** — 42%+ savings on change data
4. **Content-addressable storage** — deduplication across branches
5. **Go for performance** — but we choose TypeScript for ecosystem fit

## Our Strategic Position

Argon = **Database backup/recovery tool** with branching as a feature
MongoBranch = **Agent-native development tool** where branching IS the product

We're not competing with Argon — we're building for a different user:
- Argon user: "I need disaster recovery and time travel for my production DB"
- MongoBranch user: "I need my AI agents to safely experiment with data in isolation"
