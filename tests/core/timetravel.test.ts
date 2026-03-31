/**
 * MongoBranch — Time Travel & Blame Tests
 *
 * Phase 6.1: Query data at any commit or timestamp
 * Phase 6.2: Blame — who changed what, when
 *
 * TDD, real MongoDB, zero mocks.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { MongoClient } from "mongodb";
import { startMongoDB, stopMongoDB } from "../setup.ts";
import { BranchManager } from "../../src/core/branch.ts";
import { CommitEngine } from "../../src/core/commit.ts";
import { TimeTravelEngine } from "../../src/core/timetravel.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";

let client: MongoClient;
let branchManager: BranchManager;
let commitEngine: CommitEngine;
let timeTravelEngine: TimeTravelEngine;

const config: MongoBranchConfig = {
  sourceDatabase: "test_timetravel_source",
  metaDatabase: "__mongobranch_timetravel",
  branchPrefix: "__mb_tt_",
};

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
  branchManager = new BranchManager(client, config);
  commitEngine = new CommitEngine(client, config);
  timeTravelEngine = new TimeTravelEngine(client, config);
  await branchManager.initialize();
  await commitEngine.initialize();
  await timeTravelEngine.initialize();
}, 30_000);

afterAll(async () => {
  if (client) {
    const dbs = await client.db().admin().listDatabases();
    for (const db of dbs.databases) {
      if (db.name.startsWith("__mb_tt_") || db.name.startsWith("__mongobranch_timetravel") || db.name === "test_timetravel_source") {
        await client.db(db.name).dropDatabase();
      }
    }
  }
  await stopMongoDB();
}, 10_000);

beforeEach(async () => {
  // Clean meta collections
  await client.db(config.metaDatabase).collection("branches").deleteMany({});
  await client.db(config.metaDatabase).collection("commits").deleteMany({});
  await client.db(config.metaDatabase).collection("commit_data").deleteMany({});
  await client.db(config.metaDatabase).collection("tags").deleteMany({});

  // Seed source DB
  const sourceDb = client.db(config.sourceDatabase);
  await sourceDb.dropDatabase();
  await sourceDb.collection("users").insertMany([
    { name: "Alice", role: "admin", score: 100 },
    { name: "Bob", role: "user", score: 50 },
  ]);
});

// ── Time Travel Tests (Phase 6.1) ──────────────────────────

describe("Time Travel — findAt by commit hash", () => {
  it("queries data at a specific commit", async () => {
    const branch = await branchManager.createBranch({ name: "tt-query" });
    const branchDb = client.db(branch.branchDatabase);

    // Commit initial state
    const commit1 = await commitEngine.commit({ branchName: "tt-query", message: "Initial snapshot", author: "test" });

    // Modify data
    await branchDb.collection("users").updateOne({ name: "Alice" }, { $set: { score: 200 } });
    const commit2 = await commitEngine.commit({ branchName: "tt-query", message: "Updated Alice score", author: "test" });

    // Query at commit1 — Alice should have score 100
    const result1 = await timeTravelEngine.findAt({
      branchName: "tt-query",
      collection: "users",
      filter: { name: "Alice" },
      at: commit1.hash,
    });

    expect(result1.documents.length).toBe(1);
    expect((result1.documents[0] as any).score).toBe(100);
    expect(result1.commitHash).toBe(commit1.hash);

    // Query at commit2 — Alice should have score 200
    const result2 = await timeTravelEngine.findAt({
      branchName: "tt-query",
      collection: "users",
      filter: { name: "Alice" },
      at: commit2.hash,
    });

    expect(result2.documents.length).toBe(1);
    expect((result2.documents[0] as any).score).toBe(200);
  });

  it("returns all documents when no filter provided", async () => {
    await branchManager.createBranch({ name: "tt-nofilter" });
    const commit = await commitEngine.commit({ branchName: "tt-nofilter", message: "Snapshot all", author: "test" });

    const result = await timeTravelEngine.findAt({
      branchName: "tt-nofilter",
      collection: "users",
      at: commit.hash,
    });

    expect(result.documents.length).toBe(2);
    expect(result.documentCount).toBe(2);
  });

  it("queries by timestamp", async () => {
    await branchManager.createBranch({ name: "tt-time" });
    const commit1 = await commitEngine.commit({ branchName: "tt-time", message: "Before change", author: "test" });

    // Small delay to get a distinct timestamp
    await new Promise(r => setTimeout(r, 50));
    const midTime = new Date().toISOString();
    await new Promise(r => setTimeout(r, 50));

    const branchDb = client.db(`${config.branchPrefix}tt-time`);
    await branchDb.collection("users").updateOne({ name: "Bob" }, { $set: { score: 999 } });
    await commitEngine.commit({ branchName: "tt-time", message: "After change", author: "test" });

    // Query at midTime — should get commit1 data (before change)
    const result = await timeTravelEngine.findAt({
      branchName: "tt-time",
      collection: "users",
      filter: { name: "Bob" },
      at: midTime,
    });

    expect(result.documents.length).toBe(1);
    expect((result.documents[0] as any).score).toBe(50); // Original value
  });

  it("throws for non-existent commit", async () => {
    await branchManager.createBranch({ name: "tt-404" });

    await expect(
      timeTravelEngine.findAt({
        branchName: "tt-404",
        collection: "users",
        at: "nonexistent-hash",
      })
    ).rejects.toThrow(/No commit found/);
  });

  it("lists collections at a specific commit", async () => {
    await branchManager.createBranch({ name: "tt-cols" });
    const commit1 = await commitEngine.commit({ branchName: "tt-cols", message: "Initial", author: "test" });

    // Add a new collection
    const branchDb = client.db(`${config.branchPrefix}tt-cols`);
    await branchDb.collection("products").insertOne({ name: "Widget", price: 10 });
    const commit2 = await commitEngine.commit({ branchName: "tt-cols", message: "Added products", author: "test" });

    const colsAtCommit1 = await timeTravelEngine.listCollectionsAt("tt-cols", commit1.hash);
    expect(colsAtCommit1).toContain("users");
    expect(colsAtCommit1).not.toContain("products");

    const colsAtCommit2 = await timeTravelEngine.listCollectionsAt("tt-cols", commit2.hash);
    expect(colsAtCommit2).toContain("users");
    expect(colsAtCommit2).toContain("products");
  });
});

// ── Blame Tests (Phase 6.2) ────────────────────────────────

describe("Blame — who changed what and when", () => {
  it("blames field changes to the right commits", async () => {
    const branch = await branchManager.createBranch({ name: "blame-basic" });
    const branchDb = client.db(branch.branchDatabase);

    const commit1 = await commitEngine.commit({ branchName: "blame-basic", message: "Initial", author: "alice" });

    // Get Alice's _id
    const aliceDoc = await branchDb.collection("users").findOne({ name: "Alice" });
    const aliceId = aliceDoc!._id.toString();

    // Change Alice's score
    await branchDb.collection("users").updateOne({ name: "Alice" }, { $set: { score: 200 } });
    const commit2 = await commitEngine.commit({ branchName: "blame-basic", message: "Boosted Alice", author: "bob" });

    // Change Alice's role
    await branchDb.collection("users").updateOne({ name: "Alice" }, { $set: { role: "superadmin" } });
    const commit3 = await commitEngine.commit({ branchName: "blame-basic", message: "Promoted Alice", author: "charlie" });

    const result = await timeTravelEngine.blame("blame-basic", "users", aliceId);

    expect(result.branchName).toBe("blame-basic");
    expect(result.documentId).toBe(aliceId);
    expect(result.totalCommitsScanned).toBeGreaterThanOrEqual(3);

    // Score was changed in commit2
    expect(result.fields.score).toBeDefined();
    const scoreChange = result.fields.score.find(e => e.value === 200);
    expect(scoreChange).toBeDefined();
    expect(scoreChange!.author).toBe("bob");

    // Role was changed in commit3
    expect(result.fields.role).toBeDefined();
    const roleChange = result.fields.role.find(e => e.value === "superadmin");
    expect(roleChange).toBeDefined();
    expect(roleChange!.author).toBe("charlie");
  });

  it("attributes unchanged fields to the initial commit", async () => {
    const branch = await branchManager.createBranch({ name: "blame-init" });
    const branchDb = client.db(branch.branchDatabase);

    const commit1 = await commitEngine.commit({ branchName: "blame-init", message: "Initial", author: "creator" });

    const bobDoc = await branchDb.collection("users").findOne({ name: "Bob" });
    const bobId = bobDoc!._id.toString();

    // No changes to Bob — make a second commit with changes elsewhere
    await branchDb.collection("users").updateOne({ name: "Alice" }, { $set: { score: 999 } });
    await commitEngine.commit({ branchName: "blame-init", message: "Changed Alice only", author: "modifier" });

    const result = await timeTravelEngine.blame("blame-init", "users", bobId);

    // Bob's name and role should be attributed to the initial commit
    expect(result.fields.name).toBeDefined();
    expect(result.fields.name[0].commitHash).toBe(commit1.hash);
  });
});
