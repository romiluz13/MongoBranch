/**
 * MongoBranch — Checkpoint Stress Tests (Wave 9)
 *
 * Lightweight save points for agent safety.
 * Tests: create/restore under realistic agent workflows, multi-checkpoint
 * stacks, TTL pruning, concurrent agent isolation. Real MongoDB, zero mocks.
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
import { CommitEngine } from "../../src/core/commit.ts";
import { CheckpointManager } from "../../src/core/checkpoint.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";

let client: MongoClient;
let uri: string;
let config: MongoBranchConfig;
let branchManager: BranchManager;
let oplog: OperationLog;
let commitEngine: CommitEngine;
let checkpointManager: CheckpointManager;
let proxy: BranchProxy;

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
  uri = env.uri;
}, 30_000);

afterAll(async () => {
  if (client) {
    const dbs = await client.db().admin().listDatabases();
    for (const db of dbs.databases) {
      if (db.name.startsWith("__mb_cp_") || db.name === "__mongobranch_cp") {
        await client.db(db.name).dropDatabase();
      }
    }
    // Clean up checkpoint snapshot DBs
    const allDbs = await client.db().admin().listDatabases();
    for (const db of allDbs.databases) {
      if (db.name.includes("__cp_")) {
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
    metaDatabase: "__mongobranch_cp",
    branchPrefix: "__mb_cp_",
  };

  await client.db(config.metaDatabase).dropDatabase();
  await cleanupBranches(client);

  branchManager = new BranchManager(client, config);
  oplog = new OperationLog(client, config);
  commitEngine = new CommitEngine(client, config);
  checkpointManager = new CheckpointManager(client, config, commitEngine, branchManager);
  proxy = new BranchProxy(client, config, branchManager, oplog);

  await oplog.initialize();
  await commitEngine.initialize();
  await checkpointManager.initialize();
});

describe("Checkpoint — Stress Tests", () => {
  it("creates checkpoint and restores exact pre-experiment state", async () => {
    const branch = await branchManager.createBranch({ name: "cp-restore" });
    const branchDb = client.db(branch.branchDatabase);

    // Count initial state
    const initialUsers = await branchDb.collection("users").countDocuments();
    const initialProducts = await branchDb.collection("products").countDocuments();
    const initialOrders = await branchDb.collection("orders").countDocuments();

    // Create checkpoint before experiment
    const cp = await checkpointManager.create("cp-restore", { label: "before-experiment" });
    expect(cp.id).toBeTruthy();
    expect(cp.collectionsSnapshotted).toBeGreaterThan(0);

    // Aggressive writes: bulk insert, update all, delete half, add new collection
    await branchDb.collection("products").insertMany(
      Array.from({ length: 50 }, (_, i) => ({ name: `New Product ${i}`, price: i * 10, category: "Test" }))
    );
    await branchDb.collection("users").updateMany({}, { $set: { salary: 999999 } });
    const halfOrders = Math.floor(initialOrders / 2);
    const orderIds = await branchDb.collection("orders").find({}).limit(halfOrders).toArray();
    if (orderIds.length > 0) {
      await branchDb.collection("orders").deleteMany({ _id: { $in: orderIds.map(o => o._id) } });
    }
    await branchDb.collection("reviews").insertMany(
      Array.from({ length: 20 }, (_, i) => ({ text: `Review ${i}`, rating: (i % 5) + 1 }))
    );

    // Verify data changed
    expect(await branchDb.collection("products").countDocuments()).toBe(initialProducts + 50);
    expect(await branchDb.collection("reviews").countDocuments()).toBe(20);

    // Restore to checkpoint
    const result = await checkpointManager.restore("cp-restore", cp.id);
    expect(result.collectionsRestored).toBeGreaterThan(0);
    expect(result.documentsRestored).toBeGreaterThan(0);

    // Verify EXACT pre-experiment state
    expect(await branchDb.collection("users").countDocuments()).toBe(initialUsers);
    expect(await branchDb.collection("products").countDocuments()).toBe(initialProducts);
    expect(await branchDb.collection("orders").countDocuments()).toBe(initialOrders);

    // Reviews collection should not exist after restore
    const collections = await branchDb.listCollections().toArray();
    expect(collections.find(c => c.name === "reviews")).toBeUndefined();

    // Verify salary was restored (not 999999)
    const user = await branchDb.collection("users").findOne({});
    expect(user?.salary).not.toBe(999999);
  }, 30_000);

  it("supports multi-checkpoint stack — restore to middle checkpoint", async () => {
    const branch = await branchManager.createBranch({ name: "cp-stack" });
    const branchDb = client.db(branch.branchDatabase);
    const checkpoints: string[] = [];

    // Create 5 checkpoints with data modifications between each
    for (let i = 0; i < 5; i++) {
      const cp = await checkpointManager.create("cp-stack", { label: `step-${i}` });
      checkpoints.push(cp.id);
      await branchDb.collection("users").insertOne({ name: `Stack User ${i}`, step: i });
    }

    // Should have 5 checkpoints
    const list = await checkpointManager.list("cp-stack");
    expect(list.length).toBe(5);

    // Count users after all 5 inserts
    const countAfterAll = await branchDb.collection("users").countDocuments();

    // Restore to checkpoint #2 (middle of stack)
    await checkpointManager.restore("cp-stack", checkpoints[2]!);

    // Should have only the users from steps 0 and 1 (checkpoint 2 was taken BEFORE step-2 insert)
    const countAfterRestore = await branchDb.collection("users").countDocuments();
    expect(countAfterRestore).toBeLessThan(countAfterAll);
    // step-2 user should exist only if it was added BEFORE checkpoint 2 was taken
    // Since checkpoint is taken BEFORE the insert, step-2 should NOT exist
    const step2User = await branchDb.collection("users").findOne({ name: "Stack User 2" });
    expect(step2User).toBeNull();
  }, 30_000);

  it("TTL-based checkpoint expiry via prune", async () => {
    await branchManager.createBranch({ name: "cp-ttl" });

    // Create checkpoint with TTL
    const cp = await checkpointManager.create("cp-ttl", { ttlMinutes: 60, label: "with-ttl" });
    expect(cp.id).toBeTruthy();

    // Verify it appears in list
    let list = await checkpointManager.list("cp-ttl");
    expect(list.length).toBe(1);
    expect(list[0].expiresAt).toBeDefined();

    // Create more checkpoints — then prune keeping only 1
    await checkpointManager.create("cp-ttl", { label: "second" });
    await checkpointManager.create("cp-ttl", { label: "third" });
    const pruned = await checkpointManager.prune("cp-ttl", 1);
    expect(pruned).toBe(2);

    list = await checkpointManager.list("cp-ttl");
    expect(list.length).toBe(1);
    expect(list[0]!.label).toBe("third"); // most recent kept
  }, 30_000);

  it("concurrent agents each create+restore checkpoints without cross-contamination", async () => {
    // Create 2 branches for 2 agents
    const branchA = await branchManager.createBranch({ name: "cp-agent-a" });
    const branchB = await branchManager.createBranch({ name: "cp-agent-b" });
    const dbA = client.db(branchA.branchDatabase);
    const dbB = client.db(branchB.branchDatabase);

    // Both create checkpoints
    const [cpA, cpB] = await Promise.all([
      checkpointManager.create("cp-agent-a", { label: "agent-a-save", createdBy: "agent-a" }),
      checkpointManager.create("cp-agent-b", { label: "agent-b-save", createdBy: "agent-b" }),
    ]);

    // Each agent modifies its own branch
    await dbA.collection("users").insertOne({ name: "Agent A User", exclusive: true });
    await dbB.collection("products").insertOne({ name: "Agent B Product", exclusive: true });

    // Verify changes
    expect(await dbA.collection("users").findOne({ name: "Agent A User" })).not.toBeNull();
    expect(await dbB.collection("products").findOne({ name: "Agent B Product" })).not.toBeNull();

    // Restore agent A only
    await checkpointManager.restore("cp-agent-a", cpA.id);

    // Agent A's change is gone, Agent B's change survives
    expect(await dbA.collection("users").findOne({ name: "Agent A User" })).toBeNull();
    expect(await dbB.collection("products").findOne({ name: "Agent B Product" })).not.toBeNull();

    // Agent B's checkpoints are untouched
    const listB = await checkpointManager.list("cp-agent-b");
    expect(listB.length).toBe(1);
    expect(listB[0].createdBy).toBe("agent-b");
  }, 30_000);

  it("delete single checkpoint", async () => {
    await branchManager.createBranch({ name: "cp-delete" });
    const cp1 = await checkpointManager.create("cp-delete", { label: "keep-me" });
    const cp2 = await checkpointManager.create("cp-delete", { label: "delete-me" });

    const deleted = await checkpointManager.delete("cp-delete", cp2.id);
    expect(deleted).toBe(true);

    const list = await checkpointManager.list("cp-delete");
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(cp1.id);

    // Deleting non-existent returns false
    const again = await checkpointManager.delete("cp-delete", "fake-id");
    expect(again).toBe(false);
  }, 15_000);

  it("checkpoint result includes correct document count", async () => {
    await branchManager.createBranch({ name: "cp-count" });
    const result = await checkpointManager.create("cp-count", { label: "count-check" });

    // Should have snapshotted the seeded data
    expect(result.documentCount).toBeGreaterThan(0);
    expect(result.collectionsSnapshotted).toBeGreaterThanOrEqual(3); // users, products, orders
    expect(result.commitHash).toBeTruthy();
    expect(result.commitHash.length).toBeGreaterThan(10);
  }, 15_000);
});
