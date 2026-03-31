#!/usr/bin/env node
/**
 * MongoBranch CLI — Git-like branching for MongoDB
 *
 * Usage: mb branch create|list|switch|delete
 *        mb diff <branch-a> <branch-b>
 *        mb merge <source> --into <target>
 */
import { Command } from "commander";
import { MongoClient } from "mongodb";
import chalk from "chalk";
import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { BranchManager } from "./core/branch.ts";
import { DiffEngine } from "./core/diff.ts";
import { MergeEngine } from "./core/merge.ts";
import { HistoryManager } from "./core/history.ts";
import { CommitEngine } from "./core/commit.ts";
import { TimeTravelEngine } from "./core/timetravel.ts";
import { DeployRequestManager } from "./core/deploy.ts";
import { StashManager } from "./core/stash.ts";
import { BranchComparator } from "./core/compare.ts";
import { ReflogManager } from "./core/reflog.ts";
import { AnonymizeEngine } from "./core/anonymize.ts";
import { SearchIndexManager } from "./core/search-index.ts";
import type { MongoBranchConfig } from "./core/types.ts";
import { DEFAULT_CONFIG } from "./core/types.ts";

const program = new Command();

program
  .name("mb")
  .description("MongoBranch — Git-like branching for MongoDB data")
  .version("0.1.0");

/**
 * Load config: env vars → .mongobranch.yaml → defaults
 * Priority: env vars override yaml, yaml overrides defaults.
 */
function loadConfig(): MongoBranchConfig {
  let fileConfig: Partial<MongoBranchConfig> = {};

  const configPath = ".mongobranch.yaml";
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      fileConfig = parseYaml(raw) ?? {};
    } catch {
      // Silently fall back to defaults if YAML is invalid
    }
  }

  const uri = process.env.MONGOBRANCH_URI ?? fileConfig.uri ?? DEFAULT_CONFIG.uri;
  const sourceDatabase = process.env.MONGOBRANCH_DB ?? fileConfig.sourceDatabase ?? DEFAULT_CONFIG.sourceDatabase;
  const metaDatabase = fileConfig.metaDatabase ?? DEFAULT_CONFIG.metaDatabase;
  const branchPrefix = fileConfig.branchPrefix ?? DEFAULT_CONFIG.branchPrefix;

  return { uri, sourceDatabase, metaDatabase, branchPrefix };
}

/** Simple y/N confirmation prompt on stdin. */
function askConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.setEncoding("utf-8");
    process.stdin.once("data", (data: string) => {
      resolve(data.trim().toLowerCase() === "y");
    });
  });
}

async function withBranchManager<T>(
  fn: (manager: BranchManager, client: MongoClient) => Promise<T>
): Promise<T> {
  const config = loadConfig();
  const client = new MongoClient(config.uri);
  try {
    await client.connect();
    const manager = new BranchManager(client, config);
    await manager.initialize();
    return await fn(manager, client);
  } finally {
    await client.close();
  }
}

const branch = program.command("branch").description("Manage data branches");

branch
  .command("create <name>")
  .description("Create a new branch from current data")
  .option("-d, --description <text>", "Branch description")
  .option("--from <branch>", "Branch from a specific branch (default: main)")
  .option("--created-by <name>", "Creator identity (e.g. agent-id)")
  .action(async (name: string, opts) => {
    await withBranchManager(async (manager) => {
      const branch = await manager.createBranch({
        name,
        description: opts.description,
        from: opts.from,
        createdBy: opts.createdBy,
      });
      console.log(chalk.green(`✅ Branch "${branch.name}" created`));
      console.log(chalk.dim(`   Database: ${branch.branchDatabase}`));
      console.log(chalk.dim(`   Collections: ${branch.collections.join(", ")}`));
    });
  });

branch
  .command("list")
  .description("List all branches")
  .option("-a, --all", "Include deleted branches")
  .action(async (opts) => {
    await withBranchManager(async (manager) => {
      const branches = await manager.listBranches({
        includeDeleted: opts.all,
      });

      if (branches.length === 0) {
        console.log("No branches found. Create one with: mb branch create <name>");
        return;
      }

      console.log(chalk.bold(`\n  Branches (${branches.length}):\n`));
      for (const b of branches) {
        const current = manager.getCurrentBranch() === b.name ? chalk.cyan(" ← current") : "";
        const status = b.status === "deleted" ? chalk.red(" [deleted]") :
                       b.status === "merged" ? chalk.yellow(" [merged]") : "";
        console.log(`  ${chalk.bold(b.name)}${status}${current}`);
        console.log(chalk.dim(`    Created: ${b.createdAt.toISOString()}`));
        console.log(chalk.dim(`    Database: ${b.branchDatabase}`));
        if (b.description) console.log(chalk.dim(`    Description: ${b.description}`));
        console.log();
      }
    });
  });

branch
  .command("switch <name>")
  .description("Switch to a branch")
  .action(async (name: string) => {
    await withBranchManager(async (manager) => {
      const result = await manager.switchBranch(name);
      console.log(chalk.cyan(`🔀 Switched to "${result.currentBranch}"`));
      console.log(chalk.dim(`   Database: ${result.database}`));
      if (result.previousBranch) {
        console.log(chalk.dim(`   Previous: ${result.previousBranch}`));
      }
    });
  });

branch
  .command("delete <name>")
  .description("Delete a branch and drop its database")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (name: string, opts) => {
    if (!opts.yes) {
      const answer = await askConfirm(
        chalk.yellow(`⚠️  Delete branch "${name}" and drop its database? This cannot be undone. [y/N] `)
      );
      if (!answer) {
        console.log(chalk.dim("Cancelled."));
        return;
      }
    }
    await withBranchManager(async (manager) => {
      const result = await manager.deleteBranch(name);
      console.log(chalk.red(`🗑️  Branch "${result.name}" deleted`));
      console.log(chalk.dim(`   Database dropped: ${result.databaseDropped}`));
      console.log(chalk.dim(`   Collections removed: ${result.collectionsRemoved}`));
    });
  });

// ── Diff Command ────────────────────────────────────────────

program
  .command("diff <source> [target]")
  .description("Show differences between two branches (default target: main)")
  .option("--json", "Output as JSON")
  .action(async (source: string, target: string | undefined, opts) => {
    const config = loadConfig();
    const client = new MongoClient(config.uri);
    try {
      await client.connect();
      const diffEngine = new DiffEngine(client, config);
      const result = await diffEngine.diffBranches(source, target ?? "main");

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.totalChanges === 0) {
        console.log(chalk.green(`✅ No differences between "${source}" and "${target ?? "main"}"`));
        return;
      }

      console.log(chalk.bold(`\n📊 Diff: ${source} → ${target ?? "main"} (${result.totalChanges} changes)\n`));
      for (const [coll, diff] of Object.entries(result.collections)) {
        const counts = [
          diff.added.length ? chalk.green(`+${diff.added.length} added`) : "",
          diff.removed.length ? chalk.red(`-${diff.removed.length} removed`) : "",
          diff.modified.length ? chalk.yellow(`~${diff.modified.length} modified`) : "",
        ].filter(Boolean).join(", ");
        console.log(chalk.bold(` ${coll}`) + ` (${counts})`);

        for (const doc of diff.added) {
          console.log(chalk.green(`   + ${JSON.stringify(doc, null, 0).slice(0, 80)}...`));
        }
        for (const doc of diff.removed) {
          console.log(chalk.red(`   - ${JSON.stringify(doc, null, 0).slice(0, 80)}...`));
        }
        for (const mod of diff.modified) {
          console.log(chalk.yellow(`   ~ _id: ${mod._id}`));
          if (mod.fields) {
            for (const [key, val] of Object.entries(mod.fields)) {
              console.log(`       ${key}: ${chalk.red(JSON.stringify(val.from))} → ${chalk.green(JSON.stringify(val.to))}`);
            }
          }
        }
        console.log();
      }
    } finally {
      await client.close();
    }
  });

// ── Merge Command ───────────────────────────────────────────

program
  .command("merge <source>")
  .description("Merge a branch into target (default: main)")
  .option("--into <target>", "Target branch", "main")
  .option("--dry-run", "Preview what would change without applying")
  .action(async (source: string, opts) => {
    const config = loadConfig();
    const client = new MongoClient(config.uri);
    try {
      await client.connect();
      const mergeEngine = new MergeEngine(client, config);
      const result = await mergeEngine.merge(source, opts.into, {
        dryRun: opts.dryRun,
      });

      if (result.dryRun) {
        console.log(chalk.yellow(`🔍 Dry-run: "${source}" → "${opts.into}" (no changes applied)`));
      } else {
        console.log(chalk.green(`✅ Merged "${source}" → "${opts.into}"`));
      }
      console.log(chalk.dim(`   Collections affected: ${result.collectionsAffected}`));
      console.log(chalk.dim(`   Documents added: ${result.documentsAdded}`));
      console.log(chalk.dim(`   Documents removed: ${result.documentsRemoved}`));
      console.log(chalk.dim(`   Documents modified: ${result.documentsModified}`));
    } finally {
      await client.close();
    }
  });

// ── Log Command ─────────────────────────────────────────────

program
  .command("log [branch]")
  .description("Show event history for a branch (or all branches)")
  .option("-n, --limit <count>", "Max entries to show", "20")
  .action(async (branch: string | undefined, opts) => {
    const config = loadConfig();
    const client = new MongoClient(config.uri);
    try {
      await client.connect();
      const history = new HistoryManager(client, config);

      if (branch) {
        const log = await history.getBranchLog(branch);
        if (log.entries.length === 0) {
          console.log(chalk.dim(`No history for branch "${branch}"`));
          return;
        }
        console.log(chalk.bold(`\n📜 History: ${branch}\n`));
        for (const entry of log.entries) {
          const time = entry.timestamp.toISOString().replace("T", " ").slice(0, 19);
          const icon = entry.event === "branch_created" ? "🌿" :
                       entry.event === "branch_merged" ? "🔀" :
                       entry.event === "branch_deleted" ? "🗑️" : "📝";
          console.log(`  ${chalk.dim(time)}  ${icon}  ${entry.summary}`);
        }
      } else {
        const entries = await history.getAllLogs(parseInt(opts.limit, 10));
        if (entries.length === 0) {
          console.log(chalk.dim("No history recorded yet."));
          return;
        }
        console.log(chalk.bold(`\n📜 Recent History (${entries.length} entries)\n`));
        for (const entry of entries) {
          const time = entry.timestamp.toISOString().replace("T", " ").slice(0, 19);
          const icon = entry.event === "branch_created" ? "🌿" :
                       entry.event === "branch_merged" ? "🔀" :
                       entry.event === "branch_deleted" ? "🗑️" : "📝";
          console.log(`  ${chalk.dim(time)}  ${icon}  ${chalk.cyan(entry.branchName)}  ${entry.summary}`);
        }
      }
      console.log();
    } finally {
      await client.close();
    }
  });

// ── GC Command ──────────────────────────────────────────────

program
  .command("gc")
  .description("Garbage collect merged/deleted branch databases")
  .action(async () => {
    const config = loadConfig();
    const client = new MongoClient(config.uri);
    try {
      await client.connect();
      const manager = new BranchManager(client, config);
      await manager.initialize();
      const result = await manager.garbageCollect();
      if (result.cleaned === 0) {
        console.log(chalk.dim("Nothing to clean up."));
      } else {
        console.log(chalk.green(`🧹 Cleaned ${result.cleaned} stale branches`));
        for (const db of result.databases) {
          console.log(chalk.dim(`   Dropped: ${db}`));
        }
      }
    } finally {
      await client.close();
    }
  });

// ── Commit Command (Wave 4) ─────────────────────────────────

program
  .command("commit <branch>")
  .description("Create an immutable commit on a branch")
  .requiredOption("-m, --message <text>", "Commit message")
  .option("--author <name>", "Author of the commit")
  .action(async (branch: string, opts) => {
    const config = loadConfig();
    const client = new MongoClient(config.uri);
    try {
      await client.connect();
      const commitEngine = new CommitEngine(client, config);
      await commitEngine.initialize();
      const commit = await commitEngine.commit({
        branchName: branch,
        message: opts.message,
        author: opts.author,
      });
      console.log(chalk.green(`✅ Commit created on "${branch}"`));
      console.log(chalk.dim(`   Hash: ${commit.hash.slice(0, 12)}...`));
      console.log(chalk.dim(`   Parent(s): ${commit.parentHashes.length > 0 ? commit.parentHashes.map((h: string) => h.slice(0, 8)).join(", ") : "(root)"}`));
      console.log(chalk.dim(`   Collections: ${Object.keys(commit.snapshot.collections).join(", ")}`));
    } finally {
      await client.close();
    }
  });

// ── Commit Log Command (Wave 4) ─────────────────────────────

program
  .command("commits <branch>")
  .description("Show commit history for a branch")
  .option("-n, --limit <count>", "Max commits to show", "20")
  .action(async (branch: string, opts) => {
    const config = loadConfig();
    const client = new MongoClient(config.uri);
    try {
      await client.connect();
      const commitEngine = new CommitEngine(client, config);
      await commitEngine.initialize();
      const log = await commitEngine.getLog(branch, parseInt(opts.limit));
      if (log.commits.length === 0) {
        console.log(chalk.dim(`No commits on branch "${branch}"`));
        return;
      }
      console.log(chalk.bold(`Commit log for "${branch}" (${log.commits.length} commits):\n`));
      for (const c of log.commits) {
        const parents = c.parentHashes.length > 0
          ? c.parentHashes.map((h: string) => h.slice(0, 8)).join(", ")
          : "(root)";
        console.log(chalk.yellow(`  ${c.hash.slice(0, 8)}`), chalk.white(c.message));
        console.log(chalk.dim(`           ${c.author} · ${c.timestamp.toISOString()} · parents: ${parents}`));
      }
    } finally {
      await client.close();
    }
  });

// ── Tag Commands (Wave 4) ────────────────────────────────────

const tagCmd = program
  .command("tag")
  .description("Manage tags — immutable named references to commits");

tagCmd
  .command("create <name>")
  .description("Create a tag pointing to a commit or branch HEAD")
  .option("--commit <hash>", "Commit hash to tag")
  .option("--branch <name>", "Branch whose HEAD to tag")
  .option("-m, --message <text>", "Tag annotation message")
  .option("--author <name>", "Who created the tag")
  .action(async (name: string, opts) => {
    if (!opts.commit && !opts.branch) {
      console.error(chalk.red("❌ Provide --commit <hash> or --branch <name>"));
      process.exit(1);
    }
    const config = loadConfig();
    const client = new MongoClient(config.uri);
    try {
      await client.connect();
      const commitEngine = new CommitEngine(client, config);
      await commitEngine.initialize();
      const target = opts.commit ?? opts.branch;
      const tag = await commitEngine.createTag(name, target, {
        message: opts.message,
        author: opts.author,
        isBranch: !opts.commit && !!opts.branch,
      });
      console.log(chalk.green(`✅ Tag "${tag.name}" → ${tag.commitHash.slice(0, 12)}`));
    } finally {
      await client.close();
    }
  });

tagCmd
  .command("list")
  .description("List all tags")
  .action(async () => {
    const config = loadConfig();
    const client = new MongoClient(config.uri);
    try {
      await client.connect();
      const commitEngine = new CommitEngine(client, config);
      await commitEngine.initialize();
      const tags = await commitEngine.listTags();
      if (tags.length === 0) {
        console.log(chalk.dim("No tags found"));
        return;
      }
      console.log(chalk.bold(`Tags (${tags.length}):\n`));
      for (const t of tags) {
        console.log(
          chalk.yellow(`  ${t.name}`),
          chalk.dim(`→ ${t.commitHash.slice(0, 8)}`),
          chalk.dim(`(${t.createdBy}, ${t.createdAt.toISOString()})`)
        );
        if (t.message) console.log(chalk.dim(`    ${t.message}`));
      }
    } finally {
      await client.close();
    }
  });

tagCmd
  .command("delete <name>")
  .description("Delete a tag (the commit is NOT affected)")
  .action(async (name: string) => {
    const config = loadConfig();
    const client = new MongoClient(config.uri);
    try {
      await client.connect();
      const commitEngine = new CommitEngine(client, config);
      await commitEngine.initialize();
      await commitEngine.deleteTag(name);
      console.log(chalk.green(`✅ Tag "${name}" deleted`));
    } finally {
      await client.close();
    }
  });

// ── Cherry-Pick Command (Wave 4) ────────────────────────────

program
  .command("cherry-pick <targetBranch> <commitHash>")
  .description("Apply a single commit's changes to a target branch")
  .option("--author <name>", "Author of the cherry-pick")
  .action(async (targetBranch: string, commitHash: string, opts) => {
    const config = loadConfig();
    const client = new MongoClient(config.uri);
    try {
      await client.connect();
      const ce = new CommitEngine(client, config);
      await ce.initialize();
      const result = await ce.cherryPick(targetBranch, commitHash, opts.author);
      console.log(chalk.green(`✅ Cherry-pick successful`));
      console.log(chalk.dim(`   Source: ${result.sourceCommitHash.slice(0, 12)}`));
      console.log(chalk.dim(`   New commit: ${result.newCommitHash.slice(0, 12)}`));
    } finally {
      await client.close();
    }
  });

// ── Revert Command (Wave 4) ─────────────────────────────────

program
  .command("revert <branch> <commitHash>")
  .description("Undo a specific commit by creating an inverse commit")
  .option("--author <name>", "Author of the revert")
  .action(async (branch: string, commitHash: string, opts) => {
    const config = loadConfig();
    const client = new MongoClient(config.uri);
    try {
      await client.connect();
      const ce = new CommitEngine(client, config);
      await ce.initialize();
      const result = await ce.revert(branch, commitHash, opts.author);
      console.log(chalk.green(`✅ Revert successful`));
      console.log(chalk.dim(`   Reverted: ${result.revertedCommitHash.slice(0, 12)}`));
      console.log(chalk.dim(`   New commit: ${result.newCommitHash.slice(0, 12)}`));
    } finally {
      await client.close();
    }
  });

// ── Helper for client-only commands ──────────────────────────

async function withClient<T>(fn: (client: MongoClient, config: MongoBranchConfig) => Promise<T>): Promise<T> {
  const config = loadConfig();
  const client = new MongoClient(config.uri);
  try {
    await client.connect();
    return await fn(client, config);
  } finally {
    await client.close();
  }
}

// ── Time Travel Command (Wave 6) ───────────────────────────

program
  .command("query <branch> <collection>")
  .description("Query data at a specific commit or timestamp (time travel)")
  .option("--at <commitHash>", "Commit hash to query at")
  .option("--timestamp <iso>", "ISO timestamp to query at")
  .option("--filter <json>", "MongoDB query filter as JSON")
  .action(async (branch: string, collection: string, opts) => {
    await withClient(async (client, config) => {
      const engine = new TimeTravelEngine(client, config);
      await engine.initialize();
      const docs = await engine.findAt({
        branchName: branch,
        collection,
        commitHash: opts.at,
        timestamp: opts.timestamp ? new Date(opts.timestamp) : undefined,
        filter: opts.filter ? JSON.parse(opts.filter) : undefined,
      });
      console.log(chalk.bold(`\n📜 Time Travel: ${branch}/${collection} (${docs.length} documents)\n`));
      for (const doc of docs) {
        console.log(chalk.dim(`  ${JSON.stringify(doc, null, 0).slice(0, 120)}`));
      }
      console.log();
    });
  });

// ── Blame Command (Wave 6) ─────────────────────────────────

program
  .command("blame <branch> <collection> <documentId>")
  .description("Show who changed each field of a document and when")
  .action(async (branch: string, collection: string, documentId: string) => {
    await withClient(async (client, config) => {
      const engine = new TimeTravelEngine(client, config);
      await engine.initialize();
      const result = await engine.blame(branch, collection, documentId);
      console.log(chalk.bold(`\n🔍 Blame: ${collection}/${documentId}\n`));
      for (const [field, info] of Object.entries(result.fields)) {
        console.log(
          `  ${chalk.cyan(field)}  `,
          chalk.yellow(info.commitHash.slice(0, 8)),
          chalk.dim(`${info.author} · "${info.message}" · ${info.timestamp.toISOString()}`)
        );
      }
      console.log();
    });
  });

// ── Deploy Request Commands (Wave 6) ────────────────────────

const deployCmd = program
  .command("deploy")
  .description("Manage deploy requests — PR-like workflow for data changes");

deployCmd
  .command("create")
  .description("Open a deploy request (propose merging source → target)")
  .requiredOption("--source <branch>", "Source branch with changes")
  .requiredOption("--target <branch>", "Target branch to merge into")
  .requiredOption("-m, --message <text>", "What this deploy request does")
  .option("--by <name>", "Who is opening this request")
  .action(async (opts) => {
    await withClient(async (client, config) => {
      const mgr = new DeployRequestManager(client, config);
      await mgr.initialize();
      const dr = await mgr.open({
        sourceBranch: opts.source,
        targetBranch: opts.target,
        description: opts.message,
        createdBy: opts.by ?? "cli",
      });
      console.log(chalk.green(`✅ Deploy request #${dr.id} opened`));
      console.log(chalk.dim(`   ${dr.sourceBranch} → ${dr.targetBranch}`));
      console.log(chalk.dim(`   ${dr.description}`));
    });
  });

deployCmd
  .command("list")
  .description("List deploy requests")
  .option("--status <status>", "Filter: open, approved, rejected, merged")
  .option("--target <branch>", "Filter by target branch")
  .action(async (opts) => {
    await withClient(async (client, config) => {
      const mgr = new DeployRequestManager(client, config);
      await mgr.initialize();
      const drs = await mgr.list({
        status: opts.status as any,
        targetBranch: opts.target,
      });
      if (drs.length === 0) {
        console.log(chalk.dim("No deploy requests found"));
        return;
      }
      console.log(chalk.bold(`\n🚦 Deploy Requests (${drs.length}):\n`));
      for (const dr of drs) {
        const statusColor = dr.status === "open" ? chalk.blue :
                           dr.status === "approved" ? chalk.green :
                           dr.status === "rejected" ? chalk.red : chalk.yellow;
        console.log(`  ${chalk.bold(`#${dr.id}`)} ${statusColor(`[${dr.status}]`)} ${dr.sourceBranch} → ${dr.targetBranch}`);
        console.log(chalk.dim(`    ${dr.description} (${dr.createdBy})`));
      }
      console.log();
    });
  });

deployCmd
  .command("approve <id>")
  .description("Approve a deploy request")
  .option("--by <name>", "Reviewer name")
  .action(async (id: string, opts) => {
    await withClient(async (client, config) => {
      const mgr = new DeployRequestManager(client, config);
      await mgr.initialize();
      const dr = await mgr.approve(id, opts.by ?? "cli");
      console.log(chalk.green(`✅ Deploy request #${dr.id} approved by ${dr.reviewedBy}`));
    });
  });

deployCmd
  .command("reject <id>")
  .description("Reject a deploy request")
  .requiredOption("-r, --reason <text>", "Rejection reason")
  .option("--by <name>", "Reviewer name")
  .action(async (id: string, opts) => {
    await withClient(async (client, config) => {
      const mgr = new DeployRequestManager(client, config);
      await mgr.initialize();
      const dr = await mgr.reject(id, opts.by ?? "cli", opts.reason);
      console.log(chalk.red(`❌ Deploy request #${dr.id} rejected: ${dr.rejectionReason}`));
    });
  });

deployCmd
  .command("execute <id>")
  .description("Execute an approved deploy request (performs the merge)")
  .action(async (id: string) => {
    await withClient(async (client, config) => {
      const mgr = new DeployRequestManager(client, config);
      await mgr.initialize();
      const { deployRequest, mergeResult } = await mgr.execute(id);
      console.log(chalk.green(`✅ Deploy request #${deployRequest.id} executed!`));
      console.log(chalk.dim(`   Merged: ${mergeResult.sourceBranch} → ${mergeResult.targetBranch}`));
      console.log(chalk.dim(`   +${mergeResult.documentsAdded} added, -${mergeResult.documentsRemoved} removed, ~${mergeResult.documentsModified} modified`));
    });
  });

// ── Stash Commands (Wave 7) ─────────────────────────────────

const stashCmd = program.command("stash").description("Save and restore uncommitted changes");

stashCmd.command("save <branch>")
  .description("Stash current branch data (save + clear)")
  .option("-m, --message <text>", "Stash message", "WIP")
  .action(async (branch: string, opts) => {
    await withClient(async (client, config) => {
      const mgr = new StashManager(client, config);
      await mgr.initialize();
      const entry = await mgr.stash(branch, opts.message);
      console.log(chalk.green(`📦 Stashed "${entry.message}" on ${branch}`));
    });
  });

stashCmd.command("pop <branch>")
  .description("Restore most recent stash")
  .action(async (branch: string) => {
    await withClient(async (client, config) => {
      const mgr = new StashManager(client, config);
      await mgr.initialize();
      const entry = await mgr.pop(branch);
      console.log(chalk.green(`📦 Popped stash "${entry.message}" — data restored`));
    });
  });

stashCmd.command("list <branch>")
  .description("List stashes for a branch")
  .action(async (branch: string) => {
    await withClient(async (client, config) => {
      const mgr = new StashManager(client, config);
      await mgr.initialize();
      const entries = await mgr.list(branch);
      if (entries.length === 0) { console.log(chalk.dim("No stashes")); return; }
      for (const e of entries) {
        console.log(`  stash@{${e.index}}: ${e.message} ${chalk.dim(e.createdAt.toISOString())}`);
      }
    });
  });

// ── Compare Command (Wave 7) ───────────────────────────────

program.command("compare <branches...>")
  .description("Compare N branches side by side")
  .action(async (branches: string[]) => {
    await withClient(async (client, config) => {
      const cmp = new BranchComparator(client, config);
      const result = await cmp.compare(branches);
      console.log(chalk.bold(`\n🔀 Compare: ${result.branches.join(" vs ")}\n`));
      console.log(`  Total docs:      ${result.stats.totalDocuments}`);
      console.log(`  In all branches: ${chalk.green(String(result.stats.inAllBranches))}`);
      console.log(`  In some:         ${chalk.yellow(String(result.stats.inSomeBranches))}`);
      console.log(`  Unique to one:   ${chalk.red(String(result.stats.uniqueToOneBranch))}\n`);
    });
  });

// ── Reflog Command (Wave 7) ────────────────────────────────

program.command("reflog [branch]")
  .description("Show reflog — branch pointer movements (survives deletion)")
  .option("-n, --limit <n>", "Max entries", "50")
  .action(async (branch: string | undefined, opts) => {
    await withClient(async (client, config) => {
      const rl = new ReflogManager(client, config);
      await rl.initialize();
      const entries = branch
        ? await rl.forBranch(branch, parseInt(opts.limit))
        : await rl.all(parseInt(opts.limit));
      if (entries.length === 0) { console.log(chalk.dim("No reflog entries")); return; }
      console.log(chalk.bold(`\n📜 Reflog${branch ? ` (${branch})` : ""}:\n`));
      for (const e of entries) {
        console.log(
          `  ${chalk.dim(e.timestamp.toISOString())} ` +
          `${chalk.cyan(e.branchName)} ${chalk.yellow(e.action)}: ${e.detail}` +
          (e.commitHash ? chalk.dim(` (${e.commitHash.slice(0, 8)})`) : "")
        );
      }
      console.log();
    });
  });

// ── Anonymize Command (Wave 7) ─────────────────────────────

program.command("anonymize <branch>")
  .description("Create a branch with anonymized PII data")
  .requiredOption("--collection <name>", "Collection to anonymize")
  .requiredOption("--fields <json>", 'Fields and strategies: \'[{"path":"email","strategy":"mask"}]\'')
  .action(async (branch: string, opts) => {
    await withClient(async (client, config) => {
      const engine = new AnonymizeEngine(client, config);
      const fields = JSON.parse(opts.fields);
      const result = await engine.createAnonymizedBranch(branch, [
        { collection: opts.collection, fields },
      ]);
      console.log(chalk.green(`🔒 Anonymized branch "${result.branchName}" created`));
      console.log(chalk.dim(`   ${result.documentsProcessed} docs, ${result.fieldsAnonymized} fields anonymized`));
    });
  });

// ── Search Index Commands (Wave 8) ────────────────────────

const searchIdx = program.command("search-index")
  .description("Manage Atlas Search & Vector Search indexes on branches");

searchIdx.command("list <branch>")
  .description("List search indexes on a branch")
  .option("-c, --collection <name>", "Filter by collection")
  .action(async (branch: string, opts) => {
    await withClient(async (client, config) => {
      const mgr = new SearchIndexManager(client, config);
      const indexes = await mgr.listIndexes(branch, opts.collection);
      if (indexes.length === 0) {
        console.log(chalk.dim("No search indexes found"));
        return;
      }
      console.log(chalk.bold(`\n🔍 Search indexes on "${branch}" (${indexes.length}):\n`));
      for (const idx of indexes) {
        console.log(
          `  ${chalk.cyan(idx.collectionName)}.${chalk.yellow(idx.name)} ` +
          `[${idx.type}] status=${idx.status ?? "unknown"}`
        );
      }
      console.log();
    });
  });

searchIdx.command("copy <source> <target>")
  .description("Copy search index definitions between branches")
  .option("-c, --collection <name>", "Filter by collection")
  .action(async (source: string, target: string, opts) => {
    await withClient(async (client, config) => {
      const mgr = new SearchIndexManager(client, config);
      const result = await mgr.copyIndexes(source, target, opts.collection);
      console.log(chalk.green(`📋 Copied ${result.indexesCopied} search indexes`));
      if (result.indexesFailed > 0) {
        console.log(chalk.red(`   ${result.indexesFailed} failed`));
      }
    });
  });

searchIdx.command("diff <source> <target>")
  .description("Compare search index definitions between branches")
  .option("-c, --collection <name>", "Filter by collection")
  .action(async (source: string, target: string, opts) => {
    await withClient(async (client, config) => {
      const mgr = new SearchIndexManager(client, config);
      const diffs = await mgr.diffIndexes(source, target, opts.collection);
      if (diffs.length === 0) {
        console.log(chalk.green("✅ Search indexes are identical"));
        return;
      }
      console.log(chalk.bold("\n🔍 Search index differences:\n"));
      for (const diff of diffs) {
        console.log(chalk.cyan(`  ${diff.collection}:`));
        for (const a of diff.added) console.log(chalk.green(`    + ${a.name} [${a.type}]`));
        for (const r of diff.removed) console.log(chalk.red(`    - ${r.name} [${r.type}]`));
        for (const m of diff.modified) console.log(chalk.yellow(`    ~ ${m.name} [${m.type}]`));
        if (diff.unchanged.length) console.log(chalk.dim(`    = ${diff.unchanged.join(", ")}`));
      }
      console.log();
    });
  });

searchIdx.command("merge <source> <target>")
  .description("Merge search index definitions from source to target")
  .option("-c, --collection <name>", "Filter by collection")
  .option("--remove-orphans", "Remove indexes only in target")
  .action(async (source: string, target: string, opts) => {
    await withClient(async (client, config) => {
      const mgr = new SearchIndexManager(client, config);
      const result = await mgr.mergeIndexes(source, target, opts.collection, {
        removeOrphans: opts.removeOrphans,
      });
      console.log(chalk.green(`🔀 Search index merge: ${source} → ${target}`));
      console.log(`   Created: ${result.indexesCreated}, Updated: ${result.indexesUpdated}, Removed: ${result.indexesRemoved}`);
      if (!result.success) {
        console.log(chalk.red(`   Errors: ${result.errors.length}`));
      }
    });
  });

program.parseAsync().catch((err) => {
  console.error(`❌ Error: ${err.message}`);
  process.exit(1);
});
