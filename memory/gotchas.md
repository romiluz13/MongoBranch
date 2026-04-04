# Gotchas & Known Pitfalls

> Updated as we discover issues. Check before making assumptions.

## Test Runner Gotcha
- **Use `npx vitest run` NOT `bun test`** — `bun test` uses bun's built-in runner which only discovers 15/17 files
- Test imports must use `import { ... } from "vitest"` NOT `from "bun:test"`
- The `bun test` command silently skips files with vitest imports

## MongoDB Gotchas

### Change Streams Require Replica Set
- **Problem**: `watch()` throws error on standalone MongoDB
- **Solution**: Always use `atlas deployments setup --type local` (runs replica set)
- **Alt**: Use `mongod --replSet rs0` and `rs.initiate()` manually

### Pre/Post Images Need Explicit Enable
- **Problem**: Change stream pre-images are NOT enabled by default
- **Solution**: Must run `collMod` to enable `changeStreamPreAndPostImages`
- **Gotcha**: Once enabled, increases storage usage (images stored until expiry)

### Transactions Cannot Create Indexes
- **Problem**: DDL operations (createIndex, drop) NOT allowed in transactions
- **Solution**: Index operations must happen outside transactions
- **Impact**: Branch creation must do index setup before/after data copy transaction

### Namespace Length Limit
- **Problem**: Full namespace `db.collection` max 255 bytes
- **Solution**: Keep branch names short, use abbreviations
- **Example**: `users__br_feat1` instead of `users__branch_feature-really-long-name`

### $merge Must Be Last Pipeline Stage
- **Problem**: `$merge` and `$out` must be the last stage in aggregation
- **Impact**: Can't chain merge operations in a single pipeline

### Session Timeout
- **Problem**: Transactions timeout after 60 seconds by default
- **Solution**: For large branch operations, increase `transactionLifetimeLimitSeconds`
- **Or**: Break into smaller transactions with checkpoint resume

## Architecture Gotchas

### Copy-on-Write Is Hard in MongoDB
- **Problem**: MongoDB doesn't have native page-level CoW like Neon/Postgres
- **Solution**: Implement at document level using change tracking
- **Trade-off**: More overhead than page-level, but MongoDB doesn't give us a choice

### Cross-Collection Transactions
- **Problem**: Transactions across many collections may hit oplog size limits
- **Solution**: Batch branch operations by collection, not all at once

## Development Gotchas

### Tests: Atlas Local Docker vs mongodb-memory-server
- **Port**: 27018 (NOT 27017 — avoids conflict with other local MongoDB instances!)
- **Setup**: Tests auto-detect Atlas Local Docker on localhost:27018
- **Priority**: MONGOBRANCH_TEST_URI → Atlas Local Docker:27018 → memory-server fallback
- **Atlas Local**: `docker compose up -d` → `mongodb/mongodb-atlas-local:preview` on port 27018
- **Why `preview`**: Includes MongoDB Search in Community (mongot), auto-embedding (Voyage AI),
  Atlas Search + Vector Search. Always tracks latest MongoDB version.
- **NOT `8.0`**: The `8.0` tag is a pinned stable release. `preview` gives us experimental features
  we'll need for Atlas Search branching in Wave 4.
- **Fallback**: mongodb-memory-server downloads a real mongod binary (not a mock!)
- **Difference**: Atlas Local has Atlas Search + Vector Search; memory-server does not
- **Impact**: Wave 4 (Atlas Search branching) will REQUIRE Atlas Local Docker
- **CI/CD**: Use the docker-compose.yml with GitHub Actions services

### Port Conflicts with Local MongoDB
- **Problem**: Dev machine often has MongoDB running on default port 27017
- **Solution**: MongoBranch uses port 27018 for its Atlas Local Docker
- **Lesson**: NEVER assume port 27017 is available. Always use a dedicated port.

### Atlas CLI Local Requires Docker
- **Problem**: `atlas deployments setup --type local` needs Docker running
- **Solution**: We use `docker-compose.yml` with `mongodb/mongodb-atlas-local:preview` directly
- **Alternative**: `atlas deployments setup mydev --type local` does the same thing via Atlas CLI

### Atlas Local `preview` Tag Specifics
- **What `preview` includes**: mongot (Atlas Search engine), Vector Search, auto-embedding
  (Voyage AI), latest MongoDB version, experimental features
- **What `preview` does NOT include**: Atlas Data Federation, Atlas Charts, some Atlas UI features
- **Image pulls**: Can be large (~1.5GB), first start takes 15-30 seconds for initialization
- **Health check**: Container reports `healthy` when both mongod and mongot are ready



## Agent Branch Naming
- Agent branches use `/` as namespace separator: `agent-id/task-name`
- MongoDB database names **cannot contain `/`** — we sanitize to `--` in DB names
- Branch name `agent-a/fix-data` → Database `__mb_agent-a--fix-data`
- The regex `BRANCH_NAME_REGEX` in `branch.ts` allows `/` for this purpose


## TypeScript Gotchas

### noUncheckedIndexedAccess (2026-04-03)
- Set to `false` in `tsconfig.json` — was the sole source of 89 TS2532 "Object is possibly undefined" errors
- All 89 errors were in test files doing `array[0].prop` — test code where we KNOW the array has elements
- Core source files don't rely on this setting — they have explicit null checks
- If re-enabled, add `!` (non-null assertion) after every array index access in test files

### McpToolResult Index Signature
- The MCP SDK requires tool result objects to have `[key: string]: unknown`
- Without this, TypeScript rejects `{ content: [...], isError: false }` because of excess property checking
- Fix: add `[key: string]: unknown` to the `McpToolResult` interface in `tools.ts`
