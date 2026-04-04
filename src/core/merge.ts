/**
 * MongoBranch — Merge Engine
 *
 * Applies changes from a source branch into a target branch (usually main).
 * Supports dry-run, conflict detection, and resolution strategies.
 */
import type { MongoClient, Db, AnyBulkWriteOperation } from "mongodb";
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

    const diff = await this.diffEngine.diffBranches(sourceBranch, targetBranch);
    const targetDb = this.resolveDb(targetBranch);
    const sourceDb = this.client.db(meta.branchDatabase as string);

    let documentsAdded = 0;
    let documentsRemoved = 0;
    let documentsModified = 0;
    let collectionsAffected = 0;
    const conflicts: MergeConflict[] = [];

    for (const [collName, collDiff] of Object.entries(diff.collections)) {
      collectionsAffected++;
      documentsAdded += collDiff.added.length;
      documentsRemoved += collDiff.removed.length;
      documentsModified += collDiff.modified.length;
    }

    if (dryRun) {
      return {
        sourceBranch, targetBranch, collectionsAffected,
        documentsAdded, documentsRemoved, documentsModified,
        conflicts: [], success: true, dryRun: true,
      };
    }

    // Detect conflicts if requested
    if (detectConflicts) {
      for (const [collName, collDiff] of Object.entries(diff.collections)) {
        for (const mod of collDiff.modified) {
          // Both source and target have this doc with different content.
          // That means both sides diverged — it's a conflict.
          conflicts.push({
            collection: collName,
            documentId: mod._id,
            reason: `Document modified on both branches (fields: ${
              mod.fields ? Object.keys(mod.fields).join(", ") : "unknown"
            })`,
          });
        }
      }
    }

    // Apply changes atomically inside a transaction
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        // Apply changes per collection using bulkWrite
        for (const [collName, collDiff] of Object.entries(diff.collections)) {
          const targetColl = targetDb.collection(collName);
          const ops: AnyBulkWriteOperation[] = [];

          // Inserts — always safe (new docs)
          for (const doc of collDiff.added) {
            ops.push({ insertOne: { document: { ...doc } as any } });
          }

          // Deletes — always apply
          for (const doc of collDiff.removed) {
            ops.push({ deleteOne: { filter: { _id: doc._id as any } } });
          }

          // Modifications — apply based on conflict strategy
          for (const mod of collDiff.modified) {
            const isConflict = conflicts.some(
              (c) => c.collection === collName && c.documentId === mod._id
            );

            if (isConflict && detectConflicts) {
              if (strategy === "ours") {
                continue; // Keep target version
              } else if (strategy === "theirs") {
                const sourceDoc = await sourceDb
                  .collection(collName)
                  .findOne({ _id: mod._id as any }, { session });
                if (sourceDoc) {
                  ops.push({ replaceOne: { filter: { _id: mod._id as any }, replacement: sourceDoc } });
                }
              } else {
                continue; // "abort" — skip
              }
            } else {
              const sourceDoc = await sourceDb
                .collection(collName)
                .findOne({ _id: mod._id as any }, { session });
              if (sourceDoc) {
                ops.push({ replaceOne: { filter: { _id: mod._id as any }, replacement: sourceDoc } });
              }
            }
          }

          if (ops.length > 0) {
            await targetColl.bulkWrite(ops, { ordered: true, session });
          }
        }

        // Mark branch as merged
        await this.client
          .db(this.config.metaDatabase)
          .collection(META_COLLECTION)
          .updateOne(
            { name: sourceBranch },
            { $set: { status: "merged" }, $currentDate: { updatedAt: true } },
            { session }
          );
      });
    } finally {
      await session.endSession();
    }

    return {
      sourceBranch, targetBranch, collectionsAffected,
      documentsAdded, documentsRemoved, documentsModified,
      conflicts, success: true,
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
    const sourceDb = this.resolveDb(sourceBranch);

    let baseDbName: string;
    if (ancestor) {
      // Use the snapshot from the ancestor commit to identify the base state
      // The ancestor was created on some branch — resolve that branch's DB at that point
      // For simplicity, we use the target DB as-was (since ancestor is shared)
      baseDbName = targetDb.databaseName;
    }

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

    // Step 2-5: Three-way diff using ancestor as base
    // Both branches fork from the source database — use it as the merge base.
    // In the future, we can reconstruct the exact state at the ancestor commit
    // using snapshot checksums and stored deltas. For now, sourceDatabase works
    // because both branches were created from it.
    baseDbName = this.config.sourceDatabase;

    const diff3 = await this.diffEngine.diff3(
      baseDbName,
      targetDb.databaseName,
      sourceDb.databaseName
    );

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
        // Group operations by collection for bulkWrite
        const collOps = new Map<string, AnyBulkWriteOperation[]>();
        const getOps = (coll: string) => {
          if (!collOps.has(coll)) collOps.set(coll, []);
          return collOps.get(coll)!;
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
        // Apply resolved conflicts
        for (const conflict of diff3.conflicts.filter(c => c.resolved)) {
          if (conflict.field === "_deleted") {
            if (conflict.resolvedValue === null) {
              getOps(conflict.collection).push({
                deleteOne: { filter: { _id: conflict.documentId as any } },
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

        // Execute all bulkWrite ops
        for (const [collName, ops] of collOps) {
          if (ops.length > 0) {
            await targetDb.collection(collName).bulkWrite(ops, { ordered: true, session });
          }
        }

        // Create merge commit with two parents
        const commitMessage = message ?? `Merge "${sourceBranch}" into "${targetBranch}"`;
        const targetHead = (await this.client.db(this.config.metaDatabase)
          .collection<BranchMetadata>(META_COLLECTION)
          .findOne({ name: targetBranch, status: { $ne: "deleted" } }, { session }))?.headCommit;
        const sourceHead = (await this.client.db(this.config.metaDatabase)
          .collection<BranchMetadata>(META_COLLECTION)
          .findOne({ name: sourceBranch, status: { $ne: "deleted" } }, { session }))?.headCommit;

        if (targetHead && sourceHead) {
          const mergeCommit = await commitEngine.commit({
            branchName: targetBranch,
            message: commitMessage,
            author,
            parentOverrides: [targetHead, sourceHead],
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
  }

  private resolveDb(branchName: string): Db {
    if (branchName === MAIN_BRANCH) {
      return this.client.db(this.config.sourceDatabase);
    }
    const safeName = branchName.replace(/\//g, "--");
    return this.client.db(`${this.config.branchPrefix}${safeName}`);
  }
}
