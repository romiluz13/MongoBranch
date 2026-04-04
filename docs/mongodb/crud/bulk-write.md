# bulkWrite Operations

> Source: https://www.mongodb.com/docs/drivers/node/current/usage-examples/bulkWrite/
> Verified: 2026-04-02

## Definition

`bulkWrite()` performs multiple write operations (insert, update, delete, replace)
in a single command. Reduces network round trips and improves throughput.

## Syntax (Node.js Driver)

```typescript
const result = await collection.bulkWrite([
  { insertOne: { document: { ... } } },
  { updateOne: { filter: { ... }, update: { $set: { ... } } } },
  { updateMany: { filter: { ... }, update: { $set: { ... } } } },
  { deleteOne: { filter: { ... } } },
  { deleteMany: { filter: { ... } } },
  { replaceOne: { filter: { ... }, replacement: { ... } } }
], options);
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ordered` | boolean | `true` | Execute operations in order; stop on first error |
| `bypassDocumentValidation` | boolean | `false` | Skip schema validation |
| `writeConcern` | WriteConcern | - | Write concern for the operation |

## Operation Types

### insertOne
```typescript
{ insertOne: { document: { name: "Alice", age: 30 } } }
```

### updateOne / updateMany
```typescript
{
  updateOne: {
    filter: { status: "active" },
    update: { $set: { verified: true } },
    upsert: false  // Optional
  }
}
```

### deleteOne / deleteMany
```typescript
{ deleteOne: { filter: { status: "deleted" } } }
```

### replaceOne
```typescript
{
  replaceOne: {
    filter: { _id: objectId },
    replacement: { name: "Bob", age: 25 },
    upsert: false  // Optional
  }
}
```

## Return Type: BulkWriteResult

```typescript
{
  insertedCount: number,
  matchedCount: number,
  modifiedCount: number,
  deletedCount: number,
  upsertedCount: number,
  upsertedIds: { [index: number]: ObjectId },
  insertedIds: { [index: number]: ObjectId }
}
```

## Ordered vs Unordered

- **Ordered** (`ordered: true`, default): Operations execute sequentially.
  If one fails, remaining operations are NOT executed.
- **Unordered** (`ordered: false`): Operations may execute in parallel.
  If one fails, remaining operations still execute.

## Error Handling

```typescript
try {
  const result = await collection.bulkWrite(operations);
} catch (error) {
  if (error instanceof MongoBulkWriteError) {
    console.log('Write errors:', error.writeErrors);
    console.log('Partial result:', error.result);
  }
}
```

## MongoBranch Usage

### Merge Apply with bulkWrite
```typescript
// Instead of individual insertOne/updateOne/deleteOne calls:
const ops = [];
for (const change of changes) {
  if (change.type === 'added') {
    ops.push({ insertOne: { document: change.doc } });
  } else if (change.type === 'modified') {
    ops.push({ replaceOne: {
      filter: { _id: change.doc._id },
      replacement: change.doc,
      upsert: true
    }});
  } else if (change.type === 'removed') {
    ops.push({ deleteOne: { filter: { _id: change.doc._id } } });
  }
}

if (ops.length > 0) {
  await targetCollection.bulkWrite(ops, { ordered: true });
}
```

## Key Constraints

1. Maximum 100,000 operations per `bulkWrite()` call
2. Each operation is limited to 16MB BSON document size
3. `bulkWrite()` CAN be used inside transactions
4. Unordered bulk writes may execute operations in any order
5. The driver automatically splits large batches into multiple commands
