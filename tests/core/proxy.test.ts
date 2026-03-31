/**
 * TDD Tests for MongoBranch CRUD Proxy
 *
 * Tests run against REAL MongoDB — no mocks.
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
import { OperationLog } from "../../src/core/oplog.ts";
import { BranchProxy } from "../../src/core/proxy.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";
import { SEED_DATABASE } from "../seed.ts";

let client: MongoClient;
let uri: string;
let config: MongoBranchConfig;
let branchManager: BranchManager;
let oplog: OperationLog;
let proxy: BranchProxy;

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
  oplog = new OperationLog(client, config);
  proxy = new BranchProxy(client, config, branchManager, oplog);
  await oplog.initialize();
});

describe("BranchProxy.insertOne", () => {
  it("inserts a document and records the operation", async () => {
    await branchManager.createBranch({ name: "proxy-ins" });

    const result = await proxy.insertOne("proxy-ins", "test_col", { name: "Alice" });
    expect(result.insertedId).toBeDefined();

    // Verify the document exists
    const docs = await proxy.find("proxy-ins", "test_col", { name: "Alice" });
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe("Alice");

    // Verify operation was logged
    const ops = await oplog.getBranchOps("proxy-ins");
    expect(ops).toHaveLength(1);
    expect(ops[0].operation).toBe("insert");
  });
});

describe("BranchProxy.updateOne", () => {
  it("updates a document and records before/after", async () => {
    await branchManager.createBranch({ name: "proxy-upd" });
    await proxy.insertOne("proxy-upd", "test_col", { name: "Bob", age: 25 });

    const result = await proxy.updateOne(
      "proxy-upd",
      "test_col",
      { name: "Bob" },
      { $set: { age: 30 } }
    );
    expect(result.modifiedCount).toBe(1);

    // Verify updated
    const docs = await proxy.find("proxy-upd", "test_col", { name: "Bob" });
    expect(docs[0].age).toBe(30);

    // Verify oplog has both insert and update
    const ops = await oplog.getBranchOps("proxy-upd");
    expect(ops).toHaveLength(2);
    expect(ops[1].operation).toBe("update");
    expect(ops[1].before?.age).toBe(25);
    expect(ops[1].after?.age).toBe(30);
  });
});

describe("BranchProxy.deleteOne", () => {
  it("deletes a document and records the operation", async () => {
    await branchManager.createBranch({ name: "proxy-del" });
    await proxy.insertOne("proxy-del", "test_col", { name: "Charlie" });

    const result = await proxy.deleteOne("proxy-del", "test_col", { name: "Charlie" });
    expect(result.deletedCount).toBe(1);

    // Verify gone
    const docs = await proxy.find("proxy-del", "test_col", { name: "Charlie" });
    expect(docs).toHaveLength(0);

    // Verify oplog
    const ops = await oplog.getBranchOps("proxy-del");
    const deleteOp = ops.find((o) => o.operation === "delete");
    expect(deleteOp).toBeDefined();
    expect(deleteOp!.before?.name).toBe("Charlie");
  });
});

describe("BranchProxy — lazy branch auto-materialization", () => {
  it("auto-materializes a lazy branch collection on first write", async () => {
    await branchManager.createBranch({ name: "proxy-lazy", lazy: true });

    // Before write — collection is NOT materialized
    const statusBefore = await branchManager.getBranchMaterializationStatus("proxy-lazy");
    expect(statusBefore.materialized).not.toContain("users");

    // Write triggers materialization
    await proxy.insertOne("proxy-lazy", "users", { name: "Lazy User" });

    // After write — collection IS materialized
    const statusAfter = await branchManager.getBranchMaterializationStatus("proxy-lazy");
    expect(statusAfter.materialized).toContain("users");
  });
});

describe("BranchProxy — read-only protection", () => {
  it("rejects writes to read-only branches", async () => {
    await branchManager.createBranch({ name: "proxy-ro", readOnly: true });

    await expect(
      proxy.insertOne("proxy-ro", "test_col", { name: "Blocked" })
    ).rejects.toThrow(/read-only/i);
  });
});

describe("BranchProxy.find — lazy branch reads", () => {
  it("reads from source DB for unmaterialized collections", async () => {
    await branchManager.createBranch({ name: "proxy-read-lazy", lazy: true });

    // Read users from lazy branch (should read from main source)
    const docs = await proxy.find("proxy-read-lazy", "users");
    const mainDb = client.db(SEED_DATABASE);
    const mainCount = await mainDb.collection("users").countDocuments();
    expect(docs.length).toBe(mainCount);
  });
});
