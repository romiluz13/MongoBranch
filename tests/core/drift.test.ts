import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient } from "mongodb";
import { startMongoDB, stopMongoDB } from "../setup.ts";
import { BranchManager } from "../../src/core/branch.ts";
import { DriftManager } from "../../src/core/drift.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";

let client: MongoClient;
let branchManager: BranchManager;
let driftManager: DriftManager;

const config: MongoBranchConfig = {
  uri: "",
  sourceDatabase: "test_drift_source",
  metaDatabase: "__mongobranch_drift",
  branchPrefix: "__mb_drift_",
};

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
  branchManager = new BranchManager(client, config);
  driftManager = new DriftManager(client, config);
  await branchManager.initialize();
  await driftManager.initialize();
}, 30_000);

afterAll(async () => {
  if (client) {
    const dbs = await client.db().admin().listDatabases();
    for (const db of dbs.databases) {
      if (
        db.name === config.sourceDatabase ||
        db.name === config.metaDatabase ||
        db.name.startsWith(config.branchPrefix)
      ) {
        await client.db(db.name).dropDatabase().catch(() => {});
      }
    }
  }
  await stopMongoDB();
}, 10_000);

beforeEach(async () => {
  await client.db(config.metaDatabase).collection("branches").deleteMany({});
  await client.db(config.metaDatabase).collection("drift_baselines").deleteMany({});

  const sourceDb = client.db(config.sourceDatabase);
  const collections = await sourceDb.listCollections().toArray().catch(() => []);
  for (const collection of collections) {
    if (collection.name.startsWith("system.")) continue;
    await sourceDb.collection(collection.name).deleteMany({});
  }

  const { databases } = await client.db("admin").command({ listDatabases: 1 });
  for (const db of databases) {
    if (db.name.startsWith(config.branchPrefix)) {
      await client.db(db.name).dropDatabase().catch(() => {});
    }
  }

  await sourceDb.collection("users").insertMany([
    { name: "Alice", role: "admin" },
    { name: "Bob", role: "user" },
  ]);
});

describe("DriftManager", () => {
  it("captures a clean baseline for main", async () => {
    const baseline = await driftManager.captureBaseline({
      branchName: "main",
      capturedBy: "reviewer",
      reason: "release review",
    });

    expect(baseline.baselineOperationTime).toBeDefined();
    expect(baseline.branchName).toBe("main");

    const result = await driftManager.checkBaseline({ baselineId: baseline.id });
    expect(result.drifted).toBe(false);
    expect(result.baseline.status).toBe("clean");
    expect(result.baseline.lastCheckedAt).toBeDefined();
  });

  it("detects drift on a branch after new writes", async () => {
    await branchManager.createBranch({ name: "feat-drift" });
    const baseline = await driftManager.captureBaseline({
      branchName: "feat-drift",
      capturedBy: "agent-1",
    });

    await client
      .db(`${config.branchPrefix}feat-drift`)
      .collection("users")
      .insertOne({ name: "Charlie", role: "viewer" });
    await new Promise((resolve) => setTimeout(resolve, 250));

    const result = await driftManager.checkBaseline({ baselineId: baseline.id });
    expect(result.drifted).toBe(true);
    expect(result.baseline.status).toBe("drifted");
    expect(result.baseline.driftedAt).toBeDefined();
    expect(result.statusReason).toContain(`feat-drift`);
  });

  it("checks the latest baseline for a branch when baselineId is omitted", async () => {
    await branchManager.createBranch({ name: "feat-latest" });
    await driftManager.captureBaseline({
      branchName: "feat-latest",
      capturedBy: "agent-1",
      reason: "old review",
    });

    await client
      .db(`${config.branchPrefix}feat-latest`)
      .collection("users")
      .insertOne({ name: "Charlie", role: "viewer" });
    await new Promise((resolve) => setTimeout(resolve, 250));

    const latest = await driftManager.captureBaseline({
      branchName: "feat-latest",
      capturedBy: "agent-2",
      reason: "fresh review",
    });

    const result = await driftManager.checkBaseline({ branchName: "feat-latest" });
    expect(result.baseline.id).toBe(latest.id);
    expect(result.drifted).toBe(false);
  });

  it("rejects baselines for unknown branches", async () => {
    await expect(
      driftManager.captureBaseline({ branchName: "ghost-branch", capturedBy: "reviewer" })
    ).rejects.toThrow(/not found/i);
  });
});
