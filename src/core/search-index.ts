/**
 * SearchIndexManager — Atlas Search index branching for MongoBranch
 *
 * Manages search index definitions (Atlas Search + Vector Search) across branches.
 * Supports listing, copying, diffing, and merging search index definitions.
 *
 * Requires Atlas Local (mongodb-atlas-local:preview) which includes mongot.
 */

import { type MongoClient, type Db } from "mongodb";
import {
  type MongoBranchConfig,
  type SearchIndexDefinition,
  type SearchIndexDiff,
  type SearchIndexModification,
  type SearchIndexCopyResult,
  type SearchIndexMergeResult,
  type SearchIndexType,
  MAIN_BRANCH,
  META_COLLECTION,
} from "./types.js";

export class SearchIndexManager {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private metaDb: Db;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
    this.metaDb = client.db(config.metaDatabase);
  }

  /**
   * List all search indexes for a branch, optionally filtered by collection.
   */
  async listIndexes(
    branchName: string,
    collectionName?: string
  ): Promise<SearchIndexDefinition[]> {
    const db = this.resolveDatabase(branchName);
    const collections = collectionName
      ? [collectionName]
      : await this.getUserCollections(db);

    const results: SearchIndexDefinition[] = [];

    for (const coll of collections) {
      try {
        const cursor = db.collection(coll).listSearchIndexes();
        const indexes = await cursor.toArray();

        for (const raw of indexes) {
          const idx = raw as any;
          results.push({
            name: idx.name ?? "default",
            type: (idx.type as SearchIndexType) ?? "search",
            collectionName: coll,
            definition: idx.latestDefinition ?? idx.definition ?? {},
            status: idx.status ?? "UNKNOWN",
            queryable: idx.queryable ?? false,
          });
        }
      } catch (error: unknown) {
        // Collection may not support search indexes (e.g., views)
        // or mongot may not be available — skip gracefully
        const msg = error instanceof Error ? error.message : String(error);
        if (!msg.includes("CommandNotFound") && !msg.includes("not found")) {
          // Re-throw unexpected errors
          throw error;
        }
      }
    }

    return results;
  }

  /**
   * Copy all search index definitions from source branch to target branch.
   */
  async copyIndexes(
    sourceBranch: string,
    targetBranch: string,
    collectionName?: string
  ): Promise<SearchIndexCopyResult> {
    const sourceIndexes = await this.listIndexes(sourceBranch, collectionName);
    const targetDb = this.resolveDatabase(targetBranch);
    const details: SearchIndexCopyResult["details"] = [];
    let copied = 0;
    let failed = 0;

    for (const idx of sourceIndexes) {
      try {
        // Drop existing index with same name if present
        try {
          await targetDb
            .collection(idx.collectionName)
            .dropSearchIndex(idx.name);
          // Wait briefly for drop to propagate
          await this.sleep(500);
        } catch {
          // Index may not exist — fine
        }

        await targetDb
          .collection(idx.collectionName)
          .createSearchIndex({
            name: idx.name,
            type: idx.type,
            definition: idx.definition,
          });

        details.push({
          collection: idx.collectionName,
          indexName: idx.name,
          status: "copied",
        });
        copied++;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        details.push({
          collection: idx.collectionName,
          indexName: idx.name,
          status: "failed",
          error: msg,
        });
        failed++;
      }
    }

    return {
      sourceBranch,
      targetBranch,
      indexesCopied: copied,
      indexesFailed: failed,
      details,
    };
  }

  /**
   * Diff search indexes between two branches.
   */
  async diffIndexes(
    sourceBranch: string,
    targetBranch: string,
    collectionName?: string
  ): Promise<SearchIndexDiff[]> {
    const sourceIndexes = await this.listIndexes(sourceBranch, collectionName);
    const targetIndexes = await this.listIndexes(targetBranch, collectionName);

    // Group by collection
    const allCollections = new Set([
      ...sourceIndexes.map((i) => i.collectionName),
      ...targetIndexes.map((i) => i.collectionName),
    ]);

    const diffs: SearchIndexDiff[] = [];

    for (const coll of allCollections) {
      const srcForColl = sourceIndexes.filter(
        (i) => i.collectionName === coll
      );
      const tgtForColl = targetIndexes.filter(
        (i) => i.collectionName === coll
      );

      const srcMap = new Map(srcForColl.map((i) => [i.name, i]));
      const tgtMap = new Map(tgtForColl.map((i) => [i.name, i]));

      const added: SearchIndexDefinition[] = [];
      const removed: SearchIndexDefinition[] = [];
      const modified: SearchIndexModification[] = [];
      const unchanged: string[] = [];

      // Find added (in source, not in target) and modified
      for (const [name, srcIdx] of srcMap) {
        const tgtIdx = tgtMap.get(name);
        if (!tgtIdx) {
          added.push(srcIdx);
        } else if (
          !this.deepEqual(srcIdx.definition, tgtIdx.definition)
        ) {
          modified.push({
            name,
            type: srcIdx.type,
            collection: coll,
            source: srcIdx.definition,
            target: tgtIdx.definition,
          });
        } else {
          unchanged.push(name);
        }
      }

      // Find removed (in target, not in source)
      for (const [name, tgtIdx] of tgtMap) {
        if (!srcMap.has(name)) {
          removed.push(tgtIdx);
        }
      }

      // Only include collections with actual differences
      if (added.length > 0 || removed.length > 0 || modified.length > 0) {
        diffs.push({ collection: coll, added, removed, modified, unchanged });
      }
    }

    return diffs;
  }

  /**
   * Merge search indexes from source branch into target branch.
   * Creates indexes that exist only in source, updates modified ones.
   * Does NOT remove indexes that exist only in target (safe merge).
   */
  async mergeIndexes(
    sourceBranch: string,
    targetBranch: string,
    collectionName?: string,
    options?: { removeOrphans?: boolean }
  ): Promise<SearchIndexMergeResult> {
    const diffs = await this.diffIndexes(
      sourceBranch,
      targetBranch,
      collectionName
    );
    const targetDb = this.resolveDatabase(targetBranch);
    let created = 0;
    let updated = 0;
    let removed = 0;
    const errors: SearchIndexMergeResult["errors"] = [];

    for (const diff of diffs) {
      // Create indexes that are in source but not target
      for (const idx of diff.added) {
        try {
          await targetDb
            .collection(diff.collection)
            .createSearchIndex({
              name: idx.name,
              type: idx.type,
              definition: idx.definition,
            });
          created++;
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          errors.push({
            collection: diff.collection,
            indexName: idx.name,
            error: msg,
          });
        }
      }

      // Update modified indexes (drop + recreate)
      for (const mod of diff.modified) {
        try {
          await targetDb
            .collection(diff.collection)
            .dropSearchIndex(mod.name);
          await this.sleep(500);
          await targetDb
            .collection(diff.collection)
            .createSearchIndex({
              name: mod.name,
              type: mod.type,
              definition: mod.source,
            });
          updated++;
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          errors.push({
            collection: diff.collection,
            indexName: mod.name,
            error: msg,
          });
        }
      }

      // Optionally remove indexes that only exist in target
      if (options?.removeOrphans) {
        for (const idx of diff.removed) {
          try {
            await targetDb
              .collection(diff.collection)
              .dropSearchIndex(idx.name);
            removed++;
          } catch (error: unknown) {
            const msg =
              error instanceof Error ? error.message : String(error);
            errors.push({
              collection: diff.collection,
              indexName: idx.name,
              error: msg,
            });
          }
        }
      }
    }

    return {
      sourceBranch,
      targetBranch,
      indexesCreated: created,
      indexesUpdated: updated,
      indexesRemoved: removed,
      errors,
      success: errors.length === 0,
    };
  }

  // ── Private helpers ──────────────────────────────────

  private resolveDatabase(branchName: string): Db {
    if (branchName === MAIN_BRANCH) {
      return this.client.db(this.config.sourceDatabase);
    }
    const safeName = branchName.replace(/\//g, "--");
    return this.client.db(`${this.config.branchPrefix}${safeName}`);
  }

  private async getUserCollections(db: Db): Promise<string[]> {
    const colls = await db.listCollections().toArray();
    return colls
      .filter((c) => !c.name.startsWith("system."))
      .map((c) => c.name);
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
