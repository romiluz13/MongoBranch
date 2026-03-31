/**
 * MongoBranch — Diff Engine
 *
 * Compares two branches (or a branch vs main) and produces a structured diff:
 * - Added documents (in source but not target)
 * - Removed documents (in target but not source)
 * - Modified documents (field-level deep diff via jsondiffpatch)
 */
import type { MongoClient, Db } from "mongodb";
import { diff as jdpDiff } from "jsondiffpatch";
import {
  type DiffResult,
  type CollectionDiff,
  type ModifiedDocument,
  type IndexDiff,
  type IndexInfo,
  type ValidationDiff,
  type ValidationRule,
  type BranchMetadata,
  type MongoBranchConfig,
  type ThreeWayConflict,
  MAIN_BRANCH,
  META_COLLECTION,
} from "./types.ts";

export interface Diff3Result {
  /** Non-conflicting changes to apply */
  additions: Array<{ collection: string; doc: Record<string, unknown> }>;
  deletions: Array<{ collection: string; docId: unknown }>;
  modifications: Array<{ collection: string; docId: unknown; mergedFields: Record<string, unknown> }>;
  /** Field-level conflicts requiring resolution */
  conflicts: ThreeWayConflict[];
  collectionsAffected: Set<string>;
}

export class DiffEngine {
  private client: MongoClient;
  private config: MongoBranchConfig;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
  }

  /**
   * Diff two branches. Returns structured result with per-collection changes.
   * Compares source branch against target branch.
   */
  async diffBranches(sourceBranch: string, targetBranch: string): Promise<DiffResult> {
    const sourceDb = await this.resolveDb(sourceBranch);
    const targetDb = await this.resolveDb(targetBranch);

    // For lazy branches, only diff materialized collections (others are identical)
    const sourceMeta = await this.getBranchMeta(sourceBranch);
    const targetMeta = await this.getBranchMeta(targetBranch);

    // Get collections from both branches
    const sourceCollections = await this.getUserCollections(sourceDb);
    const targetCollections = await this.getUserCollections(targetDb);

    // Only diff collections that exist on the SOURCE branch.
    // Collections that only exist on the target (e.g., added by previous merges)
    // should NOT be touched — the branch didn't make those changes.
    // For lazy branches, restrict further to only materialized collections.
    const allCollections: Set<string> = sourceMeta?.lazy
      ? new Set(sourceMeta.materializedCollections ?? [])
      : new Set(sourceCollections);

    const collections: Record<string, CollectionDiff> = {};
    let totalChanges = 0;

    for (const collName of allCollections) {
      const collDiff = await this.diffCollection(sourceDb, targetDb, collName);
      const changeCount =
        collDiff.added.length + collDiff.removed.length + collDiff.modified.length;

      if (changeCount > 0) {
        collections[collName] = collDiff;
        totalChanges += changeCount;
      }
    }

    // Compare indexes across collections
    const indexChanges: Record<string, IndexDiff> = {};
    let hasIndexChanges = false;
    for (const collName of allCollections) {
      const idxDiff = await this.diffIndexes(sourceDb, targetDb, collName);
      if (idxDiff.added.length > 0 || idxDiff.removed.length > 0) {
        hasIndexChanges = true;
      }
      indexChanges[collName] = idxDiff;
    }

    // Compare validation rules across collections
    const validationChanges: Record<string, ValidationDiff> = {};
    let hasValidationChanges = false;
    for (const collName of allCollections) {
      const valDiff = await this.diffValidation(sourceDb, targetDb, collName);
      if (valDiff.changed) {
        hasValidationChanges = true;
        validationChanges[collName] = valDiff;
      }
    }

    return {
      sourceBranch,
      targetBranch,
      totalChanges,
      collections,
      ...(hasIndexChanges ? { indexChanges } : {}),
      ...(hasValidationChanges ? { validationChanges } : {}),
    };
  }

  /**
   * Diff a single collection between two databases.
   * Uses _id as the join key to match documents.
   */
  private async diffCollection(
    sourceDb: Db,
    targetDb: Db,
    collName: string
  ): Promise<CollectionDiff> {
    // Stream documents via cursor (memory-efficient for large collections)
    const sourceMap = new Map<string, Record<string, unknown>>();
    const targetMap = new Map<string, Record<string, unknown>>();

    const sourceCursor = sourceDb.collection(collName).find({});
    for await (const doc of sourceCursor) {
      sourceMap.set(doc._id.toString(), doc as Record<string, unknown>);
    }

    const targetCursor = targetDb.collection(collName).find({});
    for await (const doc of targetCursor) {
      targetMap.set(doc._id.toString(), doc as Record<string, unknown>);
    }

    const added: CollectionDiff["added"] = [];
    const removed: CollectionDiff["removed"] = [];
    const modified: ModifiedDocument[] = [];

    // Documents in source but not target → added
    for (const [id, doc] of sourceMap) {
      if (!targetMap.has(id)) {
        added.push(doc);
      }
    }

    // Documents in target but not source → removed
    for (const [id, doc] of targetMap) {
      if (!sourceMap.has(id)) {
        removed.push(doc);
      }
    }

    // Documents in both → check for modifications
    for (const [id, sourceDoc] of sourceMap) {
      const targetDoc = targetMap.get(id);
      if (!targetDoc) continue;

      const delta = jdpDiff(targetDoc, sourceDoc);
      if (delta) {
        modified.push({
          _id: sourceDoc._id,
          fields: this.extractFieldChanges(delta, targetDoc, sourceDoc),
        });
      }
    }

    return { added, removed, modified };
  }

  /**
   * Extract human-readable field changes from a jsondiffpatch delta.
   * Converts delta format into { field: { from, to } } map.
   */
  private extractFieldChanges(
    delta: Record<string, unknown>,
    oldDoc: Record<string, unknown>,
    newDoc: Record<string, unknown>
  ): Record<string, { from: unknown; to: unknown }> {
    const fields: Record<string, { from: unknown; to: unknown }> = {};

    for (const key of Object.keys(delta)) {
      if (key === "_id" || key === "_t") continue;

      const change = delta[key];
      if (Array.isArray(change)) {
        if (change.length === 2) {
          // [oldValue, newValue] — field modified
          fields[key] = { from: change[0], to: change[1] };
        } else if (change.length === 1) {
          // [newValue] — field added
          fields[key] = { from: undefined, to: change[0] };
        } else if (change.length === 3 && change[2] === 0) {
          // [oldValue, 0, 0] — field deleted
          fields[key] = { from: change[0], to: undefined };
        }
      } else {
        // Nested object change — use raw values
        fields[key] = { from: oldDoc[key], to: newDoc[key] };
      }
    }

    return fields;
  }

  /**
   * Compare indexes between source and target for a single collection.
   * Ignores the default `_id_` index.
   */
  private async diffIndexes(
    sourceDb: Db,
    targetDb: Db,
    collName: string
  ): Promise<IndexDiff> {
    const toInfo = (idx: any): IndexInfo => ({
      name: idx.name as string,
      key: idx.key as Record<string, number>,
      ...(idx.unique ? { unique: true } : {}),
      ...(idx.sparse ? { sparse: true } : {}),
    });

    let sourceIndexes: IndexInfo[] = [];
    let targetIndexes: IndexInfo[] = [];

    try {
      const rawSource = await sourceDb.collection(collName).indexes();
      sourceIndexes = rawSource.filter((i) => i.name !== "_id_").map(toInfo);
    } catch { /* collection may not exist on source */ }

    try {
      const rawTarget = await targetDb.collection(collName).indexes();
      targetIndexes = rawTarget.filter((i) => i.name !== "_id_").map(toInfo);
    } catch { /* collection may not exist on target */ }

    const sourceNames = new Set(sourceIndexes.map((i) => i.name));
    const targetNames = new Set(targetIndexes.map((i) => i.name));

    const added = sourceIndexes.filter((i) => !targetNames.has(i.name));
    const removed = targetIndexes.filter((i) => !sourceNames.has(i.name));

    return { added, removed };
  }

  /**
   * Compare validation rules between source and target for a single collection.
   */
  private async diffValidation(
    sourceDb: Db,
    targetDb: Db,
    collName: string
  ): Promise<ValidationDiff> {
    const getValidation = async (db: Db, name: string): Promise<ValidationRule | null> => {
      try {
        const colls = await db.listCollections({ name }).toArray();
        if (colls.length === 0) return null;
        const info = colls[0];
        const hasValidation = info.options?.validator ||
          info.options?.validationLevel ||
          info.options?.validationAction;
        if (!hasValidation) return null;
        return {
          validator: info.options?.validator,
          validationLevel: info.options?.validationLevel,
          validationAction: info.options?.validationAction,
        };
      } catch { return null; }
    };

    const source = await getValidation(sourceDb, collName);
    const target = await getValidation(targetDb, collName);

    const changed = JSON.stringify(source) !== JSON.stringify(target);
    return { source, target, changed };
  }

  /**
   * Three-way diff: Compare base → ours and base → theirs.
   * Identifies non-conflicting changes and per-field conflicts.
   */
  async diff3(
    baseDbName: string,
    oursDbName: string,
    theirsDbName: string
  ): Promise<Diff3Result> {
    const baseDb = this.client.db(baseDbName);
    const oursDb = this.client.db(oursDbName);
    const theirsDb = this.client.db(theirsDbName);

    const result: Diff3Result = {
      additions: [],
      deletions: [],
      modifications: [],
      conflicts: [],
      collectionsAffected: new Set(),
    };

    // Get all user collections across all three DBs
    const baseCols = await this.getUserCollections(baseDb);
    const oursCols = await this.getUserCollections(oursDb);
    const theirsCols = await this.getUserCollections(theirsDb);
    const allCols = new Set([...baseCols, ...oursCols, ...theirsCols]);

    for (const colName of allCols) {
      const baseColl = baseDb.collection(colName);
      const oursColl = oursDb.collection(colName);
      const theirsColl = theirsDb.collection(colName);

      // Build doc maps for each version
      const baseDocs = await this.buildDocMap(baseColl);
      const oursDocs = await this.buildDocMap(oursColl);
      const theirsDocs = await this.buildDocMap(theirsColl);

      const allIds = new Set([...baseDocs.keys(), ...oursDocs.keys(), ...theirsDocs.keys()]);

      for (const id of allIds) {
        const baseDoc = baseDocs.get(id);
        const oursDoc = oursDocs.get(id);
        const theirsDoc = theirsDocs.get(id);
        // Use original _id from any available doc (for correct MongoDB queries)
        const originalId = (baseDoc ?? oursDoc ?? theirsDoc)?._id;

        // Case 1: Only "theirs" added (not in base, not in ours)
        if (!baseDoc && !oursDoc && theirsDoc) {
          result.additions.push({ collection: colName, doc: theirsDoc });
          result.collectionsAffected.add(colName);
          continue;
        }

        // Case 2: Only "ours" added — already in target, skip
        if (!baseDoc && oursDoc && !theirsDoc) continue;

        // Case 3: Both added the same doc — check for conflicts
        if (!baseDoc && oursDoc && theirsDoc) {
          this.mergeDocFields(colName, originalId, {}, oursDoc, theirsDoc, result);
          continue;
        }

        // Case 4: Theirs deleted (was in base but not in theirs)
        if (baseDoc && oursDoc && !theirsDoc) {
          if (JSON.stringify(baseDoc) !== JSON.stringify(oursDoc)) {
            result.conflicts.push({
              collection: colName, documentId: originalId, field: "_deleted",
              base: baseDoc, ours: oursDoc, theirs: null,
            });
          } else {
            result.deletions.push({ collection: colName, docId: originalId });
          }
          result.collectionsAffected.add(colName);
          continue;
        }

        // Case 5: Ours deleted — already absent from target, skip
        if (baseDoc && !oursDoc && theirsDoc) {
          if (JSON.stringify(baseDoc) !== JSON.stringify(theirsDoc)) {
            result.conflicts.push({
              collection: colName, documentId: originalId, field: "_deleted",
              base: baseDoc, ours: null, theirs: theirsDoc,
            });
          }
          continue;
        }

        // Case 6: Both have it — check for modifications
        if (baseDoc && oursDoc && theirsDoc) {
          this.mergeDocFields(colName, originalId, baseDoc, oursDoc, theirsDoc, result);
          continue;
        }
      }
    }

    return result;
  }

  /**
   * Compare fields of a document across base/ours/theirs.
   * Auto-merges non-overlapping changes. Flags conflicts on same-field different-value.
   */
  private mergeDocFields(
    collection: string,
    docId: unknown,
    base: Record<string, unknown>,
    ours: Record<string, unknown>,
    theirs: Record<string, unknown>,
    result: Diff3Result
  ): void {
    const allFields = new Set([
      ...Object.keys(base),
      ...Object.keys(ours),
      ...Object.keys(theirs),
    ]);

    const mergedFields: Record<string, unknown> = {};
    let hasChanges = false;
    let hasConflicts = false;

    for (const field of allFields) {
      if (field === "_id") continue;

      const bVal = JSON.stringify(base[field]);
      const oVal = JSON.stringify(ours[field]);
      const tVal = JSON.stringify(theirs[field]);

      if (bVal === oVal && bVal === tVal) continue; // No change
      if (bVal === oVal && bVal !== tVal) {
        // Only theirs changed — take theirs
        mergedFields[field] = theirs[field];
        hasChanges = true;
      } else if (bVal !== oVal && bVal === tVal) {
        // Only ours changed — already in target, skip
        continue;
      } else if (oVal === tVal) {
        // Both changed to same value — no conflict
        continue;
      } else {
        // Both changed to different values — CONFLICT
        result.conflicts.push({
          collection, documentId: docId, field,
          base: base[field], ours: ours[field], theirs: theirs[field],
        });
        hasConflicts = true;
      }
    }

    if (hasChanges && !hasConflicts) {
      result.modifications.push({ collection, docId, mergedFields });
      result.collectionsAffected.add(collection);
    }
  }

  private async buildDocMap(coll: { find: Function }): Promise<Map<string, Record<string, unknown>>> {
    const docs = await coll.find({}).toArray();
    const map = new Map<string, Record<string, unknown>>();
    for (const doc of docs) {
      map.set(doc._id.toString(), doc as Record<string, unknown>);
    }
    return map;
  }

  private async getBranchMeta(branchName: string): Promise<BranchMetadata | null> {
    if (branchName === MAIN_BRANCH) return null;
    return this.client
      .db(this.config.metaDatabase)
      .collection<BranchMetadata>(META_COLLECTION)
      .findOne({ name: branchName, status: "active" });
  }

  private async resolveDb(branchName: string): Promise<Db> {
    if (branchName === MAIN_BRANCH) {
      return this.client.db(this.config.sourceDatabase);
    }
    const meta = await this.getBranchMeta(branchName);
    if (!meta) throw new Error(`Branch "${branchName}" not found`);
    return this.client.db(meta.branchDatabase as string);
  }

  private async getUserCollections(db: Db): Promise<string[]> {
    const colls = await db.listCollections().toArray();
    return colls.filter((c) => !c.name.startsWith("system.")).map((c) => c.name);
  }
}
