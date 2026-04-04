/**
 * MongoBranch — Audit Chain Stress Tests (Wave 9)
 *
 * Tamper-evident hash-chained audit log. EU AI Act Article 12 compliance.
 * Tests: chain integrity under concurrent multi-agent ops, tamper detection,
 * time-range queries, export verification. Real MongoDB, zero mocks.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient } from "mongodb";
import {
  startMongoDB,
  stopMongoDB,
  getTestEnvironment,
  cleanupBranches,
} from "../setup.ts";
import { SEED_DATABASE } from "../seed.ts";
import { BranchManager } from "../../src/core/branch.ts";
import { BranchProxy } from "../../src/core/proxy.ts";
import { OperationLog } from "../../src/core/oplog.ts";
import { MergeEngine } from "../../src/core/merge.ts";
import { DiffEngine } from "../../src/core/diff.ts";
import { CommitEngine } from "../../src/core/commit.ts";
import { AuditChainManager } from "../../src/core/audit-chain.ts";
import { AUDIT_CHAIN_COLLECTION } from "../../src/core/types.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";

let client: MongoClient;
let uri: string;
let config: MongoBranchConfig;
let branchManager: BranchManager;
let mergeEngine: MergeEngine;
let diffEngine: DiffEngine;
let oplog: OperationLog;
let commitEngine: CommitEngine;
let auditChain: AuditChainManager;

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
  uri = env.uri;
}, 30_000);

afterAll(async () => {
  if (client) {
    const dbs = await client.db().admin().listDatabases();
    for (const db of dbs.databases) {
      if (db.name.startsWith("__mb_audit_") || db.name === "__mongobranch_audit") {
        await client.db(db.name).dropDatabase();
      }
    }
  }
  await stopMongoDB();
}, 10_000);

beforeEach(async () => {
  await getTestEnvironment();
  config = {
    uri,
    sourceDatabase: SEED_DATABASE,
    metaDatabase: "__mongobranch_audit",
    branchPrefix: "__mb_audit_",
  };

  // Drop audit chain and meta from prior runs
  await client.db(config.metaDatabase).dropDatabase();
  await cleanupBranches(client);

  branchManager = new BranchManager(client, config);
  diffEngine = new DiffEngine(client, config);
  mergeEngine = new MergeEngine(client, config);
  oplog = new OperationLog(client, config);
  commitEngine = new CommitEngine(client, config);
  auditChain = new AuditChainManager(client, config);

  await oplog.initialize();
  await commitEngine.initialize();
  await auditChain.initialize();
});

describe("Audit Chain — Stress Tests", () => {
  it("initializes with genesis entry and verifies clean chain", async () => {
    const result = await auditChain.verify();
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(1);
    expect(result.firstEntry?.entryType).toBe("genesis");
    expect(result.firstEntry?.prevHash).toBe("GENESIS");
  });

  it("builds valid chain across 3 concurrent agent branches with mixed writes", async () => {
    // 3 agents create branches concurrently
    const agents = ["agent-alpha", "agent-beta", "agent-gamma"];
    const branches = await Promise.all(
      agents.map((agent) =>
        branchManager.createBranch({
          name: `audit-${agent}`,
          createdBy: agent,
        })
      )
    );

    // Append branch creation events
    for (const branch of branches) {
      await auditChain.append({
        entryType: "branch",
        branchName: branch.name,
        actor: branch.name.replace("audit-", ""),
        action: "create_branch",
        detail: `Created ${branch.name} with ${branch.collections.length} collections`,
      });
    }

    // Each agent does 5 proxy writes (mix of insert, update, delete)
    const proxy = new BranchProxy(client, config, branchManager, oplog);
    for (const agent of agents) {
      const branchName = `audit-${agent}`;

      // 2 inserts
      const { insertedId: id1 } = await proxy.insertOne(branchName, "users", {
        name: `${agent}-user-1`, email: `${agent}-1@test.com`, role: "tester",
      });
      await proxy.insertOne(branchName, "users", {
        name: `${agent}-user-2`, email: `${agent}-2@test.com`, role: "tester",
      });
      // 2 updates
      await proxy.updateOne(branchName, "products", { category: "Electronics" }, { $set: { updatedBy: agent } });
      await proxy.updateOne(branchName, "products", { category: "Books" }, { $set: { updatedBy: agent } });
      // 1 delete
      await proxy.deleteOne(branchName, "users", { name: `${agent}-user-1` });

      // Append oplog-style events
      for (const op of ["insert:users", "insert:users", "update:products", "update:products", "delete:users"]) {
        await auditChain.append({
          entryType: "oplog",
          branchName,
          actor: agent,
          action: op,
          detail: `${agent} performed ${op} on ${branchName}`,
        });
      }
    }

    // Merge all 3 back sequentially
    for (const agent of agents) {
      const branchName = `audit-${agent}`;
      await mergeEngine.merge(branchName, "main");
      await auditChain.append({
        entryType: "merge",
        branchName,
        actor: agent,
        action: "merge_branch",
        detail: `Merged ${branchName} into main`,
      });
    }

    // Verify the full chain
    const result = await auditChain.verify();
    expect(result.valid).toBe(true);
    // 1 genesis + 3 branch creates + 15 oplog entries + 3 merges = 22
    expect(result.totalEntries).toBe(22);
    expect(result.lastEntry?.entryType).toBe("merge");
  }, 30_000);

  it("detects tamper — modified detail field breaks the chain at exact position", async () => {
    // Build a chain of 5 entries
    for (let i = 1; i <= 5; i++) {
      await auditChain.append({
        entryType: "oplog",
        branchName: "tamper-test",
        actor: "agent-x",
        action: `op-${i}`,
        detail: `Operation ${i} data payload`,
      });
    }

    // Verify chain is valid before tampering
    let result = await auditChain.verify();
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(6); // genesis + 5

    // Tamper: directly overwrite entry at sequence 3's detail field
    const col = client.db(config.metaDatabase).collection(AUDIT_CHAIN_COLLECTION);
    await col.updateOne({ sequence: 3 }, { $set: { detail: "TAMPERED DATA" } });

    // Verify — must detect the tamper at sequence 3
    result = await auditChain.verify();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(3);
    expect(result.brokenReason).toContain("tampered");
    expect(result.totalEntries).toBe(6);
  });

  it("detects tamper — modified prevHash breaks the link", async () => {
    for (let i = 1; i <= 3; i++) {
      await auditChain.append({
        entryType: "branch",
        branchName: "link-test",
        actor: "agent-y",
        action: `branch-${i}`,
        detail: `Branch operation ${i}`,
      });
    }

    // Tamper: change prevHash of entry 2 to a random hash
    const col = client.db(config.metaDatabase).collection(AUDIT_CHAIN_COLLECTION);
    await col.updateOne({ sequence: 2 }, { $set: { prevHash: "deadbeef0000" } });

    const result = await auditChain.verify();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
    expect(result.brokenReason).toContain("prevHash");
  });

  it("exports chain as JSON with valid verification header", async () => {
    await auditChain.append({
      entryType: "commit",
      branchName: "export-branch",
      actor: "agent-z",
      action: "commit",
      detail: "Commit abc123 on export-branch",
    });

    const exported = await auditChain.exportChain("json");
    const parsed = JSON.parse(exported);

    expect(parsed.verification.valid).toBe(true);
    expect(parsed.verification.totalEntries).toBe(2); // genesis + 1
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0].entryType).toBe("genesis");
    expect(parsed.entries[1].entryType).toBe("commit");
    expect(parsed.entries[1].branchName).toBe("export-branch");

    // Verify hash links in exported data
    expect(parsed.entries[1].prevHash).toBe(parsed.entries[0].chainHash);
  });

  it("exports chain as CSV with correct header and rows", async () => {
    await auditChain.append({
      entryType: "deploy",
      branchName: "csv-branch",
      actor: "deployer",
      action: "execute_deploy",
      detail: "Deploy #42: csv-branch → main",
    });

    const exported = await auditChain.exportChain("csv");
    const lines = exported.split("\n");

    expect(lines[0]).toContain("MongoBranch Audit Chain Export");
    expect(lines[1]).toContain("Chain Valid: true");
    expect(lines[2]).toContain("sequence,entryType"); // header row
    expect(lines).toHaveLength(5); // 2 comment + header + genesis + deploy
  });

  it("filters entries by time range correctly", async () => {
    const before = new Date();
    await new Promise(r => setTimeout(r, 50));

    await auditChain.append({
      entryType: "oplog", branchName: "time-a", actor: "a", action: "insert", detail: "First",
    });

    const middle = new Date();
    await new Promise(r => setTimeout(r, 50));

    await auditChain.append({
      entryType: "oplog", branchName: "time-b", actor: "b", action: "update", detail: "Second",
    });

    const after = new Date();

    // Full range — should get both (not genesis, it was before `before`)
    const all = await auditChain.getByTimeRange(before, after);
    expect(all.length).toBe(2);

    // First half only
    const firstHalf = await auditChain.getByTimeRange(before, middle);
    expect(firstHalf.length).toBe(1);
    expect(firstHalf[0]!.branchName).toBe("time-a");
  });

  it("filters entries by branch name", async () => {
    await auditChain.append({
      entryType: "oplog", branchName: "branch-x", actor: "a", action: "insert", detail: "X op 1",
    });
    await auditChain.append({
      entryType: "oplog", branchName: "branch-y", actor: "b", action: "insert", detail: "Y op 1",
    });
    await auditChain.append({
      entryType: "oplog", branchName: "branch-x", actor: "a", action: "update", detail: "X op 2",
    });

    const xEntries = await auditChain.getByBranch("branch-x");
    expect(xEntries.length).toBe(2);
    expect(xEntries.every(e => e.branchName === "branch-x")).toBe(true);
  });

  it("single entry lookup by chainHash works", async () => {
    const entry = await auditChain.append({
      entryType: "reflog", branchName: "lookup-test", actor: "agent-q",
      action: "reset", detail: "Reset branch pointer",
    });

    const found = await auditChain.getEntry(entry.chainHash);
    expect(found).not.toBeNull();
    expect(found!.sequence).toBe(entry.sequence);
    expect(found!.action).toBe("reset");

    const notFound = await auditChain.getEntry("nonexistent-hash");
    expect(notFound).toBeNull();
  });
});
