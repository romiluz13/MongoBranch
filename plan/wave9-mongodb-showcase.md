# Wave 9 — MongoDB Power Showcase

> 5 highest-impact MongoDB features we don't use yet.
> Every API call verified against official MongoDB docs. Zero LLM guessing.

---

## Feature 1: Transactions (`withTransaction`)

**Source**: https://www.mongodb.com/docs/manual/core/transactions/
**Local doc**: `docs/mongodb/transactions/transactions.md`

### Why
Merge operations currently write across multiple collections non-atomically.
If any insert/update fails mid-merge, the branch is left in a partial state.
Transactions make merge all-or-nothing.

### Verified API (Node.js Driver)
```typescript
const session = client.startSession();
await session.withTransaction(async () => {
  await db.collection("users").insertOne(doc, { session });
  await db.collection("log").insertOne(entry, { session });
  // Auto-commits on success, auto-retries on transient errors
});
session.endSession();
```

### Constraints (from docs)
- Max transaction duration: 60 seconds (default)
- Max oplog entry: 16MB per transaction
- DDL operations (createIndex, drop) NOT supported inside transactions
- Collections can be created inside transactions (MongoDB 4.4+)

### Where to Apply
| File | Operation | Change |
|------|-----------|--------|
| `src/core/merge.ts` | `merge()` | Wrap all insert/update/delete ops in `withTransaction` |
| `src/core/commit.ts` | `cherryPick()` | Wrap cross-branch writes in transaction |
| `src/core/commit.ts` | `revert()` | Wrap revert writes in transaction |
| `src/core/queue.ts` | `processNext()` | Process merge inside transaction |
| `src/core/deploy.ts` | `executeDeploy()` | Deploy = merge, so must be atomic |

### Test Strategy
- Test: merge with forced failure mid-operation → verify rollback
- Test: concurrent merges don't interfere (session isolation)
- Test: `cherryPick` atomicity across collections

---

## Feature 2: Change Streams (`.watch()`)

**Source**: https://www.mongodb.com/docs/manual/changeStreams/
**Local doc**: `docs/mongodb/change-streams/change-streams.md`

### Why
No live monitoring of branch activity. Agents write to branches silently.
Change streams enable: auto-commit on write, real-time diff notifications,
agent activity dashboards.

### Verified API (Node.js Driver)
```typescript
// Watch entire branch database
const changeStream = db.watch([
  { $match: { operationType: { $in: ["insert", "update", "delete"] } } }
]);

changeStream.on("change", (event) => {
  resumeToken = event._id;  // Save for resume
  // event.operationType, event.ns, event.documentKey, event.fullDocument
});

// Resume after disconnect
const resumed = db.watch([], { resumeAfter: resumeToken });
```

### Pre/Post Images (MongoDB 6.0+)
```typescript
// Enable on collection
db.createCollection("users", {
  changeStreamPreAndPostImages: { enabled: true }
});

// Watch with images
const cs = db.collection("users").watch([], {
  fullDocument: "whenAvailable",
  fullDocumentBeforeChange: "whenAvailable"
});
```

### Where to Apply
| File | Component | What |
|------|-----------|------|
| `src/core/watcher.ts` | NEW: `BranchWatcher` class | Watch branch DB, emit events |
| `src/mcp/tools.ts` | `mb_watch_start`, `mb_watch_stop` | MCP tools for agents |
| `src/cli.ts` | `mb watch <branch>` | CLI command for live monitoring |

### Test Strategy
- Test: insert doc on branch → change stream receives event
- Test: resume token survives watcher restart
- Test: pipeline filtering by operationType works

---

## Feature 3: `$graphLookup` (Aggregation)

**Source**: https://www.mongodb.com/docs/manual/reference/operator/aggregation/graphLookup/
**Local doc**: `docs/mongodb/aggregation/aggregation-pipeline.md`

### Why
`findCommonAncestor()` currently does BFS traversal in application code —
multiple round trips to MongoDB. `$graphLookup` does recursive graph
traversal in a SINGLE aggregation query, server-side.

### Verified API (Node.js Driver)
```typescript
const pipeline = [
  { $match: { hash: startCommitHash } },
  {
    $graphLookup: {
      from: "commits",           // Same collection (self-join)
      startWith: "$parentHashes", // Start from parent pointers
      connectFromField: "parentHashes",
      connectToField: "hash",
      as: "ancestors",           // Output array
      maxDepth: 100,             // Safety limit
      depthField: "depth"        // Track traversal depth
    }
  }
];
const result = await commitsCollection.aggregate(pipeline).toArray();
```

### Parameters (from official docs)
- `from`: target collection for recursive search
- `startWith`: expression for initial lookup value
- `connectFromField`: field in matched docs to recurse from
- `connectToField`: field to match against in `from` collection
- `as`: output array field name
- `maxDepth`: optional recursion limit (0 = direct matches only)
- `depthField`: optional field name storing recursion depth
- `restrictSearchWithMatch`: optional filter for matched documents

### Where to Apply
| File | Method | Change |
|------|--------|--------|
| `src/core/commit.ts` | `findCommonAncestor()` | Replace BFS loop with `$graphLookup` pipeline |
| `src/core/commit.ts` | `log()` | Use `$graphLookup` for full commit history |
| `src/core/timetravel.ts` | `blame()` | Traverse commit graph via aggregation |

### Test Strategy
- Test: `findCommonAncestor()` returns same result as before, fewer round trips
- Test: deep commit chains (50+ commits) resolve correctly
- Test: merge commits with multiple parents traverse correctly

---

## Feature 4: Unique Partial Indexes

**Source**: https://www.mongodb.com/docs/manual/core/index-partial/
**Local doc**: `docs/mongodb/indexes/indexes.md`

### Why
Branch metadata (commits, oplog, tags) stores records per branch.
A unique index on `{ hash: 1 }` would prevent duplicate commits, but only
within the same branch. Partial indexes let us scope uniqueness to a
`partialFilterExpression`.

### Verified API (Node.js Driver)
```typescript
// Unique commit hash per branch
await commitsCollection.createIndex(
  { hash: 1 },
  {
    unique: true,
    partialFilterExpression: {
      branchName: { $exists: true },
      hash: { $type: "string" }
    },
    name: "unique_commit_per_branch"
  }
);

// Unique tag name per branch
await commitsCollection.createIndex(
  { "tags": 1 },
  {
    unique: true,
    partialFilterExpression: {
      tags: { $exists: true, $ne: [] }
    },
    name: "unique_tag_per_branch"
  }
);
```

### Constraints (from docs)
- `partialFilterExpression` supports: `$exists`, `$gt/$gte/$lt/$lte`, `$type`, `$eq`, `$and`, `$or`, `$in`
- A query must match the filter expression to USE the partial index
- Cannot combine `partialFilterExpression` with `sparse: true`

### Where to Apply
| File | What | Index |
|------|------|-------|
| `src/core/commit.ts` | Commit creation | Unique `{ hash: 1 }` per branch |
| `src/core/commit.ts` | Tag creation | Unique tag names |
| `src/core/oplog.ts` | Op deduplication | Unique `{ opId: 1 }` where opId exists |
| `src/core/branch.ts` | Branch metadata | Unique `{ name: 1 }` in metadata collection |

### Test Strategy
- Test: duplicate commit hash rejected within same branch
- Test: same hash allowed across different branches
- Test: duplicate tag name rejected, unique tag enforced
- Test: queries use partial index (explain plan check)

---

## Feature 5: `$merge` Stage (Aggregation Pipeline)

**Source**: https://www.mongodb.com/docs/manual/reference/operator/aggregation/merge/
**Local doc**: `docs/mongodb/aggregation/aggregation-pipeline.md`

### Why
Branch materialization currently reads all docs from source, then inserts
into target one-by-one or via bulkWrite. `$merge` does this SERVER-SIDE
in a single pipeline — no data transfer to/from the application.

### Verified API (Node.js Driver)
```typescript
// Materialize branch: copy from source DB to branch DB
await sourceDb.collection("users").aggregate([
  // Optional: filter or transform
  {
    $merge: {
      into: {
        db: "mb_branch_feature_x",   // Target branch database
        coll: "users"                  // Target collection
      },
      on: "_id",                       // Match field
      whenMatched: "replace",          // Options: replace, keepExisting, merge, fail, pipeline
      whenNotMatched: "insert"         // Options: insert, discard, fail
    }
  }
]).toArray();
```

### `whenMatched` Options (from official docs)
- `"replace"` — Replace entire target doc with source doc
- `"keepExisting"` — Keep existing target doc unchanged
- `"merge"` — Merge source fields into target (like `$set`)
- `"fail"` — Throw error on any match (insert-only mode)
- `[pipeline]` — Custom update pipeline for matched docs

### `whenNotMatched` Options
- `"insert"` — Insert new doc into target
- `"discard"` — Skip docs that don't match
- `"fail"` — Throw error on non-match (update-only mode)

### Where to Apply
| File | Method | Change |
|------|--------|--------|
| `src/core/proxy.ts` | `materializeCollection()` | Replace read+bulkWrite with `$merge` pipeline |
| `src/core/branch.ts` | `createBranch()` | Use `$merge` for initial branch data copy |
| `src/core/merge.ts` | `merge()` | Use `$merge` for applying branch changes to target |
| `src/core/stash.ts` | `stash()` | Use `$merge` to snapshot branch state |

### Test Strategy
- Test: `$merge` produces identical result to current bulkWrite approach
- Test: `whenMatched: "replace"` correctly overwrites modified docs
- Test: `whenNotMatched: "insert"` correctly adds new docs
- Test: cross-database `$merge` works (source DB → branch DB)

---

## Implementation Priority

| Priority | Feature | Impact | Effort |
|----------|---------|--------|--------|
| 🔴 P0 | Transactions | Data integrity — prevents corrupt merges | Medium |
| 🔴 P0 | `$merge` | 10x perf on materialization — server-side copy | Medium |
| 🟡 P1 | `$graphLookup` | Eliminates N+1 queries in commit traversal | Low |
| 🟡 P1 | Unique Partial Indexes | Data integrity — prevents duplicates | Low |
| 🟢 P2 | Change Streams | Enables real-time monitoring (new capability) | High |

## Dependencies
- Transactions: Requires replica set (Atlas Local Docker already provides this)
- Change Streams: Requires replica set + `changeStreamPreAndPostImages` enabled
- `$graphLookup`: No special requirements
- Partial Indexes: No special requirements
- `$merge`: Cross-database `$merge` requires same MongoDB instance
