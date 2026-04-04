/**
 * MongoBranch — Stash Tests
 *
 * Phase 7.3: Save/restore uncommitted changes
 * TDD, real MongoDB, zero mocks.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient } from "mongodb";
import { startMongoDB, stopMongoDB } from "../setup.ts";
import { BranchManager } from "../../src/core/branch.ts";
import { StashManager } from "../../src/core/stash.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";

let client: MongoClient;
let branchManager: BranchManager;
let stashManager: StashManager;

const config: MongoBranchConfig = {
  uri: "",
  sourceDatabase: "test_stash_source",
  metaDatabase: "__mongobranch_stash",
  branchPrefix: "__mb_stash_",
};

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
  branchManager = new BranchManager(client, config);
  stashManager = new StashManager(client, config);
  await branchManager.initialize();
  await stashManager.initialize();
}, 30_000);

afterAll(async () => {
  if (client) {
    const dbs = await client.db().admin().listDatabases();
    for (const db of dbs.databases) {
      if (db.name.startsWith("__mb_stash_") || db.name === "__mongobranch_stash" || db.name === "test_stash_source") {
        await client.db(db.name).dropDatabase();
      }
    }
  }
  await stopMongoDB();
}, 10_000);

beforeEach(async () => {
  await client.db(config.metaDatabase).collection("branches").deleteMany({});
  await client.db(config.metaDatabase).collection("stashes").deleteMany({});
  const sourceDb = client.db(config.sourceDatabase);
  await sourceDb.dropDatabase();
  await sourceDb.collection("users").insertMany([
    { name: "Alice", score: 100 },
    { name: "Bob", score: 200 },
  ]);
});

describe("StashManager — stash & pop", () => {
  it("stashes branch data and clears collections", async () => {
    await branchManager.createBranch({ name: "stash-basic" });

    const branchDb = client.db(`${config.branchPrefix}stash-basic`);
    const beforeCount = await branchDb.collection("users").countDocuments();
    expect(beforeCount).toBe(2);

    const entry = await stashManager.stash("stash-basic", "WIP changes");

    expect(entry.branchName).toBe("stash-basic");
    expect(entry.message).toBe("WIP changes");
    expect(entry.index).toBe(0);
    expect(entry.data.users!.length).toBe(2);

    // Branch should be empty after stash
    const afterCount = await branchDb.collection("users").countDocuments();
    expect(afterCount).toBe(0);
  });

  it("pops stash and restores data", async () => {
    await branchManager.createBranch({ name: "stash-pop" });

    await stashManager.stash("stash-pop", "Save state");

    // Branch is empty
    const branchDb = client.db(`${config.branchPrefix}stash-pop`);
    expect(await branchDb.collection("users").countDocuments()).toBe(0);

    // Pop restores data
    const entry = await stashManager.pop("stash-pop");
    expect(entry.message).toBe("Save state");
    expect(await branchDb.collection("users").countDocuments()).toBe(2);
  });

  it("supports stash stack (multiple stashes)", async () => {
    await branchManager.createBranch({ name: "stash-stack" });

    // First stash
    await stashManager.stash("stash-stack", "First stash");

    // Add new data and stash again
    const branchDb = client.db(`${config.branchPrefix}stash-stack`);
    await branchDb.collection("notes").insertOne({ text: "hello" });
    await stashManager.stash("stash-stack", "Second stash");

    const list = await stashManager.list("stash-stack");
    expect(list.length).toBe(2);
    expect(list[0]!.message).toBe("Second stash"); // index 0 = newest
    expect(list[1]!.message).toBe("First stash");  // index 1 = older
  });

  it("drops a specific stash", async () => {
    await branchManager.createBranch({ name: "stash-drop" });

    await stashManager.stash("stash-drop", "Will drop");
    expect(await stashManager.count("stash-drop")).toBe(1);

    await stashManager.drop("stash-drop", 0);
    expect(await stashManager.count("stash-drop")).toBe(0);
  });

  it("throws when stashing an empty branch", async () => {
    await branchManager.createBranch({ name: "stash-empty" });
    const branchDb = client.db(`${config.branchPrefix}stash-empty`);
    await branchDb.collection("users").deleteMany({});

    await expect(stashManager.stash("stash-empty", "Nothing here"))
      .rejects.toThrow(/no data/i);
  });

  it("throws when popping with no stash", async () => {
    await expect(stashManager.pop("no-stash-branch"))
      .rejects.toThrow(/No stash found/);
  });
});
