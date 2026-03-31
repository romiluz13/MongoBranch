# Reference: MongoDB MCP Server

> GitHub: https://github.com/mongodb-js/mongodb-mcp-server
> Official MongoDB MCP server for AI agent integration

## What It Is

Official MongoDB MCP (Model Context Protocol) server that gives AI agents
direct access to MongoDB Atlas and local deployments.

## Available Tools

| Tool | Description |
|------|-------------|
| `connect` | Connect to MongoDB instance |
| `find` | Query documents |
| `aggregate` | Run aggregation pipelines |
| `insertOne` | Insert a document |
| `updateOne` | Update a document |
| `deleteOne` | Delete a document |
| `createIndex` | Create an index |
| `listDatabases` | List all databases |
| `listCollections` | List collections in a database |
| `collectionSchema` | Infer schema from documents |
| `createCollection` | Create a new collection |
| `dropCollection` | Drop a collection |
| `renameCollection` | Rename a collection |
| `explain` | Explain query execution plan |

## Claude Code Integration

```json
// In Claude Code MCP settings:
{
  "mcpServers": {
    "mongodb": {
      "command": "npx",
      "args": ["-y", "mongodb-mcp-server"],
      "env": {
        "MDB_MCP_CONNECTION_STRING": "mongodb://localhost:27017"
      }
    }
  }
}
```

## MongoBranch Opportunity

The MongoDB MCP server handles basic CRUD. **MongoBranch MCP server** would ADD:

| MongoBranch Tool | What It Does |
|-----------------|-------------|
| `mb_create_branch` | Create isolated branch for agent |
| `mb_switch_branch` | Switch agent's active branch |
| `mb_list_branches` | Show all branches and status |
| `mb_diff` | Show what changed on branch |
| `mb_merge` | Merge branch into target |
| `mb_rollback` | Undo branch changes |
| `mb_branch_status` | Show branch metadata |
| `mb_commit` | Save checkpoint on branch |

## Key Insight

The MongoDB MCP server and MongoBranch MCP server would be **complementary**:
- MongoDB MCP = CRUD operations on the active database
- MongoBranch MCP = branch/diff/merge operations for safe agent workflows

An agent would use BOTH:
1. `mb_create_branch "experiment-1"` → creates isolated workspace
2. `mongodb.insertOne(...)` → normal CRUD on the branch
3. `mb_diff "experiment-1" "main"` → see what changed
4. `mb_merge "experiment-1" --into "main"` → apply changes

## Architecture: Dual MCP Server

```
Claude Code → MongoBranch MCP → MongoDB MCP → MongoDB
                   |
                   ├── Branch management
                   ├── Diff engine
                   └── Merge engine
```

Or MongoBranch wraps MongoDB MCP, routing all operations through branch context.
