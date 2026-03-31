# ADR-002: Diff Algorithm for Branch Comparison

## Status: PROPOSED — To be implemented in Wave 2

## Context

When a user runs `mb diff branch-a branch-b`, we need to compute:
1. Which documents were added/removed/modified
2. For modified documents, which fields changed
3. For schema changes, what indexes/validation rules differ

## Options

### Option A: Full Snapshot Comparison

Compare every document between two branches using aggregation.

```javascript
// Find all differences between main and branch
db.getSiblingDB("myapp").users.aggregate([
  { $lookup: {
      from: "myapp__feat1.users",
      // ... cross-DB not directly supported
  }}
])
```

- **Pro**: Simple, catches everything, no tracking overhead
- **Con**: O(n) for n documents — very slow for large collections
- **Con**: Cross-DB `$lookup` has limitations

### Option B: Change Stream Log Replay

Record all changes via change streams, replay to compute diff.

```javascript
// Changes recorded as:
{
  branch: "feat1",
  collection: "users",
  op: "update",
  docId: ObjectId("..."),
  preImage: { name: "Alice", age: 30 },
  postImage: { name: "Alice", age: 31 },
  timestamp: ISODate("...")
}
```

- **Pro**: O(changes), efficient for branches with few modifications
- **Pro**: Preserves history (intermediate states)
- **Con**: Requires change streams (replica set)
- **Con**: Pre/post images expire, storage overhead

### Option C: Operation Log (Intercept Writes) — Recommended

Intercept all writes through MongoBranch API and log them.

```javascript
// MongoBranch wraps every write:
async function branchInsert(branch, collection, doc) {
  const result = await branchDb.collection(collection).insertOne(doc)
  await metaDb.collection("__changelog").insertOne({
    branch: branch,
    op: "insert",
    collection: collection,
    docId: result.insertedId,
    newDoc: doc,
    timestamp: new Date(),
    agentId: getCurrentAgent()
  })
  return result
}
```

- **Pro**: Full control, works without change streams
- **Pro**: O(changes) diff
- **Pro**: Agent identity tracked per operation
- **Con**: Must proxy all operations (no raw MongoDB access on branches)
- **Con**: Missing operations if agent bypasses proxy

## Document-Level Deep Diff

For modified documents, compute field-level differences:

```typescript
interface DocumentDiff {
  docId: ObjectId
  collection: string
  status: "added" | "removed" | "modified"
  fields?: {
    added: Record<string, any>     // Fields in branch but not main
    removed: Record<string, any>   // Fields in main but not branch
    modified: Record<string, { old: any; new: any }>
  }
}
```

## Decision

**Recommend Option C (Operation Log)** — gives us full control and agent tracking.
Fall back to Option A (Snapshot Comparison) for branches created outside MongoBranch.

## Output Format

```
$ mb diff feat1 main

 users (3 changes)
 + Added:   { _id: "abc", name: "Dave", age: 28 }
 ~ Modified: { _id: "def" }
     name: "Alice" → "Alicia"
     age:  30 → 31
 - Removed: { _id: "ghi", name: "Charlie" }

 orders (1 change)
 + Added:   { _id: "xyz", product: "Widget", qty: 5 }

 Schema Changes:
 + Index added: users.email_1 (unique)
```
