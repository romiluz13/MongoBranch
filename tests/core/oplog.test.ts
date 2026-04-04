/**
 * TDD Tests for MongoBranch Operation Log
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
import type { MongoBranchConfig } from "../../src/core/types.ts";
import { SEED_DATABASE } from "../seed.ts";

let client: MongoClient;
let uri: string;
let config: MongoBranchConfig;
let branchManager: BranchManager;
let oplog: OperationLog;

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
  await oplog.initialize();
});

describe("OperationLog.record", () => {
  it("records an insert operation", async () => {
    const entry = await oplog.record({
      branchName: "op-test",
      collection: "users",
      operation: "insert",
      documentId: "abc123",
      after: { _id: "abc123", name: "Test User" },
    });

    expect(entry.branchName).toBe("op-test");
    expect(entry.operation).toBe("insert");
    expect(entry.collection).toBe("users");
    expect(entry.timestamp).toBeInstanceOf(Date);
  });

  it("records update with before and after state", async () => {
    const entry = await oplog.record({
      branchName: "op-test",
      collection: "users",
      operation: "update",
      documentId: "abc123",
      before: { _id: "abc123", name: "Old Name" },
      after: { _id: "abc123", name: "New Name" },
      performedBy: "agent-1",
    });

    expect(entry.before).toEqual({ _id: "abc123", name: "Old Name" });
    expect(entry.after).toEqual({ _id: "abc123", name: "New Name" });
    expect(entry.performedBy).toBe("agent-1");
  });
});

describe("OperationLog.getBranchOps", () => {
  it("returns operations for a specific branch", async () => {
    await oplog.record({ branchName: "b1", collection: "users", operation: "insert", documentId: "1" });
    await oplog.record({ branchName: "b1", collection: "users", operation: "update", documentId: "1" });
    await oplog.record({ branchName: "b2", collection: "users", operation: "insert", documentId: "2" });

    const ops = await oplog.getBranchOps("b1");
    expect(ops).toHaveLength(2);
    expect(ops.every((o) => o.branchName === "b1")).toBe(true);
  });

  it("filters by collection name", async () => {
    await oplog.record({ branchName: "b3", collection: "users", operation: "insert", documentId: "1" });
    await oplog.record({ branchName: "b3", collection: "products", operation: "insert", documentId: "2" });

    const ops = await oplog.getBranchOps("b3", { collection: "products" });
    expect(ops).toHaveLength(1);
    expect(ops[0]!.collection).toBe("products");
  });
});

describe("OperationLog.getOpSummary", () => {
  it("returns aggregated operation counts", async () => {
    await oplog.record({ branchName: "sum", collection: "users", operation: "insert", documentId: "1" });
    await oplog.record({ branchName: "sum", collection: "users", operation: "insert", documentId: "2" });
    await oplog.record({ branchName: "sum", collection: "users", operation: "update", documentId: "1" });
    await oplog.record({ branchName: "sum", collection: "users", operation: "delete", documentId: "2" });

    const summary = await oplog.getOpSummary("sum");
    expect(summary.inserts).toBe(2);
    expect(summary.updates).toBe(1);
    expect(summary.deletes).toBe(1);
    expect(summary.total).toBe(4);
  });
});

describe("OperationLog.undoLast", () => {
  it("undoes the last insert by deleting the document", async () => {
    const branch = await branchManager.createBranch({ name: "undo-test" });
    const branchDb = client.db(branch.branchDatabase);

    // Insert a document and record it
    const insertResult = await branchDb.collection("test_col").insertOne({ name: "To Undo" });
    await oplog.record({
      branchName: "undo-test",
      collection: "test_col",
      operation: "insert",
      documentId: insertResult.insertedId.toString(),
      after: { _id: insertResult.insertedId, name: "To Undo" },
    });

    // Undo it
    const undone = await oplog.undoLast("undo-test", 1);
    expect(undone).toBe(1);

    // Document should be gone
    const doc = await branchDb.collection("test_col").findOne({ _id: insertResult.insertedId });
    expect(doc).toBeNull();
  });
});
