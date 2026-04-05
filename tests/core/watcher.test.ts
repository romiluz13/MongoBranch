import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { MongoClient } from "mongodb";
import { BranchManager } from "../../src/core/branch";
import { BranchWatcher, type BranchChangeEvent } from "../../src/core/watcher";
import { startMongoDB, stopMongoDB, getTestEnvironment, cleanupBranches } from "../setup";
import { SEED_DATABASE } from "../seed";
import type { MongoBranchConfig } from "../../src/core/types";

describe("BranchWatcher", () => {
  let client: MongoClient;
  let uri: string;
  let config: MongoBranchConfig;
  let branchManager: BranchManager;
  let watcher: BranchWatcher;
  const testBranch = "watcher-test-branch";

  beforeAll(async () => {
    const env = await startMongoDB();
    client = env.client;
    uri = env.uri;

    await getTestEnvironment();
    await cleanupBranches(client);

    config = {
      uri,
      sourceDatabase: SEED_DATABASE,
      metaDatabase: "mongobranch_meta",
      branchPrefix: "mongobranch_branch_",
    };

    branchManager = new BranchManager(client, config);
    await branchManager.initialize();

    // Clean up branch if it already exists from a prior run
    try {
      await branchManager.deleteBranch(testBranch);
    } catch { /* branch doesn't exist — that's fine */ }

    await branchManager.createBranch({ name: testBranch, from: "main" });
  }, 30_000);

  afterEach(async () => {
    if (watcher?.isRunning()) {
      await watcher.stop();
    }
  });

  afterAll(async () => {
    await stopMongoDB();
  }, 10_000);

  it("should start and stop watching a branch", async () => {
    watcher = new BranchWatcher(client, config);
    expect(watcher.isRunning()).toBe(false);
    expect(watcher.getBranchName()).toBeNull();

    await watcher.watch(testBranch);
    expect(watcher.isRunning()).toBe(true);
    expect(watcher.getBranchName()).toBe(testBranch);

    await watcher.stop();
    expect(watcher.isRunning()).toBe(false);
  });

  it("should not warn when stop intentionally closes the stream", async () => {
    watcher = new BranchWatcher(client, config);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await watcher.watch(testBranch);
    await new Promise((r) => setTimeout(r, 200));
    await watcher.stop();
    await new Promise((r) => setTimeout(r, 100));

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("should throw if watching while already running", async () => {
    watcher = new BranchWatcher(client, config);
    await watcher.watch(testBranch);
    await expect(watcher.watch("another-branch")).rejects.toThrow("Watcher already running");
  });

  it("should throw for non-existent branch", async () => {
    watcher = new BranchWatcher(client, config);
    await expect(watcher.watch("nonexistent-branch-xyz")).rejects.toThrow("not found");
  });

  it("should detect insert events", async () => {
    watcher = new BranchWatcher(client, config);
    const events: BranchChangeEvent[] = [];
    watcher.on((event) => { events.push(event); });

    await watcher.watch(testBranch);
    await new Promise((r) => setTimeout(r, 200));

    const branchDb = client.db(`${config.branchPrefix}${testBranch}`);
    await branchDb.collection("watchtest").insertOne({ _id: "w1" as any, name: "Gamma" });
    await new Promise((r) => setTimeout(r, 500));

    expect(events.length).toBeGreaterThanOrEqual(1);
    const insertEvent = events.find((e) => e.type === "insert");
    expect(insertEvent).toBeDefined();
    expect(insertEvent!.collection).toBe("watchtest");
    expect(insertEvent!.branchName).toBe(testBranch);
    expect(insertEvent!.fullDocument?.name).toBe("Gamma");
  }, 10_000);

  it("should detect update events with fullDocument", async () => {
    watcher = new BranchWatcher(client, config);
    const events: BranchChangeEvent[] = [];
    watcher.on((event) => { events.push(event); });

    await watcher.watch(testBranch);
    await new Promise((r) => setTimeout(r, 200));

    const branchDb = client.db(`${config.branchPrefix}${testBranch}`);
    // Ensure the doc exists first
    await branchDb.collection("watchtest").insertOne({ _id: "w2" as any, price: 10 });
    await new Promise((r) => setTimeout(r, 300));
    events.length = 0; // Clear insert event

    await branchDb.collection("watchtest").updateOne(
      { _id: "w2" as any },
      { $set: { price: 99 } }
    );
    await new Promise((r) => setTimeout(r, 500));

    const updateEvent = events.find((e) => e.type === "update");
    expect(updateEvent).toBeDefined();
    expect(updateEvent!.collection).toBe("watchtest");
    expect(updateEvent!.updatedFields?.price).toBe(99);
  }, 10_000);

  it("should detect delete events", async () => {
    watcher = new BranchWatcher(client, config);
    const events: BranchChangeEvent[] = [];
    watcher.on((event) => { events.push(event); });

    await watcher.watch(testBranch);
    await new Promise((r) => setTimeout(r, 200));

    const branchDb = client.db(`${config.branchPrefix}${testBranch}`);
    await branchDb.collection("watchtest").insertOne({ _id: "w3" as any, name: "Del" });
    await new Promise((r) => setTimeout(r, 300));
    events.length = 0;

    await branchDb.collection("watchtest").deleteOne({ _id: "w3" as any });
    await new Promise((r) => setTimeout(r, 500));

    const deleteEvent = events.find((e) => e.type === "delete");
    expect(deleteEvent).toBeDefined();
    expect(deleteEvent!.collection).toBe("watchtest");
  }, 10_000);

  it("should provide resume token after events", async () => {
    watcher = new BranchWatcher(client, config);
    watcher.on(() => {});

    await watcher.watch(testBranch);
    await new Promise((r) => setTimeout(r, 200));

    const branchDb = client.db(`${config.branchPrefix}${testBranch}`);
    await branchDb.collection("watchtest").insertOne({ _id: "w-token" as any, name: "Token" });
    await new Promise((r) => setTimeout(r, 500));

    const token = watcher.getResumeToken();
    expect(token).not.toBeNull();
  }, 10_000);

  it("should support handler removal with off()", async () => {
    watcher = new BranchWatcher(client, config);
    const events: BranchChangeEvent[] = [];
    const handler = (event: BranchChangeEvent) => { events.push(event); };

    watcher.on(handler);
    watcher.off(handler);

    await watcher.watch(testBranch);
    await new Promise((r) => setTimeout(r, 200));

    const branchDb = client.db(`${config.branchPrefix}${testBranch}`);
    await branchDb.collection("watchtest").insertOne({ _id: "w-off" as any, name: "Off" });
    await new Promise((r) => setTimeout(r, 500));

    expect(events.length).toBe(0);
  }, 10_000);
});
