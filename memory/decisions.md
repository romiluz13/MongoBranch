# Architecture Decisions Log

> Record of every significant decision. Never delete entries — only append.

## ADR-001: Project Name — MongoBranch
- **Date**: 2026-03-30
- **Decision**: Name the project "MongoBranch"
- **Context**: Descriptive, memorable, conveys the core concept (MongoDB + branching)
- **Alternatives**: MongoGit, MongoFork, BranchDB, AeltasDB
- **Status**: ✅ Accepted

## ADR-002: TypeScript as Primary Language
- **Date**: 2026-03-30
- **Decision**: Use TypeScript for all source code
- **Context**: MongoDB Node.js driver is first-class; TypeScript provides type safety;
  MCP SDK is TypeScript-native; CLI frameworks (Commander, Oclif) are TypeScript-native
- **Alternatives**: Go (Dolt uses Go), Rust (performance), Python (AI ecosystem)
- **Status**: ✅ Accepted

## ADR-003: Triple Distribution — CLI + MCP + Atlas Plugin
- **Date**: 2026-03-30
- **Decision**: Ship as standalone CLI, MCP server, AND Atlas CLI plugin
- **Context**: CLI for humans, MCP for AI agents, Atlas plugin for Atlas users
- **Status**: ✅ Accepted

## ADR-004: Separate Database per Branch
- **Date**: 2026-03-30
- **Decision**: Each branch gets its own MongoDB database (`__mb_{branchName}`)
- **Context**: MongoDB doesn't have native branching — we simulated with separate DBs
- **Options Evaluated**:
  - Option A: Collection prefix (`users__branch_feat1`) — rejected: messy namespace
  - **Option B: Separate database per branch** ← CHOSEN
  - Option C: Hybrid — partially adopted (metadata in `__mongobranch` DB)
- **Implementation**: `branchPrefix: "__mb_"` → branch "feature-auth" → DB `__mb_feature-auth`
- **Metadata**: Stored in `__mongobranch.branches` collection (central registry)
- **Cleanup**: `dropDatabase()` for instant branch deletion
- **Status**: ✅ Accepted — implemented in `src/core/branch.ts`

## ADR-005: Snapshot Copy for Branch Creation
- **Date**: 2026-03-30
- **Decision**: Full snapshot copy on branch create (all documents + indexes)
- **Context**: We needed a working isolation strategy for Wave 1
- **What it does**:
  - `createBranch()` copies ALL documents from source to branch DB
  - Copies ALL indexes (except `_id_`)
  - Records branch metadata (parent, collections, timestamps)
- **Trade-off**: O(n) copy is expensive for large DBs, but simple and correct
- **Future**: Wave 4 will add lazy copy-on-write (only copy on first write)
- **Status**: ✅ Accepted — implemented in `src/core/branch.ts`

## ADR-006: Atlas Local Preview on Port 27018
- **Date**: 2026-03-30
- **Decision**: Use `mongodb/mongodb-atlas-local:preview` on port 27018 for dev/test
- **Context**: Dev machine has other MongoDB instances on default port 27017
- **Why `preview`**: Includes mongot (Atlas Search), Vector Search, auto-embedding
- **Why 27018**: Avoids port conflicts with existing MongoDB instances
- **Fallback**: Tests auto-detect Docker → fall back to mongodb-memory-server
- **Status**: ✅ Accepted — implemented in `docker-compose.yml` and `tests/setup.ts`
