# Partial Indexes

> Source: https://www.mongodb.com/docs/manual/core/index-partial/
> Verified: 2026-04-02

## Definition

Partial indexes only index documents that meet a specified filter expression.
They reduce storage requirements and improve write performance by indexing
only a subset of documents.

## Syntax

```javascript
db.collection.createIndex(
  { fieldName: 1 },
  { partialFilterExpression: { <filter> } }
)
```

## Filter Expression Operators

The `partialFilterExpression` supports:
- `$exists`
- `$gt`, `$gte`, `$lt`, `$lte`
- `$type`
- `$and` (at top level only)
- `$or` (at top level only)
- `$eq`

## Examples

### Basic Partial Index
```javascript
// Only index documents where status is "active"
db.orders.createIndex(
  { createdAt: 1 },
  { partialFilterExpression: { status: "active" } }
)
```

### Partial Index with $exists
```javascript
// Only index documents that have a password field
db.users.createIndex(
  { name: 1 },
  { partialFilterExpression: { password: { $exists: true } } }
)
```

### Unique Partial Index
```javascript
// Unique constraint only on documents with password field
db.users.createIndex(
  { name: 1 },
  {
    name: "name_partial_unique_idx",
    unique: true,
    partialFilterExpression: { password: { $exists: true } }
  }
)
```

## Query Optimizer Requirements

For the query optimizer to USE a partial index, the query must include:
1. A condition on the indexed field(s)
2. A condition that **matches** (is a subset of) the `partialFilterExpression`

```javascript
// ✅ CAN use the partial index (status: "active" matches filter)
db.orders.find({ createdAt: { $gt: new Date() }, status: "active" })

// ❌ CANNOT use the partial index (no status filter)
db.orders.find({ createdAt: { $gt: new Date() } })
```

## Partial vs Sparse Indexes

| Feature | Partial Index | Sparse Index |
|---------|--------------|--------------|
| Filter criteria | Any supported expression | Only `$exists` on indexed field |
| Cross-field filter | ✅ Can filter on non-index fields | ❌ Only indexed field |
| Flexibility | High | Low |
| Recommended | ✅ Yes (superset of sparse) | Legacy |

## Restrictions

1. `_id` indexes cannot be partial
2. Shard key indexes cannot be partial
3. Cannot combine `partialFilterExpression` with `sparse` option
4. Client-Side Field Level Encryption fields cannot be in the filter
5. Starting in MongoDB 7.3, equivalent partial indexes (same keys + filter) are rejected

## MongoBranch Usage

### Unique Commit Hash (Only Non-Deleted)
```javascript
// Only enforce unique hash on active commits
db.commits.createIndex(
  { hash: 1 },
  {
    unique: true,
    partialFilterExpression: { deleted: { $ne: true } }
  }
)
```

### Active Branch Metadata
```javascript
// Index only non-deleted branches for fast lookup
db.branch_metadata.createIndex(
  { name: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: { $exists: false } }
  }
)
```

### Tag Uniqueness Per Branch
```javascript
// Unique tag names only within active tags
db.commits.createIndex(
  { "tag.name": 1, branchName: 1 },
  {
    unique: true,
    partialFilterExpression: { "tag.name": { $exists: true } }
  }
)
```
