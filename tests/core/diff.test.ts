/**
 * TDD Tests for MongoBranch Diff Engine
 *
 * Tests run against REAL MongoDB (Atlas Local Docker).
 * All data is real seed data — no mocks, no stubs.
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
import { DiffEngine } from "../../src/core/diff.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";
import { SEED_DATABASE } from "../seed.ts";

let client: MongoClient;
let uri: string;
let config: MongoBranchConfig;
let branchManager: BranchManager;
let diffEngine: DiffEngine;

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
  diffEngine = new DiffEngine(client, config);
});

describe("DiffEngine.diffBranches — no changes", () => {
  it("returns empty diff when branch has no modifications", async () => {
    await branchManager.createBranch({ name: "untouched" });

    const result = await diffEngine.diffBranches("untouched", "main");
    expect(result.totalChanges).toBe(0);
    expect(result.collections).toEqual({});
  });
});

describe("DiffEngine.diffBranches — document modifications", () => {
  it("detects inserted documents", async () => {
    const branch = await branchManager.createBranch({ name: "add-user" });
    const branchDb = client.db(branch.branchDatabase);

    await branchDb.collection("users").insertOne({
      name: "Eve Wilson",
      email: "eve@techcorp.io",
      role: "intern",
      active: true,
    });

    const result = await diffEngine.diffBranches("add-user", "main");
    expect(result.totalChanges).toBe(1);
    expect(result.collections["users"]).toBeTruthy();
    expect(result.collections["users"]!.added).toHaveLength(1);
    expect(result.collections["users"]!.added[0]!.name).toBe("Eve Wilson");
  });

  it("detects deleted documents", async () => {
    const branch = await branchManager.createBranch({ name: "remove-user" });
    const branchDb = client.db(branch.branchDatabase);

    await branchDb.collection("users").deleteOne({ name: "David Okonkwo" });

    const result = await diffEngine.diffBranches("remove-user", "main");
    expect(result.totalChanges).toBe(1);
    expect(result.collections["users"]!.removed).toHaveLength(1);
    expect(result.collections["users"]!.removed[0]!.name).toBe("David Okonkwo");
  });

  it("detects modified documents with field-level diff", async () => {
    const branch = await branchManager.createBranch({ name: "edit-user" });
    const branchDb = client.db(branch.branchDatabase);

    await branchDb.collection("users").updateOne(
      { name: "Alice Chen" },
      { $set: { salary: 200000, role: "CTO" } }
    );

    const result = await diffEngine.diffBranches("edit-user", "main");
    expect(result.totalChanges).toBe(1);

    const modified = result.collections["users"]!.modified;
    expect(modified).toHaveLength(1);
    expect(modified[0]!.fields).toBeTruthy();
    expect(modified[0]!.fields!["salary"]).toEqual({ from: 145000, to: 200000 });
    expect(modified[0]!.fields!["role"]).toEqual({ from: "admin", to: "CTO" });
  });

  it("handles changes across multiple collections", async () => {
    const branch = await branchManager.createBranch({ name: "multi-coll" });
    const branchDb = client.db(branch.branchDatabase);

    await branchDb.collection("users").insertOne({
      name: "Frank", email: "frank@test.io", role: "dev", active: true,
    });
    await branchDb.collection("products").deleteOne({ sku: "AGL-003" });
    await branchDb.collection("orders").updateOne(
      { status: "pending" },
      { $set: { status: "completed" } }
    );

    const result = await diffEngine.diffBranches("multi-coll", "main");
    expect(result.totalChanges).toBe(3);
    expect(result.collections["users"]!.added).toHaveLength(1);
    expect(result.collections["products"]!.removed).toHaveLength(1);
    expect(result.collections["orders"]!.modified).toHaveLength(1);
  });
});

describe("DiffEngine.diffBranches — summary", () => {
  it("returns a structured summary of all changes", async () => {
    const branch = await branchManager.createBranch({ name: "summary-test" });
    const branchDb = client.db(branch.branchDatabase);

    await branchDb.collection("users").insertOne({
      name: "Grace", email: "grace@test.io", role: "dev", active: true,
    });
    await branchDb.collection("users").deleteOne({ name: "Bob Martinez" });

    const result = await diffEngine.diffBranches("summary-test", "main");
    expect(result.sourceBranch).toBe("summary-test");
    expect(result.targetBranch).toBe("main");
    expect(result.totalChanges).toBe(2);
    expect(result.collections["users"]!.added).toHaveLength(1);
    expect(result.collections["users"]!.removed).toHaveLength(1);
    expect(result.collections["users"]!.modified).toHaveLength(0);
  });
});

describe("DiffEngine.diffBranches — schema diff", () => {
  it("detects added indexes on branch", async () => {
    const branch = await branchManager.createBranch({ name: "idx-add" });
    const branchDb = client.db(branch.branchDatabase);

    // Create a new index on the branch
    await branchDb.collection("users").createIndex({ email: 1 }, { name: "idx_email" });

    const result = await diffEngine.diffBranches("idx-add", "main");
    expect(result.indexChanges).toBeDefined();
    const userIndexes = result.indexChanges?.["users"];
    expect(userIndexes).toBeDefined();
    expect(userIndexes!.added.length).toBeGreaterThan(0);
    expect(userIndexes!.added.some((idx: any) => idx.name === "idx_email")).toBe(true);
  });

  it("detects removed indexes on branch", async () => {
    // First create an index on main
    const mainDb = client.db(SEED_DATABASE);
    await mainDb.collection("users").createIndex({ role: 1 }, { name: "idx_role_temp" });

    const branch = await branchManager.createBranch({ name: "idx-rm" });
    const branchDb = client.db(branch.branchDatabase);

    // Drop that index on the branch
    await branchDb.collection("users").dropIndex("idx_role_temp");

    const result = await diffEngine.diffBranches("idx-rm", "main");
    const userIndexes = result.indexChanges?.["users"];
    expect(userIndexes).toBeDefined();
    expect(userIndexes!.removed.some((idx: any) => idx.name === "idx_role_temp")).toBe(true);

    // Cleanup: drop the temp index from main
    await mainDb.collection("users").dropIndex("idx_role_temp");
  });

  it("returns empty indexChanges when no index differences", async () => {
    await branchManager.createBranch({ name: "idx-none" });
    const result = await diffEngine.diffBranches("idx-none", "main");
    // All collections should have empty added/removed
    if (result.indexChanges) {
      for (const changes of Object.values(result.indexChanges)) {
        expect(changes.added).toHaveLength(0);
        expect(changes.removed).toHaveLength(0);
      }
    }
  });
});



describe("DiffEngine.diffBranches — validation diff", () => {
  it("detects added validation rules on branch", async () => {
    await branchManager.createBranch({ name: "val-add" });
    const branchDb = client.db(config.branchPrefix + "val-add");

    // Add validation to users collection on branch
    await branchDb.command({
      collMod: "users",
      validator: { $jsonSchema: { bsonType: "object", required: ["name"] } },
      validationLevel: "strict",
    });

    const result = await diffEngine.diffBranches("val-add", "main");
    expect(result.validationChanges).toBeDefined();
    expect(result.validationChanges!["users"]).toBeDefined();
    expect(result.validationChanges!["users"]!.changed).toBe(true);
    expect(result.validationChanges!["users"]!.source).not.toBeNull();
  });

  it("returns no validationChanges when rules are identical", async () => {
    await branchManager.createBranch({ name: "val-same" });

    const result = await diffEngine.diffBranches("val-same", "main");
    expect(result.validationChanges).toBeUndefined();
  });
});
