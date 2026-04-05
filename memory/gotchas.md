# Gotchas & Known Pitfalls

> Updated as we discover issues. Check before making assumptions.

## Test Runner Gotcha
- **Use `bun run test`** as the canonical full-suite command in this repo
- `package.json` maps `test` → `vitest run`, which is the real full suite used for release-grade verification
- `bun test <file>` is acceptable for small targeted checks, but do **not** rely on plain `bun test` as the repo-wide validation signal here
- Test imports must use `import { ... } from "vitest"` NOT `from "bun:test"`

### Standalone Verification vs Final State Assertions
- A later stale 2-way merge can overwrite unrelated collections back to an older snapshot
- Impact: In standalone stress scripts, assert collection-specific success immediately after the relevant merge, not only at the very end of a long multi-branch scenario
- Example: pricing merge can correctly raise product count to `4`, then a later stale HR 2-way merge can bring products back to `3` by design

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


### Database Name Character Restrictions (CRITICAL)
- **Official docs**: mongodb.com/docs/manual/reference/limits/
- **Unix/Linux**: Database names CANNOT contain `/\. "$`
- **Windows**: Also cannot contain `*<>:|?`
- **Impact**: Branch names like `agent/task` or `feat.v2` produce invalid DB names
- **Solution**: Use `sanitizeBranchDbName()` from `types.ts` — replaces `/` → `--` and `.` → `-dot-`
- **EVERY module** that constructs a DB name from branch names MUST use this function
- **Fixed in**: `beec933` — 8 locations across 7 files were missing sanitization

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
- **Port**: 27017 is the default Atlas Local Docker port for this repo
- **Setup**: Tests auto-detect Atlas Local Docker on localhost:27017, then try localhost:27018 as a legacy/custom fallback
- **Priority**: MONGOBRANCH_TEST_URI → Atlas Local Docker:27017 → Atlas Local Docker:27018 → memory-server fallback
- **Atlas Local**: `docker compose up -d` → `mongodb/mongodb-atlas-local:preview` on port 27017
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
- **Solution**: MongoBranch standardizes on port 27017 in docs/docker, but the test harness also checks 27018 for legacy/custom local setups
- **Lesson**: Prefer the documented default first, but keep explicit fallback logic in test infrastructure

### Change Stream Shutdown Noise
- **Problem**: Closing a MongoDB change stream during intentional watcher shutdown can surface `ChangeStream is closed` in the async iterator path
- **Official docs**: The Node.js driver docs recommend calling `close()` to stop processing and free resources
- **Solution**: Suppress watcher warnings when the close was initiated by `stop()`; only warn for unexpected live-stream failures

### Creating Users/Roles Is Not The Same As Enforcing RBAC
- Atlas Local in this workspace accepts `createUser` and `createRole`, but a restricted user can still write outside its granted role if access control is not actually enforced
- Practical rule: trust the live restricted-user probe (`mb access status` / `mb doctor`) more than successful provisioning
- Production implication: provisioning alone gives MongoBranch a `managed` path, not automatically an `enforced` one

### `active-context.md` Is Not An Archive
- `memory/active-context.md` should describe the repo's current verified state only
- Historical milestones, superseded counts, and old port defaults belong in `memory/decisions.md`, not in the active context snapshot
- Public docs should follow the same rule: landing/README claims must match the latest verified evidence and caveats

### MongoDB Database-Scoped Role Resources Need `collection: ""`
- When defining RBAC privileges for a whole database, MongoDB rejects resource specs shaped like just `{ db: "mydb" }`
- Practical rule: database-scoped resource documents should use `{ db: "mydb", collection: "" }`
- Symptom: `resource pattern must contain 'collection' or 'systemBuckets' specifier`

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

## Product Strategy Gotchas

### Atlas App Services / Data API Are A Dead-End Foundation
- MongoDB Atlas App Services capabilities including Data API, GraphQL, HTTPS Endpoints, Device Sync, and related surfaces reached EOL on **September 30, 2025**
- Database triggers remain available, but broader App Services is not a safe primary platform bet for MongoBranch
- Practical rule: do **not** design MongoBranch's long-term architecture around App Services or Data API replacement assumptions

### MongoDB Already Solves More Infra Than It First Appears
- Atlas Search, Vector Search, Hybrid Search, Automated Embeddings, Atlas Stream Processing, Atlas Local, and the MongoDB MCP Server already cover major chunks of "AI database platform" surface area
- Practical rule: differentiate on **agent governance and control-plane workflows**, not by rebuilding search, embeddings, or generic event infrastructure



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

## Current Semantic Gotchas (2026-04-05)

### Policy Enforcement Lives In MongoBranch, Not Native MongoDB
- Protection rules and agent scopes are enforced in `BranchProxy` and the MCP CRUD tool path, not by MongoDB server-side branch primitives
- Practical rule: if you want protection/scope guarantees, agent writes must go through MongoBranch APIs instead of raw `client.db(...).collection(...)` access

### Stored Commit Snapshot Data Is Now a Required Semantic Dependency
- Accurate ancestor-backed three-way merge, cherry-pick, revert, and time-travel behavior now rely on `commit_data`
- Practical rule: do **not** treat `commit_data` as optional cache data for non-empty commits; if it is missing, merge-base reconstruction should fail loudly instead of silently using the wrong base

### `listCollections()` Cannot Run Inside MongoDB Transactions
- Live validation hit `MongoServerError: Cannot run 'listCollections' in a multi-document transaction`
- Practical rule: transactional commits must precompute their candidate collection set outside the transaction, then query those collections with the shared session inside the transaction
- Additional rule: if a transactional workflow may create or touch new collections, pass those collection names explicitly so the snapshot includes them

### Parallel Test Cleanup Must Not Drop `__mongobranch`
- `bun run test` runs suites in parallel, and they share the metadata database
- Practical rule: test cleanup may drop branch databases (`__mb_*`), but it should only clear collections inside `__mongobranch` rather than dropping the metadata DB itself

### Temporary Merge Databases Must Stay Well Below The 64-Byte DB Name Limit
- Ancestor materialization for three-way merge creates temporary databases
- Practical rule: never derive those temp DB names from long configurable strings like `metaDatabase`; use a short fixed prefix plus a hashed suffix

### `main` Is Now A Real Ancestry Source
- Branches created from `main` now inherit a bootstrap/main head commit instead of starting from an ancestry vacuum
- Practical rule: tests and tooling should no longer assume the first branch-local commit has zero parents or that a branch created from `main` has an empty log

### Deploy Requests Fail Closed On Stale Conflicts
- Deploy execution now uses three-way merge with `manual` conflict handling
- Practical rule: an approved deploy request can still fail at execution time if `main` changed concurrently; that is the intended safety behavior, not a flaky merge

### Installed CLIs Are Bun-First
- `mb` and `mongobranch-mcp` now use Bun shebangs, which matches the repo’s declared runtime
- Practical rule: do not advertise or assume generic Node CLI support unless the package ships compiled JavaScript or verified Node-compatible execution paths

### Atlas Local Search Capability Needs A Real Round-Trip Probe
- Some Atlas Local builds accept `createSearchIndex()` but return empty results from `listSearchIndexes()` and reject `dropSearchIndex()` for the same name
- Practical rule: before trusting search-index automation in tests or demos, verify create/list/drop end-to-end on a scratch collection in the actual target environment

### Atlas Local Preview Should Be Validated With `mb doctor`
- MongoBranch now has a first-class environment probe for Atlas Local preview
- Practical rule: before using preview surfaces in a fresh environment, run `mb doctor` or MCP `environment_doctor`
- The doctor validates runtime behavior for transactions, db-level change streams, pre-images, Atlas Search, and Atlas Vector Search instead of trusting static setup assumptions

### Atlas Local Approval Requires A Live Enforcement Probe
- A deployment that can `createUser` and `createRole` is still not approval-grade if the restricted-user probe says `enforced: false`
- Practical rule: only treat Atlas Local as production-ready for core agent workflows when `mb doctor` passes and `mb access status` returns `enforced: true`
- The new `mb init --start-local` flow is the preferred way to bootstrap that stronger profile in a fresh Bun workspace

### Containerized Backup Tools Must Use The Container's MongoDB Port
- External workspaces may connect to Atlas Local through a host-mapped port such as `27027`
- Practical rule: `mongodump` / `mongorestore` executed with `docker exec` must target the container's internal MongoDB port (`27017`), not the host-mapped port
- Additional rule: pass dump/restore connection info to `docker exec` explicitly with `-e`, because container exec does not inherit host env vars

### Deploy Drift Detection Should Use `operationTime`, Not Idle Resume-Token Equality
- Atlas Local can advance cold-cursor resume tokens even when no user-visible write occurred
- Practical rule: for approval fences, use the MongoDB `operationTime` of the approval write and query later changes with `startAtOperationTime`
- MongoBranch now uses that pattern for protected deploy execution

### Drift Baselines Depend On The Oplog Window
- MongoDB documents that `startAtOperationTime` must still fall within the oplog time range
- Practical rule: drift baselines are review fences, not permanent attestations; if a baseline is too old to resume from, capture a fresh baseline instead of trusting a stale one
- MongoBranch drift checks should be used close to review/approval time, especially in Atlas Local environments with shorter oplog histories
