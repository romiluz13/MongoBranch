# MongoDB Administrative Commands

> Source: https://www.mongodb.com/docs/manual/reference/command/

Commands critical for MongoBranch branch management and introspection.

## Database Commands

```javascript
// List all databases
db.adminCommand({ listDatabases: 1 })

// Get current database stats
db.runCommand({ dbStats: 1 })

// Copy database (deprecated in 4.2 — use mongodump/mongorestore)
// Alternative: aggregate + $out for collection-level copy

// Drop database
db.dropDatabase()
```

## Collection Commands

```javascript
// Create collection with options
db.createCollection("users", {
  validator: { $jsonSchema: { ... } },
  changeStreamPreAndPostImages: { enabled: true },
  capped: false
})

// Modify collection
db.runCommand({
  collMod: "users",
  validator: { ... },
  changeStreamPreAndPostImages: { enabled: true }
})

// List collections with full info
db.runCommand({ listCollections: 1, filter: {} })
// Returns: name, type, options (validator, capped, etc.), info (readOnly, uuid)

// Collection stats
db.runCommand({ collStats: "users" })

// Rename collection
db.adminCommand({
  renameCollection: "myapp.users__feat1",
  to: "myapp.users"
})

// Clone collection to another DB (manual approach)
db.users.aggregate([
  { $match: {} },
  { $out: { db: "myapp__feat1", coll: "users" } }
])
```

## Replication Commands (Change Stream Support)

```javascript
// Check replica set status
db.adminCommand({ replSetGetStatus: 1 })

// Check if running as replica set
db.adminCommand({ isMaster: 1 })
// Look for: setName, ismaster, secondary

// Get oplog info
db.adminCommand({ getReplicationInfo: 1 })
```

## Server Status

```javascript
// Server status (connections, ops, memory)
db.adminCommand({ serverStatus: 1 })

// Current operations
db.adminCommand({ currentOp: 1 })

// Get parameters
db.adminCommand({ getParameter: 1, changeStreamOptions: 1 })

// Set parameters
db.adminCommand({
  setClusterParameter: {
    changeStreamOptions: {
      preAndPostImages: { expireAfterSeconds: 3600 }
    }
  }
})
```

## Profiling (Query Performance)

```javascript
// Enable profiling (slow queries)
db.setProfilingLevel(1, { slowms: 100 })

// Get profiling data
db.system.profile.find().sort({ ts: -1 }).limit(10)

// Disable profiling
db.setProfilingLevel(0)
```

## Aggregation on Admin

```javascript
// Get all collections across all databases
const dbs = db.adminCommand({ listDatabases: 1 }).databases
for (const d of dbs) {
  const colls = db.getSiblingDB(d.name).getCollectionNames()
  // ... enumerate
}
```

## MongoBranch Relevance

| Command | MongoBranch Use |
|---------|-----------------|
| `listDatabases` | Discover branch databases |
| `listCollections` | Discover collections to branch/diff |
| `collMod` | Enable change stream pre-images |
| `renameCollection` | Promote branch to main (swap) |
| `$out` (cross-DB) | Copy collections to branch database |
| `replSetGetStatus` | Verify change stream availability |
| `collStats` | Branch size reporting |
| `setProfilingLevel` | Performance monitoring per branch |
