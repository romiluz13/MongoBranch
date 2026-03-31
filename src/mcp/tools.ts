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
import { CommitEngine } from "../core/commit.ts";
import { ProtectionManager } from "../core/protection.ts";
import { HookManager } from "../core/hooks.ts";
import { TimeTravelEngine } from "../core/timetravel.ts";
import { DeployRequestManager } from "../core/deploy.ts";
import { ScopeManager } from "../core/scope.ts";
import { BranchComparator } from "../core/compare.ts";
import { StashManager } from "../core/stash.ts";
import { AnonymizeEngine } from "../core/anonymize.ts";
import { ReflogManager } from "../core/reflog.ts";
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
  const commitEngine = new CommitEngine(client, config);
  const protectionManager = new ProtectionManager(client, config);
  const hookManager = new HookManager(client, config);
  const timeTravelEngine = new TimeTravelEngine(client, config);
  const deployRequestManager = new DeployRequestManager(client, config);
  const scopeManager = new ScopeManager(client, config);
  const branchComparator = new BranchComparator(client, config);
  const stashManager = new StashManager(client, config);
  const anonymizeEngine = new AnonymizeEngine(client, config);
  const reflogManager = new ReflogManager(client, config);

  // Initialize all managers (create indexes)
  let initialized = false;
  async function ensureInit(): Promise<void> {
    if (!initialized) {
      await agentManager.initialize();
      await historyManager.initialize();
      await mergeQueue.initialize();
      await oplog.initialize();
      await commitEngine.initialize();
      await protectionManager.initialize();
      await hookManager.initialize();
      await timeTravelEngine.initialize();
      await deployRequestManager.initialize();
      await scopeManager.initialize();
      await stashManager.initialize();
      await reflogManager.initialize();
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

    // ── Commit Tools (Wave 4) ───────────────────────────────

    /**
     * commit — Create an immutable, content-addressed commit on a branch.
     */
    async commit(args: {
      branchName: string;
      message: string;
      author?: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const commit = await commitEngine.commit({
          branchName: args.branchName,
          message: args.message,
          author: args.author,
        });
        return textResult(
          `Commit created on "${args.branchName}"\n` +
          `Hash: ${commit.hash}\n` +
          `Parent(s): ${commit.parentHashes.length > 0 ? commit.parentHashes.join(", ") : "(root)"}\n` +
          `Message: ${commit.message}\n` +
          `Collections: ${Object.keys(commit.snapshot.collections).join(", ")}`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to commit: ${msg}`);
      }
    },

    /**
     * get_commit — Retrieve a single commit by its hash.
     */
    async get_commit(args: { hash: string }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const commit = await commitEngine.getCommit(args.hash);
        if (!commit) {
          return errorResult(`Commit "${args.hash}" not found`);
        }
        return textResult(JSON.stringify(commit, null, 2));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to get commit: ${msg}`);
      }
    },

    /**
     * commit_log — Walk the commit history of a branch (most recent first).
     */
    async commit_log(args: {
      branchName: string;
      limit?: number;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const log = await commitEngine.getLog(args.branchName, args.limit);
        if (log.commits.length === 0) {
          return textResult(`No commits on branch "${args.branchName}"`);
        }
        const lines = log.commits.map((c, i) =>
          `${i + 1}. [${c.hash.slice(0, 8)}] ${c.message} (${c.author}, ${c.timestamp.toISOString()})`
        );
        return textResult(
          `Commit log for "${args.branchName}" (${log.commits.length} commits):\n` +
          lines.join("\n")
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to get commit log: ${msg}`);
      }
    },

    // ── Tag Tools (Wave 4) ──────────────────────────────────

    /**
     * create_tag — Create an immutable named reference to a commit.
     */
    async create_tag(args: {
      name: string;
      commitHash?: string;
      branchName?: string;
      message?: string;
      author?: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        if (!args.commitHash && !args.branchName) {
          return errorResult("Provide either commitHash or branchName to tag");
        }
        const target = args.commitHash ?? args.branchName!;
        const tag = await commitEngine.createTag(args.name, target, {
          message: args.message,
          author: args.author,
          isBranch: !args.commitHash && !!args.branchName,
        });
        return textResult(
          `Tag "${tag.name}" created → commit ${tag.commitHash.slice(0, 12)}` +
          (tag.message ? `\nMessage: ${tag.message}` : "")
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to create tag: ${msg}`);
      }
    },

    /**
     * list_tags — List all tags with their commit references.
     */
    async list_tags(): Promise<McpToolResult> {
      try {
        await ensureInit();
        const tags = await commitEngine.listTags();
        if (tags.length === 0) {
          return textResult("No tags found");
        }
        const lines = tags.map((t) =>
          `  ${t.name} → ${t.commitHash.slice(0, 8)} (${t.createdBy}, ${t.createdAt.toISOString()})` +
          (t.message ? ` — ${t.message}` : "")
        );
        return textResult(`Tags (${tags.length}):\n${lines.join("\n")}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to list tags: ${msg}`);
      }
    },

    /**
     * delete_tag — Remove a tag by name.
     */
    async delete_tag(args: { name: string }): Promise<McpToolResult> {
      try {
        await ensureInit();
        await commitEngine.deleteTag(args.name);
        return textResult(`Tag "${args.name}" deleted`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to delete tag: ${msg}`);
      }
    },

    // ── Three-Way Merge Tools (Wave 4) ──────────────────────

    /**
     * merge_three_way — Git-like three-way merge using common ancestor.
     * Auto-merges non-overlapping changes, detects per-field conflicts.
     */
    /**
     * cherry_pick — Apply a single commit's changes to a target branch.
     */
    async cherry_pick(args: {
      targetBranch: string;
      commitHash: string;
      author?: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const result = await commitEngine.cherryPick(
          args.targetBranch, args.commitHash, args.author
        );
        return textResult(
          `Cherry-pick successful!\n` +
          `Source commit: ${result.sourceCommitHash.slice(0, 12)}\n` +
          `New commit: ${result.newCommitHash.slice(0, 12)}\n` +
          `Added: ${result.documentsAdded}, Removed: ${result.documentsRemoved}, Modified: ${result.documentsModified}`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Cherry-pick failed: ${msg}`);
      }
    },

    /**
     * revert_commit — Undo a specific commit by creating an inverse commit.
     */
    async revert_commit(args: {
      branchName: string;
      commitHash: string;
      author?: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const result = await commitEngine.revert(
          args.branchName, args.commitHash, args.author
        );
        return textResult(
          `Revert successful!\n` +
          `Reverted commit: ${result.revertedCommitHash.slice(0, 12)}\n` +
          `New commit: ${result.newCommitHash.slice(0, 12)}\n` +
          `Documents reverted: ${result.documentsReverted}`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Revert failed: ${msg}`);
      }
    },

    // ── TTL & Reset Tools (Wave 5) ────────────────────────────

    async set_branch_ttl(args: {
      branchName: string;
      ttlMinutes?: number;
      remove?: boolean;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        if (args.remove) {
          await branchManager.setBranchExpiration(args.branchName, null);
          return textResult(`TTL removed from "${args.branchName}"`);
        }
        const minutes = args.ttlMinutes ?? 60;
        const newExpiry = await branchManager.extendBranch(args.branchName, minutes);
        return textResult(
          `TTL set on "${args.branchName}" — expires at ${newExpiry.toISOString()} (${minutes} minutes)`
        );
      } catch (err: unknown) {
        return errorResult(`Failed to set TTL: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async reset_from_parent(args: { branchName: string }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const branch = await branchManager.resetFromParent(args.branchName);
        return textResult(
          `Branch "${args.branchName}" reset from parent.\n` +
          `Collections refreshed: ${branch.collections.join(", ")}`
        );
      } catch (err: unknown) {
        return errorResult(`Failed to reset: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async merge_three_way(args: {
      sourceBranch: string;
      targetBranch: string;
      dryRun?: boolean;
      conflictStrategy?: string;
      author?: string;
      message?: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const result = await mergeEngine.threeWayMerge(
          args.sourceBranch, args.targetBranch, commitEngine,
          {
            dryRun: args.dryRun,
            conflictStrategy: (args.conflictStrategy as any) ?? "manual",
            author: args.author,
            message: args.message,
          }
        );

        if (!result.success && result.conflicts.length > 0) {
          const conflictLines = result.conflicts.map((c) =>
            `  ⚠️ ${c.collection}.${c.documentId} → field "${c.field}": ours=${JSON.stringify(c.ours)}, theirs=${JSON.stringify(c.theirs)}`
          );
          return textResult(
            `Three-way merge BLOCKED — ${result.conflicts.length} conflict(s):\n` +
            conflictLines.join("\n") + "\n\n" +
            `Re-run with conflictStrategy="theirs" or "ours" to auto-resolve.`
          );
        }

        return textResult(
          `Three-way merge ${result.dryRun ? "(DRY RUN) " : ""}successful!\n` +
          `Source: "${result.sourceBranch}" → Target: "${result.targetBranch}"\n` +
          `Merge base: ${result.mergeBase?.slice(0, 8) ?? "none"}\n` +
          `Added: ${result.documentsAdded}, Removed: ${result.documentsRemoved}, Modified: ${result.documentsModified}\n` +
          (result.mergeCommitHash ? `Merge commit: ${result.mergeCommitHash.slice(0, 12)}` : "")
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Three-way merge failed: ${msg}`);
      }
    },

    // ── Protection Tools (Wave 5) ───────────────────────────

    async protect_branch(args: {
      pattern: string;
      requireMergeOnly?: boolean;
      preventDelete?: boolean;
      createdBy?: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const rule = await protectionManager.protectBranch(args.pattern, args);
        return textResult(
          `Protection rule created: "${rule.pattern}"\n` +
          `Merge only: ${rule.requireMergeOnly}, Prevent delete: ${rule.preventDelete}`
        );
      } catch (err: unknown) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async list_protections(): Promise<McpToolResult> {
      try {
        await ensureInit();
        const rules = await protectionManager.listProtections();
        if (rules.length === 0) return textResult("No protection rules");
        const lines = rules.map(r =>
          `  ${r.pattern} — mergeOnly:${r.requireMergeOnly} noDelete:${r.preventDelete} (${r.createdBy})`
        );
        return textResult(`Protection rules (${rules.length}):\n${lines.join("\n")}`);
      } catch (err: unknown) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async remove_protection(args: { pattern: string }): Promise<McpToolResult> {
      try {
        await ensureInit();
        await protectionManager.removeProtection(args.pattern);
        return textResult(`Protection removed for "${args.pattern}"`);
      } catch (err: unknown) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    // ── Hook Tools (Wave 5) ─────────────────────────────────

    async list_hooks(args: { event?: string }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const hooks = await hookManager.listHooks(args.event as any);
        if (hooks.length === 0) return textResult("No hooks registered");
        const lines = hooks.map(h =>
          `  [${h.priority}] ${h.name} → ${h.event} (${h.createdBy})`
        );
        return textResult(`Hooks (${hooks.length}):\n${lines.join("\n")}`);
      } catch (err: unknown) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async remove_hook(args: { name: string }): Promise<McpToolResult> {
      try {
        await ensureInit();
        await hookManager.removeHook(args.name);
        return textResult(`Hook "${args.name}" removed`);
      } catch (err: unknown) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    // ── Time Travel Tools (Wave 6) ──────────────────────────

    async time_travel_query(args: {
      branchName: string;
      collection: string;
      commitHash?: string;
      timestamp?: string;
      filter?: Record<string, unknown>;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const docs = await timeTravelEngine.findAt({
          branchName: args.branchName,
          collection: args.collection,
          commitHash: args.commitHash,
          timestamp: args.timestamp ? new Date(args.timestamp) : undefined,
          filter: args.filter,
        });
        return textResult(JSON.stringify({ count: docs.length, documents: docs }, null, 2));
      } catch (err: unknown) {
        return errorResult(`Time travel failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async blame(args: {
      branchName: string;
      collection: string;
      documentId: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const result = await timeTravelEngine.blame(args.branchName, args.collection, args.documentId);
        const lines = Object.entries(result.fields).map(([field, info]) =>
          `  ${field}: commit ${info.commitHash.slice(0, 8)} by ${info.author} — "${info.message}"`
        );
        return textResult(`Blame for ${args.collection}/${args.documentId}:\n${lines.join("\n")}`);
      } catch (err: unknown) {
        return errorResult(`Blame failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    // ── Deploy Request Tools (Wave 6) ────────────────────────

    async open_deploy_request(args: {
      sourceBranch: string;
      targetBranch: string;
      description: string;
      createdBy: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const dr = await deployRequestManager.open(args);
        return textResult(
          `Deploy request #${dr.id} opened.\n` +
          `${dr.sourceBranch} → ${dr.targetBranch}\n` +
          `Status: ${dr.status}\n` +
          `Description: ${dr.description}`
        );
      } catch (err: unknown) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async approve_deploy_request(args: { id: string; reviewedBy: string }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const dr = await deployRequestManager.approve(args.id, args.reviewedBy);
        return textResult(`Deploy request #${dr.id} approved by ${dr.reviewedBy}`);
      } catch (err: unknown) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async reject_deploy_request(args: {
      id: string;
      reviewedBy: string;
      reason: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const dr = await deployRequestManager.reject(args.id, args.reviewedBy, args.reason);
        return textResult(`Deploy request #${dr.id} rejected: ${dr.rejectionReason}`);
      } catch (err: unknown) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async execute_deploy_request(args: { id: string }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const { deployRequest, mergeResult } = await deployRequestManager.execute(args.id);
        return textResult(
          `Deploy request #${deployRequest.id} executed!\n` +
          `Merged: ${mergeResult.sourceBranch} → ${mergeResult.targetBranch}\n` +
          `Added: ${mergeResult.documentsAdded}, Removed: ${mergeResult.documentsRemoved}, Modified: ${mergeResult.documentsModified}`
        );
      } catch (err: unknown) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async list_deploy_requests(args: {
      status?: string;
      targetBranch?: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const drs = await deployRequestManager.list({
          status: args.status as any,
          targetBranch: args.targetBranch,
        });
        if (drs.length === 0) return textResult("No deploy requests found");
        const lines = drs.map(dr =>
          `  #${dr.id} [${dr.status}] ${dr.sourceBranch} → ${dr.targetBranch} — ${dr.description} (${dr.createdBy})`
        );
        return textResult(`Deploy requests (${drs.length}):\n${lines.join("\n")}`);
      } catch (err: unknown) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    // ── Agent Scope Tools (Wave 7) ──────────────────────────

    async set_agent_scope(args: {
      agentId: string;
      permissions: string[];
      allowedCollections?: string[];
      deniedCollections?: string[];
      maxBranches?: number;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const scope = await scopeManager.setScope({
          agentId: args.agentId,
          permissions: args.permissions as any,
          allowedCollections: args.allowedCollections,
          deniedCollections: args.deniedCollections,
          maxBranches: args.maxBranches,
        });
        return textResult(`Scope set for agent "${scope.agentId}": ${scope.permissions.join(", ")}`);
      } catch (err: unknown) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async check_agent_permission(args: {
      agentId: string;
      collection: string;
      operation: string;
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const result = await scopeManager.checkPermission(args.agentId, args.collection, args.operation as any);
        return textResult(result.allowed
          ? `✅ Agent "${args.agentId}" allowed to ${args.operation} on ${args.collection}`
          : `❌ Denied: ${result.reason}`);
      } catch (err: unknown) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async get_agent_violations(args: { agentId: string }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const violations = await scopeManager.getViolations(args.agentId);
        if (violations.length === 0) return textResult(`No violations for agent "${args.agentId}"`);
        const lines = violations.map(v =>
          `  ${v.timestamp.toISOString()} — ${v.operation} on ${v.collection}: ${v.reason}`
        );
        return textResult(`Violations for "${args.agentId}" (${violations.length}):\n${lines.join("\n")}`);
      } catch (err: unknown) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    // ── Branch Compare (Wave 7) ─────────────────────────────

    async compare_branches(args: { branches: string[] }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const result = await branchComparator.compare(args.branches);
        return textResult(
          `Compare ${result.branches.join(" vs ")}:\n` +
          `  Total documents: ${result.stats.totalDocuments}\n` +
          `  In all branches: ${result.stats.inAllBranches}\n` +
          `  In some: ${result.stats.inSomeBranches}\n` +
          `  Unique to one: ${result.stats.uniqueToOneBranch}`
        );
      } catch (err: unknown) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    // ── Stash Tools (Wave 7) ────────────────────────────────

    async stash(args: { branchName: string; message: string }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const entry = await stashManager.stash(args.branchName, args.message);
        return textResult(`Stashed "${entry.message}" on ${entry.branchName} (index ${entry.index})`);
      } catch (err: unknown) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async stash_pop(args: { branchName: string }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const entry = await stashManager.pop(args.branchName);
        return textResult(`Popped stash "${entry.message}" — data restored on ${entry.branchName}`);
      } catch (err: unknown) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async stash_list(args: { branchName: string }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const entries = await stashManager.list(args.branchName);
        if (entries.length === 0) return textResult("No stashes");
        const lines = entries.map(e => `  stash@{${e.index}}: ${e.message} (${e.createdAt.toISOString()})`);
        return textResult(`Stashes on ${args.branchName}:\n${lines.join("\n")}`);
      } catch (err: unknown) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    // ── Anonymize (Wave 7) ──────────────────────────────────

    async create_anonymized_branch(args: {
      branchName: string;
      rules: { collection: string; fields: { path: string; strategy: string }[] }[];
    }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const result = await anonymizeEngine.createAnonymizedBranch(args.branchName, args.rules as any);
        return textResult(
          `Anonymized branch "${result.branchName}" created.\n` +
          `  Documents: ${result.documentsProcessed}, Fields: ${result.fieldsAnonymized}`
        );
      } catch (err: unknown) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    // ── Reflog (Wave 7) ─────────────────────────────────────

    async reflog(args: { branchName?: string; limit?: number }): Promise<McpToolResult> {
      try {
        await ensureInit();
        const entries = args.branchName
          ? await reflogManager.forBranch(args.branchName, args.limit ?? 50)
          : await reflogManager.all(args.limit ?? 100);
        if (entries.length === 0) return textResult("No reflog entries");
        const lines = entries.map(e =>
          `  ${e.timestamp.toISOString()} ${e.branchName} ${e.action}: ${e.detail}${e.commitHash ? ` (${e.commitHash.slice(0, 8)})` : ""}`
        );
        return textResult(`Reflog (${entries.length} entries):\n${lines.join("\n")}`);
      } catch (err: unknown) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
