/**
 * MergeQueue — Ordered merge queue for concurrent agents
 *
 * Ensures branches merge into main one at a time, preventing conflicts
 * from concurrent agent operations. Uses MongoDB atomic operations.
 */
import type { MongoClient, Collection } from "mongodb";
import { MergeEngine } from "./merge.ts";
import type {
  MongoBranchConfig,
  MergeQueueEntry,
  MergeQueueStatus,
  MergeOptions,
} from "./types.ts";
import { MERGE_QUEUE_COLLECTION } from "./types.ts";

export class MergeQueue {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private mergeEngine: MergeEngine;
  private queue: Collection<MergeQueueEntry>;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
    this.mergeEngine = new MergeEngine(client, config);
    this.queue = client
      .db(config.metaDatabase)
      .collection<MergeQueueEntry>(MERGE_QUEUE_COLLECTION);
  }

  async initialize(): Promise<void> {
    await this.queue.createIndex({ status: 1, queuedAt: 1 });
    await this.queue.createIndex({ branchName: 1 });
  }

  /**
   * Enqueue a branch for merging. Returns the queue entry.
   */
  async enqueue(branchName: string, options?: {
    targetBranch?: string;
    queuedBy?: string;
  }): Promise<MergeQueueEntry> {
    // Prevent duplicate queueing
    const existing = await this.queue.findOne({
      branchName,
      status: { $in: ["pending", "processing"] },
    });
    if (existing) {
      throw new Error(`Branch "${branchName}" is already in the merge queue`);
    }

    const entry: MergeQueueEntry = {
      branchName,
      targetBranch: options?.targetBranch ?? "main",
      status: "pending",
      queuedAt: new Date(),
      queuedBy: options?.queuedBy,
    };

    await this.queue.insertOne(entry);
    return entry;
  }

  /**
   * Process the next item in the queue. Returns the result or null if empty.
   */
  async processNext(mergeOptions?: MergeOptions): Promise<MergeQueueEntry | null> {
    // Atomically claim the oldest pending entry
    const entry = await this.queue.findOneAndUpdate(
      { status: "pending" },
      { $set: { status: "processing" as MergeQueueStatus, processedAt: new Date() } },
      { sort: { queuedAt: 1 }, returnDocument: "after" }
    );

    if (!entry) return null;

    try {
      const result = await this.mergeEngine.merge(
        entry.branchName,
        entry.targetBranch,
        mergeOptions
      );

      await this.queue.updateOne(
        { _id: entry._id },
        { $set: { status: "completed" as MergeQueueStatus, completedAt: new Date(), result } }
      );

      return { ...entry, status: "completed", result };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.queue.updateOne(
        { _id: entry._id },
        { $set: { status: "failed" as MergeQueueStatus, completedAt: new Date(), error: msg } }
      );
      return { ...entry, status: "failed", error: msg };
    }
  }

  /**
   * Process ALL pending items in order.
   */
  async processAll(mergeOptions?: MergeOptions): Promise<MergeQueueEntry[]> {
    const results: MergeQueueEntry[] = [];
    let entry = await this.processNext(mergeOptions);
    while (entry) {
      results.push(entry);
      entry = await this.processNext(mergeOptions);
    }
    return results;
  }

  /**
   * List queue entries by status.
   */
  async listQueue(status?: MergeQueueStatus): Promise<MergeQueueEntry[]> {
    const filter = status ? { status } : {};
    return this.queue.find(filter).sort({ queuedAt: 1 }).toArray();
  }

  /**
   * Get queue length (pending items).
   */
  async queueLength(): Promise<number> {
    return this.queue.countDocuments({ status: "pending" });
  }
}
