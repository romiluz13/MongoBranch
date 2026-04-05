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
import { ProtectionManager } from "../../src/core/protection.ts";
import { ScopeManager } from "../../src/core/scope.ts";
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
  await client.db("__mongobranch").collection("protections").deleteMany({});
  await client.db("__mongobranch").collection("agent_scopes").deleteMany({});
  await client.db("__mongobranch").collection("scope_violations").deleteMany({});

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
    expect(docs[0]!.name).toBe("Alice");

    // Verify operation was logged
    const ops = await oplog.getBranchOps("proxy-ins");
    expect(ops).toHaveLength(1);
    expect(ops[0]!.operation).toBe("insert");
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
    expect(docs[0]!.age).toBe(30);

    // Verify oplog has both insert and update
    const ops = await oplog.getBranchOps("proxy-upd");
    expect(ops).toHaveLength(2);
    expect(ops[1]!.operation).toBe("update");
    expect(ops[1]!.before?.age).toBe(25);
    expect(ops[1]!.after?.age).toBe(30);
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

describe("BranchProxy — protection and scope enforcement", () => {
  it("keeps proxy writes aligned with ProtectionManager deny decisions", async () => {
    await branchManager.createBranch({ name: "proxy-protected" });
    const protectionManager = new ProtectionManager(client, config);
    await protectionManager.initialize();
    await protectionManager.protectBranch("proxy-protected", { createdBy: "admin" });

    const permission = await protectionManager.checkWritePermission("proxy-protected", false);
    expect(permission.allowed).toBe(false);
    expect(permission.reason).toMatch(/protected/i);

    await expect(
      proxy.insertOne("proxy-protected", "test_col", { name: "Blocked" })
    ).rejects.toThrow(/protected/i);

    const docs = await client
      .db("__mb_proxy-protected")
      .collection("test_col")
      .find()
      .toArray();
    expect(docs).toHaveLength(0);

    const ops = await oplog.getBranchOps("proxy-protected");
    expect(ops).toHaveLength(0);
  });

  it("rejects every proxied write operation on protected branches", async () => {
    const branch = await branchManager.createBranch({ name: "proxy-protected-all" });
    const protectionManager = new ProtectionManager(client, config);
    await protectionManager.initialize();
    await protectionManager.protectBranch("proxy-protected-all", { createdBy: "admin" });

    await client
      .db(branch.branchDatabase)
      .collection("test_col")
      .insertOne({ _id: "seed" as any, name: "Seed", status: "draft" });

    await expect(
      proxy.insertOne("proxy-protected-all", "test_col", { name: "Blocked" })
    ).rejects.toThrow(/protected/i);
    await expect(
      proxy.updateOne("proxy-protected-all", "test_col", { _id: "seed" }, { $set: { status: "live" } })
    ).rejects.toThrow(/protected/i);
    await expect(
      proxy.updateMany("proxy-protected-all", "test_col", {}, { $set: { status: "live" } })
    ).rejects.toThrow(/protected/i);
    await expect(
      proxy.deleteOne("proxy-protected-all", "test_col", { _id: "seed" })
    ).rejects.toThrow(/protected/i);

    const docs = await client
      .db(branch.branchDatabase)
      .collection("test_col")
      .find()
      .toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0]!.status).toBe("draft");

    const ops = await oplog.getBranchOps("proxy-protected-all");
    expect(ops).toHaveLength(0);
  });

  it("rejects scoped agents without write permission and logs a violation", async () => {
    await branchManager.createBranch({ name: "proxy-scoped" });
    const scopeManager = new ScopeManager(client, config);
    await scopeManager.initialize();
    await scopeManager.setScope({
      agentId: "reader-agent",
      permissions: ["read"],
      allowedCollections: ["users"],
    });

    await expect(
      proxy.insertOne("proxy-scoped", "users", { name: "Denied" }, "reader-agent")
    ).rejects.toThrow(/lacks "write" permission/i);

    const violations = await scopeManager.getViolations("reader-agent");
    expect(violations).toHaveLength(1);
    expect(violations[0]!.collection).toBe("users");
    expect(violations[0]!.operation).toBe("write");
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

  it("reads from the lazy parent branch, not root main, for nested lazy branches", async () => {
    await branchManager.createBranch({ name: "proxy-lazy-parent", lazy: true });
    const mainDb = client.db(SEED_DATABASE);
    const seeded = await mainDb.collection("users").findOne({ name: "Alice Chen" });
    expect(seeded).not.toBeNull();

    await proxy.updateOne(
      "proxy-lazy-parent",
      "users",
      { _id: seeded!._id },
      { $set: { role: "principal-engineer" } }
    );

    await branchManager.createBranch({
      name: "proxy-lazy-child",
      from: "proxy-lazy-parent",
      lazy: true,
    });

    const docs = await proxy.find("proxy-lazy-child", "users", { _id: seeded!._id });
    expect(docs).toHaveLength(1);
    expect(docs[0]!.role).toBe("principal-engineer");
  });
});

describe("BranchProxy.aggregate", () => {
  it("runs an aggregation pipeline on a branch collection", async () => {
    await branchManager.createBranch({ name: "proxy-agg" });
    await proxy.insertOne("proxy-agg", "items", { name: "A", price: 10 });
    await proxy.insertOne("proxy-agg", "items", { name: "B", price: 20 });
    await proxy.insertOne("proxy-agg", "items", { name: "C", price: 30 });

    const result = await proxy.aggregate("proxy-agg", "items", [
      { $group: { _id: null, total: { $sum: "$price" } } },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.total).toBe(60);
  });

  it("reads from source for unmaterialized lazy branches", async () => {
    await branchManager.createBranch({ name: "proxy-agg-lazy", lazy: true });

    const result = await proxy.aggregate("proxy-agg-lazy", "users", [
      { $count: "total" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.total).toBeGreaterThan(0);
  });
});

describe("BranchProxy.countDocuments", () => {
  it("counts all documents in a branch collection", async () => {
    await branchManager.createBranch({ name: "proxy-cnt" });
    await proxy.insertOne("proxy-cnt", "items", { name: "A" });
    await proxy.insertOne("proxy-cnt", "items", { name: "B" });
    await proxy.insertOne("proxy-cnt", "items", { name: "C" });

    const count = await proxy.countDocuments("proxy-cnt", "items");
    expect(count).toBe(3);
  });

  it("counts documents matching a filter", async () => {
    await branchManager.createBranch({ name: "proxy-cnt-f" });
    await proxy.insertOne("proxy-cnt-f", "items", { name: "A", active: true });
    await proxy.insertOne("proxy-cnt-f", "items", { name: "B", active: false });
    await proxy.insertOne("proxy-cnt-f", "items", { name: "C", active: true });

    const count = await proxy.countDocuments("proxy-cnt-f", "items", { active: true });
    expect(count).toBe(2);
  });
});

describe("BranchProxy.listCollections", () => {
  it("lists collections on a branch", async () => {
    await branchManager.createBranch({ name: "proxy-lc" });
    await proxy.insertOne("proxy-lc", "col_a", { x: 1 });
    await proxy.insertOne("proxy-lc", "col_b", { y: 2 });

    const cols = await proxy.listCollections("proxy-lc");
    const names = cols.map((c) => c.name);
    expect(names).toContain("col_a");
    expect(names).toContain("col_b");
  });

  it("merges parent + materialized collections for lazy branches", async () => {
    await branchManager.createBranch({ name: "proxy-lc-lazy", lazy: true });
    // Lazy branch should see source collections without writing
    const cols = await proxy.listCollections("proxy-lc-lazy");
    const names = cols.map((c) => c.name);
    expect(names).toContain("users");
  });

  it("filters out _mongobranch_meta", async () => {
    await branchManager.createBranch({ name: "proxy-lc-meta" });
    const cols = await proxy.listCollections("proxy-lc-meta");
    const names = cols.map((c) => c.name);
    expect(names).not.toContain("_mongobranch_meta");
  });
});

describe("BranchProxy.updateMany", () => {
  it("updates multiple documents and records oplog", async () => {
    await branchManager.createBranch({ name: "proxy-um" });
    await proxy.insertOne("proxy-um", "items", { category: "a", status: "draft" });
    await proxy.insertOne("proxy-um", "items", { category: "a", status: "draft" });
    await proxy.insertOne("proxy-um", "items", { category: "b", status: "draft" });

    const result = await proxy.updateMany(
      "proxy-um", "items",
      { category: "a" },
      { $set: { status: "published" } },
      "test-user"
    );
    expect(result.matchedCount).toBe(2);
    expect(result.modifiedCount).toBe(2);

    // Verify the docs were updated
    const docs = await proxy.find("proxy-um", "items", { status: "published" });
    expect(docs).toHaveLength(2);

    // Verify oplog recorded the batch
    const ops = await oplog.getBranchOps("proxy-um");
    const batchOp = ops.find((o) => o.documentId?.startsWith("batch:"));
    expect(batchOp).toBeDefined();
    expect(batchOp!.performedBy).toBe("test-user");
  });

  it("rejects writes to read-only branches", async () => {
    await branchManager.createBranch({ name: "proxy-um-ro", readOnly: true });
    await expect(
      proxy.updateMany("proxy-um-ro", "items", {}, { $set: { x: 1 } })
    ).rejects.toThrow(/read-only/i);
  });
});

describe("BranchProxy.inferSchema", () => {
  it("infers schema from branch collection documents", async () => {
    await branchManager.createBranch({ name: "proxy-sch" });
    await proxy.insertOne("proxy-sch", "items", { name: "A", price: 10, tags: ["x"] });
    await proxy.insertOne("proxy-sch", "items", { name: "B", price: 20, active: true });

    const schema = await proxy.inferSchema("proxy-sch", "items");
    expect(schema.totalSampled).toBe(2);
    expect(schema.fields._id).toBeDefined();
    expect(schema.fields._id!.types).toContain("objectId");
    expect(schema.fields.name!.types).toContain("string");
    expect(schema.fields.price!.types).toContain("number");
    expect(schema.fields.tags!.types).toContain("array");
    expect(schema.fields.tags!.count).toBe(1); // only 1 of 2 docs has tags
    expect(schema.fields.active!.types).toContain("boolean");
    expect(schema.fields.active!.count).toBe(1);
  });
});
