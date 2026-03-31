# MongoDB Views & Collection Types

> Source: https://www.mongodb.com/docs/manual/core/views/

## Standard Views

Read-only, computed from aggregation pipeline. Not materialized.

```javascript
db.createView("activeUsers", "users", [
  { $match: { status: "active" } },
  { $project: { name: 1, email: 1, lastLogin: 1 } }
])

// Query like a regular collection
db.activeUsers.find({ name: "Alice" })
```

## On-Demand Materialized Views

Use `$merge` to persist aggregation results into a collection.

```javascript
db.orders.aggregate([
  { $group: { _id: "$product", totalSold: { $sum: "$quantity" } } },
  { $merge: {
      into: "productSummary",
      whenMatched: "replace",
      whenNotMatched: "insert"
  }}
])
```

## Capped Collections

Fixed-size, FIFO collections. Useful for logs.

```javascript
db.createCollection("branchLog", {
  capped: true,
  size: 10485760,   // 10MB max
  max: 10000        // 10K documents max
})
```

## Time Series Collections (MongoDB 5.0+)

Optimized for time-stamped data.

```javascript
db.createCollection("metrics", {
  timeseries: {
    timeField: "timestamp",
    metaField: "agentId",
    granularity: "minutes"
  },
  expireAfterSeconds: 86400  // Auto-delete after 24h
})
```

## Collection Management

```javascript
// List all collections
db.getCollectionNames()

// Get collection stats
db.collection.stats()

// Get collection info (includes options, validation, etc.)
db.getCollectionInfos()

// Rename collection
db.collection.renameCollection("newName")

// Drop collection
db.collection.drop()
```

## Namespaces

- Full namespace: `database.collection` (max 255 bytes)
- Database name: max 64 chars, no special characters
- Collection name: no `$`, no null, no empty string

## MongoBranch Relevance

| Feature | MongoBranch Use |
|---------|-----------------|
| `getCollectionNames()` | Discover all collections to branch |
| `getCollectionInfos()` | Capture collection options (capped, timeseries, validation) |
| Views | Branch-specific views for filtered access |
| Capped collections | Branch change logs (auto-cleanup) |
| Namespaces | `{collection}__{branch_name}` naming convention |
| `$merge` | Materialized branch diff results |
| `renameCollection()` | Branch swap (promote branch to main) |

## Branch Namespace Strategy

```
Main:    users, orders, products
Branch:  users__feature1, orders__feature1, products__feature1
Meta:    __mongobranch_branches, __mongobranch_changelog
```

Alternative: Use separate databases per branch
```
Main DB:    myapp
Branch DB:  myapp__feature1
Meta DB:    __mongobranch
```
