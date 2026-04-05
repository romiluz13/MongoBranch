#!/usr/bin/env bun
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
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
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
import { AuditChainManager } from "./core/audit-chain.ts";
import { CheckpointManager } from "./core/checkpoint.ts";
import { BranchProxy } from "./core/proxy.ts";
import { OperationLog } from "./core/oplog.ts";
import { EnvironmentDoctor } from "./core/doctor.ts";
import { DriftManager } from "./core/drift.ts";
import { AccessControlManager } from "./core/access-control.ts";
import type { MongoBranchConfig } from "./core/types.ts";
import { DEFAULT_CONFIG, CLIENT_OPTIONS } from "./core/types.ts";

const program = new Command();
const DEFAULT_LOCAL_COMPOSE_FILE = "mongobranch.atlas-local.yml";
const DEFAULT_ROOT_USERNAME = "mongobranch";
const DEFAULT_ROOT_PASSWORD = "mongobranch-local";

program
  .name("mb")
  .description("MongoBranch — Git-like branching for MongoDB data")
  .version("1.0.0");

program
  .command("init")
  .description("Scaffold MongoBranch config and an auth-enabled Atlas Local Docker Compose file")
  .option("--db <name>", "Source database name", DEFAULT_CONFIG.sourceDatabase)
  .option("--uri <uri>", "MongoDB connection string (overrides the generated Atlas Local URI)")
  .option("--meta-db <name>", "MongoBranch metadata database", DEFAULT_CONFIG.metaDatabase)
  .option("--branch-prefix <prefix>", "Branch database prefix", DEFAULT_CONFIG.branchPrefix)
  .option("--config-file <path>", "Path to write the MongoBranch YAML config", ".mongobranch.yaml")
  .option("--compose-file <path>", "Path to write the Atlas Local Docker Compose file", DEFAULT_LOCAL_COMPOSE_FILE)
  .option("--container-name <name>", "Docker container name for Atlas Local")
  .option("--root-username <username>", "Atlas Local root username", DEFAULT_ROOT_USERNAME)
  .option("--root-password <password>", "Atlas Local root password", DEFAULT_ROOT_PASSWORD)
  .option("--port <port>", "Local Atlas port", "27017")
  .option("--start-local", "Run `docker compose up -d` after writing the files")
  .option("--timeout-ms <ms>", "How long to wait for the Atlas Local healthcheck", "120000")
  .option("--no-compose-file", "Skip writing the Atlas Local Docker Compose file")
  .option("--no-doctor", "Skip running the environment doctor after bootstrap")
  .option("--force", "Overwrite existing config/bootstrap files")
  .option("--json", "Output the bootstrap result as JSON")
  .action(async (opts) => {
    const configPath = resolve(String(opts.configFile));
    const composePath = resolve(String(opts.composeFile));
    const port = Number.parseInt(String(opts.port), 10) || 27017;
    const timeoutMs = Number.parseInt(String(opts.timeoutMs), 10) || 120000;
    const projectSlug = sanitizeProjectSlug(basename(process.cwd()));
    const containerName = opts.containerName || `mongobranch-${projectSlug}-atlas`;
    const volumePrefix = containerName.replace(/[^a-zA-Z0-9_.-]/g, "-");
    const generatedUri = buildMongoUri(String(opts.rootUsername), String(opts.rootPassword), port);
    const config: MongoBranchConfig = {
      uri: opts.uri ? String(opts.uri) : generatedUri,
      sourceDatabase: String(opts.db),
      metaDatabase: String(opts.metaDb),
      branchPrefix: String(opts.branchPrefix),
    };

    if (!opts.force) {
      if (existsSync(configPath)) {
        throw new Error(`Config file already exists at ${configPath}. Re-run with --force to overwrite.`);
      }
      if (opts.composeFile && existsSync(composePath)) {
        throw new Error(`Compose file already exists at ${composePath}. Re-run with --force to overwrite.`);
      }
    }

    writeFileSync(configPath, stringifyYaml(config), "utf-8");

    if (opts.composeFile) {
      const compose = buildAtlasLocalCompose({
        containerName,
        port,
        username: String(opts.rootUsername),
        password: String(opts.rootPassword),
        volumePrefix,
      });
      writeFileSync(composePath, compose, "utf-8");
    }

    let doctorSummary: { passed: number; warned: number; failed: number } | null = null;

    if (opts.startLocal) {
      if (!opts.composeFile) {
        throw new Error("--start-local requires a generated compose file. Remove --no-compose-file or start Atlas Local manually.");
      }

      runCommand(
        "docker",
        ["compose", "-f", composePath, "up", "-d"],
        `Failed to start Atlas Local with docker compose (${composePath})`,
      );
      await waitForContainerHealthy(containerName, timeoutMs);
    }

    if (opts.doctor && (opts.startLocal || opts.uri)) {
      const client = new MongoClient(config.uri, CLIENT_OPTIONS);
      try {
        await client.connect();
        const doctor = new EnvironmentDoctor(client, config);
        const report = await doctor.run({
          timeoutMs: 15000,
          includeSearch: true,
          includeVectorSearch: true,
        });
        doctorSummary = report.summary;
      } finally {
        await client.close().catch(() => {});
      }
    }

    const maskedUri = config.uri.replace(String(opts.rootPassword), "********");
    const result = {
      workspace: process.cwd(),
      configPath,
      composePath: opts.composeFile ? composePath : null,
      containerName: opts.composeFile ? containerName : null,
      uri: config.uri,
      sourceDatabase: config.sourceDatabase,
      metaDatabase: config.metaDatabase,
      branchPrefix: config.branchPrefix,
      startedLocal: Boolean(opts.startLocal),
      doctorSummary,
    };

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(chalk.green("✅ MongoBranch bootstrap complete"));
    console.log(chalk.dim(`   Config: ${configPath}`));
    if (opts.composeFile) {
      console.log(chalk.dim(`   Compose: ${composePath}`));
      console.log(chalk.dim(`   Container: ${containerName}`));
    }
    console.log(chalk.dim(`   URI: ${maskedUri}`));
    if (doctorSummary) {
      console.log(chalk.dim(`   Doctor: ${doctorSummary.passed} passed, ${doctorSummary.warned} warned, ${doctorSummary.failed} failed`));
    }
    console.log(chalk.bold("\nNext steps"));
    console.log(`  ${chalk.cyan("mb doctor")}`);
    console.log(`  ${chalk.cyan(`mb branch create ${projectSlug}-experiment`)}`);
    console.log(`  ${chalk.cyan("mb access status")}`);
    console.log();
  });

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

function sanitizeProjectSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "mongobranch";
}

function buildMongoUri(username: string, password: string, port: number): string {
  const user = encodeURIComponent(username);
  const pass = encodeURIComponent(password);
  return `mongodb://${user}:${pass}@localhost:${port}/?directConnection=true&authSource=admin`;
}

function buildAtlasLocalCompose(args: {
  containerName: string;
  port: number;
  username: string;
  password: string;
  volumePrefix: string;
}): string {
  return [
    "services:",
    "  atlas-local:",
    "    image: mongodb/mongodb-atlas-local:preview",
    "    hostname: mongodb",
    `    container_name: ${args.containerName}`,
    "    ports:",
    `      - ${args.port}:27017`,
    "    environment:",
    `      - MONGODB_INITDB_ROOT_USERNAME=${args.username}`,
    `      - MONGODB_INITDB_ROOT_PASSWORD=${args.password}`,
    "      - DO_NOT_TRACK=1",
    "      - MONGOT_LOG_FILE=/dev/stderr",
    "      - RUNNER_LOG_FILE=/dev/stderr",
    "    volumes:",
    `      - ${args.volumePrefix}_db:/data/db`,
    `      - ${args.volumePrefix}_configdb:/data/configdb`,
    `      - ${args.volumePrefix}_mongot:/data/mongot`,
    "volumes:",
    `  ${args.volumePrefix}_db:`,
    `  ${args.volumePrefix}_configdb:`,
    `  ${args.volumePrefix}_mongot:`,
    "",
  ].join("\n");
}

function runCommand(command: string, args: string[], errorMessage: string): void {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(errorMessage);
  }
}

async function waitForContainerHealthy(containerName: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const inspect = spawnSync(
      "docker",
      ["inspect", "-f", "{{.State.Health.Status}}", containerName],
      {
        encoding: "utf-8",
        env: process.env,
      },
    );

    const status = inspect.stdout?.trim();
    if (inspect.status === 0 && status === "healthy") return;
    if (inspect.status === 0 && status === "unhealthy") {
      throw new Error(`Atlas Local container "${containerName}" reported an unhealthy status`);
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
  }

  throw new Error(`Timed out waiting for Atlas Local container "${containerName}" to become healthy`);
}

async function withBranchManager<T>(
  fn: (manager: BranchManager, client: MongoClient) => Promise<T>
): Promise<T> {
  return withClient(async (client, config) => {
    const manager = new BranchManager(client, config);
    await manager.initialize();
    return fn(manager, client);
  });
}

// ── Status Command ───────────────────────────────────────────
program
  .command("status")
  .description("System overview — active branches, storage, recent activity")
  .action(async () => {
    await withBranchManager(async (manager) => {
      const status = await manager.getSystemStatus();
      const formatBytes = (b: number) =>
        b < 1024 ? `${b}B` : b < 1048576 ? `${(b / 1024).toFixed(1)}KB` : `${(b / 1048576).toFixed(1)}MB`;

      console.log(chalk.bold("\n  MongoBranch Status\n"));
      console.log(`  Active branches:  ${chalk.green(String(status.activeBranches))}`);
      console.log(`  Merged branches:  ${chalk.yellow(String(status.mergedBranches))}`);
      console.log(`  Total storage:    ${chalk.cyan(formatBytes(status.totalStorageBytes))}`);
      console.log(`  Last activity:    ${chalk.dim(status.recentActivity?.toISOString() ?? "never")}`);

      if (status.branches.length > 0) {
        console.log(chalk.bold("\n  Branches:\n"));
        for (const b of status.branches) {
          const icon = b.status === "active" ? chalk.green("●") : chalk.yellow("○");
          const flags: string[] = [];
          if (b.lazy) flags.push(chalk.blue("lazy"));
          if (b.readOnly) flags.push(chalk.red("readonly"));
          const flagStr = flags.length > 0 ? ` ${flags.join(" ")}` : "";
          console.log(
            `  ${icon} ${chalk.bold(b.name)} — ${b.collections} collections, ${formatBytes(b.storageBytes)}${flagStr}`
          );
        }
      } else {
        console.log(chalk.dim("\n  No branches. Create one with: mb branch create <name>"));
      }
      console.log();
    });
  });

program
  .command("doctor")
  .description("Probe the connected Atlas Local / MongoDB environment for live feature support")
  .option("--json", "Output the full report as JSON")
  .option("--timeout-ms <ms>", "Per-check timeout in milliseconds", "15000")
  .option("--no-search", "Skip Atlas Search probe")
  .option("--no-vector-search", "Skip Atlas Vector Search probe")
  .action(async (opts) => {
    await withClient(async (client, config) => {
      const doctor = new EnvironmentDoctor(client, config);
      const report = await doctor.run({
        timeoutMs: Number.parseInt(String(opts.timeoutMs), 10) || 15_000,
        includeSearch: opts.search,
        includeVectorSearch: opts.vectorSearch,
      });

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      console.log(chalk.bold("\n  MongoBranch Environment Doctor\n"));
      console.log(`  Generated: ${chalk.dim(report.generatedAt.toISOString())}`);
      if (report.serverInfo?.version) {
        console.log(`  Server:    ${chalk.cyan(report.serverInfo.version)}`);
      }
      console.log(
        `  Summary:   ${chalk.green(String(report.summary.passed))} passed, ` +
        `${chalk.yellow(String(report.summary.warned))} warned, ` +
        `${chalk.red(String(report.summary.failed))} failed`
      );
      console.log();

      for (const check of report.checks) {
        const marker = check.status === "pass"
          ? chalk.green("PASS")
          : check.status === "warn"
            ? chalk.yellow("WARN")
            : chalk.red("FAIL");
        console.log(`  ${marker} ${chalk.bold(check.name)}`);
        console.log(chalk.dim(`    ${check.detail}`));
        if (check.data && Object.keys(check.data).length > 0) {
          console.log(chalk.dim(`    ${JSON.stringify(check.data)}`));
        }
      }
      console.log();
    });
  });

const drift = program.command("drift").description("Capture and check branch freshness baselines");

drift
  .command("capture <branch>")
  .description("Capture a branch drift baseline at the current Atlas Local operationTime")
  .option("--by <actor>", "Reviewer or agent capturing the baseline", "unknown")
  .option("--reason <text>", "Why this baseline was captured")
  .option("--json", "Output the captured baseline as JSON")
  .action(async (branch: string, opts) => {
    await withClient(async (client, config) => {
      const driftManager = new DriftManager(client, config);
      await driftManager.initialize();
      const baseline = await driftManager.captureBaseline({
        branchName: branch,
        capturedBy: opts.by,
        reason: opts.reason,
      });

      if (opts.json) {
        console.log(JSON.stringify(baseline, null, 2));
        return;
      }

      console.log(chalk.green(`✅ Captured drift baseline "${baseline.id}"`));
      console.log(chalk.dim(`   Branch: ${baseline.branchName}`));
      console.log(chalk.dim(`   Captured by: ${baseline.capturedBy}`));
      console.log(chalk.dim(`   Captured at: ${baseline.capturedAt.toISOString()}`));
      if (baseline.reason) {
        console.log(chalk.dim(`   Reason: ${baseline.reason}`));
      }
    });
  });

const access = program.command("access").description("Provision and inspect MongoDB access-control identities");

access
  .command("status")
  .description("Show authenticated user context and probe whether least-privilege access control is enforced")
  .option("--json", "Output the access-control status as JSON")
  .option("--no-probe", "Skip the restricted-user enforcement probe")
  .action(async (opts) => {
    await withClient(async (client, config) => {
      const manager = new AccessControlManager(client, config);
      await manager.initialize();
      const status = await manager.getStatus({ probeEnforcement: opts.probe });

      if (opts.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      console.log(chalk.bold("\n  MongoBranch Access Control Status\n"));
      const users = status.authenticatedUsers.length > 0
        ? status.authenticatedUsers.map((entry) => `${entry.user}@${entry.db}`).join(", ")
        : "none";
      const roles = status.authenticatedRoles.length > 0
        ? status.authenticatedRoles.map((entry) => `${entry.role}@${entry.db}`).join(", ")
        : "none";
      console.log(`  Admin DB:          ${chalk.cyan(status.adminDatabase)}`);
      console.log(`  Authenticated:     ${users}`);
      console.log(`  Roles:             ${roles}`);
      console.log(`  User management:   ${status.canManageUsers ? chalk.green("yes") : chalk.red("no")}`);
      console.log(`  Role management:   ${status.canManageRoles ? chalk.green("yes") : chalk.red("no")}`);
      if (status.enforcementProbe) {
        const marker = status.enforcementProbe.enforced ? chalk.green("ENFORCED") : chalk.yellow("NOT ENFORCED");
        console.log(`  Enforcement probe: ${marker}`);
        console.log(chalk.dim(`    ${status.enforcementProbe.detail}`));
      }
      console.log();
    });
  });

access
  .command("provision-branch <branch>")
  .description("Create a least-privilege MongoDB user scoped to one branch database")
  .requiredOption("--username <username>", "MongoDB username to create")
  .requiredOption("--password <password>", "MongoDB password to assign")
  .requiredOption("--by <actor>", "Who is provisioning this identity")
  .option("--collections <names>", "Comma-separated allowed collections within the branch DB")
  .option("--read-only", "Create a read-only identity")
  .option("--no-search-indexes", "Exclude Atlas Search / Vector Search privileges")
  .option("--json", "Output the provision result as JSON")
  .action(async (branch: string, opts) => {
    await withClient(async (client, config) => {
      const manager = new AccessControlManager(client, config);
      await manager.initialize();
      const result = await manager.provisionBranchAccess({
        branchName: branch,
        username: opts.username,
        password: opts.password,
        collections: typeof opts.collections === "string"
          ? opts.collections.split(",").map((value: string) => value.trim()).filter(Boolean)
          : undefined,
        readOnly: Boolean(opts.readOnly),
        includeSearchIndexes: opts.searchIndexes,
        createdBy: opts.by,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(chalk.green(`✅ Provisioned branch identity "${result.profile.username}"`));
      console.log(chalk.dim(`   Branch: ${result.profile.branchName}`));
      console.log(chalk.dim(`   Role: ${result.profile.roleName}`));
      console.log(chalk.dim(`   Database: ${result.profile.databaseName}`));
      console.log(chalk.dim(`   Connection string: ${result.connectionString}`));
    });
  });

access
  .command("provision-deployer")
  .description("Create a deploy identity scoped to a protected target database")
  .requiredOption("--username <username>", "MongoDB username to create")
  .requiredOption("--password <password>", "MongoDB password to assign")
  .requiredOption("--by <actor>", "Who is provisioning this identity")
  .option("--target <branch>", "Protected target branch or database owner branch", "main")
  .option("--write-block-bypass", "Grant bypassWriteBlockingMode for protected deploy windows")
  .option("--no-search-indexes", "Exclude Atlas Search / Vector Search privileges")
  .option("--json", "Output the provision result as JSON")
  .action(async (opts) => {
    await withClient(async (client, config) => {
      const manager = new AccessControlManager(client, config);
      await manager.initialize();
      const result = await manager.provisionDeployerAccess({
        username: opts.username,
        password: opts.password,
        targetBranch: opts.target,
        includeSearchIndexes: opts.searchIndexes,
        allowWriteBlockBypass: Boolean(opts.writeBlockBypass),
        createdBy: opts.by,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(chalk.green(`✅ Provisioned deploy identity "${result.profile.username}"`));
      console.log(chalk.dim(`   Target: ${result.profile.targetBranch}`));
      console.log(chalk.dim(`   Role: ${result.profile.roleName}`));
      console.log(chalk.dim(`   Database: ${result.profile.databaseName}`));
      console.log(chalk.dim(`   Connection string: ${result.connectionString}`));
    });
  });

access
  .command("revoke <username>")
  .description("Drop a provisioned MongoDB user/role and mark the profile revoked")
  .requiredOption("--by <actor>", "Who is revoking this identity")
  .option("--json", "Output the revoked profile as JSON")
  .action(async (username: string, opts) => {
    await withClient(async (client, config) => {
      const manager = new AccessControlManager(client, config);
      await manager.initialize();
      const result = await manager.revoke(username, opts.by);

      if (opts.json) {
        console.log(JSON.stringify({ profile: result }, null, 2));
        return;
      }

      if (!result) {
        console.log(chalk.yellow(`No provisioned access profile found for "${username}".`));
        return;
      }

      console.log(chalk.green(`✅ Revoked "${username}"`));
      console.log(chalk.dim(`   Role: ${result.roleName}`));
    });
  });

access
  .command("list")
  .description("List provisioned MongoDB access profiles tracked by MongoBranch")
  .option("--json", "Output the access profiles as JSON")
  .action(async (opts) => {
    await withClient(async (client, config) => {
      const manager = new AccessControlManager(client, config);
      await manager.initialize();
      const profiles = await manager.listProfiles();

      if (opts.json) {
        console.log(JSON.stringify({ profiles }, null, 2));
        return;
      }

      if (profiles.length === 0) {
        console.log(chalk.dim("No access profiles found."));
        return;
      }

      console.log(chalk.bold("\n  MongoBranch Access Profiles\n"));
      for (const profile of profiles) {
        const scope = profile.kind === "branch" ? profile.branchName : profile.targetBranch;
        console.log(`  ${chalk.bold(profile.username)} [${profile.kind}/${profile.status}] → ${scope}`);
        console.log(chalk.dim(`    role=${profile.roleName} db=${profile.databaseName}`));
      }
      console.log();
    });
  });

drift
  .command("check [baselineId]")
  .description("Check whether a branch changed since a captured baseline")
  .option("--branch <name>", "Use the latest baseline for this branch")
  .option("--json", "Output the drift check result as JSON")
  .action(async (baselineId: string | undefined, opts) => {
    await withClient(async (client, config) => {
      const driftManager = new DriftManager(client, config);
      await driftManager.initialize();
      const result = await driftManager.checkBaseline({
        baselineId,
        branchName: opts.branch,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const marker = result.drifted ? chalk.red("DRIFTED") : chalk.green("CLEAN");
      console.log(chalk.bold(`\n  Branch Drift Check\n`));
      console.log(`  Status:   ${marker}`);
      console.log(`  Baseline: ${chalk.cyan(result.baseline.id)}`);
      console.log(`  Branch:   ${chalk.cyan(result.baseline.branchName)}`);
      console.log(`  Detail:   ${chalk.dim(result.statusReason)}`);
      console.log();
    });
  });

drift
  .command("list")
  .description("List captured drift baselines")
  .option("--branch <name>", "Filter by branch")
  .option("--status <status>", "Filter by status (clean|drifted)")
  .option("--limit <n>", "Maximum baselines to return", "20")
  .option("--json", "Output the baselines as JSON")
  .action(async (opts) => {
    await withClient(async (client, config) => {
      const driftManager = new DriftManager(client, config);
      await driftManager.initialize();
      const baselines = await driftManager.listBaselines({
        branchName: opts.branch,
        status: opts.status,
        limit: Number.parseInt(String(opts.limit), 10) || 20,
      });

      if (opts.json) {
        console.log(JSON.stringify({ baselines }, null, 2));
        return;
      }

      if (baselines.length === 0) {
        console.log(chalk.dim("No drift baselines found."));
        return;
      }

      console.log(chalk.bold(`\n  Drift Baselines (${baselines.length})\n`));
      for (const baseline of baselines) {
        const marker = baseline.status === "drifted" ? chalk.red("drifted") : chalk.green("clean");
        console.log(`  ${chalk.cyan(baseline.id)} ${marker} ${chalk.bold(baseline.branchName)}`);
        console.log(chalk.dim(`    Captured: ${baseline.capturedAt.toISOString()} by ${baseline.capturedBy}`));
        if (baseline.lastStatusReason) {
          console.log(chalk.dim(`    Status: ${baseline.lastStatusReason}`));
        }
      }
      console.log();
    });
  });

// ── Branch Commands ──────────────────────────────────────────
const branch = program.command("branch").description("Manage data branches");

branch
  .command("create <name>")
  .description("Create a new branch from current data")
  .option("-d, --description <text>", "Branch description")
  .option("--from <branch>", "Branch from a specific branch (default: main)")
  .option("--created-by <name>", "Creator identity (e.g. agent-id)")
  .option("--lazy", "Lazy copy-on-write (instant create, materialize on first write)")
  .option("--collections <list>", "Only copy these collections (comma-separated)")
  .option("--schema-only", "Copy indexes and validators only, no data")
  .action(async (name: string, opts) => {
    await withBranchManager(async (manager) => {
      const branch = await manager.createBranch({
        name,
        description: opts.description,
        from: opts.from,
        createdBy: opts.createdBy,
        lazy: opts.lazy,
        collections: opts.collections ? opts.collections.split(",").map((s: string) => s.trim()) : undefined,
        schemaOnly: opts.schemaOnly,
      });
      const mode = branch.lazy ? " (lazy)" : opts.schemaOnly ? " (schema-only)" : "";
      console.log(chalk.green(`✅ Branch "${branch.name}" created${mode}`));
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
    await withClient(async (client, config) => {
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
    });
  });

// ── Merge Command ───────────────────────────────────────────

program
  .command("merge <source>")
  .description("Merge a branch into target (default: main)")
  .option("--into <target>", "Target branch", "main")
  .option("--dry-run", "Preview what would change without applying")
  .action(async (source: string, opts) => {
    await withClient(async (client, config) => {
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
    });
  });

// ── Log Command ─────────────────────────────────────────────

program
  .command("log [branch]")
  .description("Show event history for a branch (or all branches)")
  .option("-n, --limit <count>", "Max entries to show", "20")
  .action(async (branch: string | undefined, opts) => {
    await withClient(async (client, config) => {
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
    });
  });

// ── GC Command ──────────────────────────────────────────────

program
  .command("gc")
  .description("Garbage collect merged/deleted branch databases")
  .action(async () => {
    await withClient(async (client, config) => {
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
    });
  });

// ── Commit Command (Wave 4) ─────────────────────────────────

program
  .command("commit <branch>")
  .description("Create an immutable commit on a branch")
  .requiredOption("-m, --message <text>", "Commit message")
  .option("--author <name>", "Author of the commit")
  .action(async (branch: string, opts) => {
    await withClient(async (client, config) => {
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
    });
  });

// ── Commit Log Command (Wave 4) ─────────────────────────────

program
  .command("commits <branch>")
  .description("Show commit history for a branch")
  .option("-n, --limit <count>", "Max commits to show", "20")
  .action(async (branch: string, opts) => {
    await withClient(async (client, config) => {
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
    });
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
    await withClient(async (client, config) => {
      const commitEngine = new CommitEngine(client, config);
      await commitEngine.initialize();
      const target = opts.commit ?? opts.branch;
      const tag = await commitEngine.createTag(name, target, {
        message: opts.message,
        author: opts.author,
        isBranch: !opts.commit && !!opts.branch,
      });
      console.log(chalk.green(`✅ Tag "${tag.name}" → ${tag.commitHash.slice(0, 12)}`));
    });
  });

tagCmd
  .command("list")
  .description("List all tags")
  .action(async () => {
    await withClient(async (client, config) => {
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
    });
  });

tagCmd
  .command("delete <name>")
  .description("Delete a tag (the commit is NOT affected)")
  .action(async (name: string) => {
    await withClient(async (client, config) => {
      const commitEngine = new CommitEngine(client, config);
      await commitEngine.initialize();
      await commitEngine.deleteTag(name);
      console.log(chalk.green(`✅ Tag "${name}" deleted`));
    });
  });

// ── Cherry-Pick Command (Wave 4) ────────────────────────────

program
  .command("cherry-pick <targetBranch> <commitHash>")
  .description("Apply a single commit's changes to a target branch")
  .option("--author <name>", "Author of the cherry-pick")
  .action(async (targetBranch: string, commitHash: string, opts) => {
    await withClient(async (client, config) => {
      const ce = new CommitEngine(client, config);
      await ce.initialize();
      const result = await ce.cherryPick(targetBranch, commitHash, opts.author);
      console.log(chalk.green(`✅ Cherry-pick successful`));
      console.log(chalk.dim(`   Source: ${result.sourceCommitHash.slice(0, 12)}`));
      console.log(chalk.dim(`   New commit: ${result.newCommitHash.slice(0, 12)}`));
    });
  });

// ── Revert Command (Wave 4) ─────────────────────────────────

program
  .command("revert <branch> <commitHash>")
  .description("Undo a specific commit by creating an inverse commit")
  .option("--author <name>", "Author of the revert")
  .action(async (branch: string, commitHash: string, opts) => {
    await withClient(async (client, config) => {
      const ce = new CommitEngine(client, config);
      await ce.initialize();
      const result = await ce.revert(branch, commitHash, opts.author);
      console.log(chalk.green(`✅ Revert successful`));
      console.log(chalk.dim(`   Reverted: ${result.revertedCommitHash.slice(0, 12)}`));
      console.log(chalk.dim(`   New commit: ${result.newCommitHash.slice(0, 12)}`));
    });
  });

// ── Helper for client-only commands ──────────────────────────

async function withClient<T>(fn: (client: MongoClient, config: MongoBranchConfig) => Promise<T>): Promise<T> {
  const config = loadConfig();
  const client = new MongoClient(config.uri, CLIENT_OPTIONS);
  try {
    await client.connect();
    return await fn(client, config);
  } finally {
    await client.close();
  }
}

// ── Data Commands (Branch Proxy) ───────────────────────────

program
  .command("find <branch> <collection>")
  .description("Query documents on a branch collection")
  .option("--filter <json>", "MongoDB query filter as JSON")
  .option("-n, --limit <count>", "Max documents to return")
  .action(async (branch: string, collection: string, opts) => {
    await withClient(async (client, config) => {
      const bm = new BranchManager(client, config);
      const ol = new OperationLog(client, config);
      await ol.initialize();
      const proxy = new BranchProxy(client, config, bm, ol);
      const docs = await proxy.find(branch, collection, opts.filter ? JSON.parse(opts.filter) : {}, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      console.log(JSON.stringify(docs, null, 2));
    });
  });

program
  .command("aggregate <branch> <collection>")
  .description("Run an aggregation pipeline on a branch collection")
  .requiredOption("-p, --pipeline <json>", "Aggregation pipeline as JSON array")
  .action(async (branch: string, collection: string, opts) => {
    await withClient(async (client, config) => {
      const bm = new BranchManager(client, config);
      const ol = new OperationLog(client, config);
      await ol.initialize();
      const proxy = new BranchProxy(client, config, bm, ol);
      const docs = await proxy.aggregate(branch, collection, JSON.parse(opts.pipeline));
      console.log(JSON.stringify(docs, null, 2));
    });
  });

program
  .command("count <branch> <collection>")
  .description("Count documents matching a filter on a branch collection")
  .option("--filter <json>", "MongoDB query filter as JSON")
  .action(async (branch: string, collection: string, opts) => {
    await withClient(async (client, config) => {
      const bm = new BranchManager(client, config);
      const ol = new OperationLog(client, config);
      await ol.initialize();
      const proxy = new BranchProxy(client, config, bm, ol);
      const count = await proxy.countDocuments(branch, collection, opts.filter ? JSON.parse(opts.filter) : {});
      console.log(chalk.bold(`📊 ${collection}: ${count} document(s)`));
    });
  });

program
  .command("collections <branch>")
  .description("List all collections in a branch database")
  .action(async (branch: string) => {
    await withClient(async (client, config) => {
      const bm = new BranchManager(client, config);
      const ol = new OperationLog(client, config);
      await ol.initialize();
      const proxy = new BranchProxy(client, config, bm, ol);
      const cols = await proxy.listCollections(branch);
      if (cols.length === 0) {
        console.log(chalk.dim("No collections found"));
        return;
      }
      console.log(chalk.bold(`\n📂 Collections on "${branch}" (${cols.length}):\n`));
      for (const c of cols) {
        console.log(`  ${chalk.cyan(c.name)} ${chalk.dim(`[${c.type}]`)}`);
      }
      console.log();
    });
  });

program
  .command("schema <branch> <collection>")
  .description("Infer collection schema by sampling documents")
  .option("-n, --sample <count>", "Number of documents to sample", "100")
  .action(async (branch: string, collection: string, opts) => {
    await withClient(async (client, config) => {
      const bm = new BranchManager(client, config);
      const ol = new OperationLog(client, config);
      await ol.initialize();
      const proxy = new BranchProxy(client, config, bm, ol);
      const schema = await proxy.inferSchema(branch, collection, parseInt(opts.sample));
      console.log(chalk.bold(`\n🔍 Schema: ${collection} (sampled ${schema.totalSampled} docs)\n`));
      for (const [field, info] of Object.entries(schema.fields)) {
        const pct = Math.round((info.count / schema.totalSampled) * 100);
        console.log(`  ${chalk.cyan(field.padEnd(20))} ${chalk.yellow(info.types.join(" | ").padEnd(20))} ${chalk.dim(`${pct}% present`)}`);
      }
      console.log();
    });
  });

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
      const result = await engine.findAt({
        branchName: branch,
        collection,
        at: opts.at ?? opts.timestamp ?? "",
        filter: opts.filter ? JSON.parse(opts.filter) : undefined,
      });
      console.log(chalk.bold(`\n📜 Time Travel: ${branch}/${collection} (${result.documents.length} documents)\n`));
      for (const doc of result.documents) {
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
      for (const [field, entries] of Object.entries(result.fields)) {
        const latest = entries[0];
        if (!latest) continue;
        console.log(
          `  ${chalk.cyan(field)}  `,
          chalk.yellow(latest.commitHash.slice(0, 8)),
          chalk.dim(`${latest.author} · "${latest.message}" · ${latest.timestamp.toISOString()}`)
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

// ── mb checkpoint ─────────────────────────────────────────────
const checkpoint = program.command("checkpoint").description("Lightweight save points for agent safety");

checkpoint
  .command("create <branch>")
  .description("Create a checkpoint on a branch")
  .option("--label <label>", "Optional label")
  .option("--ttl <minutes>", "Auto-expire after N minutes")
  .action(async (branch: string, opts) => {
    await withClient(async (client, config) => {
      const commitEng = new CommitEngine(client, config);
      const branchMgr = new BranchManager(client, config);
      await commitEng.initialize();
      const mgr = new CheckpointManager(client, config, commitEng, branchMgr);
      await mgr.initialize();
      const result = await mgr.create(branch, { label: opts.label, ttlMinutes: opts.ttl ? parseInt(opts.ttl) : undefined });
      console.log(chalk.green(`✅ Checkpoint ${result.id} created on "${branch}"`));
      console.log(`   Commit: ${result.commitHash.slice(0, 12)}…`);
      console.log(`   Snapshotted: ${result.collectionsSnapshotted} collections, ${result.documentCount} documents`);
    });
  });

checkpoint
  .command("restore <branch> <id>")
  .description("Restore branch to a checkpoint")
  .action(async (branch: string, id: string) => {
    await withClient(async (client, config) => {
      const commitEng = new CommitEngine(client, config);
      const branchMgr = new BranchManager(client, config);
      await commitEng.initialize();
      const mgr = new CheckpointManager(client, config, commitEng, branchMgr);
      await mgr.initialize();
      const result = await mgr.restore(branch, id);
      console.log(chalk.green(`✅ Restored "${branch}" to checkpoint ${id}`));
      console.log(`   Collections: ${result.collectionsRestored}, Documents: ${result.documentsRestored}`);
    });
  });

checkpoint
  .command("list <branch>")
  .description("List checkpoints on a branch")
  .action(async (branch: string) => {
    await withClient(async (client, config) => {
      const commitEng = new CommitEngine(client, config);
      const branchMgr = new BranchManager(client, config);
      await commitEng.initialize();
      const mgr = new CheckpointManager(client, config, commitEng, branchMgr);
      await mgr.initialize();
      const cps = await mgr.list(branch);
      if (cps.length === 0) {
        console.log(chalk.gray("No checkpoints"));
        return;
      }
      for (const cp of cps) {
        console.log(
          `${chalk.cyan(cp.id)} ${chalk.yellow((cp.label ?? "").padEnd(30))} ${chalk.gray(cp.commitHash.slice(0, 12))}… ${cp.createdAt.toISOString()}`
        );
      }
    });
  });

// ── mb audit ──────────────────────────────────────────────────
const audit = program.command("audit").description("Tamper-evident audit chain (EU AI Act compliance)");

audit
  .command("verify")
  .description("Verify the entire audit chain hash integrity")
  .action(async () => {
    await withClient(async (client, config) => {
      const mgr = new AuditChainManager(client, config);
      await mgr.initialize();
      const result = await mgr.verify();
      if (result.valid) {
        console.log(chalk.green(`✅ Audit chain VALID — ${result.totalEntries} entries verified`));
      } else {
        console.log(chalk.red(`❌ Audit chain BROKEN at sequence ${result.brokenAt}`));
        console.log(chalk.red(`   Reason: ${result.brokenReason}`));
      }
    });
  });

audit
  .command("export")
  .description("Export the audit chain for compliance review")
  .option("--format <fmt>", "json or csv", "json")
  .option("--output <file>", "Output file path")
  .action(async (opts) => {
    await withClient(async (client, config) => {
      const mgr = new AuditChainManager(client, config);
      await mgr.initialize();
      const exported = await mgr.exportChain(opts.format as "json" | "csv");
      if (opts.output) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(opts.output, exported);
        console.log(chalk.green(`📄 Exported to ${opts.output}`));
      } else {
        console.log(exported);
      }
    });
  });

audit
  .command("log")
  .description("Show recent audit chain entries")
  .option("--branch <name>", "Filter by branch")
  .option("--limit <n>", "Max entries", "20")
  .action(async (opts) => {
    await withClient(async (client, config) => {
      const mgr = new AuditChainManager(client, config);
      await mgr.initialize();
      const entries = opts.branch
        ? await mgr.getByBranch(opts.branch, parseInt(opts.limit))
        : await mgr.getChain(parseInt(opts.limit));
      for (const e of entries) {
        const hash = e.chainHash.slice(0, 12);
        console.log(
          `${chalk.gray(`[${e.sequence}]`)} ${chalk.cyan(e.entryType.padEnd(10))} ${chalk.yellow(e.branchName.padEnd(20))} ${e.action.padEnd(20)} ${chalk.gray(hash)}…`
        );
      }
    });
  });

program.parseAsync().catch((err) => {
  console.error(`❌ Error: ${err.message}`);
  process.exit(1);
});
