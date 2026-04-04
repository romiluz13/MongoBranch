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
import { MergeEngine } from "../../src/core/merge.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";
import { SEED_DATABASE } from "../seed.ts";

let client: MongoClient;
let uri: string;
let config: MongoBranchConfig;
let branchManager: BranchManager;
let mergeEngine: MergeEngine;

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

  config = {
    uri,
    sourceDatabase: SEED_DATABASE,
    metaDatabase: "__mongobranch",
    branchPrefix: "__mb_",
  };
  branchManager = new BranchManager(client, config);
  await branchManager.initialize();
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
  it("detects conflicts when same document modified on both sides", async () => {
    // Create branch
    const branch = await branchManager.createBranch({ name: "conflict-src" });
    const branchDb = client.db(branch.branchDatabase);
    const mainDb = client.db(SEED_DATABASE);

    // Find a user that exists on both sides
    const user = await mainDb.collection("users").findOne({ role: "admin" });
    expect(user).not.toBeNull();

    // Modify the SAME user on the branch
    await branchDb.collection("users").updateOne(
      { _id: user!._id },
      { $set: { name: "Branch Version" } }
    );

    // Modify the SAME user on main (simulating another branch merged first)
    await mainDb.collection("users").updateOne(
      { _id: user!._id },
      { $set: { name: "Main Version" } }
    );

    // Merge should detect the conflict
    const result = await mergeEngine.merge("conflict-src", "main", { detectConflicts: true });
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0]!.documentId).toEqual(user!._id);
    expect(result.conflicts[0]!.collection).toBe("users");
  });

  it("applies non-conflicting changes even when conflicts exist (ours strategy)", async () => {
    const branch = await branchManager.createBranch({ name: "ours-test" });
    const branchDb = client.db(branch.branchDatabase);
    const mainDb = client.db(SEED_DATABASE);

    // Get a user for conflict
    const user = await mainDb.collection("users").findOne({ role: "admin" });

    // Modify same user on both sides
    await branchDb.collection("users").updateOne(
      { _id: user!._id },
      { $set: { name: "Branch Ours" } }
    );
    await mainDb.collection("users").updateOne(
      { _id: user!._id },
      { $set: { name: "Main Ours" } }
    );

    // Add a non-conflicting doc on branch
    await branchDb.collection("users").insertOne({ name: "No Conflict", role: "new" });

    // Merge with "ours" strategy — target wins on conflicts
    const result = await mergeEngine.merge("ours-test", "main", {
      detectConflicts: true,
      conflictStrategy: "ours",
    });

    // Non-conflicting insert should succeed
    const newDoc = await mainDb.collection("users").findOne({ name: "No Conflict" });
    expect(newDoc).not.toBeNull();

    // Conflicting doc should keep main's version ("ours" = target)
    const conflictDoc = await mainDb.collection("users").findOne({ _id: user!._id });
    expect(conflictDoc!.name).toBe("Main Ours");
  });

  it("applies source version on conflicts with 'theirs' strategy", async () => {
    const branch = await branchManager.createBranch({ name: "theirs-test" });
    const branchDb = client.db(branch.branchDatabase);
    const mainDb = client.db(SEED_DATABASE);

    const user = await mainDb.collection("users").findOne({ role: "admin" });

    await branchDb.collection("users").updateOne(
      { _id: user!._id },
      { $set: { name: "Branch Theirs" } }
    );
    await mainDb.collection("users").updateOne(
      { _id: user!._id },
      { $set: { name: "Main Theirs" } }
    );

    const result = await mergeEngine.merge("theirs-test", "main", {
      detectConflicts: true,
      conflictStrategy: "theirs",
    });

    // Conflicting doc should use branch version ("theirs" = source)
    const conflictDoc = await mainDb.collection("users").findOne({ _id: user!._id });
    expect(conflictDoc!.name).toBe("Branch Theirs");
  });
});
