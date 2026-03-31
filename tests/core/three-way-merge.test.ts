/**
 * TDD Tests for MongoBranch Three-Way Merge
 *
 * The flagship feature — uses common ancestor to distinguish
 * added vs deleted vs modified. Per-field conflict detection.
 * Real MongoDB — no mocks.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, ObjectId } from "mongodb";
import {
  startMongoDB,
  stopMongoDB,
  getTestEnvironment,
  cleanupBranches,
} from "../setup.ts";
import { CommitEngine } from "../../src/core/commit.ts";
import { BranchManager } from "../../src/core/branch.ts";
import { MergeEngine } from "../../src/core/merge.ts";
import { BranchProxy } from "../../src/core/proxy.ts";
import { OperationLog } from "../../src/core/oplog.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";
import { SEED_DATABASE } from "../seed.ts";

let client: MongoClient;
let uri: string;
let config: MongoBranchConfig;
let commitEngine: CommitEngine;
let branchManager: BranchManager;
let mergeEngine: MergeEngine;
let oplog: OperationLog;

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
  uri = env.uri;
}, 30_000);

afterAll(async () => {
  await stopMongoDB();
}, 10_000);

beforeEach(async () => {
  await getTestEnvironment();
  await cleanupBranches(client);
  await client.db("__mongobranch").collection("commits").deleteMany({});
  await client.db("__mongobranch").collection("tags").deleteMany({});

  config = {
    uri,
    sourceDatabase: SEED_DATABASE,
    metaDatabase: "__mongobranch",
    branchPrefix: "__mb_",
  };

  branchManager = new BranchManager(client, config);
  await branchManager.initialize();
  commitEngine = new CommitEngine(client, config);
  await commitEngine.initialize();
  mergeEngine = new MergeEngine(client, config);
  oplog = new OperationLog(client, config);
  await oplog.initialize();
});

describe("Three-Way Merge — Clean merges (no conflicts)", () => {
  it("auto-merges non-overlapping field changes", async () => {
    // Setup: create branch A, commit a base state
    await branchManager.createBranch({ name: "tw-a" });
    const proxy = new BranchProxy(client, config, branchManager, oplog);

    // Insert a doc in both branches via source
    const testId = new ObjectId();
    const sourceDb = client.db(SEED_DATABASE);
    await sourceDb.collection("tw_test").insertOne({
      _id: testId, name: "Alice", age: 30, city: "NYC",
    });

    // Create two branches from same base
    await branchManager.createBranch({ name: "tw-branch-a" });
    await branchManager.createBranch({ name: "tw-branch-b" });

    // Commit shared base on both branches
    const baseA = await commitEngine.commit({ branchName: "tw-branch-a", message: "Base A" });
    const baseB = await commitEngine.commit({
      branchName: "tw-branch-b",
      message: "Base B",
      parentOverrides: [baseA.hash], // Share the same ancestor
    });

    // Branch A changes "age"
    const branchADb = client.db("__mb_tw-branch-a");
    await branchADb.collection("tw_test").updateOne(
      { _id: testId },
      { $set: { age: 31 } }
    );
    await commitEngine.commit({ branchName: "tw-branch-a", message: "Update age" });

    // Branch B changes "city"
    const branchBDb = client.db("__mb_tw-branch-b");
    await branchBDb.collection("tw_test").updateOne(
      { _id: testId },
      { $set: { city: "SF" } }
    );
    await commitEngine.commit({ branchName: "tw-branch-b", message: "Update city" });

    // Three-way merge: B → A
    const result = await mergeEngine.threeWayMerge(
      "tw-branch-b", "tw-branch-a", commitEngine,
      { author: "test" }
    );

    expect(result.success).toBe(true);
    expect(result.mergeBase).toBe(baseA.hash);
    expect(result.conflicts).toHaveLength(0);

    // Cleanup
    await sourceDb.collection("tw_test").deleteMany({});
  });
});

describe("Three-Way Merge — Conflict detection", () => {
  it("detects per-field conflict when both sides change same field", async () => {
    const testId = new ObjectId();
    const sourceDb = client.db(SEED_DATABASE);
    await sourceDb.collection("tw_conflict").insertOne({
      _id: testId, name: "Bob", status: "active",
    });

    await branchManager.createBranch({ name: "conf-a" });
    await branchManager.createBranch({ name: "conf-b" });

    const baseA = await commitEngine.commit({ branchName: "conf-a", message: "Base" });
    await commitEngine.commit({
      branchName: "conf-b",
      message: "Base B",
      parentOverrides: [baseA.hash],
    });

    // Both change "status" to different values
    const dbA = client.db("__mb_conf-a");
    await dbA.collection("tw_conflict").updateOne(
      { _id: testId }, { $set: { status: "paused" } }
    );
    await commitEngine.commit({ branchName: "conf-a", message: "Pause" });

    const dbB = client.db("__mb_conf-b");
    await dbB.collection("tw_conflict").updateOne(
      { _id: testId }, { $set: { status: "cancelled" } }
    );
    await commitEngine.commit({ branchName: "conf-b", message: "Cancel" });

    // Merge with manual strategy — should report conflict
    const result = await mergeEngine.threeWayMerge(
      "conf-b", "conf-a", commitEngine,
      { conflictStrategy: "manual" }
    );

    expect(result.success).toBe(false);
    expect(result.conflicts.length).toBeGreaterThan(0);

    const conflict = result.conflicts.find(c => c.field === "status");
    expect(conflict).toBeDefined();
    expect(conflict!.ours).toBe("paused");
    expect(conflict!.theirs).toBe("cancelled");

    // Cleanup
    await sourceDb.collection("tw_conflict").deleteMany({});
  });

  it("resolves conflicts with 'theirs' strategy", async () => {
    const testId = new ObjectId();
    const sourceDb = client.db(SEED_DATABASE);
    await sourceDb.collection("tw_resolve").insertOne({
      _id: testId, name: "Carol", role: "admin",
    });

    await branchManager.createBranch({ name: "res-a" });
    await branchManager.createBranch({ name: "res-b" });

    const baseA = await commitEngine.commit({ branchName: "res-a", message: "Base" });
    await commitEngine.commit({
      branchName: "res-b",
      message: "Base",
      parentOverrides: [baseA.hash],
    });

    const dbA = client.db("__mb_res-a");
    await dbA.collection("tw_resolve").updateOne(
      { _id: testId }, { $set: { role: "moderator" } }
    );
    await commitEngine.commit({ branchName: "res-a", message: "To moderator" });

    const dbB = client.db("__mb_res-b");
    await dbB.collection("tw_resolve").updateOne(
      { _id: testId }, { $set: { role: "viewer" } }
    );
    await commitEngine.commit({ branchName: "res-b", message: "To viewer" });

    const result = await mergeEngine.threeWayMerge(
      "res-b", "res-a", commitEngine,
      { conflictStrategy: "theirs" }
    );

    expect(result.success).toBe(true);
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0].resolved).toBe(true);

    // Verify the "theirs" value won
    const mergedDoc = await dbA.collection("tw_resolve").findOne({ _id: testId });
    expect(mergedDoc?.role).toBe("viewer");

    // Cleanup
    await sourceDb.collection("tw_resolve").deleteMany({});
  });

  it("creates a merge commit with two parents on successful merge", async () => {
    const testId = new ObjectId();
    const sourceDb = client.db(SEED_DATABASE);
    await sourceDb.collection("tw_commit").insertOne({
      _id: testId, val: "base",
    });

    await branchManager.createBranch({ name: "mc-a" });
    await branchManager.createBranch({ name: "mc-b" });

    const baseA = await commitEngine.commit({ branchName: "mc-a", message: "Base mc" });
    await commitEngine.commit({
      branchName: "mc-b",
      message: "Base mc-b",
      parentOverrides: [baseA.hash],
    });

    // Non-overlapping changes
    const dbB = client.db("__mb_mc-b");
    await dbB.collection("tw_commit").updateOne(
      { _id: testId }, { $set: { extra: "new field" } }
    );
    await commitEngine.commit({ branchName: "mc-b", message: "Add field" });

    const result = await mergeEngine.threeWayMerge(
      "mc-b", "mc-a", commitEngine,
      { author: "merger", message: "Merge mc-b into mc-a" }
    );

    expect(result.success).toBe(true);
    expect(result.mergeCommitHash).toBeDefined();

    // Verify merge commit has two parents
    const mergeCommit = await commitEngine.getCommit(result.mergeCommitHash!);
    expect(mergeCommit).not.toBeNull();
    expect(mergeCommit!.parentHashes).toHaveLength(2);
    expect(mergeCommit!.message).toBe("Merge mc-b into mc-a");

    // Cleanup
    await sourceDb.collection("tw_commit").deleteMany({});
  });
});

describe("Three-Way Merge — Fallback", () => {
  it("falls back to 2-way merge when no common ancestor exists", async () => {
    await branchManager.createBranch({ name: "no-ancestor" });
    // No commits at all — no common ancestor
    const result = await mergeEngine.threeWayMerge(
      "no-ancestor", "main", commitEngine,
      { dryRun: true }
    );

    expect(result.mergeBase).toBeNull();
    expect(result.dryRun).toBe(true);
  });
});
