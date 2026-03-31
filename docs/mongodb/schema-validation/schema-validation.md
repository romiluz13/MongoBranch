# MongoDB Schema Validation

> Source: https://www.mongodb.com/docs/manual/core/schema-validation/

Schema validation enforces document structure rules on a collection.
**MongoBranch must track validation rule changes** as part of schema diffs.

## JSON Schema Validation

```javascript
db.createCollection("users", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["name", "email", "age"],
      properties: {
        name: {
          bsonType: "string",
          description: "must be a string and is required"
        },
        email: {
          bsonType: "string",
          pattern: "^.+@.+$",
          description: "must be a valid email"
        },
        age: {
          bsonType: "int",
          minimum: 0,
          maximum: 200,
          description: "must be an integer between 0 and 200"
        }
      }
    }
  }
})
```

## Modify Validation Rules

```javascript
db.runCommand({
  collMod: "users",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["name", "email"],
      properties: {
        name: { bsonType: "string" },
        email: { bsonType: "string" }
      }
    }
  },
  validationLevel: "moderate",   // "off", "strict", "moderate"
  validationAction: "warn"       // "error" or "warn"
})
```

## Validation Levels

| Level | Description |
|-------|-------------|
| `strict` (default) | All inserts and updates must pass validation |
| `moderate` | Existing invalid docs can be updated; new docs must pass |
| `off` | No validation |

## Get Current Validation Rules

```javascript
// Get collection info including validator
db.getCollectionInfos({ name: "users" })

// Returns:
[{
  name: "users",
  options: {
    validator: { $jsonSchema: { ... } },
    validationLevel: "strict",
    validationAction: "error"
  }
}]
```

## MongoBranch Relevance

| Feature | MongoBranch Use |
|---------|-----------------|
| `$jsonSchema` | Store validation rules as part of branch metadata |
| `getCollectionInfos()` | Capture validation state when branching |
| Schema diff | Compare validation rules between branches |
| `validationLevel: "off"` | Allow branch data that doesn't match main's schema |
| `collMod` | Apply schema changes during merge |

## Branch Schema Strategy

When creating a branch:
1. `getCollectionInfos()` to capture all validation rules
2. Store in branch metadata alongside index definitions
3. Branch collections can have different validation rules

When diffing:
1. Compare `$jsonSchema` objects between branches
2. Report: added rules, removed rules, modified constraints

When merging:
1. Validate all branch data against target schema
2. Report conflicts if branch data violates target validation
3. Option: apply branch's schema changes to target
