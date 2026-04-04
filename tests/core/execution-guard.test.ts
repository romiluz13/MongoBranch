/**
 * MongoBranch — Execution Guard Stress Tests (Wave 9)
 *
 * Idempotent agent operations. Prevents duplicate side effects from retries.
 * Tests: dedup under retry storms, concurrent same-requestId, backward compat,
 * receipt expiry. Real MongoDB, zero mocks.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient } from "mongodb";
import { startMongoDB, stopMongoDB } from "../setup.ts";
import { ExecutionGuard } from "../../src/core/execution-guard.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";

let client: MongoClient;
let guard: ExecutionGuard;

const config: MongoBranchConfig = {
  uri: "",
  sourceDatabase: "test_guard_source",
  metaDatabase: "__mongobranch_guard",
  branchPrefix: "__mb_guard_",
};

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
  guard = new ExecutionGuard(client, config);
  await guard.initialize();
}, 30_000);

afterAll(async () => {
  if (client) {
    await client.db(config.metaDatabase).dropDatabase();
  }
  await stopMongoDB();
}, 10_000);

beforeEach(async () => {
  // Clear receipts between tests
  await client.db(config.metaDatabase).collection("execution_receipts").deleteMany({});
});

describe("Execution Guard — Stress Tests", () => {
  it("executes once, returns cached on retry with same requestId", async () => {
    let executionCount = 0;

    const fn = async () => {
      executionCount++;
      return { status: "inserted", docId: "abc-123" };
    };

    // First call — executes
    const r1 = await guard.execute("req-001", "branch_insert", "test-branch", { col: "users" }, fn);
    expect(r1.cached).toBe(false);
    expect(r1.result.status).toBe("inserted");
    expect(executionCount).toBe(1);

    // Second call — cached
    const r2 = await guard.execute("req-001", "branch_insert", "test-branch", { col: "users" }, fn);
    expect(r2.cached).toBe(true);
    expect(r2.result.status).toBe("inserted");
    expect(r2.result.docId).toBe("abc-123");
    expect(executionCount).toBe(1); // NOT incremented
  });

  it("handles 3 concurrent calls with same requestId — only 1 executes", async () => {
    let executionCount = 0;

    const fn = async () => {
      executionCount++;
      // Simulate some work
      await new Promise(r => setTimeout(r, 50));
      return { created: true, branch: "concurrent-test" };
    };

    // Fire 3 calls in parallel
    const results = await Promise.all([
      guard.execute("req-002", "create_branch", "main", { name: "b1" }, fn),
      guard.execute("req-002", "create_branch", "main", { name: "b1" }, fn),
      guard.execute("req-002", "create_branch", "main", { name: "b1" }, fn),
    ]);

    // Exactly 1 should have executed, others cached
    const executed = results.filter(r => !r.cached);
    const cached = results.filter(r => r.cached);

    expect(executed.length).toBe(1);
    expect(cached.length).toBe(2);
    expect(executionCount).toBe(1);

    // All should return same result
    for (const r of results) {
      expect(r.result.created).toBe(true);
    }
  });

  it("different requestIds with same args — both execute", async () => {
    let executionCount = 0;

    const fn = async () => {
      executionCount++;
      return { id: executionCount };
    };

    const r1 = await guard.execute("req-003", "branch_insert", "b", { same: "args" }, fn);
    const r2 = await guard.execute("req-004", "branch_insert", "b", { same: "args" }, fn);

    expect(r1.cached).toBe(false);
    expect(r2.cached).toBe(false);
    expect(executionCount).toBe(2);
    // Results are different because they executed independently
    expect(r1.result.id).not.toBe(r2.result.id);
  });

  it("failed execution cleans up receipt — retry can succeed", async () => {
    let callCount = 0;

    const fn = async () => {
      callCount++;
      if (callCount === 1) throw new Error("Transient failure");
      return { success: true };
    };

    // First call fails
    await expect(
      guard.execute("req-005", "merge", "b", {}, fn)
    ).rejects.toThrow("Transient failure");
    expect(callCount).toBe(1);

    // Retry succeeds because receipt was cleaned up
    const r2 = await guard.execute("req-005", "merge", "b", {}, fn);
    expect(r2.cached).toBe(false);
    expect(r2.result.success).toBe(true);
    expect(callCount).toBe(2);
  });

  it("hasReceipt returns correct status", async () => {
    expect(await guard.hasReceipt("req-006")).toBe(false);

    await guard.execute("req-006", "test", "b", {}, async () => ({ done: true }));

    expect(await guard.hasReceipt("req-006")).toBe(true);
    expect(await guard.hasReceipt("req-nonexistent")).toBe(false);
  });

  it("purge removes old receipts", async () => {
    // Create a receipt
    await guard.execute("req-purge-1", "test", "b", {}, async () => ({ x: 1 }));
    expect(await guard.hasReceipt("req-purge-1")).toBe(true);

    // Purge with 0 hours — should remove everything
    const purged = await guard.purge(0);
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await guard.hasReceipt("req-purge-1")).toBe(false);
  });

  it("mixed concurrent: 10 operations with 5 unique requestIds — exactly 5 execute", async () => {
    let totalExecutions = 0;
    const results = new Map<string, number>();

    const makeFn = (reqId: string) => async () => {
      totalExecutions++;
      results.set(reqId, (results.get(reqId) ?? 0) + 1);
      return { reqId, ts: Date.now() };
    };

    // 5 unique requestIds, each submitted twice = 10 total
    const calls = [];
    for (let i = 0; i < 5; i++) {
      const reqId = `req-mix-${i}`;
      calls.push(guard.execute(reqId, "test", "b", { i }, makeFn(reqId)));
      calls.push(guard.execute(reqId, "test", "b", { i }, makeFn(reqId)));
    }

    const allResults = await Promise.all(calls);

    // Exactly 5 unique executions
    expect(totalExecutions).toBe(5);

    // Each requestId should have been executed at most once
    for (const [, count] of results) {
      expect(count).toBe(1);
    }

    // 5 cached + 5 fresh
    const freshCount = allResults.filter(r => !r.cached).length;
    const cachedCount = allResults.filter(r => r.cached).length;
    expect(freshCount).toBe(5);
    expect(cachedCount).toBe(5);
  });
});
