# MongoDB Aggregation Pipeline

> Source: https://www.mongodb.com/docs/manual/aggregation/

The aggregation pipeline processes documents through sequential stages.
**Critical for MongoBranch** — aggregation powers the diff engine (comparing branch data).

## Pipeline Basics

```javascript
db.collection.aggregate([
  { $match: { status: "active" } },       // Filter documents
  { $group: { _id: "$city", count: { $sum: 1 } } }, // Group & count
  { $sort: { count: -1 } },               // Sort results
  { $limit: 10 }                          // Limit output
])
```

## Key Stages for MongoBranch

### $lookup (JOIN between collections/branches)
```javascript
// Compare documents between two branch collections
{ $lookup: {
    from: "users__branch_feature1",    // Branch collection
    localField: "_id",
    foreignField: "_id",
    as: "branch_version"
} }
```

### $merge (Write pipeline results to collection)
```javascript
// Merge branch data back to main
{ $merge: {
    into: "users",
    on: "_id",
    whenMatched: "replace",        // Overwrite main with branch
    whenNotMatched: "insert"       // Add new docs from branch
} }
```

### $unionWith (Combine documents from multiple collections)
```javascript
// Union branch changes with main
{ $unionWith: { coll: "users__branch_feature1" } }
```

### $setWindowFields (For diff ordering/ranking)
```javascript
{ $setWindowFields: {
    partitionBy: "$_id",
    sortBy: { version: 1 },
    output: { rank: { $rank: {} } }
} }
```

## Diff-Relevant Operators

| Operator | Use in MongoBranch |
|----------|-------------------|
| `$match` | Filter by branch namespace |
| `$lookup` | Join main ↔ branch for comparison |
| `$project` | Select fields for diff output |
| `$group` | Aggregate change counts per branch |
| `$merge` | Write merge results to target branch |
| `$out` | Create snapshot collections |
| `$unionWith` | Combine data from multiple branches |
| `$setDifference` | Find array elements in A but not B |
| `$setIntersection` | Find common elements |
| `$cmp` | Compare two values (-1, 0, 1) |

## Document Comparison Pipeline

```javascript
// Find documents that differ between main and branch
db.collection("users").aggregate([
  // Get all docs from main
  { $lookup: {
      from: "users__branch_feature1",
      localField: "_id",
      foreignField: "_id",
      as: "branch_doc"
  }},
  { $unwind: { path: "$branch_doc", preserveNullAndEmptyArrays: true } },
  // Compare: find mismatches
  { $addFields: {
      diff_status: {
        $cond: {
          if: { $eq: ["$branch_doc", null] },
          then: "deleted_in_branch",
          else: {
            $cond: {
              if: { $ne: ["$$ROOT", "$branch_doc"] },
              then: "modified",
              else: "unchanged"
            }
          }
        }
      }
  }},
  { $match: { diff_status: { $ne: "unchanged" } } }
])
```

## Performance Notes

- Indexes are used by `$match` and `$sort` stages (when first in pipeline)
- `allowDiskUse: true` for large datasets
- `$merge` and `$out` must be last stage
- Pipeline memory limit: 100MB per stage (use `allowDiskUse` to bypass)

## MongoBranch Relevance

| Feature | MongoBranch Use |
|---------|-----------------|
| `$lookup` | Cross-branch document comparison |
| `$merge` | Merge branch into target |
| `$out` | Create branch snapshots |
| `$match` + `$project` | Efficient diff computation |
| `$group` | Change summary statistics |
