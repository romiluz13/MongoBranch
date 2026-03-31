# MongoDB CRUD Operations

> Source: https://www.mongodb.com/docs/manual/crud/

CRUD operations create, read, update, and delete documents.

## General Constraints

- **Target scope**: Operations target a single collection
- **Atomicity**: All write operations are atomic at the level of a single document
- **Filter syntax**: Update and delete operations use the same filter syntax as read operations

## Create Operations

Insert new documents into a collection. MongoDB creates the collection if it doesn't exist.

```javascript
// Insert one document
db.collection.insertOne({ name: "Alice", age: 30 })

// Insert multiple documents
db.collection.insertMany([
  { name: "Bob", age: 25 },
  { name: "Charlie", age: 35 }
])
```

**Returns**: `insertedId` (single) or `insertedIds` (many)

## Read Operations

Retrieve documents from a collection using query filters.

```javascript
// Find all documents
db.collection.find({})

// Find with filter
db.collection.find({ age: { $gt: 25 } })

// Find one document
db.collection.findOne({ name: "Alice" })

// Projection (select specific fields)
db.collection.find({}, { name: 1, age: 1, _id: 0 })
```

## Update Operations

Modify existing documents in a collection.

```javascript
// Update one document
db.collection.updateOne(
  { name: "Alice" },
  { $set: { age: 31 } }
)

// Update multiple documents
db.collection.updateMany(
  { age: { $lt: 30 } },
  { $inc: { age: 1 } }
)

// Replace entire document
db.collection.replaceOne(
  { name: "Alice" },
  { name: "Alice", age: 31, city: "NYC" }
)
```

**Update operators**: `$set`, `$unset`, `$inc`, `$push`, `$pull`, `$addToSet`, `$rename`, `$min`, `$max`

## Delete Operations

Remove documents from a collection.

```javascript
// Delete one document
db.collection.deleteOne({ name: "Alice" })

// Delete multiple documents
db.collection.deleteMany({ age: { $lt: 25 } })
```

## Bulk Write Operations

Perform multiple write operations in a single call for better performance.

```javascript
db.collection.bulkWrite([
  { insertOne: { document: { name: "Dave", age: 28 } } },
  { updateOne: { filter: { name: "Bob" }, update: { $set: { age: 26 } } } },
  { deleteOne: { filter: { name: "Charlie" } } }
])
```

Options: `ordered: true` (default, stops on error) or `ordered: false` (continues on error)

## MongoBranch Relevance

| Operation | Branch Behavior |
|-----------|----------------|
| Insert | Tracked in branch change log, only exists in current branch |
| Find | Reads from branch-specific namespace |
| Update | Old value captured as pre-image, new value in branch |
| Delete | Deletion recorded in branch change log, reversible |
| BulkWrite | All operations tracked atomically in branch |
