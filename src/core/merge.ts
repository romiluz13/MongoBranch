/**
 * MongoBranch — Merge Engine
 *
 * Applies changes from a source branch into a target branch (usually main).
 * Supports dry-run, conflict detection, and resolution strategies.
 */
import { createHash } from "crypto";
import type { MongoClient, Db, AnyBulkWriteOperation, ClientSession } from "mongodb";
import { DiffEngine } from "./diff.ts";
import { CommitEngine } from "./commit.ts";
import {
  type MergeResult,
  type MergeOptions,
  type MergeConflict,
  type MongoBranchConfig,
  type BranchMetadata,
  type ThreeWayMergeResult,
  type ThreeWayMergeOptions,
  MAIN_BRANCH,
  META_COLLECTION,
  sanitizeBranchDbName,
} from "./types.ts";

export class MergeEngine {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private diffEngine: DiffEngine;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
    this.diffEngine = new DiffEngine(client, config);
  }

  async merge(
    sourceBranch: string,
    targetBranch: string,
    options?: MergeOptions
  ): Promise<MergeResult> {
    const dryRun = options?.dryRun ?? false;
    const detectConflicts = options?.detectConflicts ?? false;
    const strategy = options?.conflictStrategy ?? "abort";

    const meta = await this.client
      .db(this.config.metaDatabase)
      .collection<BranchMetadata>(META_COLLECTION)
      .findOne({ name: sourceBranch, status: "active" });

    if (!meta) {
      throw new Error(`Branch "${sourceBranch}" not found`);
    }

    const targetDb = this.resolveDb(targetBranch);
    const sourceDb = this.client.db(meta.branchDatabase as string);

    if (detectConflicts) {
      const commitEngine = new CommitEngine(this.client, this.config);
      const ancestor = await commitEngine.getCommonAncestor(targetBranch, sourceBranch);

      if (ancestor) {
        const { diff3, cleanup } = await this.prepareThreeWayDiff(
          sourceBranch,
          targetBranch,
          ancestor.hash,
          commitEngine
        );

        try {
          const conflicts = diff3.conflicts.map((conflict) => ({
            collection: conflict.collection,
            documentId: conflict.documentId,
            reason: `Concurrent change on field "${conflict.field}"`,
          }));

          if (diff3.conflicts.length > 0 && strategy !== "abort") {
            for (const conflict of diff3.conflicts) {
              conflict.resolved = true;
              conflict.resolvedValue = strategy === "theirs" ? conflict.theirs : conflict.ours;
            }
          }

          const result: MergeResult = {
            sourceBranch,
            targetBranch,
            collectionsAffected: diff3.collectionsAffected.size,
            documentsAdded: diff3.additions.length,
            documentsRemoved: diff3.deletions.length,
            documentsModified: diff3.modifications.length,
            conflicts,
            success: !(strategy === "abort" && conflicts.length > 0),
            ...(dryRun ? { dryRun: true } : {}),
          };

          if (dryRun || (strategy === "abort" && conflicts.length > 0)) {
            return result;
          }

          const session = this.client.startSession();
          try {
            await session.withTransaction(async () => {
              await this.applyThreeWayPlan(targetDb, diff3, session);
              await this.markBranchMerged(sourceBranch, session);
              await this.recordTargetMergeCommit(
                sourceBranch,
                targetBranch,
                Array.from(diff3.collectionsAffected),
                session,
                commitEngine
              );
            });
          } finally {
            await session.endSession();
          }

          return result;
        } finally {
          await cleanup();
        }
      }
    }

    const diff = await this.diffEngine.diffBranches(sourceBranch, targetBranch);
    let documentsAdded = 0;
    let documentsRemoved = 0;
    let documentsModified = 0;
    let collectionsAffected = 0;

    for (const collDiff of Object.values(diff.collections)) {
      collectionsAffected++;
      documentsAdded += collDiff.added.length;
      documentsRemoved += collDiff.removed.length;
      documentsModified += collDiff.modified.length;
    }

    if (dryRun) {
      return {
        sourceBranch,
        targetBranch,
        collectionsAffected,
        documentsAdded,
        documentsRemoved,
        documentsModified,
        conflicts: [],
        success: true,
        dryRun: true,
      };
    }

    const session = this.client.startSession();
    const commitEngine = new CommitEngine(this.client, this.config);
    try {
      await session.withTransaction(async () => {
        for (const [collName, collDiff] of Object.entries(diff.collections)) {
          const targetColl = targetDb.collection(collName);
          const ops: AnyBulkWriteOperation[] = [];

          for (const doc of collDiff.added) {
            ops.push({ insertOne: { document: { ...doc } as any } });
          }

          for (const doc of collDiff.removed) {
            ops.push({ deleteOne: { filter: { _id: doc._id as any } } });
          }

          for (const mod of collDiff.modified) {
            const sourceDoc = await sourceDb
              .collection(collName)
              .findOne({ _id: mod._id as any }, { session });
            if (sourceDoc) {
              ops.push({
                replaceOne: {
                  filter: { _id: mod._id as any },
                  replacement: sourceDoc,
                },
              });
            }
          }

          if (ops.length > 0) {
            await targetColl.bulkWrite(ops, { ordered: true, session });
          }
        }

        await this.markBranchMerged(sourceBranch, session);
        if (documentsAdded + documentsRemoved + documentsModified > 0) {
          await this.recordTargetMergeCommit(
            sourceBranch,
            targetBranch,
            Object.keys(diff.collections),
            session,
            commitEngine
          );
        }
      });
    } finally {
      await session.endSession();
    }

    return {
      sourceBranch,
      targetBranch,
      collectionsAffected,
      documentsAdded,
      documentsRemoved,
      documentsModified,
      conflicts: [],
      success: true,
    };
  }

  /**
   * Three-way merge: Uses common ancestor to distinguish added vs deleted vs modified.
   * This is the full Git-like merge — the feature Neon can't do.
   *
   * Steps (validated from Dolt's 6-step process):
   * 1. Find merge base (common ancestor via commit graph BFS)
   * 2. Diff base→ours (target branch)
   * 3. Diff base→theirs (source branch)
   * 4. Auto-merge non-overlapping changes
   * 5. Detect per-field conflicts (same _id + same field + different values)
   * 6. Apply or report (depending on dryRun and conflict strategy)
   */
  async threeWayMerge(
    sourceBranch: string,
    targetBranch: string,
    commitEngine: CommitEngine,
    options: ThreeWayMergeOptions = {}
  ): Promise<ThreeWayMergeResult> {
    const { dryRun = false, conflictStrategy = "manual", author = "unknown", message } = options;

    // Step 1: Find merge base
    const ancestor = await commitEngine.getCommonAncestor(targetBranch, sourceBranch);

    // Resolve database names
    const targetDb = this.resolveDb(targetBranch);

    // If no common ancestor, fall back to 2-way merge behavior
    if (!ancestor) {
      const twoWayResult = await this.merge(sourceBranch, targetBranch, {
        dryRun,
        conflictStrategy: conflictStrategy === "ours" ? "ours" : conflictStrategy === "theirs" ? "theirs" : "ours",
      });
      return {
        sourceBranch,
        targetBranch,
        mergeBase: null,
        collectionsAffected: twoWayResult.collectionsAffected,
        documentsAdded: twoWayResult.documentsAdded,
        documentsRemoved: twoWayResult.documentsRemoved,
        documentsModified: twoWayResult.documentsModified,
        conflicts: [],
        success: twoWayResult.success,
        dryRun,
      };
    }

    const { diff3, cleanup } = await this.prepareThreeWayDiff(
      sourceBranch,
      targetBranch,
      ancestor.hash,
      commitEngine
    );

    try {
      // If we have conflicts and strategy is manual, report them
      if (diff3.conflicts.length > 0 && conflictStrategy === "manual") {
        return {
          sourceBranch,
          targetBranch,
          mergeBase: ancestor.hash,
          collectionsAffected: diff3.collectionsAffected.size,
          documentsAdded: diff3.additions.length,
          documentsRemoved: diff3.deletions.length,
          documentsModified: diff3.modifications.length,
          conflicts: diff3.conflicts,
          success: false,
          dryRun,
        };
      }

      // Resolve conflicts by strategy if not manual
      if (diff3.conflicts.length > 0) {
        for (const conflict of diff3.conflicts) {
          conflict.resolved = true;
          conflict.resolvedValue = conflictStrategy === "theirs" ? conflict.theirs : conflict.ours;
        }
      }

      if (dryRun) {
        return {
          sourceBranch, targetBranch, mergeBase: ancestor.hash,
          collectionsAffected: diff3.collectionsAffected.size,
          documentsAdded: diff3.additions.length,
          documentsRemoved: diff3.deletions.length,
          documentsModified: diff3.modifications.length,
          conflicts: diff3.conflicts,
          success: true,
          dryRun: true,
        };
      }

      // Step 6: Apply changes to target atomically
      const session = this.client.startSession();
      let mergeCommitHash: string | undefined;
      try {
        await session.withTransaction(async () => {
          await this.applyThreeWayPlan(targetDb, diff3, session);
          await this.markBranchMerged(sourceBranch, session);

          // Create merge commit with two parents
          const commitMessage = message ?? `Merge "${sourceBranch}" into "${targetBranch}"`;
          const targetHead = await commitEngine.getHeadCommitHash(targetBranch, session);
          const sourceHead = await commitEngine.getHeadCommitHash(sourceBranch, session);

          if (targetHead && sourceHead) {
            const mergeCommit = await commitEngine.commit({
              branchName: targetBranch,
              message: commitMessage,
              author,
              parentOverrides: [targetHead, sourceHead],
              collectionNames: Array.from(diff3.collectionsAffected),
              session,
            });
            mergeCommitHash = mergeCommit.hash;
          }
        });
      } finally {
        await session.endSession();
      }

      return {
        sourceBranch, targetBranch, mergeBase: ancestor.hash,
        collectionsAffected: diff3.collectionsAffected.size,
        documentsAdded: diff3.additions.length,
        documentsRemoved: diff3.deletions.length,
        documentsModified: diff3.modifications.length,
        conflicts: diff3.conflicts,
        mergeCommitHash,
        success: true,
        dryRun: false,
      };
    } finally {
      await cleanup();
    }
  }

  private async prepareThreeWayDiff(
    sourceBranch: string,
    targetBranch: string,
    ancestorHash: string,
    commitEngine: CommitEngine
  ): Promise<{
    diff3: Awaited<ReturnType<DiffEngine["diff3"]>>;
    cleanup: () => Promise<void>;
  }> {
    const targetDb = this.resolveDb(targetBranch);
    const sourceDb = this.resolveDb(sourceBranch);
    const { dbName, cleanup } = await this.materializeCommitBase(ancestorHash, commitEngine);

    const diff3 = await this.diffEngine.diff3(
      dbName,
      targetDb.databaseName,
      sourceDb.databaseName
    );

    return { diff3, cleanup };
  }

  private async materializeCommitBase(
    commitHash: string,
    commitEngine: CommitEngine
  ): Promise<{ dbName: string; cleanup: () => Promise<void> }> {
    const commit = await commitEngine.getCommit(commitHash);
    if (!commit) {
      throw new Error(`Merge base commit "${commitHash}" not found`);
    }

    const snapshotDocs = await commitEngine.getCommitDocuments(commitHash);
    if (Object.keys(commit.snapshot.collections).length > 0 && Object.keys(snapshotDocs).length === 0) {
      throw new Error(`Stored snapshot data missing for merge base "${commitHash}"`);
    }

    const dbName = this.buildTemporaryDbName(commitHash);
    const db = this.client.db(dbName);
    await db.dropDatabase().catch(() => {});

    for (const [collection, docs] of Object.entries(snapshotDocs)) {
      if (docs.length === 0) continue;
      await db.collection(collection).insertMany(docs.map((doc) => ({ ...doc })) as any[]);
    }

    return {
      dbName,
      cleanup: async () => {
        await this.client.db(dbName).dropDatabase().catch(() => {});
      },
    };
  }

  private async applyThreeWayPlan(
    targetDb: Db,
    diff3: Awaited<ReturnType<DiffEngine["diff3"]>>,
    session: ClientSession
  ): Promise<void> {
    const collOps = new Map<string, AnyBulkWriteOperation[]>();
    const getOps = (collection: string) => {
      if (!collOps.has(collection)) collOps.set(collection, []);
      return collOps.get(collection)!;
    };

    for (const add of diff3.additions) {
      getOps(add.collection).push({ insertOne: { document: add.doc as any } });
    }
    for (const del of diff3.deletions) {
      getOps(del.collection).push({ deleteOne: { filter: { _id: del.docId as any } } });
    }
    for (const mod of diff3.modifications) {
      getOps(mod.collection).push({
        updateOne: {
          filter: { _id: mod.docId as any },
          update: { $set: mod.mergedFields },
        },
      });
    }
    for (const conflict of diff3.conflicts.filter((entry) => entry.resolved)) {
      if (conflict.field === "_deleted") {
        if (conflict.resolvedValue === null) {
          getOps(conflict.collection).push({
            deleteOne: { filter: { _id: conflict.documentId as any } },
          });
        } else {
          getOps(conflict.collection).push({
            replaceOne: {
              filter: { _id: conflict.documentId as any },
              replacement: conflict.resolvedValue as Record<string, unknown>,
              upsert: true,
            },
          });
        }
      } else {
        getOps(conflict.collection).push({
          updateOne: {
            filter: { _id: conflict.documentId as any },
            update: { $set: { [conflict.field]: conflict.resolvedValue } },
          },
        });
      }
    }

    for (const [collection, ops] of collOps) {
      if (ops.length > 0) {
        await targetDb.collection(collection).bulkWrite(ops, { ordered: true, session });
      }
    }
  }

  private async markBranchMerged(sourceBranch: string, session: ClientSession): Promise<void> {
    await this.client
      .db(this.config.metaDatabase)
      .collection(META_COLLECTION)
      .updateOne(
        { name: sourceBranch },
        { $set: { status: "merged" }, $currentDate: { updatedAt: true } },
        { session }
      );
  }

  private async recordTargetMergeCommit(
    sourceBranch: string,
    targetBranch: string,
    collectionNames: string[],
    session: ClientSession,
    commitEngine: CommitEngine
  ): Promise<void> {
    const targetHead = await commitEngine.getHeadCommitHash(targetBranch, session);
    const sourceHead = await commitEngine.getHeadCommitHash(sourceBranch, session);
    const parentOverrides = Array.from(new Set([targetHead, sourceHead].filter(Boolean))) as string[];

    await commitEngine.commit({
      branchName: targetBranch,
      message: `Merge "${sourceBranch}" into "${targetBranch}"`,
      author: "merge-system",
      parentOverrides: parentOverrides.length > 0 ? parentOverrides : undefined,
      collectionNames,
      session,
    });
  }

  private buildTemporaryDbName(seed: string): string {
    const suffix = createHash("sha1")
      .update(`${this.config.metaDatabase}:${seed}:${Date.now()}`)
      .digest("hex")
      .slice(0, 24);
    return `__mb_tmp_${suffix}`;
  }

  private resolveDb(branchName: string): Db {
    if (branchName === MAIN_BRANCH) {
      return this.client.db(this.config.sourceDatabase);
    }
    return this.client.db(`${this.config.branchPrefix}${sanitizeBranchDbName(branchName)}`);
  }
}
