# Errors & Solutions Log

> Every error we encounter gets logged here with its solution.
> Format: Error → Cause → Solution → Date

## Known Pre-Existing Failures (Not Our Bugs)

### Stress Tests (7 failures) — Pre-existing with mongodb-memory-server
- **Date**: 2026-03-31
- **Tests**: All 7 in `tests/core/stress.test.ts`
- **Root cause**: Race condition in `cleanupBranches` — DB being dropped while collections created
- **Error**: `Cannot create collection X - database is in the process of being dropped`
- **Fix**: Use `docker compose up -d` (Atlas Local Docker) or add retry logic. LOW priority.

## Wave 4 Errors

### Error: External Bun consumer app could not import `mongobranch/drift`
- **When**: First run of the new auth-enabled external dogfood scenario in `/Users/rom.iluz/Dev/mongobranch-auth-dogfood`
- **Cause**: `DriftManager` existed in the repo, but `package.json` did not export the `./drift` subpath
- **Solution**: Add `./drift` to the package exports map and re-run the real external scenario
- **Date**: 2026-04-05

### Error: Backup drill failed because `docker exec` did not receive host env vars
- **When**: First backup/restore attempt in the new external dogfood scenario
- **Cause**: `docker exec` does not inherit the host process environment, so the containerized `mongodump` call never received the authenticated MongoDB URI
- **Solution**: Pass `-e MONGO_URI=...` and `-e MONGO_DB=...` directly to `docker exec`
- **Date**: 2026-04-05

### Error: Backup drill used the host-mapped Atlas Local port from inside the container
- **When**: Second backup/restore attempt in the new external dogfood scenario
- **Cause**: The external workspace connects through host port `27027`, but tools running inside the Atlas Local container must connect to the internal MongoDB port `27017`
- **Solution**: Rewrite the dump/restore URI for in-container execution to use `localhost:27017`
- **Date**: 2026-04-05

### Error: RBAC role creation failed on database-scoped privileges
- **When**: First implementation of `AccessControlManager`
- **Cause**: MongoDB rejected database-scoped resource documents shaped like `{ db: "mydb" }`
- **Error**: `MongoServerError: resource pattern must contain 'collection' or 'systemBuckets' specifier`
- **Solution**: Use the MongoDB database-resource shape `{ db: "mydb", collection: "" }` for database-scoped actions, reserve `{ cluster: true }` for cluster privileges, and keep collection-scoped resources explicit
- **Date**: 2026-04-05

### Error: Idle resume-token equality produced false stale-deploy signals
- **When**: First implementation of the deploy approval drift gate
- **Cause**: Atlas Local can advance idle cursor resume tokens without a user-visible write, so comparing cold-cursor resume tokens was too noisy
- **Solution**: Fence approvals with the `operationTime` of the approval write and detect later drift via `startAtOperationTime` change streams on the source/target databases
- **Date**: 2026-04-05

### Error: Strict TypeScript rejected the first Atlas Local doctor probes
- **When**: Implementing `EnvironmentDoctor`
- **Cause**: The MongoDB driver inferred `ObjectId`-typed `_id` fields on generic collections and exposes database-level change stream events as a union where `ns` may not include `coll`
- **Solution**: Use explicit probe-key fields instead of string `_id` assumptions, guard `ns.coll` access, and type search-index polling metadata explicitly
- **Date**: 2026-04-05

### Error: `listCollections()` cannot run inside a multi-document transaction
- **When**: First attempt to make `CommitEngine.commit()` fully transactional during the second skeptical repair pass
- **Cause**: Snapshot creation tried to call `db.listCollections(..., { session })` inside `withTransaction()`
- **Error**: `MongoServerError: Cannot run 'listCollections' in a multi-document transaction.`
- **Solution**: Precompute the collection set outside the transaction, then read those collections inside the shared session; transactional callers also pass touched collection names so uncommitted new collections are still captured
- **Date**: 2026-04-05

### Error: Shared metadata DB was being dropped during parallel full-suite runs
- **When**: Running `bun run test` after the semantic repair pass
- **Cause**: `cleanupBranches()` dropped the shared `__mongobranch` database while other Vitest files were still creating collections inside it
- **Error**: `Cannot create collection __mongobranch.<name> - database is in the process of being dropped`
- **Solution**: Drop only branch databases (`__mb_*`) and clear collections inside `__mongobranch` instead of dropping the metadata database itself
- **Date**: 2026-04-05

### Error: `merge()` with `conflictStrategy: "abort"` could still mark a branch as merged
- **When**: Running a standalone 10-turn real-world scenario after fully cleaning local MongoDB
- **Cause**: Conflict detection populated `conflicts`, but the 2-way merge path still proceeded into the transaction and branch status update path instead of exiting before any writes
- **Solution**: Return early with `success: false` when `detectConflicts` is enabled, conflicts exist, and the strategy is `abort`; added a regression test in `tests/core/merge.test.ts`
- **Date**: 2026-04-05

### Error: Deploy requests could overwrite newer `main` data with stale branch state
- **When**: External dogfood scenario in `/Users/rom.iluz/Dev/mongobranch-production-lab`
- **Cause**: `DeployRequestManager.execute()` used the blind 2-way merge path, while branches from `main` had no tracked shared ancestor with `main`
- **Solution**: Bootstrap `main` history on first branch creation, resolve `main` head commits in `CommitEngine`, and execute deploy requests through `threeWayMerge()` with manual conflict blocking
- **Date**: 2026-04-05

### Error: Installed CLI crashed from an external workspace on `./types.js` resolution
- **When**: Running `mb status` and `mb branch list` from the external dogfood app
- **Cause**: `src/core/search-index.ts` imported local project types via `./types.js` even though the package ships TypeScript source
- **Solution**: Fix the import to `./types.ts`, switch CLI/MCP entrypoints to Bun shebangs, and align package runtime metadata with Bun-first execution
- **Date**: 2026-04-05

### Error: Branch blame attributed unchanged fields to inherited `main` bootstrap history
- **When**: Full-suite verification after adding real `main` ancestry
- **Cause**: `TimeTravelEngine.findCreationCommit()` picked the oldest commit in the full ancestor chain, which became the bootstrap `main` commit
- **Solution**: Prefer the earliest branch-local commit that contains the document, then fall back to the older shared history only if needed
- **Date**: 2026-04-05

### Error: Atlas Local accepted `createSearchIndex()` but never surfaced the created index
- **When**: Reproducing search-index failures outside Vitest after the production hardening pass
- **Cause**: This Atlas Local build exposes search-index commands but does not reliably persist/list created indexes
- **Solution**: Strengthen the search-index capability probe in `tests/core/search-index.test.ts` and skip those tests unless create/list/drop works end-to-end on a scratch collection
- **Date**: 2026-04-05

### Error: Full-suite verification looked incomplete when invoked with `bun test`
- **When**: Post-fix validation of the whole repo after the standalone scenario passed
- **Cause**: This repo’s real full-suite entrypoint is the package script `bun run test` → `vitest run`; plain `bun test` can produce misleading partial output in this project
- **Solution**: Use `bun run test` for the full suite, and reserve `bun test <file>` for small targeted checks only
- **Date**: 2026-04-05

### CommitEngine.resolveBranchDb used wrong DB naming pattern
- **Error**: Snapshot was empty, tests timing out
- **Cause**: CommitEngine used `sourceDatabase__branch__name` but BranchManager uses `branchPrefix + name`
- **Solution**: Changed to look up `branchDatabase` from BranchMetadata collection
- **Date**: 2026-03-31

### Three-Way Merge used string _id for MongoDB queries
- **Error**: Conflict resolution didn't apply — updateOne matched 0 documents
- **Cause**: `buildDocMap` stored `_id.toString()` as key, but conflict `documentId` was string, not ObjectId
- **Solution**: Pass original `_id` from doc to conflict objects instead of string key
- **Date**: 2026-03-31

---

### Error: "MongoDB not started. Call startMongoDB() first."
- **When**: Running tests with Atlas Local Docker (instead of mongodb-memory-server)
- **Cause**: `getTestEnvironment()` checked `!replSet` which is null when using Atlas Local
  Docker (replSet is only set for mongodb-memory-server fallback). Also `replSet.getUri()`
  was called for the return URI, which fails when replSet is null.
- **Solution**: Track `currentUri` separately from `replSet`. Check `!client || !currentUri`
  instead of `!client || !replSet`.
- **Date**: 2026-03-30

### Error: Tests connected to wrong MongoDB (port 27017 instead of 27018)
- **When**: First run after adding Atlas Local Docker support
- **Cause**: User has other MongoDB instances on default port 27017. Test setup tried 27017
  first and connected to the wrong MongoDB.
- **Solution**: Use port 27018 for MongoBranch Atlas Local Docker (docker-compose.yml maps
  27018→27017). Also had a hardcoded "localhost:27017" in a log message that was misleading.
- **Date**: 2026-03-30

### Error: `BranchWatcher` logged `ChangeStream is closed` on intentional stop
- **When**: Running watcher tests and normal shutdown paths against Atlas Local change streams
- **Cause**: `stop()` called `changeStream.close()`, but the async iterator catch path still logged the close as if it were an unexpected stream error
- **Solution**: Track the active stream instance locally, clear it before close in `stop()`, and suppress warnings unless the stream is still active and `running`
- **Date**: 2026-04-04

### Error: Documentation drift around Atlas Local port and test totals
- **When**: Post-validation pass against official MongoDB web docs and live local runtime
- **Cause**: Legacy docs still referenced port `27018` as the primary Atlas Local port and stale totals like `308 tests`
- **Solution**: Re-sync docs and memory to the validated default of `27017`, keep `27018` only as fallback, and update public totals to the full validated suite result of 325 tests
- **Date**: 2026-04-04

### Error: Public docs and active context drifted behind the current verified evidence
- **When**: Documentation hygiene pass after access-control and external dogfood validation
- **Cause**: `landing/index.html` and `memory/active-context.md` still carried older counts and stronger claims than the current Atlas Local proof
- **Solution**: Re-sync public messaging and internal context to the current evidence: `339` tests, `87` MCP tools, `26` engines, Atlas Local default `27017`, and explicit wording that server-side direct-write prevention depends on MongoDB access control actually being enforced
- **Date**: 2026-04-05

## Template

### Error: [Error message]
- **When**: [What we were doing]
- **Cause**: [Root cause]
- **Solution**: [What fixed it]
- **Date**: YYYY-MM-DD
