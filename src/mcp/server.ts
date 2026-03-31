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

  // ── Tool: commit (Wave 4) ─────────────────────────────────
  mcpServer.registerTool("commit", {
    description: "Create an immutable, content-addressed commit on a branch. Snapshots current state with SHA-256 hash.",
    inputSchema: {
      branchName: z.string().describe("Branch to commit on"),
      message: z.string().describe("Commit message describing the changes"),
      author: z.string().optional().describe("Author of the commit"),
    },
  }, async (args) => tools.commit(args));

  // ── Tool: get_commit (Wave 4) ─────────────────────────────
  mcpServer.registerTool("get_commit", {
    description: "Retrieve a single commit by its SHA-256 hash.",
    inputSchema: {
      hash: z.string().describe("Full SHA-256 hash of the commit"),
    },
  }, async (args) => tools.get_commit(args));

  // ── Tool: commit_log (Wave 4) ─────────────────────────────
  mcpServer.registerTool("commit_log", {
    description: "Walk the commit history of a branch. Returns commits in reverse chronological order (most recent first).",
    inputSchema: {
      branchName: z.string().describe("Branch to get history for"),
      limit: z.number().optional().describe("Max commits to return (default: 50)"),
    },
  }, async (args) => tools.commit_log(args));

  // ── Tool: create_tag (Wave 4) ─────────────────────────────
  mcpServer.registerTool("create_tag", {
    description: "Create an immutable named reference to a commit. Like git tag — for production checkpoints, rollback targets.",
    inputSchema: {
      name: z.string().describe("Tag name (e.g., 'v1.0', 'before-migration')"),
      commitHash: z.string().optional().describe("Commit hash to tag (use this OR branchName)"),
      branchName: z.string().optional().describe("Branch whose HEAD to tag (use this OR commitHash)"),
      message: z.string().optional().describe("Tag message/annotation"),
      author: z.string().optional().describe("Who created the tag"),
    },
  }, async (args) => tools.create_tag(args));

  // ── Tool: list_tags (Wave 4) ──────────────────────────────
  mcpServer.registerTool("list_tags", {
    description: "List all tags with their commit references, sorted newest first.",
    inputSchema: {},
  }, async () => tools.list_tags());

  // ── Tool: delete_tag (Wave 4) ─────────────────────────────
  mcpServer.registerTool("delete_tag", {
    description: "Delete a tag by name. The underlying commit is NOT affected.",
    inputSchema: {
      name: z.string().describe("Tag name to delete"),
    },
  }, async (args) => tools.delete_tag(args));

  // ── Tool: merge_three_way (Wave 4) ────────────────────────
  mcpServer.registerTool("merge_three_way", {
    description: "Git-like three-way merge using common ancestor. Auto-merges non-overlapping changes, detects per-field conflicts. The feature Neon CAN'T do.",
    inputSchema: {
      sourceBranch: z.string().describe("Branch to merge FROM"),
      targetBranch: z.string().describe("Branch to merge INTO"),
      dryRun: z.boolean().optional().describe("Preview merge without applying changes"),
      conflictStrategy: z.enum(["manual", "ours", "theirs"]).optional().describe("How to handle conflicts (default: manual)"),
      author: z.string().optional().describe("Author of the merge commit"),
      message: z.string().optional().describe("Merge commit message"),
    },
  }, async (args) => tools.merge_three_way(args));

  // ── Tool: cherry_pick (Wave 4) ────────────────────────────
  mcpServer.registerTool("cherry_pick", {
    description: "Apply a single commit's changes to a target branch. Like git cherry-pick.",
    inputSchema: {
      targetBranch: z.string().describe("Branch to apply the commit to"),
      commitHash: z.string().describe("SHA-256 hash of the commit to cherry-pick"),
      author: z.string().optional().describe("Author of the cherry-pick commit"),
    },
  }, async (args) => tools.cherry_pick(args));

  // ── Tool: revert_commit (Wave 4) ─────────────────────────
  mcpServer.registerTool("revert_commit", {
    description: "Undo a specific commit by creating an inverse commit. The original commit is preserved in history.",
    inputSchema: {
      branchName: z.string().describe("Branch to revert on"),
      commitHash: z.string().describe("SHA-256 hash of the commit to revert"),
      author: z.string().optional().describe("Author of the revert commit"),
    },
  }, async (args) => tools.revert_commit(args));

  // ── Tool: set_branch_ttl (Wave 5) ──────────────────────────
  mcpServer.registerTool("set_branch_ttl", {
    description: "Set or remove TTL (time-to-live) on a branch. Branch auto-expires after TTL.",
    inputSchema: {
      branchName: z.string().describe("Branch to set TTL on"),
      ttlMinutes: z.number().optional().describe("TTL in minutes from now"),
      remove: z.boolean().optional().describe("Remove TTL from branch"),
    },
  }, async (args) => tools.set_branch_ttl(args));

  // ── Tool: reset_from_parent (Wave 5) ──────────────────────
  mcpServer.registerTool("reset_from_parent", {
    description: "Reset branch data from parent — drops all branch data and re-copies from source. Metadata preserved.",
    inputSchema: {
      branchName: z.string().describe("Branch to reset"),
    },
  }, async (args) => tools.reset_from_parent(args));

  // ── Tool: protect_branch (Wave 5) ──────────────────────────
  mcpServer.registerTool("protect_branch", {
    description: "Protect a branch or pattern — prevent direct writes, only merges allowed.",
    inputSchema: {
      pattern: z.string().describe("Branch name or glob pattern (e.g., 'main', 'prod-*')"),
      requireMergeOnly: z.boolean().optional().describe("Only allow merges (default: true)"),
      preventDelete: z.boolean().optional().describe("Prevent deletion (default: true)"),
      createdBy: z.string().optional().describe("Who created the rule"),
    },
  }, async (args) => tools.protect_branch(args));

  mcpServer.registerTool("list_protections", {
    description: "List all branch protection rules.",
    inputSchema: {},
  }, async () => tools.list_protections());

  mcpServer.registerTool("remove_protection", {
    description: "Remove a branch protection rule.",
    inputSchema: { pattern: z.string().describe("Pattern to unprotect") },
  }, async (args) => tools.remove_protection(args));

  // ── Tool: list_hooks (Wave 5) ─────────────────────────────
  mcpServer.registerTool("list_hooks", {
    description: "List all registered hooks, optionally filtered by event type.",
    inputSchema: {
      event: z.string().optional().describe("Filter by event type (e.g., 'pre-commit')"),
    },
  }, async (args) => tools.list_hooks(args));

  mcpServer.registerTool("remove_hook", {
    description: "Remove a registered hook by name.",
    inputSchema: { name: z.string().describe("Hook name to remove") },
  }, async (args) => tools.remove_hook(args));

  // ── Tool: time_travel_query (Wave 6) ─────────────────────────
  mcpServer.registerTool("time_travel_query", {
    description: "Query data at a specific point in time (commit hash or timestamp). Like Dolt's AS OF or Neon's Time Travel.",
    inputSchema: {
      branchName: z.string().describe("Branch to query"),
      collection: z.string().describe("Collection name"),
      commitHash: z.string().optional().describe("Specific commit hash"),
      timestamp: z.string().optional().describe("ISO timestamp (RFC 3339)"),
      filter: z.record(z.unknown()).optional().describe("MongoDB query filter"),
    },
  }, async (args) => tools.time_travel_query(args));

  // ── Tool: blame (Wave 6) ─────────────────────────────────────
  mcpServer.registerTool("blame", {
    description: "Field-level blame — trace which commit changed each field of a document. Like git blame for data.",
    inputSchema: {
      branchName: z.string().describe("Branch to blame on"),
      collection: z.string().describe("Collection name"),
      documentId: z.string().describe("Document _id to blame"),
    },
  }, async (args) => tools.blame(args));

  // ── Tool: open_deploy_request (Wave 6) ───────────────────────
  mcpServer.registerTool("open_deploy_request", {
    description: "Open a deploy request (like a PR for data). Proposes merging source branch into target.",
    inputSchema: {
      sourceBranch: z.string().describe("Branch with changes"),
      targetBranch: z.string().describe("Branch to merge into"),
      description: z.string().describe("What this deploy request does"),
      createdBy: z.string().describe("Who opened this request"),
    },
  }, async (args) => tools.open_deploy_request(args));

  mcpServer.registerTool("approve_deploy_request", {
    description: "Approve a deploy request — marks it ready for execution.",
    inputSchema: {
      id: z.string().describe("Deploy request ID"),
      reviewedBy: z.string().describe("Who approved"),
    },
  }, async (args) => tools.approve_deploy_request(args));

  mcpServer.registerTool("reject_deploy_request", {
    description: "Reject a deploy request with a reason.",
    inputSchema: {
      id: z.string().describe("Deploy request ID"),
      reviewedBy: z.string().describe("Who rejected"),
      reason: z.string().describe("Rejection reason"),
    },
  }, async (args) => tools.reject_deploy_request(args));

  mcpServer.registerTool("execute_deploy_request", {
    description: "Execute an approved deploy request — performs the merge.",
    inputSchema: {
      id: z.string().describe("Deploy request ID"),
    },
  }, async (args) => tools.execute_deploy_request(args));

  mcpServer.registerTool("list_deploy_requests", {
    description: "List deploy requests, optionally filtered by status or target branch.",
    inputSchema: {
      status: z.string().optional().describe("Filter: open, approved, rejected, merged"),
      targetBranch: z.string().optional().describe("Filter by target branch"),
    },
  }, async (args) => tools.list_deploy_requests(args));

  // ── Tool: Agent Scopes (Wave 7) ──────────────────────────────
  mcpServer.registerTool("set_agent_scope", {
    description: "Set permissions and restrictions for an AI agent.",
    inputSchema: {
      agentId: z.string().describe("Agent ID"),
      permissions: z.array(z.string()).describe("Allowed ops: read, write, delete, merge"),
      allowedCollections: z.array(z.string()).optional().describe("Collections the agent can access"),
      deniedCollections: z.array(z.string()).optional().describe("Explicitly denied collections"),
      maxBranches: z.number().optional().describe("Max simultaneous branches"),
    },
  }, async (args) => tools.set_agent_scope(args));

  mcpServer.registerTool("check_agent_permission", {
    description: "Check if an agent is allowed to perform an operation on a collection.",
    inputSchema: {
      agentId: z.string().describe("Agent ID"),
      collection: z.string().describe("Collection name"),
      operation: z.string().describe("Operation: read, write, delete, merge"),
    },
  }, async (args) => tools.check_agent_permission(args));

  mcpServer.registerTool("get_agent_violations", {
    description: "Get scope violation log for an agent.",
    inputSchema: { agentId: z.string().describe("Agent ID") },
  }, async (args) => tools.get_agent_violations(args));

  // ── Tool: Branch Compare (Wave 7) ────────────────────────────
  mcpServer.registerTool("compare_branches", {
    description: "Compare N branches side by side — per-document presence matrix.",
    inputSchema: {
      branches: z.array(z.string()).describe("2+ branch names to compare"),
    },
  }, async (args) => tools.compare_branches(args));

  // ── Tool: Stash (Wave 7) ─────────────────────────────────────
  mcpServer.registerTool("stash", {
    description: "Stash current branch data (save + clear). Like git stash.",
    inputSchema: {
      branchName: z.string().describe("Branch to stash"),
      message: z.string().describe("Stash message"),
    },
  }, async (args) => tools.stash(args));

  mcpServer.registerTool("stash_pop", {
    description: "Pop most recent stash — restore data to branch.",
    inputSchema: { branchName: z.string().describe("Branch to pop stash on") },
  }, async (args) => tools.stash_pop(args));

  mcpServer.registerTool("stash_list", {
    description: "List stashes for a branch.",
    inputSchema: { branchName: z.string().describe("Branch name") },
  }, async (args) => tools.stash_list(args));

  // ── Tool: Anonymize (Wave 7) ─────────────────────────────────
  mcpServer.registerTool("create_anonymized_branch", {
    description: "Create a branch with anonymized/masked PII data. Strategies: hash, mask, null, redact.",
    inputSchema: {
      branchName: z.string().describe("Name for the anonymized branch"),
      rules: z.array(z.object({
        collection: z.string(),
        fields: z.array(z.object({
          path: z.string().describe("Dot-notation field path"),
          strategy: z.string().describe("hash | mask | null | redact"),
        })),
      })).describe("Anonymization rules"),
    },
  }, async (args) => tools.create_anonymized_branch(args));

  // ── Tool: Reflog (Wave 7) ────────────────────────────────────
  mcpServer.registerTool("reflog", {
    description: "View reflog — branch pointer movement history. Survives deletion.",
    inputSchema: {
      branchName: z.string().optional().describe("Filter by branch (omit for all)"),
      limit: z.number().optional().describe("Max entries to return"),
    },
  }, async (args) => tools.reflog(args));

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
