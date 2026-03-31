# MongoDB Change Streams

> Source: https://www.mongodb.com/docs/manual/changeStreams/

Change streams allow applications to watch real-time data changes without polling.
**This is CRITICAL for MongoBranch** — change streams are how we track what agents modify.

## Availability

- Replica sets (MongoDB 3.6+)
- Sharded clusters (MongoDB 4.0+)
- **Requires**: Replica set or sharded cluster (NOT standalone)
- For local dev: Use `atlas deployments setup --type local` (runs replica set via Docker)

## Watch Scope

```javascript
// Watch a single collection
const changeStream = db.collection("users").watch()

// Watch an entire database
const changeStream = db.watch()

// Watch entire deployment (all databases)
const changeStream = client.watch()
```

## Change Event Types

| Event | Description |
|-------|-------------|
| `insert` | New document added |
| `update` | Document fields modified |
| `replace` | Document replaced entirely |
| `delete` | Document removed |
| `drop` | Collection dropped |
| `rename` | Collection renamed |
| `dropDatabase` | Database dropped |
| `invalidate` | Stream invalidated |

## Event Structure

```javascript
{
  _id: { _data: "..." },           // Resume token
  operationType: "update",          // Event type
  clusterTime: Timestamp,           // When it happened
  ns: { db: "mydb", coll: "users" }, // Namespace
  documentKey: { _id: ObjectId("...") }, // Which document
  updateDescription: {              // What changed (for updates)
    updatedFields: { age: 31 },
    removedFields: [],
    truncatedArrays: []
  },
  fullDocument: { ... },            // Full doc (if requested)
  fullDocumentBeforeChange: { ... } // Pre-image (if enabled)
}
```

## Pre- and Post-Images (MongoDB 6.0+)

**CRITICAL FOR MONGOBRANCH DIFF**: Get the document BEFORE and AFTER a change.

### Enable pre/post images on a collection:
```javascript
db.createCollection("users", {
  changeStreamPreAndPostImages: { enabled: true }
})

// Or on existing collection:
db.runCommand({
  collMod: "users",
  changeStreamPreAndPostImages: { enabled: true }
})
```

### Request pre/post images in watch:
```javascript
const changeStream = db.collection("users").watch([], {
  fullDocument: "whenAvailable",              // Post-image
  fullDocumentBeforeChange: "whenAvailable"   // Pre-image
})
```

Options: `"whenAvailable"` (returns null if unavailable) or `"required"` (errors if unavailable)

### Retention:
```javascript
// Set expiry for pre/post images (cluster-wide)
db.adminCommand({
  setClusterParameter: {
    changeStreamOptions: {
      preAndPostImages: { expireAfterSeconds: 3600 }
    }
  }
})
```

## Resume Tokens

Change streams can be resumed after disconnection using a resume token:

```javascript
const changeStream = db.collection("users").watch()
let resumeToken

changeStream.on("change", (event) => {
  resumeToken = event._id  // Save the resume token
  // Process the change...
})

// Later, resume from where we left off:
const resumed = db.collection("users").watch([], {
  resumeAfter: resumeToken
})
```

## Pipeline Filtering

Filter change stream events using aggregation pipeline:

```javascript
const changeStream = db.collection("users").watch([
  { $match: { operationType: { $in: ["insert", "update", "delete"] } } },
  { $match: { "fullDocument.agentId": "agent-001" } }
])
```

## MongoBranch Relevance

| Feature | MongoBranch Use |
|---------|-----------------|
| Change events | Track all modifications per branch |
| Pre/post images | Build document-level diffs for branch comparison |
| Resume tokens | Reliable change tracking even if CLI restarts |
| Pipeline filtering | Filter changes by branch namespace / agent ID |
| Watch scope | Watch entire branch database for comprehensive tracking |
