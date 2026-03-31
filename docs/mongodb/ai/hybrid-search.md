# MongoDB Hybrid Search ($rankFusion & $scoreFusion)

> Source: MongoDB docs, community forums (March 2026)

## Overview

Hybrid search combines lexical ($search) and semantic ($vectorSearch) results
into a single ranked result set using `$rankFusion` or `$scoreFusion`.

- **$rankFusion**: Reciprocal Rank Fusion (RRF) — available since MongoDB 8.1 (Preview)
- **$scoreFusion**: Score-based merging — available since MongoDB 8.2+ (Preview)

## $rankFusion Syntax

```javascript
db.collection.aggregate([
  {
    $rankFusion: {
      input: {
        pipelines: {
          // Named pipeline 1: vector search
          vectorPipeline: [
            {
              $vectorSearch: {
                index: "vector_index",
                path: "field_name",
                queryVector: [0.1, 0.2, ...],  // or query: { text: "..." } with autoEmbed
                numCandidates: 500,
                limit: 20
              }
            }
          ],
          // Named pipeline 2: full-text search
          textPipeline: [
            {
              $search: {
                index: "search_index",
                text: {
                  query: "search term",
                  path: "field_name"
                }
              }
            },
            { $limit: 20 }
          ]
        }
      },
      // Optional: weight pipelines differently
      combination: {
        weights: {
          vectorPipeline: 0.6,
          textPipeline: 0.4
        }
      },
      // Optional: include score breakdown
      scoreDetails: true
    }
  },
  { $limit: 20 },
  // Optional: include score details in output
  { $addFields: { scoreDetails: { $meta: "searchScoreDetails" } } }
]);
```

## Node.js Driver Example

```typescript
const pipeline = [
  {
    $rankFusion: {
      input: {
        pipelines: {
          searchPlot: [
            {
              $search: {
                index: "default",
                text: { query: "space", path: "plot" }
              }
            }
          ],
          searchGenre: [
            {
              $search: {
                index: "default",
                text: { query: "adventure", path: "genres" }
              }
            }
          ]
        }
      },
      combination: { weights: { searchPlot: 0.6, searchGenre: 0.4 } },
      scoreDetails: true
    }
  },
  { $addFields: { scoreDetails: { $meta: "searchScoreDetails" } } }
];

const cursor = collection.aggregate(pipeline);
const results = await cursor.toArray();
```

## Prerequisites

1. **Search index** (type: `search`) with dynamic or explicit field mappings
2. **VectorSearch index** (type: `vectorSearch`) with vector or autoEmbed fields
3. MongoDB 8.1+ for $rankFusion, 8.2+ for $scoreFusion

## Score Details Output

```javascript
{
  value: 0.0306,
  description: "reciprocal rank fusion: sum of weight * (1 / (60 + rank))",
  details: [
    { inputPipelineName: "search", rank: 2, weight: 1, value: 0.387 },
    { inputPipelineName: "vector", rank: 9, weight: 3, value: 0.779 }
  ]
}
```

## MongoBranch Implications

When branching with hybrid search:
1. Both search and vectorSearch indexes are branch-scoped
2. $rankFusion queries run against the branch's own indexes
3. Diff engine should ignore search score metadata fields
4. Merge preserves both index types on target
