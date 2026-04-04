/**
 * MongoBranch — Execution Guard (Idempotent Agent Operations)
 *
 * Prevents duplicate side effects from LLM tool call retries.
 * Each operation gets a requestId. Re-execution returns the cached result.
 * Uses findOneAndUpdate with upsert for atomic check-and-set.
 */
import { createHash } from "crypto";
import type { MongoClient, Collection } from "mongodb";
import type {
  MongoBranchConfig,
  ExecutionReceipt,
} from "./types.ts";
import { EXECUTION_RECEIPTS_COLLECTION } from "./types.ts";

const DEFAULT_TTL_HOURS = 24;

export class ExecutionGuard {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private receipts: Collection<ExecutionReceipt>;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
    this.receipts = client
      .db(config.metaDatabase)
      .collection<ExecutionReceipt>(EXECUTION_RECEIPTS_COLLECTION);
  }

  async initialize(): Promise<void> {
    await this.receipts.createIndex({ requestId: 1 }, { unique: true });
    await this.receipts.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 },
    );
  }

  /**
   * Execute a function with idempotency guarantee.
   *
   * If a receipt exists for the given requestId, return the cached result.
   * If not, execute the function, store the receipt, and return the result.
   *
   * Uses atomic upsert to prevent race conditions when the same requestId
   * is submitted concurrently.
   */
  async execute<T>(
    requestId: string,
    toolName: string,
    branchName: string,
    args: Record<string, unknown>,
    fn: () => Promise<T>,
  ): Promise<{ result: T; cached: boolean }> {
    const argsHash = this.hashArgs(args);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEFAULT_TTL_HOURS * 3600_000);

    // Check if already completed
    const existing = await this.receipts.findOne({ requestId });
    if (existing && existing.result !== "__PENDING__") {
      return {
        result: JSON.parse(existing.result) as T,
        cached: true,
      };
    }

    // Try to claim this requestId atomically using insertOne
    // Only the first inserter wins; duplicates get a unique constraint error
    let weOwnIt = false;
    try {
      await this.receipts.insertOne({
        requestId,
        toolName,
        branchName,
        argsHash,
        result: "__PENDING__",
        executedAt: now,
        expiresAt,
      } as any);
      weOwnIt = true;
    } catch (err: any) {
      // Duplicate key error (code 11000) = someone else claimed it
      if (err?.code === 11000) {
        // Wait for the other execution to finish, then return cached
        return this.waitForResult<T>(requestId);
      }
      throw err;
    }

    if (!weOwnIt) {
      return this.waitForResult<T>(requestId);
    }

    // We own it — execute the function
    try {
      const result = await fn();
      const serialized = JSON.stringify(result);

      await this.receipts.updateOne(
        { requestId },
        { $set: { result: serialized, executedAt: new Date() } },
      );

      return { result, cached: false };
    } catch (err) {
      await this.receipts.deleteOne({ requestId });
      throw err;
    }
  }

  /**
   * Poll until a pending receipt is completed, then return the cached result.
   */
  private async waitForResult<T>(requestId: string): Promise<{ result: T; cached: boolean }> {
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 50));
      const doc = await this.receipts.findOne({ requestId });
      if (doc && doc.result !== "__PENDING__") {
        return { result: JSON.parse(doc.result) as T, cached: true };
      }
      if (!doc) {
        // Receipt was deleted (execution failed) — caller can retry
        throw new Error(`Execution of requestId "${requestId}" failed in another call`);
      }
    }
    throw new Error(`Timeout waiting for requestId "${requestId}" to complete`);
  }

  /**
   * Purge old receipts. TTL index handles this automatically,
   * but this allows manual cleanup.
   */
  async purge(olderThanHours = DEFAULT_TTL_HOURS): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanHours * 3600_000);
    const result = await this.receipts.deleteMany({
      executedAt: { $lt: cutoff },
    });
    return result.deletedCount;
  }

  /**
   * Check if a requestId has already been executed.
   */
  async hasReceipt(requestId: string): Promise<boolean> {
    const receipt = await this.receipts.findOne({ requestId });
    return receipt !== null && receipt.result !== "__PENDING__";
  }

  // ── Private helpers ──────────────────────────────────────────

  private hashArgs(args: Record<string, unknown>): string {
    const sorted = JSON.stringify(args, Object.keys(args).sort());
    return createHash("sha256").update(sorted).digest("hex");
  }
}
