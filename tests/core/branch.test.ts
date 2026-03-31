/**
 * TDD Tests for MongoBranch Branch Engine
 *
 * Tests run against a REAL MongoDB instance (mongodb-memory-server).
 * All data is real — no mocks, no stubs, no fakes.
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

describe("BranchManager.createBranch", () => {
  it("creates a branch with all collections copied from source", async () => {
    const branch = await branchManager.createBranch({ name: "feature-auth" });

    expect(branch.name).toBe("feature-auth");
    expect(branch.status).toBe("active");
    expect(branch.parentBranch).toBe("main");
    expect(branch.sourceDatabase).toBe(SEED_DATABASE);
    expect(branch.collections).toContain("users");
    expect(branch.collections).toContain("products");
    expect(branch.collections).toContain("orders");

    // Verify data was actually copied to branch database
    const branchDb = client.db(branch.branchDatabase);
    const branchUsers = await branchDb.collection("users").find({}).toArray();
    expect(branchUsers).toHaveLength(4); // 4 seed users

    const branchProducts = await branchDb.collection("products").find({}).toArray();
    expect(branchProducts).toHaveLength(3); // 3 seed products

    const branchOrders = await branchDb.collection("orders").find({}).toArray();
    expect(branchOrders).toHaveLength(3); // 3 seed orders
  });

  it("preserves document content when copying to branch", async () => {
    const branch = await branchManager.createBranch({ name: "data-check" });
    const branchDb = client.db(branch.branchDatabase);

    const alice = await branchDb.collection("users").findOne({ name: "Alice Chen" });
    expect(alice).toBeTruthy();
    expect(alice!.email).toBe("alice.chen@techcorp.io");
    expect(alice!.salary).toBe(145000);
    expect(alice!.skills).toEqual(["TypeScript", "MongoDB", "React"]);
    expect(alice!.address.city).toBe("San Francisco");
  });

  it("rejects duplicate branch names", async () => {
    await branchManager.createBranch({ name: "duplicate-test" });
    await expect(
      branchManager.createBranch({ name: "duplicate-test" })
    ).rejects.toThrow(/already exists/i);
  });

  it("rejects invalid branch names", async () => {
    await expect(
      branchManager.createBranch({ name: "" })
    ).rejects.toThrow(/invalid/i);

    await expect(
      branchManager.createBranch({ name: "has spaces" })
    ).rejects.toThrow(/invalid/i);

    await expect(
      branchManager.createBranch({ name: "main" })
    ).rejects.toThrow(/reserved/i);
  });

  it("stores branch metadata in the meta database", async () => {
    await branchManager.createBranch({
      name: "meta-test",
      description: "Testing metadata storage",
      createdBy: "agent-007",
    });

    const metaDb = client.db(config.metaDatabase);
    const meta = await metaDb.collection("branches").findOne({ name: "meta-test" });
    expect(meta).toBeTruthy();
    expect(meta!.description).toBe("Testing metadata storage");
    expect(meta!.createdBy).toBe("agent-007");
    expect(meta!.createdAt).toBeInstanceOf(Date);
  });
});

describe("BranchManager.listBranches", () => {
  it("returns empty array when no branches exist", async () => {
    const branches = await branchManager.listBranches();
    expect(branches).toEqual([]);
  });

  it("returns all active branches", async () => {
    await branchManager.createBranch({ name: "branch-a" });
    await branchManager.createBranch({ name: "branch-b" });
    await branchManager.createBranch({ name: "branch-c" });

    const branches = await branchManager.listBranches();
    expect(branches).toHaveLength(3);

    const names = branches.map((b) => b.name);
    expect(names).toContain("branch-a");
    expect(names).toContain("branch-b");
    expect(names).toContain("branch-c");
  });

  it("excludes deleted branches by default", async () => {
    await branchManager.createBranch({ name: "keep-me" });
    await branchManager.createBranch({ name: "delete-me" });
    await branchManager.deleteBranch("delete-me");

    const branches = await branchManager.listBranches();
    expect(branches).toHaveLength(1);
    expect(branches[0]!.name).toBe("keep-me");
  });

  it("includes deleted branches when requested", async () => {
    await branchManager.createBranch({ name: "visible" });
    await branchManager.createBranch({ name: "hidden" });
    await branchManager.deleteBranch("hidden");

    const all = await branchManager.listBranches({ includeDeleted: true });
    expect(all).toHaveLength(2);
  });
});
