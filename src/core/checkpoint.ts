/**
 * MongoBranch — Checkpoint Manager (Lightweight Save Points)
 *
 * Instant save points agents can create before risky operations.
 * Zero ceremony — no message required. Auto-prunable via TTL.
 * Uses CommitEngine internally for snapshots.
 */
import { randomUUID } from "crypto";
import type { MongoClient, Collection } from "mongodb";
import type {
  MongoBranchConfig,
  CheckpointEntry,
  CheckpointResult,
  RestoreResult,
} from "./types.ts";
import { CHECKPOINTS_COLLECTION } from "./types.ts";
import { CommitEngine } from "./commit.ts";
import { BranchManager } from "./branch.ts";

export class CheckpointManager {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private commitEngine: CommitEngine;
  private branchManager: BranchManager;
  private checkpoints: Collection<CheckpointEntry>;

  constructor(
    client: MongoClient,
    config: MongoBranchConfig,
    commitEngine: CommitEngine,
    branchManager: BranchManager,
  ) {
    this.client = client;
    this.config = config;
    this.commitEngine = commitEngine;
    this.branchManager = branchManager;
    this.checkpoints = client
      .db(config.metaDatabase)
      .collection<CheckpointEntry>(CHECKPOINTS_COLLECTION);
  }

  async initialize(): Promise<void> {
    await this.checkpoints.createIndex({ id: 1 }, { unique: true });
    await this.checkpoints.createIndex({ branchName: 1, createdAt: -1 });
    await this.checkpoints.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $exists: true } } },
    );
  }

  /**
   * Get the checkpoint snapshot database name for a given checkpoint.
   */
  private cpDbName(checkpointId: string): string {
    return `${this.config.branchPrefix}__cp_${checkpointId}`;
  }

  /**
   * Create a lightweight save point. Copies branch data to a snapshot DB.
   */
  async create(
    branchName: string,
    options?: { label?: string; ttlMinutes?: number; createdBy?: string },
  ): Promise<CheckpointResult> {
    // Verify branch exists
    const branches = await this.branchManager.listBranches();
    const branch = branches.find(b => b.name === branchName);
    if (!branch) throw new Error(`Branch "${branchName}" not found`);

    const id = randomUUID().slice(0, 8);
    const label = options?.label ?? `checkpoint-${id}`;

    // Create a commit to record the state in the commit chain
    const commit = await this.commitEngine.commit({
      branchName,
      message: `[checkpoint] ${label}`,
      author: options?.createdBy ?? "checkpoint-system",
    });

    // Copy branch data into a checkpoint-specific database
    const branchDb = this.client.db(branch.branchDatabase);
    const cpDb = this.client.db(this.cpDbName(id));
    const collections = await branchDb.listCollections().toArray();
    let collectionsSnapshotted = 0;
    let documentCount = 0;

    for (const col of collections) {
      if (col.name.startsWith("system.")) continue;
      const docs = await branchDb.collection(col.name).find({}).toArray();
      if (docs.length > 0) {
        await cpDb.collection(col.name).insertMany(docs);
      }
      collectionsSnapshotted++;
      documentCount += docs.length;
    }

    const entry: CheckpointEntry = {
      id,
      branchName,
      commitHash: commit.hash,
      createdBy: options?.createdBy ?? "checkpoint-system",
      createdAt: new Date(),
      expiresAt: options?.ttlMinutes
        ? new Date(Date.now() + options.ttlMinutes * 60_000)
        : undefined,
      label,
      auto: !options?.label,
    };

    await this.checkpoints.insertOne(entry);

    return {
      id,
      branchName,
      commitHash: commit.hash,
      collectionsSnapshotted,
      documentCount,
    };
  }

  /**
   * Restore branch to a checkpoint state.
   * Drops branch data and rebuilds from the checkpoint's snapshot DB.
   */
  async restore(
    branchName: string,
    checkpointId: string,
  ): Promise<RestoreResult> {
    const cp = await this.checkpoints.findOne({ id: checkpointId, branchName });
    if (!cp) throw new Error(`Checkpoint "${checkpointId}" not found on branch "${branchName}"`);

    // Count commits since checkpoint for rollback count
    const commitLog = await this.commitEngine.getLog(branchName, 1000);
    const targetIdx = commitLog.commits.findIndex(c => c.hash === cp.commitHash);
    const commitsRolledBack = targetIdx >= 0 ? targetIdx : 0;

    // Get branch database
    const branchList = await this.branchManager.listBranches();
    const branch = branchList.find(b => b.name === branchName);
    if (!branch) throw new Error(`Branch "${branchName}" not found`);

    const branchDb = this.client.db(branch.branchDatabase);
    const cpDb = this.client.db(this.cpDbName(checkpointId));

    // Verify checkpoint DB exists
    const cpCols = await cpDb.listCollections().toArray();
    if (cpCols.length === 0) throw new Error(`Checkpoint data not found for "${checkpointId}"`);

    // Drop all existing collections in branch
    const existingCols = await branchDb.listCollections().toArray();
    for (const col of existingCols) {
      if (!col.name.startsWith("system.")) {
        await branchDb.dropCollection(col.name);
      }
    }

    // Restore from checkpoint snapshot DB
    let collectionsRestored = 0;
    let documentsRestored = 0;
    for (const col of cpCols) {
      if (col.name.startsWith("system.")) continue;
      const docs = await cpDb.collection(col.name).find({}).toArray();
      if (docs.length > 0) {
        await branchDb.collection(col.name).insertMany(docs);
        collectionsRestored++;
        documentsRestored += docs.length;
      }
    }

    return {
      branchName,
      checkpointId,
      collectionsRestored,
      documentsRestored,
      commitsRolledBack,
    };
  }

  /**
   * List checkpoints for a branch, newest first.
   */
  async list(branchName: string): Promise<CheckpointEntry[]> {
    return this.checkpoints
      .find({ branchName })
      .sort({ createdAt: -1 })
      .toArray();
  }

  /**
   * Delete a single checkpoint and its snapshot DB.
   */
  async delete(branchName: string, checkpointId: string): Promise<boolean> {
    const result = await this.checkpoints.deleteOne({
      id: checkpointId,
      branchName,
    });
    if (result.deletedCount > 0) {
      try {
        await this.client.db(this.cpDbName(checkpointId)).dropDatabase();
      } catch (err) {
        console.warn(`[Checkpoint] failed to drop DB for ${checkpointId}:`, err instanceof Error ? err.message : err);
      }
    }
    return result.deletedCount > 0;
  }

  /**
   * Prune old checkpoints, keeping only the most recent `keepLast`.
   */
  async prune(branchName: string, keepLast = 5): Promise<number> {
    const all = await this.checkpoints
      .find({ branchName })
      .sort({ createdAt: -1 })
      .toArray();

    if (all.length <= keepLast) return 0;

    const toDelete = all.slice(keepLast).map(cp => cp.id);
    const result = await this.checkpoints.deleteMany({
      id: { $in: toDelete },
      branchName,
    });
    return result.deletedCount;
  }
}
