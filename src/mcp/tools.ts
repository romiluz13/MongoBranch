/**
 * MongoBranch MCP Tool Handlers
 *
 * Pure functions that execute branch/diff/merge operations and return
 * MCP-compatible response objects. Decoupled from transport (stdio/http).
 */
import { MongoClient } from "mongodb";
import { BranchManager } from "../core/branch.ts";
import { DiffEngine } from "../core/diff.ts";
import { MergeEngine } from "../core/merge.ts";
import { AgentManager } from "../core/agent.ts";
import { HistoryManager } from "../core/history.ts";
import { MergeQueue } from "../core/queue.ts";
import { OperationLog } from "../core/oplog.ts";
import { BranchProxy } from "../core/proxy.ts";
import type { MongoBranchConfig } from "../core/types.ts";

interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

function textResult(text: string): McpToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(message: string): McpToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Creates all MongoBranch tool handlers wired to a live MongoDB connection.
 * These handlers are used both by the MCP server and by tests directly.
 */
export function createMongoBranchTools(client: MongoClient, config: MongoBranchConfig) {
  const branchManager = new BranchManager(client, config);
  const diffEngine = new DiffEngine(client, config);
  const mergeEngine = new MergeEngine(client, config);
  const agentManager = new AgentManager(client, config);
  const historyManager = new HistoryManager(client, config);
  const mergeQueue = new MergeQueue(client, config);
  const oplog = new OperationLog(client, config);
  const proxy = new BranchProxy(client, config, branchManager, oplog);

  // Initialize all managers (create indexes)
  let initialized = false;
  async function ensureInit(): Promise<void> {
    if (!initialized) {
      await agentManager.initialize();
      await historyManager.initialize();
      await mergeQueue.initialize();
      await oplog.initialize();
      initialized = true;
    }
  }

  return {
    /**
     * create_branch — Create an isolated data branch for an agent.
     */
    async create_branch(args: {
      name: string;
      description?: string;
      from?: string;
      createdBy?: string;
      readOnly?: boolean;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const branch = await branchManager.createBranch({
          name: args.name,
          description: args.description,
          from: args.from,
          createdBy: args.createdBy,
          readOnly: args.readOnly,
        });
        return textResult(
          `Branch "${branch.name}" created.\n` +
          `Database: ${branch.branchDatabase}\n` +
          `Collections copied: ${branch.collections.join(", ")}`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to create branch: ${msg}`);
      }
    },

    /**
     * list_branches — List all data branches.
     */
    async list_branches(args: {
      includeDeleted?: boolean;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const branches = await branchManager.listBranches({
          includeDeleted: args.includeDeleted,
        });
        const summary = branches.map((b) => ({
          name: b.name,
          status: b.status,
          parentBranch: b.parentBranch,
          createdAt: b.createdAt,
          description: b.description ?? null,
          branchDatabase: b.branchDatabase,
        }));
        return textResult(JSON.stringify({ branches: summary }, null, 2));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to list branches: ${msg}`);
      }
    },

    /**
     * diff_branch — Show differences between two branches.
     */
    async diff_branch(args: {
      source: string;
      target?: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const result = await diffEngine.diffBranches(args.source, args.target ?? "main");
        return textResult(JSON.stringify(result, null, 2));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to diff branches: ${msg}`);
      }
    },

    /**
     * merge_branch — Merge a branch into a target (default: main).
     */
    async merge_branch(args: {
      source: string;
      into?: string;
      dryRun?: boolean;
      detectConflicts?: boolean;
      conflictStrategy?: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const result = await mergeEngine.merge(args.source, args.into ?? "main", {
          dryRun: args.dryRun,
          detectConflicts: args.detectConflicts,
          conflictStrategy: (args.conflictStrategy as any) ?? "abort",
        });
        const prefix = result.dryRun ? "Dry-run preview" : "Merged";
        let output =
          `${prefix} "${result.sourceBranch}" → "${result.targetBranch}"\n` +
          `Collections affected: ${result.collectionsAffected}\n` +
          `Documents added: ${result.documentsAdded}\n` +
          `Documents removed: ${result.documentsRemoved}\n` +
          `Documents modified: ${result.documentsModified}`;
        if (result.conflicts.length > 0) {
          output += `\nConflicts: ${result.conflicts.length}\n` +
            result.conflicts.map((c) =>
              `  ⚠️  ${c.collection}/${String(c.documentId)}: ${c.reason}`
            ).join("\n");
        }
        return textResult(output);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to merge: ${msg}`);
      }
    },

    /**
     * delete_branch — Delete a branch and drop its database.
     */
    async delete_branch(args: {
      name: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const result = await branchManager.deleteBranch(args.name);
        return textResult(
          `Branch "${result.name}" deleted.\n` +
          `Database dropped: ${result.databaseDropped}\n` +
          `Collections removed: ${result.collectionsRemoved}`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to delete branch: ${msg}`);
      }
    },

    /**
     * gc — Garbage collect merged/deleted branch databases.
     */
    async gc(_args: {}): Promise<McpToolResult> {
      try {
        await ensureInit();
        const result = await branchManager.garbageCollect();
        if (result.cleaned === 0) {
          return textResult("Nothing to clean up.");
        }
        return textResult(
          `Cleaned ${result.cleaned} stale branches.\n` +
          `Databases dropped: ${result.databases.join(", ")}`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to garbage collect: ${msg}`);
      }
    },

    /**
     * rollback_branch — Reset a branch to match its source (undo all changes).
     */
    async rollback_branch(args: {
      name: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const result = await branchManager.rollbackBranch(args.name);
        return textResult(
          `Branch "${result.name}" rolled back.\n` +
          `Collections reset: ${result.collectionsReset}\n` +
          `Documents restored: ${result.documentsRestored}`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to rollback branch: ${msg}`);
      }
    },

    // ── Agent Tools ─────────────────────────────────────────────

    /**
     * register_agent — Register an AI agent for branch isolation.
     */
    async register_agent(args: {
      agentId: string;
      name?: string;
      description?: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const agent = await agentManager.registerAgent(args);
        return textResult(
          `Agent "${agent.agentId}" registered.\n` +
          `Name: ${agent.name ?? "—"}\n` +
          `Status: ${agent.status}`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to register agent: ${msg}`);
      }
    },

    /**
     * create_agent_branch — Create a task branch for a registered agent.
     */
    async create_agent_branch(args: {
      agentId: string;
      task: string;
      description?: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const branch = await agentManager.createAgentBranch(args.agentId, {
          task: args.task,
          description: args.description,
        });
        return textResult(
          `Branch "${branch.name}" created for agent "${args.agentId}".\n` +
          `Database: ${branch.branchDatabase}\n` +
          `Collections: ${branch.collections.join(", ")}`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to create agent branch: ${msg}`);
      }
    },

    /**
     * agent_status — Get status of a registered agent (branches, activity).
     */
    async agent_status(args: {
      agentId: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const status = await agentManager.getAgentStatus(args.agentId);
        return textResult(JSON.stringify(status, null, 2));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to get agent status: ${msg}`);
      }
    },

    // ── Workflow Tools ──────────────────────────────────────────

    /**
     * start_task — One-call workflow: register agent (if needed) + create task branch.
     * Call this at the beginning of any agent task.
     */
    async start_task(args: {
      agentId: string;
      task: string;
      description?: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();

        // Auto-register if not already registered
        try {
          await agentManager.registerAgent({ agentId: args.agentId });
        } catch {
          // Already registered — that's fine
        }

        const branch = await agentManager.createAgentBranch(args.agentId, {
          task: args.task,
          description: args.description,
        });

        return textResult(
          `Task started. Branch "${branch.name}" created.\n` +
          `Database: ${branch.branchDatabase}\n` +
          `Collections: ${branch.collections.join(", ")}\n` +
          `\nYou now have a full isolated copy. Make any changes freely.`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to start task: ${msg}`);
      }
    },

    /**
     * complete_task — One-call workflow: diff changes, optionally auto-merge.
     * Call this when an agent finishes its task.
     */
    async complete_task(args: {
      agentId: string;
      task: string;
      autoMerge?: boolean;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();

        const branchName = `${args.agentId}/${args.task}`;

        // Diff against main to show what changed
        const diff = await diffEngine.diffBranches(branchName, "main");
        let output = `Task review for "${branchName}":\n` +
          JSON.stringify(diff, null, 2);

        // Auto-merge if requested
        if (args.autoMerge && diff.totalChanges > 0) {
          const mergeResult = await mergeEngine.merge(branchName, "main");
          output += `\n\nMerged "${branchName}" → "main"\n` +
            `Documents added: ${mergeResult.documentsAdded}\n` +
            `Documents removed: ${mergeResult.documentsRemoved}\n` +
            `Documents modified: ${mergeResult.documentsModified}`;
        }

        return textResult(output);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to complete task: ${msg}`);
      }
    },

    // ── History Tools ───────────────────────────────────────────

    /**
     * branch_log — Get the event history for a branch.
     */
    async branch_log(args: {
      branchName?: string;
      limit?: number;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        if (args.branchName) {
          const log = await historyManager.getBranchLog(args.branchName);
          return textResult(JSON.stringify(log, null, 2));
        } else {
          const entries = await historyManager.getAllLogs(args.limit ?? 20);
          return textResult(JSON.stringify({ entries }, null, 2));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to get branch log: ${msg}`);
      }
    },

    /**
     * record_snapshot — Manually record a history event for a branch.
     * Used by agents to track their own data modifications.
     */
    async record_snapshot(args: {
      branchName: string;
      event: string;
      summary: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const validEvents = ["branch_created", "branch_merged", "branch_deleted", "data_modified"];
        const event = validEvents.includes(args.event) ? args.event as any : "data_modified";
        await historyManager.recordSnapshot({
          branchName: args.branchName,
          event,
          summary: args.summary,
        });
        return textResult(`Snapshot recorded for "${args.branchName}": ${args.summary}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to record snapshot: ${msg}`);
      }
    },

    // ── Merge Queue Tools ───────────────────────────────────────

    /**
     * enqueue_merge — Add a branch to the merge queue.
     */
    async enqueue_merge(args: {
      branchName: string;
      targetBranch?: string;
      queuedBy?: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const entry = await mergeQueue.enqueue(args.branchName, {
          targetBranch: args.targetBranch,
          queuedBy: args.queuedBy,
        });
        const length = await mergeQueue.queueLength();
        return textResult(
          `Branch "${entry.branchName}" queued for merge.\n` +
          `Position: ${length} in queue`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to enqueue: ${msg}`);
      }
    },

    /**
     * process_merge_queue — Process the next (or all) items in the merge queue.
     */
    async process_merge_queue(args: {
      all?: boolean;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        if (args.all) {
          const results = await mergeQueue.processAll();
          if (results.length === 0) {
            return textResult("Merge queue is empty.");
          }
          const summary = results.map((r) =>
            `${r.branchName}: ${r.status}${r.error ? ` (${r.error})` : ""}`
          ).join("\n");
          return textResult(`Processed ${results.length} merges:\n${summary}`);
        } else {
          const result = await mergeQueue.processNext();
          if (!result) {
            return textResult("Merge queue is empty.");
          }
          return textResult(
            `Processed: ${result.branchName} → ${result.status}` +
            (result.error ? `\nError: ${result.error}` : "")
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to process queue: ${msg}`);
      }
    },

    /**
     * merge_queue_status — Show the current state of the merge queue.
     */
    async merge_queue_status(_args: {}): Promise<McpToolResult> {
      try {
        await ensureInit();
        const pending = await mergeQueue.listQueue("pending");
        const processing = await mergeQueue.listQueue("processing");
        return textResult(JSON.stringify({
          pending: pending.map((e) => ({ branch: e.branchName, queuedAt: e.queuedAt })),
          processing: processing.map((e) => ({ branch: e.branchName, processedAt: e.processedAt })),
          queueLength: pending.length,
        }, null, 2));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to get queue status: ${msg}`);
      }
    },

    // ── Audit Export Tools ──────────────────────────────────────

    /**
     * export_audit_log — Export audit history as JSON or CSV.
     */
    async export_audit_log(args: {
      format?: string;
      branchName?: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const format = args.format ?? "json";
        const opts = args.branchName ? { branchName: args.branchName } : undefined;

        let output: string;
        if (format === "csv") {
          output = await historyManager.exportCSV(opts);
        } else {
          output = await historyManager.exportJSON(opts);
        }

        return textResult(output);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to export audit log: ${msg}`);
      }
    },

    /**
     * materialization_status — Check lazy branch materialization status.
     */
    async materialization_status(args: {
      branchName: string;
    }): Promise<McpToolResult> {
      try {
        const status = await branchManager.getBranchMaterializationStatus(args.branchName);
        return textResult(JSON.stringify(status, null, 2));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to get materialization status: ${msg}`);
      }
    },

    // ── CRUD Proxy + OpLog Tools ────────────────────────────────

    /**
     * branch_insert — Insert a document into a branch collection.
     */
    async branch_insert(args: {
      branchName: string;
      collection: string;
      document: Record<string, unknown>;
      performedBy?: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const result = await proxy.insertOne(
          args.branchName, args.collection, args.document, args.performedBy
        );
        return textResult(`Inserted document ${result.insertedId} into ${args.collection}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to insert: ${msg}`);
      }
    },

    /**
     * branch_update — Update a document on a branch collection.
     */
    async branch_update(args: {
      branchName: string;
      collection: string;
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
      performedBy?: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const result = await proxy.updateOne(
          args.branchName, args.collection, args.filter, args.update, args.performedBy
        );
        return textResult(
          `Updated ${result.modifiedCount} of ${result.matchedCount} matched documents`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to update: ${msg}`);
      }
    },

    /**
     * branch_delete — Delete a document from a branch collection.
     */
    async branch_delete(args: {
      branchName: string;
      collection: string;
      filter: Record<string, unknown>;
      performedBy?: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const result = await proxy.deleteOne(
          args.branchName, args.collection, args.filter, args.performedBy
        );
        return textResult(`Deleted ${result.deletedCount} document(s)`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to delete: ${msg}`);
      }
    },

    /**
     * branch_find — Query documents on a branch collection.
     */
    async branch_find(args: {
      branchName: string;
      collection: string;
      filter?: Record<string, unknown>;
      limit?: number;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const docs = await proxy.find(
          args.branchName, args.collection, args.filter ?? {}, { limit: args.limit }
        );
        return textResult(JSON.stringify(docs, null, 2));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to find: ${msg}`);
      }
    },

    /**
     * branch_oplog — Get the operation log for a branch.
     */
    async branch_oplog(args: {
      branchName: string;
      collection?: string;
      limit?: number;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const ops = await oplog.getBranchOps(args.branchName, {
          collection: args.collection,
          limit: args.limit,
        });
        if (ops.length === 0) {
          return textResult(`No operations recorded for "${args.branchName}"`);
        }
        const summary = await oplog.getOpSummary(args.branchName);
        return textResult(JSON.stringify({ summary, operations: ops }, null, 2));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to get oplog: ${msg}`);
      }
    },

    /**
     * branch_undo — Undo the last N operations on a branch.
     */
    async branch_undo(args: {
      branchName: string;
      count?: number;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const undone = await oplog.undoLast(args.branchName, args.count ?? 1);
        return textResult(`Undid ${undone} operation(s) on "${args.branchName}"`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to undo: ${msg}`);
      }
    },
  };
}
