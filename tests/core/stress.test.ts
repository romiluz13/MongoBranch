/**
 * MongoBranch — Stress Tests
 *
 * Push the system to its limits:
 * - Many branches concurrently
 * - Large documents
 * - Rapid CRUD via proxy
 * - Merge queue under load
 * - Lazy CoW at scale
 * - Full lifecycle: create → write → diff → merge → gc
 * See also: stress-ai.test.ts for real Voyage AI embedding tests
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, ObjectId } from "mongodb";
import {
  startMongoDB,
  stopMongoDB,
  getTestEnvironment,
  cleanupBranches,
} from "../setup.ts";
import { BranchManager } from "../../src/core/branch.ts";
import { DiffEngine } from "../../src/core/diff.ts";
import { MergeEngine } from "../../src/core/merge.ts";
import { HistoryManager } from "../../src/core/history.ts";
import { MergeQueue } from "../../src/core/queue.ts";
import { OperationLog } from "../../src/core/oplog.ts";
import { BranchProxy } from "../../src/core/proxy.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";
import { SEED_DATABASE } from "../seed.ts";

let client: MongoClient;
let uri: string;
let config: MongoBranchConfig;
let branchManager: BranchManager;
let diffEngine: DiffEngine;
let mergeEngine: MergeEngine;
let historyManager: HistoryManager;
let mergeQueue: MergeQueue;
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

  // Drop stress-test collections from prior runs in source DB
  const sourceDb = client.db(SEED_DATABASE);
  const collections = await sourceDb.listCollections().toArray();
  for (const col of collections) {
    if (
      col.name.startsWith("queue_data_") ||
      col.name.startsWith("stress_") ||
      col.name.startsWith("lifecycle_") ||
      col.name.startsWith("cow_")
    ) {
      await sourceDb.dropCollection(col.name);
    }
  }

  config = {
    uri,
    sourceDatabase: SEED_DATABASE,
    metaDatabase: "__mongobranch",
    branchPrefix: "__mb_",
  };
  branchManager = new BranchManager(client, config);
  diffEngine = new DiffEngine(client, config);
  mergeEngine = new MergeEngine(client, config);
  historyManager = new HistoryManager(client, config);
  mergeQueue = new MergeQueue(client, config);
  oplog = new OperationLog(client, config);
  proxy = new BranchProxy(client, config, branchManager, oplog);
  await historyManager.initialize();
  await mergeQueue.initialize();
  await oplog.initialize();
});

// ── Concurrent Branches ─────────────────────────────────────

describe("Stress: concurrent branch creation", () => {
  it("creates 10 branches in parallel without conflicts", async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      branchManager.createBranch({ name: `parallel-${i}` })
    );
    const results = await Promise.all(promises);
    expect(results).toHaveLength(10);

    const branches = await branchManager.listBranches();
    expect(branches.length).toBe(10);

    // Each branch should have independent data
    for (const branch of results) {
      const db = client.db(branch.branchDatabase);
      const count = await db.collection("users").countDocuments();
      expect(count).toBe(4); // seed has 4 users
    }
  });
});

// ── Large Document Handling ─────────────────────────────────

describe("Stress: large documents", () => {
  it("handles documents with deeply nested objects and large arrays", async () => {
    await branchManager.createBranch({ name: "large-docs" });

    // Insert a large document with nested structure
    const largeDoc = {
      name: "Large Test Document",
      metadata: Object.fromEntries(
        Array.from({ length: 50 }, (_, i) => [`field_${i}`, `value_${i}`])
      ),
      tags: Array.from({ length: 100 }, (_, i) => `tag-${i}`),
      nested: {
        level1: {
          level2: {
            level3: {
              data: Array.from({ length: 20 }, (_, i) => ({
                id: i,
                value: `nested-val-${i}`,
                timestamp: new Date(),
              })),
            },
          },
        },
      },
    };

    await proxy.insertOne("large-docs", "stress_col", largeDoc);

    // Diff should detect the large doc
    const diff = await diffEngine.diffBranches("large-docs", "main");
    const stressDiff = diff.collections["stress_col"];
    expect(stressDiff).toBeDefined();
    expect(stressDiff.added.length).toBe(1);
  });
});

// ── Rapid CRUD via Proxy ────────────────────────────────────

describe("Stress: rapid CRUD operations", () => {
  it("handles 50 rapid insert/update/delete cycles with oplog tracking", async () => {
    await branchManager.createBranch({ name: "rapid-crud" });

    // Insert 50 documents
    const insertPromises = Array.from({ length: 50 }, (_, i) =>
      proxy.insertOne("rapid-crud", "stress_items", {
        index: i,
        value: `item-${i}`,
        category: i % 5 === 0 ? "special" : "regular",
      })
    );
    const inserted = await Promise.all(insertPromises);
    expect(inserted).toHaveLength(50);

    // Update 20 of them
    for (let i = 0; i < 20; i++) {
      await proxy.updateOne(
        "rapid-crud", "stress_items",
        { index: i },
        { $set: { value: `updated-${i}`, modifiedAt: new Date() } }
      );
    }

    // Delete 10
    for (let i = 40; i < 50; i++) {
      await proxy.deleteOne("rapid-crud", "stress_items", { index: i });
    }

    // Verify final state
    const remaining = await proxy.find("rapid-crud", "stress_items");
    expect(remaining.length).toBe(40);

    // Verify oplog captured everything
    const summary = await oplog.getOpSummary("rapid-crud");
    expect(summary.inserts).toBe(50);
    expect(summary.updates).toBe(20);
    expect(summary.deletes).toBe(10);
    expect(summary.total).toBe(80);

    // Diff should show all changes vs main
    const diff = await diffEngine.diffBranches("rapid-crud", "main");
    expect(diff.collections["stress_items"]).toBeDefined();
    expect(diff.collections["stress_items"].added.length).toBe(40);
  }, 30_000);
});

// ── Merge Queue Under Load ──────────────────────────────────

describe("Stress: merge queue ordering", () => {
  it("queues and processes 5 branches in FIFO order", async () => {
    // Create 5 branches, each modifying a DIFFERENT collection
    // (Snapshot diff model: same collection = destructive sequential merge)
    for (let i = 0; i < 5; i++) {
      await branchManager.createBranch({ name: `queue-${i}` });
      const db = client.db(`${config.branchPrefix}queue-${i}`);
      await db.collection(`queue_data_${i}`).insertOne({
        branch: i,
        data: `from-queue-${i}`,
      });
    }

    // Queue them all
    for (let i = 0; i < 5; i++) {
      await mergeQueue.enqueue(`queue-${i}`);
    }

    expect(await mergeQueue.queueLength()).toBe(5);

    // Process all
    const results = await mergeQueue.processAll();
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.status === "completed")).toBe(true);

    // Main should have a document in each of the 5 collections
    const mainDb = client.db(config.sourceDatabase);
    for (let i = 0; i < 5; i++) {
      const count = await mainDb.collection(`queue_data_${i}`).countDocuments();
      expect(count).toBe(1);
    }

    expect(await mergeQueue.queueLength()).toBe(0);
  }, 30_000);
});

// ── Lazy CoW at Scale ───────────────────────────────────────

describe("Stress: lazy CoW branch lifecycle", () => {
  it("lazy branch → selective materialization → merge", async () => {
    // Create lazy branch (instant, no copy)
    const branch = await branchManager.createBranch({ name: "lazy-full", lazy: true });
    expect(branch.lazy).toBe(true);
    expect(branch.materializedCollections).toEqual([]);

    // Read from unmaterialized collection (should work via source fallback)
    const usersBeforeWrite = await proxy.find("lazy-full", "users");
    expect(usersBeforeWrite.length).toBe(4); // from source

    // Write to ONE collection — triggers materialization of just that one
    await proxy.insertOne("lazy-full", "products", {
      name: "Lazy Product",
      sku: "LAZY-001",
      price: 42.00,
    });

    const status = await branchManager.getBranchMaterializationStatus("lazy-full");
    expect(status.materialized).toContain("products");
    expect(status.materialized).not.toContain("users"); // still unmaterialized
    expect(status.pending.length).toBeGreaterThan(0);

    // Diff should only show changes in materialized collection
    const diff = await diffEngine.diffBranches("lazy-full", "main");
    expect(diff.collections["products"]).toBeDefined();
    expect(diff.collections["products"].added.length).toBe(1);
    // Non-materialized collections should NOT appear in diff
    expect(diff.collections["users"]).toBeUndefined();

    // Merge the lazy branch
    const mergeResult = await mergeEngine.merge("lazy-full", "main");
    expect(mergeResult.success).toBe(true);
  }, 20_000);
});

// ── Full Lifecycle End-to-End ────────────────────────────────

describe("Stress: full agent lifecycle", () => {
  it("simulates an AI agent: create → write → diff → merge → gc", async () => {
    // 1. Agent creates a working branch
    const branch = await branchManager.createBranch({
      name: "agent-x/price-update",
      description: "AI agent updating product prices",
      createdBy: "agent-x",
    });

    // 2. Agent makes changes via proxy
    await proxy.updateOne(
      "agent-x/price-update", "products",
      { sku: "CSP-001" },
      { $set: { price: 39.99 } },
      "agent-x"
    );

    await proxy.updateOne(
      "agent-x/price-update", "products",
      { sku: "DVE-002" },
      { $set: { price: 89.99, category: "Database Pro" } },
      "agent-x"
    );

    await proxy.insertOne("agent-x/price-update", "products", {
      name: "NewProduct AI",
      sku: "NPA-001",
      price: 19.99,
      category: "AI",
    }, "agent-x");

    // 3. Agent reviews the diff
    const diff = await diffEngine.diffBranches("agent-x/price-update", "main");
    expect(diff.totalChanges).toBeGreaterThan(0);
    expect(diff.collections["products"].modified.length).toBe(2);
    expect(diff.collections["products"].added.length).toBe(1);

    // 4. Agent checks the oplog
    const summary = await oplog.getOpSummary("agent-x/price-update");
    expect(summary.inserts).toBe(1);
    expect(summary.updates).toBe(2);
    expect(summary.total).toBe(3);

    // 5. Agent merges via queue
    await mergeQueue.enqueue("agent-x/price-update", { queuedBy: "agent-x" });
    const queueResult = await mergeQueue.processNext();
    expect(queueResult).not.toBeNull();
    expect(queueResult!.status).toBe("completed");

    // 6. Verify main has the changes
    const mainDb = client.db(config.sourceDatabase);
    const updatedProduct = await mainDb.collection("products").findOne({ sku: "CSP-001" });
    expect(updatedProduct!.price).toBe(39.99);
    const newProduct = await mainDb.collection("products").findOne({ sku: "NPA-001" });
    expect(newProduct).not.toBeNull();
    expect(newProduct!.name).toBe("NewProduct AI");

    // 7. GC the merged branch
    const gcResult = await branchManager.garbageCollect();
    expect(gcResult.cleaned).toBe(1);
    expect(gcResult.databases).toContain(branch.branchDatabase);
  }, 30_000);
});

// ── Audit Export Stress ─────────────────────────────────────

describe("Stress: audit export completeness", () => {
  it("exports a full audit trail after multi-branch activity", async () => {
    // Create activity
    for (let i = 0; i < 3; i++) {
      await historyManager.recordSnapshot({
        branchName: `audit-${i}`,
        event: "branch_created",
        summary: `Branch audit-${i} created`,
      });
      await historyManager.recordSnapshot({
        branchName: `audit-${i}`,
        event: "data_modified",
        summary: `Data modified on audit-${i}`,
      });
    }

    // Export as JSON
    const json = await historyManager.exportJSON();
    const parsed = JSON.parse(json);
    expect(parsed.length).toBeGreaterThanOrEqual(6);

    // Export as CSV
    const csv = await historyManager.exportCSV();
    const lines = csv.split("\n");
    expect(lines[0]).toBe("timestamp,branchName,event,summary");
    expect(lines.length).toBeGreaterThanOrEqual(7); // header + 6 entries

    // Filter by branch
    const filteredJson = await historyManager.exportJSON({ branchName: "audit-1" });
    const filteredParsed = JSON.parse(filteredJson);
    expect(filteredParsed.every((e: any) => e.branchName === "audit-1")).toBe(true);
    expect(filteredParsed.length).toBe(2);
  });
});

// ── Conflict Detection Under Pressure ───────────────────────

describe("Stress: multi-branch conflict scenario", () => {
  it("detects conflicts when 2 branches modify the same documents", async () => {
    // Create two branches from main
    await branchManager.createBranch({ name: "conflict-a" });
    await branchManager.createBranch({ name: "conflict-b" });

    // Both modify the same user
    const dbA = client.db(`${config.branchPrefix}conflict-a`);
    const dbB = client.db(`${config.branchPrefix}conflict-b`);

    await dbA.collection("users").updateOne(
      { _id: new ObjectId("507f1f77bcf86cd799439011") },
      { $set: { salary: 200000, role: "CTO" } }
    );

    await dbB.collection("users").updateOne(
      { _id: new ObjectId("507f1f77bcf86cd799439011") },
      { $set: { salary: 180000, role: "VP Engineering" } }
    );

    // Merge A first (should succeed)
    const mergeA = await mergeEngine.merge("conflict-a", "main");
    expect(mergeA.success).toBe(true);

    // Merge B with conflict detection (same doc modified on both)
    const mergeB = await mergeEngine.merge("conflict-b", "main", {
      detectConflicts: true,
      conflictStrategy: "ours", // keep main's version (from A's merge)
    });
    expect(mergeB.success).toBe(true);
    expect(mergeB.conflicts).toBeDefined();
    expect(mergeB.conflicts!.length).toBeGreaterThan(0);

    // Main should have A's changes (ours = keep target)
    const mainDb = client.db(config.sourceDatabase);
    const user = await mainDb.collection("users").findOne({
      _id: new ObjectId("507f1f77bcf86cd799439011"),
    });
    expect(user!.salary).toBe(200000);
    expect(user!.role).toBe("CTO");
  }, 20_000);
});

// ── Undo Operations ─────────────────────────────────────────

describe("Stress: undo chain", () => {
  it("undoes a chain of 5 operations correctly", async () => {
    await branchManager.createBranch({ name: "undo-chain" });

    // Insert 5 docs via proxy (auto-logged)
    for (let i = 0; i < 5; i++) {
      await proxy.insertOne("undo-chain", "undo_col", {
        index: i,
        data: `item-${i}`,
      });
    }

    // Verify 5 docs exist
    let docs = await proxy.find("undo-chain", "undo_col");
    expect(docs.length).toBe(5);

    // Undo last 3 inserts
    const undone = await oplog.undoLast("undo-chain", 3);
    expect(undone).toBe(3);

    // Should have 2 remaining
    docs = await proxy.find("undo-chain", "undo_col");
    expect(docs.length).toBe(2);

    // The remaining should be index 0 and 1
    const indexes = docs.map((d) => d.index).sort();
    expect(indexes).toEqual([0, 1]);
  });
});
