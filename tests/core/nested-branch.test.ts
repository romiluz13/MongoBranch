/**
 * MongoBranch — Nested Branch Stress Tests (Wave 9)
 *
 * Branch-from-branch with hierarchical agent exploration trees.
 * Tests: depth-3 chains, merge walk-up, max depth enforcement,
 * concurrent forking, data isolation. Real MongoDB, zero mocks.
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
import { DiffEngine } from "../../src/core/diff.ts";
import { MergeEngine } from "../../src/core/merge.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";

let client: MongoClient;
let uri: string;
let config: MongoBranchConfig;
let branchManager: BranchManager;
let diffEngine: DiffEngine;
let mergeEngine: MergeEngine;

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
  uri = env.uri;
}, 30_000);

afterAll(async () => {
  if (client) {
    const dbs = await client.db().admin().listDatabases();
    for (const db of dbs.databases) {
      if (db.name.startsWith("__mb_nest_") || db.name === "__mongobranch_nest") {
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
    metaDatabase: "__mongobranch_nest",
    branchPrefix: "__mb_nest_",
  };
  await client.db(config.metaDatabase).dropDatabase();
  await cleanupBranches(client);
  branchManager = new BranchManager(client, config);
  diffEngine = new DiffEngine(client, config);
  mergeEngine = new MergeEngine(client, config);
});

describe("Nested Branch — Stress Tests", () => {
  it("creates depth-3 branch chain with correct parent tracking", async () => {
    // main → feature → experiment → sub-test
    const feature = await branchManager.createBranch({ name: "feature", createdBy: "dev" });
    expect(feature.parentBranch).toBe("main");
    expect(feature.parentDepth).toBe(0);

    const experiment = await branchManager.createBranch({ name: "experiment", from: "feature", createdBy: "agent-a" });
    expect(experiment.parentBranch).toBe("feature");
    expect(experiment.parentDepth).toBe(1);

    const subTest = await branchManager.createBranch({ name: "sub-test", from: "experiment", createdBy: "agent-b" });
    expect(subTest.parentBranch).toBe("experiment");
    expect(subTest.parentDepth).toBe(2);
  }, 15_000);

  it("child branch has correct data snapshot from parent (not just from main)", async () => {
    // Create feature branch and add data
    const feature = await branchManager.createBranch({ name: "data-feature" });
    const featureDb = client.db(feature.branchDatabase);
    await featureDb.collection("users").insertOne({ name: "Feature User", exclusive: true });

    // Create child from feature
    const child = await branchManager.createBranch({ name: "data-child", from: "data-feature" });
    const childDb = client.db(child.branchDatabase);

    // Child should have the feature-exclusive user
    const featureUser = await childDb.collection("users").findOne({ name: "Feature User" });
    expect(featureUser).not.toBeNull();
    expect(featureUser?.exclusive).toBe(true);
  }, 15_000);

  it("modifications at depth-3 propagate up through merge chain", async () => {
    // Create chain: main → L1 → L2
    const l1 = await branchManager.createBranch({ name: "merge-l1" });
    const l2 = await branchManager.createBranch({ name: "merge-l2", from: "merge-l1" });
    const l2Db = client.db(l2.branchDatabase);

    // Modify at depth 2
    await l2Db.collection("users").insertOne({ name: "Deep User", level: 2 });

    // Diff L2 vs L1 — should show the change
    const diffL2L1 = await diffEngine.diffBranches("merge-l2", "merge-l1");
    expect(diffL2L1.totalChanges).toBeGreaterThanOrEqual(1);

    // Merge L2 back into L1
    const mergeResult1 = await mergeEngine.merge("merge-l2", "merge-l1");
    expect(mergeResult1.success).toBe(true);
    expect(mergeResult1.documentsAdded).toBeGreaterThanOrEqual(1);

    // Verify L1 now has the deep user
    const l1Db = client.db(l1.branchDatabase);
    const deepUser = await l1Db.collection("users").findOne({ name: "Deep User" });
    expect(deepUser).not.toBeNull();

    // Merge L1 back into main
    const mergeResult2 = await mergeEngine.merge("merge-l1", "main");
    expect(mergeResult2.success).toBe(true);

    // Verify main now has the deep user
    const mainDb = client.db(config.sourceDatabase);
    const mainDeepUser = await mainDb.collection("users").findOne({ name: "Deep User" });
    expect(mainDeepUser).not.toBeNull();
  }, 30_000);

  it("max depth enforcement — rejects branch beyond maxDepth", async () => {
    // Create chain of depth 3 with maxDepth=3
    await branchManager.createBranch({ name: "d0", maxDepth: 3 });
    await branchManager.createBranch({ name: "d1", from: "d0", maxDepth: 3 });
    await branchManager.createBranch({ name: "d2", from: "d1", maxDepth: 3 });
    await branchManager.createBranch({ name: "d3", from: "d2", maxDepth: 3 });

    // Depth 4 should fail (exceeds maxDepth of 3)
    await expect(
      branchManager.createBranch({ name: "d4", from: "d3", maxDepth: 3 })
    ).rejects.toThrow(/depth/i);
  }, 20_000);

  it("3 agents fork from same parent — changes are isolated", async () => {
    const parent = await branchManager.createBranch({ name: "fork-parent" });

    // 3 agents fork from the same parent
    const [forkA, forkB, forkC] = await Promise.all([
      branchManager.createBranch({ name: "fork-a", from: "fork-parent", createdBy: "agent-a" }),
      branchManager.createBranch({ name: "fork-b", from: "fork-parent", createdBy: "agent-b" }),
      branchManager.createBranch({ name: "fork-c", from: "fork-parent", createdBy: "agent-c" }),
    ]);

    // Each agent modifies only its fork
    const dbA = client.db(forkA.branchDatabase);
    const dbB = client.db(forkB.branchDatabase);
    const dbC = client.db(forkC.branchDatabase);

    await dbA.collection("users").insertOne({ name: "Agent A Only", agent: "a" });
    await dbB.collection("users").insertOne({ name: "Agent B Only", agent: "b" });
    await dbC.collection("users").insertOne({ name: "Agent C Only", agent: "c" });

    // Verify isolation — each fork only has its own user
    expect(await dbA.collection("users").findOne({ agent: "b" })).toBeNull();
    expect(await dbB.collection("users").findOne({ agent: "a" })).toBeNull();
    expect(await dbC.collection("users").findOne({ agent: "a" })).toBeNull();

    // Diff each fork vs parent — only shows its own changes
    const diffA = await diffEngine.diffBranches("fork-a", "fork-parent");
    expect(diffA.totalChanges).toBe(1);
    const diffB = await diffEngine.diffBranches("fork-b", "fork-parent");
    expect(diffB.totalChanges).toBe(1);

    // Merge first fork into parent — should add its user
    const mergeResultA = await mergeEngine.merge("fork-a", "fork-parent");
    expect(mergeResultA.success).toBe(true);
    expect(mergeResultA.documentsAdded).toBeGreaterThanOrEqual(1);

    // Verify parent now has agent-a user
    const parentDb = client.db(parent.branchDatabase);
    expect(await parentDb.collection("users").findOne({ agent: "a" })).not.toBeNull();
  }, 30_000);

  it("delete middle branch — child still works with its copied data", async () => {
    // Create A → B → C
    const branchA = await branchManager.createBranch({ name: "del-a" });
    const branchB = await branchManager.createBranch({ name: "del-b", from: "del-a" });
    const branchC = await branchManager.createBranch({ name: "del-c", from: "del-b" });

    // Add data at each level
    const dbA = client.db(branchA.branchDatabase);
    const dbB = client.db(branchB.branchDatabase);
    const dbC = client.db(branchC.branchDatabase);
    await dbC.collection("users").insertOne({ name: "Child C User" });

    // Delete middle branch B
    await branchManager.deleteBranch("del-b");

    // Child C should still work — its data was COPIED at creation time
    const cUser = await dbC.collection("users").findOne({ name: "Child C User" });
    expect(cUser).not.toBeNull();

    // Child C should still have the seed data
    const cCount = await dbC.collection("users").countDocuments();
    expect(cCount).toBeGreaterThan(1); // seed data + Child C User
  }, 20_000);
});
