# MongoDB Capabilities — Local Index

> **Source**: `/Users/rom.iluz/Dev/skills-hub/MONGODB_CAPABILITIES.md`
> **Purpose**: Quick lookup for all MongoDB capabilities with doc URLs.
> **Last synced**: 2026-04-02
> **Covers**: MongoDB 5.0–8.0 GA + 8.1/8.2 Preview • Node.js Driver 6.x/7.x

## Local Doc Coverage

| Section | Local File | Status |
|---------|-----------|--------|
| 1. CRUD | `crud/crud-operations.md`, `crud/bulk-write.md` | ✅ Complete |
| 2-6. Query Operators | `query-operators/operators.md` | ✅ Complete |
| 7-8. Update Operators | `update-operators/operators.md` | ✅ Complete |
| 9. Core Aggregation | `aggregation/aggregation-pipeline.md` | ✅ Complete |
| 10. Advanced Aggregation | `aggregation/graphlookup-stage.md` | ✅ Partial |
| 11. Atlas Search | `ai/automated-embeddings.md`, `ai/hybrid-search.md` | ✅ Complete |
| 12. Indexes | `indexes/indexes.md`, `indexes/partial-indexes.md` | ✅ Complete |
| 13. Expressions | (inline in aggregation docs) | ⬜ Reference only |
| 14. Platform Features | `transactions/transactions.md`, `change-streams/change-streams.md` | ✅ Complete |
| 15. Schema Patterns | `schema-design/patterns.md` | ✅ Complete |
| 16. Version Highlights | (in capabilities-index) | ✅ Inline below |
| 17. Connection | `connection/best-practices.md` | ✅ Complete |

## Version Highlights (Quick Reference)

### MongoDB 8.0 GA (Oct 2024)
- QE Range Queries on encrypted fields
- `updateOne`/`replaceOne` now support `sort` option
- Express Query stages for `_id` matches
- `$lookup` in transactions on sharded collections
- 36% faster reads, 32% faster mixed workloads vs 7.0

### Atlas Search & Vector Search (2024–2026)
- Scalar quantization for vector indexes (Dec 2024)
- `$vectorSearch` pre-filter support for arrays (Aug 2024)
- Search & Vector Search on Views — GA Aug 2025

### MongoDB 8.1+ Preview 🔮
- `$rankFusion` — Native RRF hybrid search (Preview Jun 2025)
- `$scoreFusion` — Score-based hybrid combination (Preview Sep 2025)
- Lexical Prefilters for Vector Search (Preview Jan 2026)

## Doc URL Reference

For any capability #, the full URL pattern is:
`https://www.mongodb.com/docs/manual/reference/operator/{type}/{name}/`

Quick links for commonly-needed pages:
- [CRUD Methods](https://www.mongodb.com/docs/manual/reference/method/js-collection/)
- [Query Operators](https://www.mongodb.com/docs/manual/reference/operator/query/)
- [Update Operators](https://www.mongodb.com/docs/manual/reference/operator/update/)
- [Aggregation Stages](https://www.mongodb.com/docs/manual/reference/operator/aggregation-pipeline/)
- [Aggregation Expressions](https://www.mongodb.com/docs/manual/reference/operator/aggregation/)
- [Indexes](https://www.mongodb.com/docs/manual/indexes/)
- [Transactions](https://www.mongodb.com/docs/manual/core/transactions/)
- [Change Streams](https://www.mongodb.com/docs/manual/changeStreams/)
- [Schema Validation](https://www.mongodb.com/docs/manual/core/schema-validation/)
- [Connection String](https://www.mongodb.com/docs/manual/reference/connection-string/)
- [Node.js Driver](https://www.mongodb.com/docs/drivers/node/current/)
- [Atlas Search](https://www.mongodb.com/docs/atlas/atlas-search/)
- [Vector Search](https://www.mongodb.com/docs/atlas/atlas-vector-search/)

## Summary — Capability Counts

| Section | Count |
|---------|-------|
| 1. CRUD | 16 |
| 2-6. Query Operators | 31 |
| 7-8. Update Operators | 21 |
| 9-10. Aggregation Stages | 33 |
| 11. Atlas Search & Vector | 35 |
| 12. Index Types | 17 |
| 13. Expressions | 26 |
| 14. Platform Features | 26 |
| 15. Schema Patterns | 17 |
| **TOTAL** | **~222** |
