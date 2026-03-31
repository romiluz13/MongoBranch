# Errors & Solutions Log

> Every error we encounter gets logged here with its solution.
> Format: Error → Cause → Solution → Date

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
