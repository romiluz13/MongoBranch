# MongoDB Node.js Driver API

> Source: https://www.mongodb.com/docs/drivers/node/current/

MongoBranch will be built with the official MongoDB Node.js driver (TypeScript).

## Connection

```typescript
import { MongoClient } from "mongodb"

const client = new MongoClient("mongodb://localhost:27017", {
  retryWrites: true,
  w: "majority"
})

await client.connect()
const db = client.db("myapp")
const collection = db.collection("users")
```

## Key Classes

### MongoClient
```typescript
const client = new MongoClient(uri, options)
await client.connect()
await client.close()
client.db("name")           // Get database
client.watch()               // Watch all changes
client.startSession()        // Start transaction session
```

### Db
```typescript
const db = client.db("myapp")
db.collection("users")            // Get collection
db.createCollection("users", opts) // Create with options
db.dropCollection("users")        // Drop collection
db.listCollections().toArray()     // List all collections
db.collections()                   // Get Collection objects
db.watch()                         // Watch database changes
db.command({ collMod: "users", ... }) // Run command
db.admin()                         // Admin operations
```

### Collection
```typescript
const coll = db.collection("users")

// CRUD
await coll.insertOne(doc)
await coll.insertMany(docs)
await coll.findOne(filter)
coll.find(filter).toArray()
await coll.updateOne(filter, update)
await coll.updateMany(filter, update)
await coll.deleteOne(filter)
await coll.deleteMany(filter)
await coll.replaceOne(filter, doc)

// Aggregation
coll.aggregate(pipeline).toArray()

// Indexes
await coll.createIndex(keys, options)
await coll.dropIndex(name)
await coll.indexes()
await coll.listIndexes().toArray()

// Bulk
await coll.bulkWrite(operations)

// Count
await coll.countDocuments(filter)
await coll.estimatedDocumentCount()

// Distinct
await coll.distinct(field, filter)

// Watch
const cs = coll.watch(pipeline, options)
```

### ClientSession (Transactions)
```typescript
const session = client.startSession()

await session.withTransaction(async () => {
  await coll.insertOne(doc, { session })
  await coll.updateOne(filter, update, { session })
})

session.endSession()
```

### ChangeStream
```typescript
const cs = coll.watch(pipeline, {
  fullDocument: "updateLookup",
  fullDocumentBeforeChange: "whenAvailable"
})

cs.on("change", (event) => { /* handle */ })
cs.on("error", (err) => { /* handle */ })
await cs.close()
```

## Connection String Options

```
mongodb://user:pass@host:27017/db?
  retryWrites=true
  &w=majority
  &readPreference=primary
  &readConcernLevel=snapshot
  &maxPoolSize=10
  &connectTimeoutMS=5000
  &socketTimeoutMS=30000
```

## Error Handling

```typescript
import { MongoError, MongoServerError } from "mongodb"

try {
  await coll.insertOne(doc)
} catch (err) {
  if (err instanceof MongoServerError) {
    if (err.code === 11000) console.log("Duplicate key")
  }
}
```

## MongoBranch Relevance

| API | MongoBranch Use |
|-----|-----------------|
| `listCollections()` | Discover collections to branch |
| `aggregate([...$lookup])` | Cross-branch comparison |
| `bulkWrite()` | Efficient branch snapshot creation |
| `watch()` | Real-time branch change tracking |
| `withTransaction()` | Atomic merge operations |
| `createCollection()` | Create branch-namespaced collections |
| `indexes()` | Capture/replicate index state |
