/**
 * TDD Tests for branch switch, delete, and isolation.
 * Real MongoDB — no mocks.
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
import type { MongoBranchConfig } from "../../src/core/types.ts";
import { SEED_DATABASE } from "../seed.ts";

let client: MongoClient;
let uri: string;
let config: MongoBranchConfig;
let branchManager: BranchManager;

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
});

describe("BranchManager.switchBranch", () => {
  it("switches active branch and returns result", async () => {
    await branchManager.createBranch({ name: "feature-x" });

    const result = await branchManager.switchBranch("feature-x");
    expect(result.currentBranch).toBe("feature-x");
    expect(result.previousBranch).toBe("main");
    expect(result.database).toBeTruthy();
  });

  it("can switch back to main", async () => {
    await branchManager.createBranch({ name: "temp-branch" });
    await branchManager.switchBranch("temp-branch");

    const result = await branchManager.switchBranch("main");
    expect(result.currentBranch).toBe("main");
    expect(result.previousBranch).toBe("temp-branch");
    expect(result.database).toBe(SEED_DATABASE);
  });

  it("rejects switching to non-existent branch", async () => {
    await expect(
      branchManager.switchBranch("ghost-branch")
    ).rejects.toThrow(/not found/i);
  });

  it("rejects switching to deleted branch", async () => {
    await branchManager.createBranch({ name: "doomed" });
    await branchManager.deleteBranch("doomed");

    await expect(
      branchManager.switchBranch("doomed")
    ).rejects.toThrow(/not found|deleted/i);
  });

  it("tracks current branch correctly", async () => {
    expect(branchManager.getCurrentBranch()).toBe("main");

    await branchManager.createBranch({ name: "branch-y" });
    await branchManager.switchBranch("branch-y");
    expect(branchManager.getCurrentBranch()).toBe("branch-y");
  });
});

describe("BranchManager.deleteBranch", () => {
  it("deletes branch and drops its database", async () => {
    const branch = await branchManager.createBranch({ name: "to-delete" });
    const branchDbName = branch.branchDatabase;

    // Verify the DB exists first
    const dbsBefore = await client.db("admin").command({ listDatabases: 1 });
    const existsBefore = dbsBefore.databases.some(
      (d: { name: string }) => d.name === branchDbName
    );
    expect(existsBefore).toBe(true);

    // Delete the branch
    const result = await branchManager.deleteBranch("to-delete");
    expect(result.name).toBe("to-delete");
    expect(result.databaseDropped).toBe(true);

    // Verify the DB is gone
    const dbsAfter = await client.db("admin").command({ listDatabases: 1 });
    const existsAfter = dbsAfter.databases.some(
      (d: { name: string }) => d.name === branchDbName
    );
    expect(existsAfter).toBe(false);
  });

  it("marks branch as deleted in metadata", async () => {
    await branchManager.createBranch({ name: "soft-delete" });
    await branchManager.deleteBranch("soft-delete");

    const metaDb = client.db(config.metaDatabase);
    const meta = await metaDb.collection("branches").findOne({ name: "soft-delete" });
    expect(meta).toBeTruthy();
    expect(meta!.status).toBe("deleted");
  });

  it("cannot delete main branch", async () => {
    await expect(branchManager.deleteBranch("main")).rejects.toThrow(/cannot delete.*main/i);
  });

  it("cannot delete non-existent branch", async () => {
    await expect(branchManager.deleteBranch("phantom")).rejects.toThrow(/not found/i);
  });

  it("switches to main if deleting the current branch", async () => {
    await branchManager.createBranch({ name: "current-then-gone" });
    await branchManager.switchBranch("current-then-gone");
    expect(branchManager.getCurrentBranch()).toBe("current-then-gone");

    await branchManager.deleteBranch("current-then-gone");
    expect(branchManager.getCurrentBranch()).toBe("main");
  });
});

describe("Branch Data Isolation", () => {
  it("changes on a branch do NOT affect the source database", async () => {
    const branch = await branchManager.createBranch({ name: "isolated-test" });
    const branchDb = client.db(branch.branchDatabase);
    const sourceDb = client.db(SEED_DATABASE);

    // Modify data on the branch
    await branchDb.collection("users").updateOne(
      { name: "Alice Chen" },
      { $set: { salary: 200000, role: "CTO" } }
    );
    await branchDb.collection("users").insertOne({
      name: "New Hire",
      email: "new@techcorp.io",
      role: "intern",
      active: true,
    });

    // Source database should be unchanged
    const sourceAlice = await sourceDb.collection("users").findOne({ name: "Alice Chen" });
    expect(sourceAlice!.salary).toBe(145000);
    expect(sourceAlice!.role).toBe("admin");

    const sourceUsers = await sourceDb.collection("users").countDocuments();
    expect(sourceUsers).toBe(4); // Still 4, not 5

    // Branch should have the changes
    const branchAlice = await branchDb.collection("users").findOne({ name: "Alice Chen" });
    expect(branchAlice!.salary).toBe(200000);
    expect(branchAlice!.role).toBe("CTO");

    const branchUsers = await branchDb.collection("users").countDocuments();
    expect(branchUsers).toBe(5); // 4 + 1 new
  });
});

describe("BranchManager.rollbackBranch", () => {
  it("resets branch data to match source", async () => {
    const branch = await branchManager.createBranch({ name: "rollback-me" });
    const branchDb = client.db(branch.branchDatabase);

    // Make changes
    await branchDb.collection("users").insertOne({ name: "Extra", role: "test" });
    await branchDb.collection("users").deleteOne({ role: "admin" });

    const countBefore = await branchDb.collection("users").countDocuments();

    // Rollback
    const result = await branchManager.rollbackBranch("rollback-me");
    expect(result.name).toBe("rollback-me");
    expect(result.collectionsReset).toBeGreaterThan(0);

    // Data should match main again
    const mainDb = client.db(SEED_DATABASE);
    const mainCount = await mainDb.collection("users").countDocuments();
    const branchCount = await branchDb.collection("users").countDocuments();
    expect(branchCount).toBe(mainCount);
  });

  it("cannot rollback main", async () => {
    await expect(branchManager.rollbackBranch("main")).rejects.toThrow(/cannot rollback main/i);
  });

  it("cannot rollback non-existent branch", async () => {
    await expect(branchManager.rollbackBranch("ghost")).rejects.toThrow(/not found/i);
  });
});


describe("BranchManager — lazy copy-on-write", () => {
  it("creates a lazy branch without copying data", async () => {
    const branch = await branchManager.createBranch({ name: "lazy-1", lazy: true });

    expect(branch.lazy).toBe(true);
    expect(branch.materializedCollections).toEqual([]);

    // Branch database should have NO collections yet
    const branchDb = client.db(branch.branchDatabase);
    const colls = await branchDb.listCollections().toArray();
    const userColl = colls.find((c) => c.name === "users");
    expect(userColl).toBeUndefined();
  });

  it("materializes a collection on demand", async () => {
    const branch = await branchManager.createBranch({ name: "lazy-mat", lazy: true });

    // Materialize the users collection
    const result = await branchManager.materializeCollection("lazy-mat", "users");
    expect(result).toBe(true);

    // Now the branch should have users data
    const branchDb = client.db(branch.branchDatabase);
    const mainDb = client.db(SEED_DATABASE);
    const branchCount = await branchDb.collection("users").countDocuments();
    const mainCount = await mainDb.collection("users").countDocuments();
    expect(branchCount).toBe(mainCount);
  });

  it("skips re-materialization of already materialized collection", async () => {
    await branchManager.createBranch({ name: "lazy-skip", lazy: true });
    await branchManager.materializeCollection("lazy-skip", "users");

    // Second call should return false (already materialized)
    const result = await branchManager.materializeCollection("lazy-skip", "users");
    expect(result).toBe(false);
  });

  it("reports materialization status correctly", async () => {
    await branchManager.createBranch({ name: "lazy-status", lazy: true });
    await branchManager.materializeCollection("lazy-status", "users");

    const status = await branchManager.getBranchMaterializationStatus("lazy-status");
    expect(status.lazy).toBe(true);
    expect(status.materialized).toContain("users");
    expect(status.pending.length).toBeGreaterThan(0);
    expect(status.pending).not.toContain("users");
  });
});
