# MongoDB Automated Embeddings (autoEmbed)

> Source: MongoDB docs, LinkedIn articles, mongodb-mcp-server repo (March 2026)

## Overview

Automated Embeddings let MongoDB generate and maintain vector embeddings automatically.
No external embedding pipelines needed — the database handles vectorization on insert/update.

**Provider**: Voyage AI (acquired by MongoDB)
**Supported Models**: `voyage-4`, `voyage-4-large`, `voyage-4-lite`, `voyage-code-3`, `voyage-4-small`

## Create Index with autoEmbed

```javascript
// mongosh syntax
db.articles.createSearchIndex(
  "vector_index",    // index name
  "vectorSearch",    // index type
  {
    fields: [
      {
        type: "autoEmbed",       // automatic embedding generation
        path: "content",         // source text field
        model: "voyage-4-small", // Voyage AI model
        modality: "text"         // text modality
      }
    ]
  }
);
```

### Node.js Driver Syntax

```typescript
const collection = db.collection("articles");

// Create vectorSearch index with autoEmbed
await collection.createSearchIndex({
  name: "vector_index",
  type: "vectorSearch",
  definition: {
    fields: [
      {
        type: "autoEmbed",
        path: "content",
        model: "voyage-4-small",
        modality: "text"
      }
    ]
  }
});
```

## Insert Documents (Auto-Vectorized)

```javascript
// No embedding code needed — vectors are generated automatically
db.articles.insertOne({
  title: "What Happens When the Primary Fails?",
  content: "When a primary node goes down, replica sets trigger an election...",
  createdAt: new Date()
});
```

## Query with $vectorSearch (Text Query — No Manual Vectors)

```javascript
db.articles.aggregate([
  {
    $vectorSearch: {
      index: "vector_index",
      query: { text: "database failover behavior" },  // text query, not vector
      path: "content"
    }
  }
]);
```

## Verify Embeddings Were Generated

```javascript
// Check embedding count across internal collections
mongosh <connection-string> --eval '
  print("Embeddings: " +
    db.getSiblingDB("__mdb_internal_search")
      .getCollectionNames()
      .filter(c => c.match(/^[0-9a-f]{24}$/))
      .map(c => db.getSiblingDB("__mdb_internal_search").getCollection(c).countDocuments())
      .reduce((a,b) => a+b, 0)
  );
'
```

## Atlas Local Setup (Docker)

Requires the `preview` tag of `mongodb/mongodb-atlas-local` and a Voyage AI API key:

```yaml
# docker-compose.yml
services:
  mongodb:
    image: mongodb/mongodb-atlas-local:preview
    ports:
      - "27018:27017"
    environment:
      - VOYAGE_API_KEY=your-voyage-api-key-here
```

The mongodb-mcp-server uses these env vars for local auto-embed:
- `autoEmbed: true` in cluster config
- `voyageIndexingKey` and `voyageQueryKey` set to the Voyage API key

## Limitations

- Only available on Atlas (or Atlas Local with preview tag)
- Requires Voyage AI API key
- Embedding generation is async — may take seconds after insert
- Supported modalities: `text` only (as of March 2026)
- Models must be from the supported list above

## MongoBranch Implications

When branching collections with autoEmbed indexes:
1. The vector index definition is branch metadata — needs to be tracked
2. Documents inserted into a branch should trigger auto-embedding if the branch DB has the index
3. Diff should handle the auto-generated vector fields gracefully
4. Merge should preserve vector index definitions on the target
