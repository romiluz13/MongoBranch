# $graphLookup Aggregation Stage

> Source: https://www.mongodb.com/docs/manual/reference/operator/aggregation/graphLookup/
> Verified: 2026-04-02

## Definition

`$graphLookup` performs a recursive search on a collection. It traverses relationships
between documents, following a specified field as an edge in a graph.

## Syntax

```javascript
{
  $graphLookup: {
    from: <collection>,              // Collection to search
    startWith: <expression>,         // Starting point value(s)
    connectFromField: <string>,      // Field to recurse FROM
    connectToField: <string>,        // Field to match TO
    as: <string>,                    // Output array field name
    maxDepth: <number>,              // Optional. Max recursion depth
    depthField: <string>,            // Optional. Field name for depth level
    restrictSearchWithMatch: <document> // Optional. Filter during traversal
  }
}
```

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `from` | Yes | Target collection for recursive search |
| `startWith` | Yes | Expression for the value to start recursion |
| `connectFromField` | Yes | Field in each document to use as the next lookup value |
| `connectToField` | Yes | Field in `from` collection to match against `connectFromField` |
| `as` | Yes | Name of the output array containing all reachable documents |
| `maxDepth` | No | Max number of recursive steps (0 = direct connections only) |
| `depthField` | No | Field added to each result doc indicating its depth from start |
| `restrictSearchWithMatch` | No | Additional query filter applied at each recursion step |

## Key Behaviors

1. Results are returned as a **flat array** (not nested tree)
2. Each result document includes ALL fields from the original document
3. Cycles are handled — documents already visited are not revisited
4. With `depthField`, each result gets a numeric depth value (0-based from startWith)
5. Without `maxDepth`, recursion continues until no more matching documents found

## MongoBranch Usage: Commit Ancestor Traversal

Replace BFS-based `getCommonAncestor()` with a single aggregation query:

```typescript
// Find all ancestors of a commit using $graphLookup
const result = await commitsCollection.aggregate([
  { $match: { hash: startCommitHash } },
  { $graphLookup: {
      from: "commits",
      startWith: "$parentHash",
      connectFromField: "parentHash",
      connectToField: "hash",
      as: "ancestors",
      depthField: "depth"
  }}
]).toArray();

// result[0].ancestors = all ancestor commits with depth
```

### Finding Common Ancestor (Two Branches)

```typescript
// Get ancestors of both commits, find intersection
const [ancestorsA] = await commits.aggregate([
  { $match: { hash: commitA } },
  { $graphLookup: {
      from: "commits",
      startWith: "$parentHash",
      connectFromField: "parentHash",
      connectToField: "hash",
      as: "ancestors",
      depthField: "depth"
  }}
]).toArray();

const [ancestorsB] = await commits.aggregate([
  { $match: { hash: commitB } },
  { $graphLookup: {
      from: "commits",
      startWith: "$parentHash",
      connectFromField: "parentHash",
      connectToField: "hash",
      as: "ancestors",
      depthField: "depth"
  }}
]).toArray();

// Common ancestor = intersection of ancestor sets, lowest combined depth
```

## Constraints

1. `from` collection must be in the **same database**
2. Cannot use sharded collections as `from` target
3. Memory limit: 100MB per `$graphLookup` stage (use `allowDiskUse` if needed)
4. `connectToField` should be indexed for performance
5. `maxDepth` is 0-indexed (maxDepth: 0 = only direct connections)
