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

program.parseAsync().catch((err) => {
  console.error(`❌ Error: ${err.message}`);
  process.exit(1);
});
