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

## Template

### Error: [Error message]
- **When**: [What we were doing]
- **Cause**: [Root cause]
- **Solution**: [What fixed it]
- **Date**: YYYY-MM-DD
