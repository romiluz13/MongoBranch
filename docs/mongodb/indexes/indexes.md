# MongoDB Indexes

> Source: https://www.mongodb.com/docs/manual/indexes/

Indexes support efficient query execution. **MongoBranch must manage indexes per branch** —
when branching, indexes must be replicated; when diffing, index changes must be detected.

## Index Types

### Single Field Index
```javascript
db.collection.createIndex({ name: 1 })   // Ascending
db.collection.createIndex({ age: -1 })   // Descending
```

### Compound Index
```javascript
db.collection.createIndex({ lastName: 1, firstName: 1 })
```

### Multikey Index (Arrays)
```javascript
// Automatically created for array fields
db.collection.createIndex({ tags: 1 })
```

### Text Index
```javascript
db.collection.createIndex({ description: "text" })
// Query: db.collection.find({ $text: { $search: "coffee" } })
```

### Wildcard Index
```javascript
db.collection.createIndex({ "attributes.$**": 1 })
```

### 2dsphere Index (Geospatial)
```javascript
db.collection.createIndex({ location: "2dsphere" })
```

### Hashed Index
```javascript
db.collection.createIndex({ _id: "hashed" })
```

## Index Properties

| Property | Description | Syntax |
|----------|-------------|--------|
| Unique | No duplicate values | `{ unique: true }` |
| Partial | Index subset of documents | `{ partialFilterExpression: { age: { $gt: 18 } } }` |
| Sparse | Skip documents without field | `{ sparse: true }` |
| TTL | Auto-delete after time | `{ expireAfterSeconds: 3600 }` |
| Hidden | Not used by query planner | `{ hidden: true }` |

## Index Management Commands

```javascript
// List all indexes on a collection
db.collection.getIndexes()

// Create index
db.collection.createIndex({ field: 1 }, { name: "field_idx" })

// Drop index
db.collection.dropIndex("field_idx")

// Drop all indexes (except _id)
db.collection.dropIndexes()

// Reindex (rebuilds all indexes)
db.collection.reIndex()
```

## Atlas Search Indexes (MongoDB 7.0+)

```javascript
// Create search index (Atlas only)
db.collection.createSearchIndex(
  "default",
  {
    mappings: {
      dynamic: true,
      fields: {
        name: { type: "string", analyzer: "lucene.standard" }
      }
    }
  }
)

// List search indexes
db.collection.getSearchIndexes()
```

## MongoBranch Relevance

| Feature | MongoBranch Use |
|---------|-----------------|
| `getIndexes()` | Capture index state when creating branch snapshot |
| `createIndex()` | Replicate indexes in branch namespace |
| Index comparison | Part of branch diff (schema-level changes) |
| TTL indexes | Auto-cleanup of expired branch data |
| Hidden indexes | Temporarily disable branch-specific indexes |
| Partial indexes | Branch-specific indexing strategies |

## Branch Index Strategy

When creating a branch:
1. `getIndexes()` on all source collections
2. Store index definitions in branch metadata
3. Create equivalent indexes on branch collections
4. On merge: compare index defs, apply changes to target

When diffing branches:
1. Compare index definitions (name, key, options)
2. Report: added indexes, removed indexes, modified indexes
