# MongoDB Replication

> Source: https://www.mongodb.com/docs/manual/replication/

Replication is the foundation for change streams (which power MongoBranch tracking).

## Replica Set Basics

A replica set is a group of MongoDB instances that maintain the same data:
- **Primary**: Receives all write operations
- **Secondaries**: Replicate data from primary
- **Minimum**: 3 members (1 primary + 2 secondaries) for production

## Why MongoBranch Needs Replica Sets

1. **Change streams** require a replica set (uses the oplog)
2. **Transactions** work best with replica set write concern
3. **Read concern `snapshot`** requires replica set
4. **Atlas local dev** automatically sets up a replica set

## Oplog (Operation Log)

The oplog is a capped collection (`local.oplog.rs`) that records all writes:

```javascript
// View oplog entries
use local
db.oplog.rs.find().sort({ ts: -1 }).limit(5)

// Example oplog entry:
{
  ts: Timestamp(1234567890, 1),
  op: "i",          // i=insert, u=update, d=delete, c=command, n=no-op
  ns: "myapp.users",
  o: { _id: ObjectId("..."), name: "Alice" },  // The document
  o2: { _id: ObjectId("...") }                 // For updates: the filter
}
```

## Oplog Operation Types

| Op | Description | MongoBranch Use |
|----|-------------|-----------------|
| `i` | Insert | Track new documents in branch |
| `u` | Update | Track modifications |
| `d` | Delete | Track removals |
| `c` | Command | Track DDL (createCollection, createIndex) |
| `n` | No-op | Ignore |

## Read Preferences

```javascript
// Read from primary (default)
{ readPreference: "primary" }

// Read from secondary (stale reads OK)
{ readPreference: "secondary" }

// Read from nearest member
{ readPreference: "nearest" }
```

## Local Dev Replica Set Setup

### Option 1: Atlas CLI (Recommended)
```bash
atlas deployments setup mydev --type local
# Automatically creates replica set in Docker
```

### Option 2: Manual
```bash
mongod --replSet rs0 --dbpath /data/db --port 27017
# Then in mongosh:
rs.initiate()
```

## MongoBranch Relevance

| Feature | MongoBranch Use |
|---------|-----------------|
| Oplog | Raw change tracking (alternative to change streams) |
| Change streams | Built on oplog, cleaner API for tracking |
| Read concern `snapshot` | Consistent branch snapshots |
| Write concern `majority` | Durable merge commits |
| Replica set | Required infrastructure for MongoBranch |

## Key Insight: Oplog as Change Source

MongoBranch could use the oplog directly (instead of change streams) for:
- Historical diff (what happened before we started watching)
- Replay operations from one branch to another
- Lower overhead than change streams for bulk operations

**Trade-off**: Oplog is an implementation detail (may change), change streams are the stable API.
**Decision**: Use change streams for real-time, oplog for debugging/advanced features.
