# ADR-001: Storage Strategy for Branch Isolation

## Status: ✅ ACCEPTED — Option C (Hybrid) implemented

## Context

MongoDB has no native branching. We must simulate it. The core question:
**How do we isolate branch data from main data?**

## Options

### Option A: Collection Prefix

```
Main:    db.users, db.orders
Branch:  db.users__feat1, db.orders__feat1
```

| Pro | Con |
|-----|-----|
| All in one database | Namespace length limit (255 bytes) |
| Simple connection string | `listCollections()` returns everything |
| Cross-collection queries easy | Branch name in every operation |
| Works with all MongoDB features | Messy at scale (100+ branches) |

### Option B: Separate Database per Branch

```
Main:    myapp.users, myapp.orders
Branch:  myapp__feat1.users, myapp__feat1.orders
```

| Pro | Con |
|-----|-----|
| Clean isolation | Cross-DB operations limited |
| Easy cleanup (`dropDatabase`) | More connections needed |
| No namespace pollution | DB name limit (64 chars) |
| Natural `listCollections` | Harder to coordinate |

### Option C: Hybrid (Recommended)

```
Metadata:  __mongobranch.branches, __mongobranch.changelog
Main:      myapp.users, myapp.orders
Branch:    myapp__feat1.users, myapp__feat1.orders  (separate DB)
```

- Central metadata database for branch state
- Separate database per branch for data isolation
- Main database untouched (no prefix pollution)
- `dropDatabase` for branch cleanup

## Decision

**Option C (Hybrid) — ACCEPTED and implemented.**

## Implementation (as built)

```
Metadata DB:  __mongobranch          (central registry)
  └── branches collection            (branch name, parent, status, timestamps)

Source DB:    ecommerce_app           (user's actual database, untouched)
  └── users, products, orders

Branch DB:    __mb_feature-auth       (prefix: __mb_)
  └── users, products, orders        (full copy of source data + indexes)
```

- **Branch creation**: `find().toArray()` + `insertMany()` per collection → new DB
- **Index copy**: `indexes()` on source → `createIndex()` on branch
- **Branch switching**: Change `currentBranch` pointer (in-memory)
- **Branch deletion**: `dropDatabase()` + mark `status: "deleted"` in metadata
- **Cleanup**: Metadata preserved for audit trail; DB fully dropped
