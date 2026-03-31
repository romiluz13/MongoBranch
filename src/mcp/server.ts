#!/usr/bin/env node
/**
 * MongoBranch MCP Server
 *
 * Exposes branch/diff/merge as MCP tools for AI agents.
 * Agents can create isolated data sandboxes, inspect changes, and merge results.
 *
 * Usage:
 *   bun src/mcp/server.ts
 *
 * Configure via environment variables:
 *   MONGOBRANCH_URI — MongoDB connection string (default: mongodb://localhost:27018)
 *   MONGOBRANCH_DB  — Source database name (default: myapp)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MongoClient } from "mongodb";
import { z } from "zod";
import { createMongoBranchTools } from "./tools.ts";
import { DEFAULT_CONFIG } from "../core/types.ts";
import type { MongoBranchConfig } from "../core/types.ts";

const config: MongoBranchConfig = {
  uri: process.env.MONGOBRANCH_URI ?? DEFAULT_CONFIG.uri,
  sourceDatabase: process.env.MONGOBRANCH_DB ?? DEFAULT_CONFIG.sourceDatabase,
  metaDatabase: DEFAULT_CONFIG.metaDatabase,
  branchPrefix: DEFAULT_CONFIG.branchPrefix,
};

const mcpServer = new McpServer({
  name: "mongobranch",
  version: "0.1.0",
});

async function main(): Promise<void> {
  const client = new MongoClient(config.uri);
  await client.connect();

  const tools = createMongoBranchTools(client, config);

  // ── Tool: create_branch ─────────────────────────────────────
  mcpServer.registerTool("create_branch", {
    description:
      "Create an isolated data branch. The branch gets a full copy of the source database " +
      "so the agent can modify data freely without affecting production.",
    inputSchema: {
      name: z.string().describe("Branch name (lowercase, hyphens, underscores)"),
      description: z.string().optional().describe("What this branch is for"),
      from: z.string().optional().describe("Parent branch (default: main)"),
      createdBy: z.string().optional().describe("Agent or user identity"),
      readOnly: z.boolean().optional().describe("Create as read-only (for review)"),
    },
  }, async (args) => tools.create_branch(args));

  // ── Tool: list_branches ─────────────────────────────────────
  mcpServer.registerTool("list_branches", {
    description: "List all data branches with their status and metadata.",
    inputSchema: {
      includeDeleted: z.boolean().optional().describe("Include deleted branches"),
    },
  }, async (args) => tools.list_branches(args));

  // ── Tool: diff_branch ───────────────────────────────────────
  mcpServer.registerTool("diff_branch", {
    description:
      "Compare two branches and show document-level differences " +
      "(added, removed, modified documents with field-level detail).",
    inputSchema: {
      source: z.string().describe("Source branch name"),
      target: z.string().optional().describe("Target branch to compare against (default: main)"),
    },
  }, async (args) => tools.diff_branch(args));

  // ── Tool: merge_branch ──────────────────────────────────────
  mcpServer.registerTool("merge_branch", {
    description:
      "Merge a branch into a target branch. Supports dry-run, conflict detection, " +
      "and resolution strategies (ours=keep target, theirs=keep source, abort=skip conflicts).",
    inputSchema: {
      source: z.string().describe("Source branch to merge from"),
      into: z.string().optional().describe("Target branch (default: main)"),
      dryRun: z.boolean().optional().describe("Preview only — don't apply changes"),
      detectConflicts: z.boolean().optional().describe("Detect conflicting document modifications"),
      conflictStrategy: z.enum(["ours", "theirs", "abort"]).optional()
        .describe("How to resolve conflicts: ours (keep target), theirs (keep source), abort (skip)"),
    },
  }, async (args) => tools.merge_branch(args));

  // ── Tool: delete_branch ─────────────────────────────────────
  mcpServer.registerTool("delete_branch", {
    description:
      "Delete a branch and drop its database. " +
      "Cannot delete the main branch.",
    inputSchema: {
      name: z.string().describe("Branch name to delete"),
    },
  }, async (args) => tools.delete_branch(args));

  // ── Tool: gc ─────────────────────────────────────────────────
  mcpServer.registerTool("gc", {
    description:
      "Garbage collect — drop databases for merged/deleted branches " +
      "and remove their metadata.",
    inputSchema: {},
  }, async (args) => tools.gc(args));

  // ── Tool: rollback_branch ───────────────────────────────────
  mcpServer.registerTool("rollback_branch", {
    description:
      "Reset a branch to its original state — drops all changes and " +
      "re-copies from the source database. Cannot rollback main.",
    inputSchema: {
      name: z.string().describe("Branch name to rollback"),
    },
  }, async (args) => tools.rollback_branch(args));

  // ── Tool: register_agent ────────────────────────────────────
  mcpServer.registerTool("register_agent", {
    description:
      "Register an AI agent for isolated branch operations. " +
      "Each agent gets its own namespace for branches.",
    inputSchema: {
      agentId: z.string().describe("Unique agent identifier"),
      name: z.string().optional().describe("Human-readable agent name"),
      description: z.string().optional().describe("Agent description"),
    },
  }, async (args) => tools.register_agent(args));

  // ── Tool: create_agent_branch ───────────────────────────────
  mcpServer.registerTool("create_agent_branch", {
    description:
      "Create a task-specific branch for a registered agent. " +
      "Branch name: {agentId}/{task}. Full data isolation.",
    inputSchema: {
      agentId: z.string().describe("Agent ID (must be registered)"),
      task: z.string().describe("Task name (becomes branch suffix)"),
      description: z.string().optional().describe("What this task is about"),
    },
  }, async (args) => tools.create_agent_branch(args));

  // ── Tool: agent_status ──────────────────────────────────────
  mcpServer.registerTool("agent_status", {
    description:
      "Get the status of a registered agent — active branches, " +
      "registration date, last activity.",
    inputSchema: {
      agentId: z.string().describe("Agent ID to check"),
    },
  }, async (args) => tools.agent_status(args));

  // ── Tool: start_task ────────────────────────────────────────
  mcpServer.registerTool("start_task", {
    description:
      "Start a task: auto-registers agent (if new) and creates an isolated " +
      "branch with a full data copy. Call this first when beginning any task.",
    inputSchema: {
      agentId: z.string().describe("Agent ID (auto-registered if new)"),
      task: z.string().describe("Task name — becomes branch suffix"),
      description: z.string().optional().describe("What this task is about"),
    },
  }, async (args) => tools.start_task(args));

  // ── Tool: complete_task ─────────────────────────────────────
  mcpServer.registerTool("complete_task", {
    description:
      "Complete a task: diffs the branch against main and shows a review summary. " +
      "Optionally auto-merges the changes. Call this when the task is done.",
    inputSchema: {
      agentId: z.string().describe("Agent ID"),
      task: z.string().describe("Task name (must match start_task)"),
      autoMerge: z.boolean().optional().describe("Auto-merge changes to main (default: false)"),
    },
  }, async (args) => tools.complete_task(args));

  // ── Tool: branch_log ────────────────────────────────────────
  mcpServer.registerTool("branch_log", {
    description:
      "Get the event history for a branch (created, merged, data changes). " +
      "Omit branchName to see all recent history.",
    inputSchema: {
      branchName: z.string().optional().describe("Branch name (omit for global log)"),
      limit: z.number().optional().describe("Max entries (default: 20)"),
    },
  }, async (args) => tools.branch_log(args));

  // ── Tool: record_snapshot ───────────────────────────────────
  mcpServer.registerTool("record_snapshot", {
    description:
      "Record a history event for a branch. Use this to track data modifications " +
      "so they appear in branch_log.",
    inputSchema: {
      branchName: z.string().describe("Branch name"),
      event: z.string().describe("Event type: branch_created | data_modified | branch_merged | branch_deleted"),
      summary: z.string().describe("Human-readable description of what happened"),
    },
  }, async (args) => tools.record_snapshot(args));

  // ── Tool: enqueue_merge ─────────────────────────────────────
  mcpServer.registerTool("enqueue_merge", {
    description:
      "Add a branch to the ordered merge queue. " +
      "Branches merge one at a time to prevent conflicts.",
    inputSchema: {
      branchName: z.string().describe("Branch to queue for merging"),
      targetBranch: z.string().optional().describe("Target branch (default: main)"),
      queuedBy: z.string().optional().describe("Who queued this merge"),
    },
  }, async (args) => tools.enqueue_merge(args));

  // ── Tool: process_merge_queue ───────────────────────────────
  mcpServer.registerTool("process_merge_queue", {
    description: "Process the next (or all) pending merges in the queue.",
    inputSchema: {
      all: z.boolean().optional().describe("Process all pending (default: just next)"),
    },
  }, async (args) => tools.process_merge_queue(args));

  // ── Tool: merge_queue_status ────────────────────────────────
  mcpServer.registerTool("merge_queue_status", {
    description: "Show the current merge queue — pending and processing items.",
    inputSchema: {},
  }, async (args) => tools.merge_queue_status(args));

  // ── Tool: export_audit_log ─────────────────────────────────
  mcpServer.registerTool("export_audit_log", {
    description:
      "Export the audit trail as JSON or CSV. " +
      "Filter by branch name. Use for compliance and reporting.",
    inputSchema: {
      format: z.enum(["json", "csv"]).optional().describe("Output format (default: json)"),
      branchName: z.string().optional().describe("Filter to specific branch"),
    },
  }, async (args) => tools.export_audit_log(args));

  // ── Tool: materialization_status ───────────────────────────
  mcpServer.registerTool("materialization_status", {
    description:
      "Check which collections on a lazy (copy-on-write) branch have been materialized.",
    inputSchema: {
      branchName: z.string().describe("Branch to check"),
    },
  }, async (args) => tools.materialization_status(args));

  // ── Tool: branch_insert ────────────────────────────────────
  mcpServer.registerTool("branch_insert", {
    description:
      "Insert a document into a branch collection. Auto-materializes lazy branches.",
    inputSchema: {
      branchName: z.string().describe("Target branch"),
      collection: z.string().describe("Collection name"),
      document: z.record(z.unknown()).describe("Document to insert"),
      performedBy: z.string().optional().describe("Who performed this"),
    },
  }, async (args) => tools.branch_insert(args));

  // ── Tool: branch_update ────────────────────────────────────
  mcpServer.registerTool("branch_update", {
    description: "Update a document on a branch collection.",
    inputSchema: {
      branchName: z.string().describe("Target branch"),
      collection: z.string().describe("Collection name"),
      filter: z.record(z.unknown()).describe("Query filter"),
      update: z.record(z.unknown()).describe("Update expression (e.g. {$set: {...}})"),
      performedBy: z.string().optional().describe("Who performed this"),
    },
  }, async (args) => tools.branch_update(args));

  // ── Tool: branch_delete ────────────────────────────────────
  mcpServer.registerTool("branch_delete", {
    description: "Delete a document from a branch collection.",
    inputSchema: {
      branchName: z.string().describe("Target branch"),
      collection: z.string().describe("Collection name"),
      filter: z.record(z.unknown()).describe("Query filter"),
      performedBy: z.string().optional().describe("Who performed this"),
    },
  }, async (args) => tools.branch_delete(args));

  // ── Tool: branch_find ──────────────────────────────────────
  mcpServer.registerTool("branch_find", {
    description:
      "Query documents on a branch. For lazy branches, reads from source for unmaterialized collections.",
    inputSchema: {
      branchName: z.string().describe("Target branch"),
      collection: z.string().describe("Collection name"),
      filter: z.record(z.unknown()).optional().describe("Query filter"),
      limit: z.number().optional().describe("Max documents to return"),
    },
  }, async (args) => tools.branch_find(args));

  // ── Tool: branch_oplog ─────────────────────────────────────
  mcpServer.registerTool("branch_oplog", {
    description: "Get the operation log for a branch — every insert, update, delete recorded.",
    inputSchema: {
      branchName: z.string().describe("Target branch"),
      collection: z.string().optional().describe("Filter by collection"),
      limit: z.number().optional().describe("Max entries"),
    },
  }, async (args) => tools.branch_oplog(args));

  // ── Tool: branch_undo ──────────────────────────────────────
  mcpServer.registerTool("branch_undo", {
    description: "Undo the last N operations on a branch (reverse replay).",
    inputSchema: {
      branchName: z.string().describe("Target branch"),
      count: z.number().optional().describe("Number of operations to undo (default: 1)"),
    },
  }, async (args) => tools.branch_undo(args));

  // ── Start stdio transport ───────────────────────────────────
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("🔌 MongoBranch MCP server running on stdio");

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await mcpServer.close();
    await client.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("❌ MCP Server error:", err);
  process.exit(1);
});
