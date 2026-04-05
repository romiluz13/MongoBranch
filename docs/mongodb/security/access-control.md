# MongoDB Access Control for MongoBranch

> Sources:
> - https://www.mongodb.com/docs/manual/core/authorization/
> - https://www.mongodb.com/docs/manual/reference/method/db.createUser/
> - https://www.mongodb.com/docs/manual/reference/method/db.createRole/
> - https://www.mongodb.com/docs/manual/reference/privilege-actions/
> - https://www.mongodb.com/docs/manual/reference/command/connectionStatus/
> - https://www.mongodb.com/docs/manual/reference/command/setUserWriteBlockMode/

MongoBranch can only prevent raw direct writes at the MongoDB server layer when
MongoDB access control is actually enforced.

## What MongoDB Guarantees

- MongoDB uses role-based access control (RBAC).
- A user gets one or more roles.
- Each role grants actions on resources.
- Outside role assignments, the user has no access to the system.
- MongoDB does **not** enable access control by default.

## Core Commands

### Create a user

```javascript
db.createUser({
  user: "branch_agent",
  pwd: passwordPrompt(),
  roles: [{ role: "mb_branch_agent_feature_x", db: "admin" }]
})
```

### Create a role

```javascript
db.createRole({
  role: "mb_branch_agent_feature_x",
  privileges: [
    {
      resource: { db: "__mb_feature-x", collection: "users" },
      actions: ["find", "insert", "update", "remove", "listIndexes"]
    },
    {
      resource: { db: "__mb_feature-x" },
      actions: ["listCollections", "dbStats"]
    }
  ],
  roles: []
})
```

### Inspect current authentication state

```javascript
db.runCommand({ connectionStatus: 1, showPrivileges: true })
```

Useful output fields:

- `authInfo.authenticatedUsers`
- `authInfo.authenticatedUserRoles`

## Privilege Actions MongoBranch Cares About

### Branch read/write roles

- `find`
- `insert`
- `update`
- `remove`
- `listCollections`
- `listIndexes`
- `createCollection`
- `createIndex`
- `dropCollection`
- `dropIndex`
- `collMod`
- `dbStats`

### Search index roles

- `createSearchIndexes`
- `dropSearchIndex`
- `listSearchIndexes`
- `updateSearchIndex`

### Protected deploy windows

- `setUserWriteBlockMode`
- `bypassWriteBlockingMode`

MongoDB documents that `setUserWriteBlockMode` blocks writes to the entire cluster.
Only users with `bypassWriteBlockingMode` can continue writing while the block is active.

## MongoBranch Interpretation

### `managed`

MongoBranch can:

- create least-privilege users
- create least-privilege roles
- hand agents a branch-scoped connection string
- record those identities in metadata

This is useful, but it is **not enough** if MongoDB is still running without access control enforcement.

### `enforced`

MongoBranch must verify that a restricted user:

1. can write where its role allows
2. is rejected where its role does **not** allow

That is why MongoBranch now uses a live restricted-user probe instead of trusting
that user creation automatically implies real server-side enforcement.

## Atlas Local Practical Rule

Atlas Local may accept `createUser` and `createRole` while still allowing writes
outside those roles if access control is not actually enforced in the deployment.

Practical rule for MongoBranch:

- Do not claim server-side protection only because user/role provisioning succeeded.
- Run `mb access status` or `mb doctor`.
- Trust the live enforcement probe more than static setup assumptions.

Current stronger proof:

- The older unauthenticated local lab could provision users but reported `enforced: false`.
- A fresh auth-enabled Atlas Local preview workspace bootstrapped with `mb init --start-local`
  reported `enforced: true` and passed restricted-user write-denial checks from the installed CLI.
- MongoBranch now treats that enforced profile as the approval baseline for Atlas Local production-ready claims.
