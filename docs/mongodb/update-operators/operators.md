# MongoDB Update Operators Reference

> Source: https://www.mongodb.com/docs/manual/reference/operator/update/
> Synced from: MONGODB_CAPABILITIES.md Sections 7-8
> Last updated: 2026-04-02

## Field Update Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$set` | Set field value | `{ $set: { status: "merged" } }` |
| `$unset` | Remove field | `{ $unset: { tempField: "" } }` |
| `$inc` | Increment numeric value | `{ $inc: { retryCount: 1 } }` |
| `$mul` | Multiply numeric value | `{ $mul: { price: 1.1 } }` |
| `$min` | Set to value if less than current | `{ $min: { lowest: score } }` |
| `$max` | Set to value if greater than current | `{ $max: { highest: score } }` |
| `$rename` | Rename field | `{ $rename: { "old": "new" } }` |
| `$setOnInsert` | Set only during upsert insert | `{ $setOnInsert: { createdAt: new Date() } }` |
| `$currentDate` | Set to current server date | `{ $currentDate: { updatedAt: true } }` |

### `$currentDate` vs `new Date()`

```typescript
// ❌ Client-side timestamp (can drift in distributed systems)
await coll.updateOne(filter, { $set: { updatedAt: new Date() } });

// ✅ Server-side timestamp (always consistent)
await coll.updateOne(filter, { $currentDate: { updatedAt: true } });

// ✅ Server-side with type control
await coll.updateOne(filter, {
  $currentDate: { updatedAt: { $type: "timestamp" } }
});
```

### `$setOnInsert` (Upsert Pattern)

```typescript
// Only set createdAt on insert, always update modifiedAt
await coll.updateOne(
  { _id: docId },
  {
    $set: { name: "updated", modifiedAt: new Date() },
    $setOnInsert: { createdAt: new Date(), version: 1 }
  },
  { upsert: true }
);
```

## Array Update Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$push` | Add element to array | `{ $push: { tags: "new" } }` |
| `$pull` | Remove matching elements | `{ $pull: { tags: "old" } }` |
| `$addToSet` | Add only if not present | `{ $addToSet: { tags: "unique" } }` |
| `$pop` | Remove first (-1) or last (1) | `{ $pop: { queue: 1 } }` |
| `$pullAll` | Remove all matching values | `{ $pullAll: { tags: ["a", "b"] } }` |

### Array Modifiers

| Modifier | Description | Example |
|----------|-------------|---------|
| `$each` | Push multiple values | `{ $push: { tags: { $each: ["a", "b"] } } }` |
| `$slice` | Limit array size after push | `{ $push: { log: { $each: [entry], $slice: -100 } } }` |
| `$sort` | Sort array after push | `{ $push: { scores: { $each: [], $sort: -1 } } }` |
| `$position` | Insert at specific index | `{ $push: { items: { $each: [x], $position: 0 } } }` |

### Capped Array Pattern (Keep Last N)

```typescript
// Keep only the last 50 log entries — prevents unbounded growth
await coll.updateOne(
  { _id: branchId },
  {
    $push: {
      activityLog: {
        $each: [{ action: "merge", timestamp: new Date() }],
        $slice: -50,    // Keep last 50
        $sort: { timestamp: 1 }
      }
    }
  }
);
```

## MongoBranch Usage

### Branch metadata updates
```typescript
// Mark branch as merged (uses $set)
{ $set: { status: "merged", updatedAt: new Date() } }

// Scope quota tracking (uses $inc, $setOnInsert)
{ $inc: { "usage.writes": 1 }, $setOnInsert: { createdAt: new Date() } }
```

### Reflog entries (uses $push with $slice)
```typescript
// Could use $push+$slice to limit reflog size per branch
{ $push: { entries: { $each: [newEntry], $slice: -1000 } } }
```

## Bitwise Operators (Section 8)

| Operator | Description |
|----------|-------------|
| `$bit.and` | Bitwise AND |
| `$bit.or` | Bitwise OR |
| `$bit.xor` | Bitwise XOR |

> Not typically needed for MongoBranch. Useful for permission bitmasks.
