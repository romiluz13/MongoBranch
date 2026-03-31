/**
 * MongoBranch — Branch Comparison Matrix Tests
 *
 * Phase 7.2: N-way branch comparison
 * TDD, real MongoDB, zero mocks.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient } from "mongodb";
import { startMongoDB, stopMongoDB } from "../setup.ts";
import { BranchManager } from "../../src/core/branch.ts";
import { BranchComparator } from "../../src/core/compare.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";

let client: MongoClient;
let branchManager: BranchManager;
let comparator: BranchComparator;

const config: MongoBranchConfig = {
  sourceDatabase: "test_compare_source",
  metaDatabase: "__mongobranch_compare",
  branchPrefix: "__mb_cmp_",
};

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
  branchManager = new BranchManager(client, config);
  comparator = new BranchComparator(client, config);
  await branchManager.initialize();
}, 30_000);

afterAll(async () => {
  if (client) {
    const dbs = await client.db().admin().listDatabases();
    for (const db of dbs.databases) {
      if (db.name.startsWith("__mb_cmp_") || db.name === "__mongobranch_compare" || db.name === "test_compare_source") {
        await client.db(db.name).dropDatabase();
      }
    }
  }
  await stopMongoDB();
}, 10_000);

beforeEach(async () => {
  await client.db(config.metaDatabase).collection("branches").deleteMany({});
  const sourceDb = client.db(config.sourceDatabase);
  await sourceDb.dropDatabase();
  await sourceDb.collection("users").insertMany([
    { name: "Alice", role: "admin" },
    { name: "Bob", role: "user" },
  ]);
});

describe("BranchComparator — N-way compare", () => {
  it("compares two identical branches", async () => {
    await branchManager.createBranch({ name: "cmp-a" });
    await branchManager.createBranch({ name: "cmp-b" });

    const result = await comparator.compare(["cmp-a", "cmp-b"]);

    expect(result.branches).toEqual(["cmp-a", "cmp-b"]);
    expect(result.stats.totalDocuments).toBe(2); // Alice + Bob
    expect(result.stats.inAllBranches).toBe(2);
    expect(result.stats.uniqueToOneBranch).toBe(0);
  });

  it("detects documents unique to one branch", async () => {
    await branchManager.createBranch({ name: "cmp-c" });
    await branchManager.createBranch({ name: "cmp-d" });

    // Add a doc only to cmp-c
    const dbC = client.db(`${config.branchPrefix}cmp-c`);
    await dbC.collection("users").insertOne({ name: "Charlie", role: "guest" });

    const result = await comparator.compare(["cmp-c", "cmp-d"]);

    expect(result.stats.totalDocuments).toBe(3);
    expect(result.stats.inAllBranches).toBe(2); // Alice + Bob
    expect(result.stats.uniqueToOneBranch).toBe(1); // Charlie
  });

  it("detects modified documents between branches", async () => {
    await branchManager.createBranch({ name: "cmp-e" });
    await branchManager.createBranch({ name: "cmp-f" });

    // Modify Alice on cmp-f
    const dbF = client.db(`${config.branchPrefix}cmp-f`);
    await dbF.collection("users").updateOne({ name: "Alice" }, { $set: { role: "superadmin" } });

    const result = await comparator.compare(["cmp-e", "cmp-f"]);

    const aliceEntry = result.entries.find(e => {
      const doc = client.db(`${config.branchPrefix}cmp-e`);
      return e.branches["cmp-f"] === "modified";
    });
    expect(aliceEntry).toBeDefined();
  });

  it("compares three branches", async () => {
    await branchManager.createBranch({ name: "cmp-1" });
    await branchManager.createBranch({ name: "cmp-2" });
    await branchManager.createBranch({ name: "cmp-3" });

    // Add unique doc to cmp-2
    const db2 = client.db(`${config.branchPrefix}cmp-2`);
    await db2.collection("users").insertOne({ name: "Unique", role: "test" });

    const result = await comparator.compare(["cmp-1", "cmp-2", "cmp-3"]);

    expect(result.branches.length).toBe(3);
    expect(result.stats.inAllBranches).toBe(2); // Alice + Bob
    expect(result.stats.uniqueToOneBranch).toBe(1); // Unique
  });

  it("throws for less than 2 branches", async () => {
    await expect(comparator.compare(["only-one"])).rejects.toThrow(/at least 2/);
  });
});
