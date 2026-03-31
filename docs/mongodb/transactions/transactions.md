# MongoDB Transactions

> Source: https://www.mongodb.com/docs/manual/core/transactions/

Multi-document transactions provide atomicity for operations across multiple documents,
collections, and databases. **Critical for MongoBranch** — branch operations (snapshot,
merge) must be atomic.

## Key Concepts

### Transactions and Atomicity
- All operations in a transaction succeed or fail together
- On abort: all data changes are discarded, never visible to other operations
- On commit: all changes become visible atomically

### ACID Guarantees
- **Atomicity**: All-or-nothing across multiple documents/collections
- **Consistency**: Data moves from one valid state to another
- **Isolation**: In-progress transaction changes invisible to other operations
- **Durability**: Committed changes survive system failures (with write concern)

## API Usage (Node.js Driver)

```javascript
const session = client.startSession()

try {
  session.startTransaction({
    readConcern: { level: "snapshot" },
    writeConcern: { w: "majority" },
    readPreference: "primary"
  })

  // All operations use the session
  await db.collection("users").insertOne(
    { name: "Alice", branch: "feature-1" },
    { session }
  )
  await db.collection("changelog").insertOne(
    { op: "insert", docId: "...", branch: "feature-1" },
    { session }
  )

  await session.commitTransaction()
} catch (error) {
  await session.abortTransaction()
  throw error
} finally {
  session.endSession()
}
```

## Convenient Transaction API (withTransaction)

```javascript
const session = client.startSession()

await session.withTransaction(async () => {
  await db.collection("users").insertOne({ name: "Alice" }, { session })
  await db.collection("log").insertOne({ op: "insert" }, { session })
  // Auto-commits on success, auto-retries on transient errors
})

session.endSession()
```

## Limits and Constraints

| Constraint | Value |
|-----------|-------|
| Max transaction duration | 60 seconds (default, configurable) |
| Max oplog entry | 16MB per transaction |
| Collections created in txn | Supported (MongoDB 4.4+) |
| DDL operations | NOT supported (createIndex, drop, etc.) |
| Cross-shard transactions | Supported (MongoDB 4.2+) |
| Count operations | Use `$count` aggregation stage instead |

## Read Concern Levels

| Level | Description | MongoBranch Use |
|-------|-------------|-----------------|
| `"local"` | Latest data on primary | Branch reads (fast) |
| `"majority"` | Committed to majority | Merge operations |
| `"snapshot"` | Point-in-time snapshot | Branch snapshot creation |
| `"linearizable"` | Strongest consistency | N/A (too slow) |

## Write Concern Levels

| Level | Description | MongoBranch Use |
|-------|-------------|-----------------|
| `{ w: 1 }` | Ack from primary | Branch writes |
| `{ w: "majority" }` | Ack from majority | Merge commits |
| `{ w: 1, j: true }` | Written to journal | Critical operations |

## Retry Logic

MongoDB drivers auto-retry:
- **Retryable writes**: `insertOne`, `updateOne`, `deleteOne`, `findOneAndUpdate`, etc.
- **Transient transaction errors**: Entire transaction can be retried
- **Unknown commit result**: `commitTransaction` can be retried

## MongoBranch Relevance

| Feature | MongoBranch Use |
|---------|-----------------|
| Multi-doc atomicity | Atomic branch snapshot (copy multiple collections) |
| `withTransaction` | Safe merge operations with auto-retry |
| Read concern `snapshot` | Consistent point-in-time branch creation |
| Write concern `majority` | Durable merge commits |
| Session isolation | Concurrent branch operations don't interfere |
