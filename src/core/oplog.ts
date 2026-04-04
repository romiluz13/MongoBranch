/**
 * MongoBranch — Operation Log
 *
 * Tracks every write operation (insert/update/delete) on branch collections.
 * Enables detailed audit trails, replay, and undo capabilities.
 */
import type { MongoClient, Collection, Db } from "mongodb";
import type {
  MongoBranchConfig,
  OperationEntry,
  OpType,
} from "./types.ts";
import { OPLOG_COLLECTION, META_COLLECTION, MAIN_BRANCH } from "./types.ts";

export interface RecordOpOptions {
  branchName: string;
  collection: string;
  operation: OpType;
  documentId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  performedBy?: string;
}

export class OperationLog {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private oplog: Collection<OperationEntry>;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
    this.oplog = client
      .db(config.metaDatabase)
      .collection<OperationEntry>(OPLOG_COLLECTION);
  }

  async initialize(): Promise<void> {
    await this.oplog.createIndex({ branchName: 1, timestamp: 1 });
    await this.oplog.createIndex({ branchName: 1, collection: 1 });
    // TTL: auto-expire oplog entries after 30 days to prevent unbounded growth
    await this.oplog.createIndex(
      { timestamp: 1 },
      { expireAfterSeconds: 30 * 24 * 60 * 60 }
    ).catch(() => {}); // May conflict with existing timestamp index
  }

  /**
   * Record a write operation on a branch collection.
   */
  async record(options: RecordOpOptions): Promise<OperationEntry> {
    const entry: OperationEntry = {
      branchName: options.branchName,
      collection: options.collection,
      operation: options.operation,
      documentId: options.documentId,
      timestamp: new Date(),
      before: options.before,
      after: options.after,
      performedBy: options.performedBy,
    };

    await this.oplog.insertOne(entry);
    return entry;
  }

  /**
   * Get the full operation log for a branch, ordered by timestamp.
   */
  async getBranchOps(
    branchName: string,
    options?: { collection?: string; limit?: number }
  ): Promise<OperationEntry[]> {
    const filter: Record<string, unknown> = { branchName };
    if (options?.collection) filter.collection = options.collection;

    return this.oplog
      .find(filter)
      .sort({ timestamp: 1 })
      .limit(options?.limit ?? 1000)
      .toArray();
  }

  /**
   * Get operation counts per type for a branch.
   */
  async getOpSummary(branchName: string): Promise<{
    inserts: number;
    updates: number;
    deletes: number;
    total: number;
  }> {
    const ops = await this.oplog
      .aggregate<{ _id: OpType; count: number }>([
        { $match: { branchName } },
        { $group: { _id: "$operation", count: { $sum: 1 } } },
      ])
      .toArray();

    const counts = { inserts: 0, updates: 0, deletes: 0, total: 0 };
    for (const op of ops) {
      if (op._id === "insert") counts.inserts = op.count;
      if (op._id === "update") counts.updates = op.count;
      if (op._id === "delete") counts.deletes = op.count;
      counts.total += op.count;
    }
    return counts;
  }

  /**
   * Undo the last N operations on a branch (reverse replay).
   * Returns the number of operations undone.
   */
  async undoLast(branchName: string, count: number = 1): Promise<number> {
    const meta = await this.client
      .db(this.config.metaDatabase)
      .collection(META_COLLECTION)
      .findOne({ name: branchName, status: "active" });

    if (!meta) throw new Error(`Branch "${branchName}" not found`);

    const branchDb = this.client.db(meta.branchDatabase as string);

    const ops = await this.oplog
      .find({ branchName })
      .sort({ timestamp: -1 })
      .limit(count)
      .toArray();

    let undone = 0;
    for (const op of ops) {
      const coll = branchDb.collection(op.collection);
      try {
        if (op.operation === "insert" && op.after) {
          await coll.deleteOne({ _id: op.after._id as any });
          undone++;
        } else if (op.operation === "delete" && op.before) {
          await coll.insertOne(op.before);
          undone++;
        } else if (op.operation === "update" && op.before) {
          await coll.replaceOne({ _id: op.before._id as any }, op.before);
          undone++;
        }
        // Remove the op from the log
        await this.oplog.deleteOne({ _id: op._id });
      } catch (err) {
        // Best effort undo — log but don't abort remaining undo ops
        console.warn(`[Oplog] undo failed for op ${op._id}:`, err instanceof Error ? err.message : err);
      }
    }

    return undone;
  }
}
