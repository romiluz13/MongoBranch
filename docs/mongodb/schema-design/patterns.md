# MongoDB Schema Design Patterns

> Source: https://www.mongodb.com/docs/manual/data-modeling/
> Synced from: MONGODB_CAPABILITIES.md Section 15
> Last updated: 2026-04-02

## Core Patterns

### 1. Embedded (1:1, 1:few)
```javascript
// User with address — always fetched together
{ _id: "u1", name: "Alice", address: { city: "NYC", zip: "10001" } }
```
**When**: Data always accessed together, child won't grow unbounded.

### 2. Reference (1:many)
```javascript
// Order references user by ID
{ _id: "o1", userId: "u1", items: [...] }
```
**When**: Related data accessed independently, child collection grows.

### 3. Subset Pattern
```javascript
// Product with only recent 10 reviews embedded, rest in separate collection
{ _id: "p1", name: "Widget", recentReviews: [...top10...] }
```
**When**: Working set must stay small, most queries only need subset.

### 4. Computed Pattern
```javascript
// Pre-compute counts/sums on write
{ _id: "p1", name: "Widget", totalReviews: 342, avgRating: 4.5 }
```
**When**: Expensive aggregations run frequently, can tolerate slight staleness.

### 5. Bucket Pattern
```javascript
// Group time-series data into buckets
{ sensorId: "s1", date: "2026-04-02", readings: [{ t: "00:00", v: 22.5 }, ...] }
```
**When**: Time-series data, IoT, logs. Reduces document count dramatically.

### 6. Polymorphic Pattern
```javascript
// Different document shapes in same collection
{ type: "car", make: "Toyota", doors: 4 }
{ type: "truck", make: "Ford", payload: 5000 }
```
**When**: Objects share some fields but have type-specific fields. Use discriminator field.

### 7. Attribute Pattern
```javascript
// Convert sparse fields to key-value array for indexing
{ name: "Widget", attrs: [{ k: "color", v: "red" }, { k: "size", v: "L" }] }
// Index: { "attrs.k": 1, "attrs.v": 1 }
```
**When**: Many optional/sparse fields that all need to be searchable.

### 8. Outlier Pattern
```javascript
// Flag documents that exceed normal bounds
{ _id: "p1", title: "Viral Post", likes: 50000, hasOverflow: true }
// Overflow stored in separate collection
```
**When**: Most docs are normal size but rare outliers could blow up.

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| Unbounded arrays | Document > 16MB | Use bucket or reference pattern |
| Massive number of collections | Memory pressure | Consolidate with polymorphic pattern |
| Unnecessary indexes | Slow writes, memory waste | Audit with `$indexStats` |
| Bloated documents | Working set won't fit RAM | Use subset or computed pattern |
| Case-insensitive regex | Full collection scan | Use collation or Atlas Search |
| `$lookup` in every query | Slow joins | Embed or denormalize |

## MongoBranch Schema Decisions

### Branch Metadata → Embedded
```javascript
// Good: metadata is always fetched with branch
{ name: "feature/x", status: "active", parentBranch: "main",
  branchDatabase: "mongobranch_branch_feature/x", headCommit: "abc123",
  createdAt: Date, updatedAt: Date, createdBy: "agent-1" }
```

### Commits → Reference Pattern
```javascript
// Good: commits reference branch by name, can grow unbounded
{ hash: "abc123", branchName: "feature/x", parentHashes: ["def456"],
  message: "Add users", timestamp: Date }
```

### Commit Data → Bucket-ish Pattern
```javascript
// Good: snapshot data bucketed per commit+collection
{ commitHash: "abc123", collection: "users",
  documents: [...all docs...], checksum: "sha256:..." }
```

### Operation Log → Time-Series-like
```javascript
// Could benefit from MongoDB native time series collections in future
{ branchName: "feature/x", collection: "users", operation: "insert",
  documentId: "u1", timestamp: Date, performedBy: "agent-1" }
```

## Key Limits

| Limit | Value |
|-------|-------|
| Document size | 16 MB |
| Namespace length | 120 bytes (db.collection) |
| Index key size | 1024 bytes |
| Indexes per collection | 64 |
| Nesting depth | 100 levels |
| `$graphLookup` memory | 100 MB (per stage, use allowDiskUse) |
