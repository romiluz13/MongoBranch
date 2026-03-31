/**
 * MongoBranch — Merge Engine
 *
 * Applies changes from a source branch into a target branch (usually main).
 * Supports dry-run, conflict detection, and resolution strategies.
 */
import type { MongoClient, Db } from "mongodb";
import { DiffEngine } from "./diff.ts";
import {
  type MergeResult,
  type MergeOptions,
  type MergeConflict,
  type MongoBranchConfig,
  type BranchMetadata,
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

    // Apply changes per collection
    for (const [collName, collDiff] of Object.entries(diff.collections)) {
      const targetColl = targetDb.collection(collName);

      // Inserts — always safe (new docs)
      if (collDiff.added.length > 0) {
        await targetColl.insertMany(collDiff.added.map((doc) => ({ ...doc })));
      }

      // Deletes — always apply
      for (const doc of collDiff.removed) {
        await targetColl.deleteOne({ _id: doc._id });
      }

      // Modifications — apply based on conflict strategy
      for (const mod of collDiff.modified) {
        const isConflict = conflicts.some(
          (c) => c.collection === collName && c.documentId === mod._id
        );

        if (isConflict && detectConflicts) {
          if (strategy === "ours") {
            // Keep target version — skip this modification
            continue;
          } else if (strategy === "theirs") {
            // Use source version — apply the modification
            const sourceDoc = await sourceDb.collection(collName).findOne({ _id: mod._id });
            if (sourceDoc) {
              await targetColl.replaceOne({ _id: mod._id }, sourceDoc);
            }
          } else {
            // "abort" — skip the modification (but don't fail the whole merge)
            continue;
          }
        } else {
          // No conflict — apply source version
          const sourceDoc = await sourceDb.collection(collName).findOne({ _id: mod._id });
          if (sourceDoc) {
            await targetColl.replaceOne({ _id: mod._id }, sourceDoc);
          }
        }
      }
    }

    // Mark branch as merged
    await this.client
      .db(this.config.metaDatabase)
      .collection(META_COLLECTION)
      .updateOne(
        { name: sourceBranch },
        { $set: { status: "merged", updatedAt: new Date() } }
      );

    return {
      sourceBranch, targetBranch, collectionsAffected,
      documentsAdded, documentsRemoved, documentsModified,
      conflicts, success: true,
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
