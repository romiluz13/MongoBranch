# MongoDB Query Operators Reference

> Source: https://www.mongodb.com/docs/manual/reference/operator/query/
> Synced from: MONGODB_CAPABILITIES.md Sections 2-6
> Last updated: 2026-04-02

## Comparison Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$eq` | Equals (implicit in `{ field: value }`) | `{ status: "active" }` |
| `$ne` | Not equal | `{ status: { $ne: "deleted" } }` |
| `$gt` | Greater than | `{ age: { $gt: 18 } }` |
| `$gte` | Greater than or equal | `{ price: { $gte: 10 } }` |
| `$lt` | Less than | `{ createdAt: { $lt: cutoffDate } }` |
| `$lte` | Less than or equal | `{ score: { $lte: 100 } }` |
| `$in` | Match any value in array | `{ status: { $in: ["open", "approved"] } }` |
| `$nin` | Match none in array | `{ role: { $nin: ["admin", "superadmin"] } }` |

## Logical Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$and` | All conditions must match (implicit with comma) | `{ $and: [{ a: 1 }, { b: 2 }] }` |
| `$or` | Any condition matches | `{ $or: [{ status: "open" }, { priority: "high" }] }` |
| `$not` | Negate a condition | `{ age: { $not: { $gt: 65 } } }` |
| `$nor` | None of the conditions match | `{ $nor: [{ deleted: true }, { archived: true }] }` |

## Element & Evaluation Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$exists` | Field exists or not | `{ email: { $exists: true } }` |
| `$type` | Field is specific BSON type | `{ age: { $type: "number" } }` |
| `$expr` | Use aggregation expressions in query | `{ $expr: { $gt: ["$qty", "$ordered"] } }` |
| `$jsonSchema` | Validate against JSON Schema | Used in `createCollection` validator |
| `$mod` | Modulo operation | `{ qty: { $mod: [4, 0] } }` |
| `$regex` | Regular expression (⚠️ use Atlas Search instead) | `{ name: { $regex: /^mongo/i } }` |
| `$text` | Legacy text search (⚠️ deprecated) | `{ $text: { $search: "coffee" } }` |

## Array Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$all` | Array contains all elements | `{ tags: { $all: ["mongo", "db"] } }` |
| `$elemMatch` | Array element matches all conditions | `{ scores: { $elemMatch: { $gt: 80, $lt: 90 } } }` |
| `$size` | Array has exact length | `{ tags: { $size: 3 } }` |

## MongoBranch Usage

### Branch queries
```typescript
// Find active branches (uses $ne, $exists)
{ status: { $ne: "deleted" }, name: { $exists: true } }

// Find branches by multiple names (uses $in)
{ name: { $in: ["feature/a", "feature/b"] } }

// Find branches updated after date (uses $gt)
{ updatedAt: { $gt: new Date("2026-01-01") } }
```

### Deploy request queries
```typescript
// Find open or approved requests (uses $in with partial index)
{ status: { $in: ["open", "approved"] }, sourceBranch: branchName }
```

## Index Strategy (ESR Rule)

```
Compound Index Field Order:
  1. Equality fields → Fields queried with exact match ($eq)
  2. Sort fields     → Fields used in sort()
  3. Range fields    → Fields queried with $gt/$lt/$in/$regex

Example: { status: 1, createdAt: -1, score: 1 }
         ↑ Equality    ↑ Sort           ↑ Range
```
