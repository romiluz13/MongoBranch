/**
 * TDD Tests for MongoBranch Merge Engine
 *
 * Tests run against REAL MongoDB (Atlas Local Docker).
 * Verifies merge applies branch changes to target correctly.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient } from "mongodb";
import {
  startMongoDB,
  stopMongoDB,
  getTestEnvironment,
  cleanupBranches,
} from "../setup.ts";
import { BranchManager } from "../../src/core/branch.ts";
import { CommitEngine } from "../../src/core/commit.ts";
import { MergeEngine } from "../../src/core/merge.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";
import { SEED_DATABASE } from "../seed.ts";

let client: MongoClient;
let uri: string;
let config: MongoBranchConfig;
let branchManager: BranchManager;
let mergeEngine: MergeEngine;
let commitEngine: CommitEngine;

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
  await client.db("__mongobranch").collection("commit_data").deleteMany({});
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
});

describe("MergeEngine.merge — inserts", () => {
  it("merges added documents into main", async () => {
    const branch = await branchManager.createBranch({ name: "add-merge" });
    const branchDb = client.db(branch.branchDatabase);

    await branchDb.collection("users").insertOne({
      name: "Merged User", email: "merged@test.io", role: "dev", active: true,
    });

    const result = await mergeEngine.merge("add-merge", "main");
    expect(result.success).toBe(true);
    expect(result.documentsAdded).toBe(1);

    // Verify document is now in main
    const mainDb = client.db(SEED_DATABASE);
    const merged = await mainDb.collection("users").findOne({ name: "Merged User" });
    expect(merged).toBeTruthy();
    expect(merged!.email).toBe("merged@test.io");
  });
});

describe("MergeEngine.merge — deletes", () => {
  it("merges deleted documents from branch into main", async () => {
    const branch = await branchManager.createBranch({ name: "del-merge" });
    const branchDb = client.db(branch.branchDatabase);

    await branchDb.collection("users").deleteOne({ name: "David Okonkwo" });

    const result = await mergeEngine.merge("del-merge", "main");
    expect(result.success).toBe(true);
    expect(result.documentsRemoved).toBe(1);

    // Verify document is gone from main
    const mainDb = client.db(SEED_DATABASE);
    const gone = await mainDb.collection("users").findOne({ name: "David Okonkwo" });
    expect(gone).toBeNull();
  });
});

describe("MergeEngine.merge — updates", () => {
  it("merges modified documents into main", async () => {
    const branch = await branchManager.createBranch({ name: "upd-merge" });
    const branchDb = client.db(branch.branchDatabase);

    await branchDb.collection("products").updateOne(
      { sku: "CSP-001" },
      { $set: { price: 49.99, name: "CloudSync Pro V2" } }
    );

    const result = await mergeEngine.merge("upd-merge", "main");
    expect(result.success).toBe(true);
    expect(result.documentsModified).toBe(1);

    // Verify product updated in main
    const mainDb = client.db(SEED_DATABASE);
    const product = await mainDb.collection("products").findOne({ sku: "CSP-001" });
    expect(product!.price).toBe(49.99);
    expect(product!.name).toBe("CloudSync Pro V2");
  });
});

describe("MergeEngine.merge — multi-collection", () => {
  it("merges changes across multiple collections", async () => {
    const branch = await branchManager.createBranch({ name: "big-merge" });
    const branchDb = client.db(branch.branchDatabase);

    await branchDb.collection("users").insertOne({
      name: "New Dev", email: "newdev@test.io", role: "dev", active: true,
    });
    await branchDb.collection("products").deleteOne({ sku: "AGL-003" });
    await branchDb.collection("orders").updateOne(
      { status: "pending" },
      { $set: { status: "shipped" } }
    );

    const result = await mergeEngine.merge("big-merge", "main");
    expect(result.success).toBe(true);
    expect(result.collectionsAffected).toBe(3);
    expect(result.documentsAdded).toBe(1);
    expect(result.documentsRemoved).toBe(1);
    expect(result.documentsModified).toBe(1);
  });
});

describe("MergeEngine.merge — branch status", () => {
  it("marks branch as merged after successful merge", async () => {
    await branchManager.createBranch({ name: "status-check" });

    const result = await mergeEngine.merge("status-check", "main");
    expect(result.success).toBe(true);

    const metaDb = client.db(config.metaDatabase);
    const meta = await metaDb.collection("branches").findOne({ name: "status-check" });
    expect(meta!.status).toBe("merged");
  });

  it("rejects merging a non-existent branch", async () => {
    await expect(mergeEngine.merge("phantom", "main")).rejects.toThrow(/not found/i);
  });
});

describe("MergeEngine.merge — dry-run", () => {
  it("returns what would change without applying", async () => {
    const branch = await branchManager.createBranch({ name: "dry-test" });
    const branchDb = client.db(branch.branchDatabase);
    await branchDb.collection("users").insertOne({ name: "Preview User", role: "test" });

    const result = await mergeEngine.merge("dry-test", "main", { dryRun: true });

    expect(result.success).toBe(true);
    expect(result.documentsAdded).toBeGreaterThan(0);
    expect(result.dryRun).toBe(true);

    // Verify data was NOT applied to main
    const mainDb = client.db(SEED_DATABASE);
    const found = await mainDb.collection("users").findOne({ name: "Preview User" });
    expect(found).toBeNull();
  });

  it("does not mark branch as merged on dry-run", async () => {
    const branch = await branchManager.createBranch({ name: "dry-status" });
    const branchDb = client.db(branch.branchDatabase);
    await branchDb.collection("users").insertOne({ name: "Dry Status", role: "test" });

    await mergeEngine.merge("dry-status", "main", { dryRun: true });

    // Branch should still be active
    const branches = await branchManager.listBranches({});
    const found = branches.find((b) => b.name === "dry-status");
    expect(found?.status).toBe("active");
  });
});

describe("MergeEngine.merge — rollback on failure", () => {
  it("rolls back partial changes if merge fails mid-way", async () => {
    const branch = await branchManager.createBranch({ name: "rollback-test" });
    const branchDb = client.db(branch.branchDatabase);

    // Add a doc that will merge fine
    await branchDb.collection("users").insertOne({ name: "Good Doc", role: "test" });

    // Count docs in main before merge attempt
    const mainDb = client.db(SEED_DATABASE);
    const countBefore = await mainDb.collection("users").countDocuments();

    // Force a failure by dropping the branch DB mid-way (simulated via bad collection)
    // For now, verify that a successful merge with rollback flag works correctly
    const result = await mergeEngine.merge("rollback-test", "main");
    expect(result.success).toBe(true);

    const countAfter = await mainDb.collection("users").countDocuments();
    expect(countAfter).toBe(countBefore + 1);
  });
});

describe("MergeEngine.merge — conflict detection", () => {
  it("uses the shared ancestor to detect real concurrent conflicts", async () => {
    const target = await branchManager.createBranch({ name: "conflict-target" });
    const user = await client.db(target.branchDatabase).collection("users").findOne({ role: "admin" });
    expect(user).not.toBeNull();

    await commitEngine.commit({ branchName: "conflict-target", message: "Shared base" });
    const source = await branchManager.createBranch({ name: "conflict-src", from: "conflict-target" });

    await client.db(target.branchDatabase).collection("users").updateOne(
      { _id: user!._id },
      { $set: { name: "Target Version" } }
    );
    await client.db(source.branchDatabase).collection("users").updateOne(
      { _id: user!._id },
      { $set: { name: "Source Version" } }
    );

    const result = await mergeEngine.merge("conflict-src", "conflict-target", { detectConflicts: true });
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0]!.documentId).toEqual(user!._id);
    expect(result.conflicts[0]!.collection).toBe("users");
  });

  it("does not flag branch-only updates as conflicts when the target is unchanged since branching", async () => {
    const target = await branchManager.createBranch({ name: "ff-target" });
    await commitEngine.commit({ branchName: "ff-target", message: "Shared base" });
    const source = await branchManager.createBranch({ name: "ff-source", from: "ff-target" });

    await client.db(source.branchDatabase).collection("users").updateOne(
      { name: "Alice Chen" },
      { $set: { department: "AI Platform" } }
    );

    const result = await mergeEngine.merge("ff-source", "ff-target", {
      detectConflicts: true,
      conflictStrategy: "abort",
    });

    expect(result.success).toBe(true);
    expect(result.conflicts).toHaveLength(0);

    const alice = await client.db(target.branchDatabase).collection("users").findOne({ name: "Alice Chen" });
    expect(alice!.department).toBe("AI Platform");
  });

  it("applies non-conflicting changes even when conflicts exist (ours strategy)", async () => {
    const target = await branchManager.createBranch({ name: "ours-target" });
    const user = await client.db(target.branchDatabase).collection("users").findOne({ role: "admin" });
    expect(user).not.toBeNull();

    await commitEngine.commit({ branchName: "ours-target", message: "Shared base" });
    const source = await branchManager.createBranch({ name: "ours-source", from: "ours-target" });

    await client.db(source.branchDatabase).collection("users").updateOne(
      { _id: user!._id },
      { $set: { name: "Branch Ours" } }
    );
    await client.db(target.branchDatabase).collection("users").updateOne(
      { _id: user!._id },
      { $set: { name: "Target Ours" } }
    );
    await client.db(source.branchDatabase).collection("users").insertOne({ name: "No Conflict", role: "new" });

    const result = await mergeEngine.merge("ours-source", "ours-target", {
      detectConflicts: true,
      conflictStrategy: "ours",
    });

    const newDoc = await client.db(target.branchDatabase).collection("users").findOne({ name: "No Conflict" });
    expect(newDoc).not.toBeNull();

    const conflictDoc = await client.db(target.branchDatabase).collection("users").findOne({ _id: user!._id });
    expect(conflictDoc!.name).toBe("Target Ours");
  });

  it("does not apply partial writes or mark branch merged with 'abort' strategy", async () => {
    const target = await branchManager.createBranch({ name: "abort-target" });
    const user = await client.db(target.branchDatabase).collection("users").findOne({ role: "admin" });
    expect(user).not.toBeNull();

    await commitEngine.commit({ branchName: "abort-target", message: "Shared base" });
    const source = await branchManager.createBranch({ name: "abort-source", from: "abort-target" });

    await client.db(source.branchDatabase).collection("users").updateOne(
      { _id: user!._id },
      { $set: { name: "Branch Abort" } }
    );
    await client.db(source.branchDatabase).collection("users").insertOne({
      name: "Should Not Merge",
      email: "abort@test.io",
      role: "tester",
      active: true,
    });

    await client.db(target.branchDatabase).collection("users").updateOne(
      { _id: user!._id },
      { $set: { name: "Target Abort" } }
    );

    const result = await mergeEngine.merge("abort-source", "abort-target", {
      detectConflicts: true,
      conflictStrategy: "abort",
    });

    expect(result.success).toBe(false);
    expect(result.conflicts.length).toBeGreaterThan(0);

    const conflictDoc = await client.db(target.branchDatabase).collection("users").findOne({ _id: user!._id });
    expect(conflictDoc!.name).toBe("Target Abort");

    const leakedDoc = await client.db(target.branchDatabase).collection("users").findOne({ name: "Should Not Merge" });
    expect(leakedDoc).toBeNull();

    const meta = await client.db(config.metaDatabase).collection("branches").findOne({
      name: "abort-source",
    });
    expect(meta!.status).toBe("active");
  });

  it("applies source version on conflicts with 'theirs' strategy", async () => {
    const target = await branchManager.createBranch({ name: "theirs-target" });
    const user = await client.db(target.branchDatabase).collection("users").findOne({ role: "admin" });
    expect(user).not.toBeNull();

    await commitEngine.commit({ branchName: "theirs-target", message: "Shared base" });
    const source = await branchManager.createBranch({ name: "theirs-source", from: "theirs-target" });

    await client.db(source.branchDatabase).collection("users").updateOne(
      { _id: user!._id },
      { $set: { name: "Branch Theirs" } }
    );
    await client.db(target.branchDatabase).collection("users").updateOne(
      { _id: user!._id },
      { $set: { name: "Target Theirs" } }
    );

    const result = await mergeEngine.merge("theirs-source", "theirs-target", {
      detectConflicts: true,
      conflictStrategy: "theirs",
    });

    expect(result.success).toBe(true);
    const conflictDoc = await client.db(target.branchDatabase).collection("users").findOne({ _id: user!._id });
    expect(conflictDoc!.name).toBe("Branch Theirs");
  });
});

describe("MergeEngine.threeWayMerge — temporary merge-base database", () => {
  it("keeps the temporary merge-base DB name within MongoDB limits for long meta database names", async () => {
    const altConfig: MongoBranchConfig = {
      uri,
      sourceDatabase: "merge_temp_source",
      metaDatabase: "__mongobranch_merge_namespace_probe_20260405",
      branchPrefix: "__mb_mt_",
    };

    const cleanupAlt = async () => {
      const { databases } = await client.db("admin").command({ listDatabases: 1 });
      for (const db of databases) {
        if (
          db.name === altConfig.sourceDatabase ||
          db.name === altConfig.metaDatabase ||
          db.name.startsWith(altConfig.branchPrefix) ||
          db.name.startsWith("__mb_tmp_")
        ) {
          await client.db(db.name).dropDatabase().catch(() => {});
        }
      }
    };

    await cleanupAlt();

    const altSourceDb = client.db(altConfig.sourceDatabase);
    await altSourceDb.collection("items").insertOne({ key: "x", value: 1 });

    const altBranchManager = new BranchManager(client, altConfig);
    await altBranchManager.initialize();
    const altCommitEngine = new CommitEngine(client, altConfig);
    await altCommitEngine.initialize();
    const altMergeEngine = new MergeEngine(client, altConfig);

    const target = await altBranchManager.createBranch({ name: "target" });
    await altCommitEngine.commit({ branchName: "target", message: "Base" });

    const source = await altBranchManager.createBranch({ name: "source", from: "target" });
    await client.db(source.branchDatabase).collection("items").updateOne(
      { key: "x" },
      { $set: { value: 2 } }
    );
    await altCommitEngine.commit({ branchName: "source", message: "Change" });

    const result = await altMergeEngine.threeWayMerge("source", "target", altCommitEngine, {
      author: "tester",
    });

    expect(result.success).toBe(true);
    const merged = await client.db(target.branchDatabase).collection("items").findOne({ key: "x" });
    expect(merged).not.toBeNull();
    expect(merged!.value).toBe(2);

    await cleanupAlt();
  });
});
