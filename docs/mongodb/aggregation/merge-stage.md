# $merge Aggregation Stage

> Source: https://www.mongodb.com/docs/manual/reference/operator/aggregation/merge/
> Verified: 2026-04-02

## Definition

`$merge` writes the results of the aggregation pipeline to a specified collection.
It must be the **last stage** in the pipeline.

## Syntax

```javascript
{ $merge: {
    into: <collection> -or- { db: <db>, coll: <collection> },
    on: <identifier field> -or- [ <identifier field1>, ... ],  // Optional. Default: _id
    let: <variables>,                                            // Optional
    whenMatched: "replace"|"keepExisting"|"merge"|"fail"|<pipeline>, // Optional. Default: "merge"
    whenNotMatched: "insert"|"discard"|"fail"                    // Optional. Default: "insert"
}}
```

## Key Options

### `into`
- **String**: Output collection name (same database)
- **Object**: `{ db: "targetDB", coll: "targetCollection" }` for cross-database

### `on`
- Field(s) used to match documents between pipeline output and target collection
- Default: `_id`
- Must have a **unique index** on the `on` field(s) in the target collection

### `whenMatched`
| Value | Behavior |
|-------|----------|
| `"replace"` | Replace the existing document with the pipeline doc |
| `"keepExisting"` | Keep the existing document, discard pipeline doc |
| `"merge"` | Merge fields (default) — new fields added, existing overwritten |
| `"fail"` | Throw error if match found |
| `[pipeline]` | Custom update pipeline using `$$new` for pipeline doc |

### `whenNotMatched`
| Value | Behavior |
|-------|----------|
| `"insert"` | Insert the document (default) |
| `"discard"` | Discard the document |
| `"fail"` | Throw error |

## Node.js Driver Usage

```typescript
const pipeline = [
  { $merge: {
      into: "targetCollection",
      on: "_id",
      whenMatched: "replace",
      whenNotMatched: "insert"
  }}
];

await sourceCollection.aggregate(pipeline).toArray();
```

## Key Constraints

1. `$merge` can output to **same or different** database (unlike `$out` which is same-db only)
2. Target collection **must already exist** if using `whenMatched: "fail"` or custom pipeline
3. The `on` field(s) **must have a unique index** in the target collection
4. `$merge` does **NOT** replace the target collection — it merges/upserts
5. Cannot use `$merge` in a transaction
6. Cannot output to a capped collection
7. Cannot output to a time series collection

## MongoBranch Usage

Replace manual cursor-based copying in `materializeCollection()`:

```typescript
// BEFORE: Manual read+write loop
const cursor = sourceDb.collection(name).find().batchSize(1000);
for await (const doc of cursor) {
  await targetDb.collection(name).insertOne(doc);
}

// AFTER: Single $merge pipeline
await sourceDb.collection(name).aggregate([
  { $merge: {
      into: { db: targetDbName, coll: name },
      whenMatched: "replace",
      whenNotMatched: "insert"
  }}
]).toArray();
```

## Comparison with $out

| Feature | `$merge` | `$out` |
|---------|----------|--------|
| Cross-database | ✅ Yes | ❌ No |
| Merge strategy | Configurable | Replace entire collection |
| Target must exist | No | No (creates it) |
| Preserves existing docs | ✅ Configurable | ❌ Drops & recreates |
| Sharded output | ✅ Yes | ❌ No |
