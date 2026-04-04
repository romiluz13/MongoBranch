# MongoDB Connection Best Practices

> Source: https://www.mongodb.com/docs/drivers/node/current/fundamentals/connection/
> Synced from: MONGODB_CAPABILITIES.md Section 17
> Last updated: 2026-04-02

## Connection String Format

```
mongodb+srv://user:pass@cluster.mongodb.net/dbName?retryWrites=true&w=majority
```

### Query Parameters

| Parameter | Default | Recommended | Description |
|-----------|---------|-------------|-------------|
| `retryWrites` | `true` (Atlas) | `true` | Auto-retry transient write errors |
| `retryReads` | `true` | `true` | Auto-retry transient read errors |
| `w` | `1` | `majority` | Write concern — wait for majority replica ack |
| `readPreference` | `primary` | `primary` | Read from primary (strongest consistency) |
| `readConcern` | `local` | `majority` | Read data acknowledged by majority |
| `maxPoolSize` | `100` | 10-50 | Max connections in pool |
| `minPoolSize` | `0` | 5 | Pre-warm connections |
| `maxIdleTimeMS` | `0` (no limit) | `60000` | Close idle connections after 60s |
| `serverSelectionTimeoutMS` | `30000` | `5000` | Fail fast on connection issues |
| `connectTimeoutMS` | `30000` | `10000` | Socket connect timeout |
| `socketTimeoutMS` | `0` (no limit) | `45000` | Socket read/write timeout |
| `appName` | none | `mongobranch` | Identifies app in logs/profiler |

## MongoBranch CLIENT_OPTIONS

```typescript
// src/core/types.ts
export const CLIENT_OPTIONS = {
  retryWrites: true,
  retryReads: true,
  w: "majority" as const,
  appName: "mongobranch",
};

// Usage
const client = new MongoClient(uri, CLIENT_OPTIONS);
```

## Connection Patterns

### Singleton (recommended for CLI/server)
```typescript
let client: MongoClient | null = null;

async function getClient(uri: string): Promise<MongoClient> {
  if (!client) {
    client = new MongoClient(uri, CLIENT_OPTIONS);
    await client.connect();
  }
  return client;
}
```

### Graceful shutdown
```typescript
process.on("SIGINT", async () => {
  if (client) await client.close();
  process.exit(0);
});
```

## Retryable Writes (Section 14.4)

Automatically retried operations:
- `insertOne`, `insertMany`
- `updateOne`, `updateMany`, `replaceOne`
- `deleteOne`, `deleteMany`
- `findOneAndUpdate`, `findOneAndDelete`, `findOneAndReplace`
- `bulkWrite` (ordered and unordered)

**NOT** retried:
- `aggregate` with `$merge` or `$out`
- `drop`, `createIndex`

## Write Concern Options (Section 14.8)

| Value | Meaning | Use Case |
|-------|---------|----------|
| `w: 0` | Fire-and-forget | Logging, metrics (acceptable data loss) |
| `w: 1` | Acknowledged by primary | Default — fast but not durable |
| `w: "majority"` | Acknowledged by majority | **Recommended** — survives failover |
| `w: <n>` | Acknowledged by n members | Custom durability requirements |
| `j: true` | Wait for journal flush | Maximum durability |
| `wtimeoutMS` | Write concern timeout | Prevent indefinite hangs |

## Read Concern Options (Section 14.7)

| Value | Meaning |
|-------|---------|
| `local` | Returns most recent data (may be rolled back) |
| `available` | Like local but for sharded clusters |
| `majority` | Returns data acknowledged by majority (no rollback) |
| `linearizable` | Strongest — reflects all writes before read |
| `snapshot` | Used in multi-doc transactions |

## Transaction Read/Write Concern

```typescript
const session = client.startSession();
await session.withTransaction(async () => {
  // ... operations
}, {
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
  readPreference: "primary",
});
```

## Connection Monitoring

```typescript
client.on("connectionPoolCreated", (event) => { /* pool created */ });
client.on("connectionCheckedOut", (event) => { /* connection in use */ });
client.on("connectionCheckOutFailed", (event) => { /* pool exhaustion */ });
```

## Atlas Local (Development)

```
# Default Atlas Local connection (Docker)
mongodb://localhost:27018/?directConnection=true

# MongoBranch test setup auto-detects:
# 1. Try port 27018 (Atlas Local Docker)
# 2. Fallback to port 27017 (standard mongod)
```

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `ECONNREFUSED` | MongoDB not running | Start Docker / mongod |
| `MongoServerSelectionError` | Wrong URI / network | Check connection string |
| `MongoPoolClearedError` | Pool reset after error | Retryable — should auto-recover |
| `MaxTimeMSExpired` | Slow query timeout | Add indexes, optimize query |
| `DocumentTooLarge` | Document > 16MB | Split document, use GridFS |
