/**
 * TDD Tests for MongoBranch Merge Queue
 *
 * Tests concurrent agent merge ordering against real MongoDB.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient } from "mongodb";
import {
  startMongoDB,
  stopMongoDB,
  getTestEnvironment,
  cleanupBranches,
} from "../setup.ts";
import { MergeQueue } from "../../src/core/queue.ts";
import { BranchManager } from "../../src/core/branch.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";
import { SEED_DATABASE } from "../seed.ts";

let client: MongoClient;
let uri: string;
let config: MongoBranchConfig;
let queue: MergeQueue;
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
  await client.db("__mongobranch").collection("merge_queue").deleteMany({});

  config = {
    uri,
    sourceDatabase: SEED_DATABASE,
    metaDatabase: "__mongobranch",
    branchPrefix: "__mb_",
  };

  queue = new MergeQueue(client, config);
  branchManager = new BranchManager(client, config);
  await branchManager.initialize();
  await queue.initialize();
});

describe("MergeQueue.enqueue", () => {
  it("adds a branch to the merge queue", async () => {
    await branchManager.createBranch({ name: "q-branch-1" });
    const entry = await queue.enqueue("q-branch-1", { queuedBy: "agent-1" });

    expect(entry.branchName).toBe("q-branch-1");
    expect(entry.status).toBe("pending");
    expect(entry.queuedBy).toBe("agent-1");
  });

  it("rejects duplicate queueing", async () => {
    await branchManager.createBranch({ name: "q-dup" });
    await queue.enqueue("q-dup");
    await expect(queue.enqueue("q-dup")).rejects.toThrow(/already in the merge queue/);
  });
});

describe("MergeQueue.processNext", () => {
  it("processes the oldest pending entry", async () => {
    const branch = await branchManager.createBranch({ name: "q-first" });
    const branchDb = client.db(branch.branchDatabase);
    await branchDb.collection("users").insertOne({ name: "Queue User", role: "test" });

    await queue.enqueue("q-first");
    const result = await queue.processNext();

    expect(result).not.toBeNull();
    expect(result!.status).toBe("completed");

    // Verify the data was merged
    const mainDb = client.db(SEED_DATABASE);
    const found = await mainDb.collection("users").findOne({ name: "Queue User" });
    expect(found).not.toBeNull();
  });

  it("returns null when queue is empty", async () => {
    const result = await queue.processNext();
    expect(result).toBeNull();
  });

  it("processes in FIFO order", async () => {
    const b1 = await branchManager.createBranch({ name: "q-order-1" });
    const b2 = await branchManager.createBranch({ name: "q-order-2" });

    await client.db(b1.branchDatabase).collection("users").insertOne({ name: "First", role: "t" });
    await client.db(b2.branchDatabase).collection("users").insertOne({ name: "Second", role: "t" });

    await queue.enqueue("q-order-1");
    await queue.enqueue("q-order-2");

    const first = await queue.processNext();
    const second = await queue.processNext();

    expect(first!.branchName).toBe("q-order-1");
    expect(second!.branchName).toBe("q-order-2");
  });
});

describe("MergeQueue.processAll", () => {
  it("processes all pending entries", async () => {
    await branchManager.createBranch({ name: "q-all-1" });
    await branchManager.createBranch({ name: "q-all-2" });
    await queue.enqueue("q-all-1");
    await queue.enqueue("q-all-2");

    const results = await queue.processAll();
    expect(results.length).toBe(2);
    expect(results.every((r) => r.status === "completed")).toBe(true);
  });
});

describe("MergeQueue.queueLength", () => {
  it("returns count of pending items", async () => {
    await branchManager.createBranch({ name: "q-len-1" });
    await branchManager.createBranch({ name: "q-len-2" });
    await queue.enqueue("q-len-1");
    await queue.enqueue("q-len-2");

    expect(await queue.queueLength()).toBe(2);

    await queue.processNext();
    expect(await queue.queueLength()).toBe(1);
  });
});
