/**
 * MongoBranch — Branch-Scoped CRUD Proxy
 *
 * Provides insert/find/update/delete/aggregate/count operations scoped to a branch.
 * Automatically materializes lazy collections and records operations.
 */
import type { MongoClient, Db, Document, Filter, UpdateFilter, OptionalUnlessRequiredId } from "mongodb";
import { ObjectId } from "mongodb";
import type { MongoBranchConfig, BranchMetadata, ScopePermission } from "./types.ts";
import { META_COLLECTION, MAIN_BRANCH } from "./types.ts";
import { BranchManager } from "./branch.ts";
import { OperationLog } from "./oplog.ts";
import { ProtectionManager } from "./protection.ts";
import { ScopeManager } from "./scope.ts";

export class BranchProxy {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private branchManager: BranchManager;
  private oplog: OperationLog;
  private protectionManager: ProtectionManager;
  private scopeManager: ScopeManager;

  constructor(
    client: MongoClient,
    config: MongoBranchConfig,
    branchManager: BranchManager,
    oplog: OperationLog
  ) {
    this.client = client;
    this.config = config;
    this.branchManager = branchManager;
    this.oplog = oplog;
    this.protectionManager = new ProtectionManager(client, config);
    this.scopeManager = new ScopeManager(client, config);
  }

  /**
   * Insert a document into a branch collection.
   * Auto-materializes lazy branches.
   */
  async insertOne(
    branchName: string,
    collection: string,
    doc: Record<string, unknown>,
    performedBy?: string
  ): Promise<{ insertedId: string }> {
    await this.assertWriteAllowed(branchName, collection, performedBy, "write");
    await this.ensureMaterialized(branchName, collection);
    const db = await this.resolveBranchDb(branchName);

    const result = await db.collection(collection).insertOne(doc as any);
    const insertedId = result.insertedId.toString();

    await this.oplog.record({
      branchName,
      collection,
      operation: "insert",
      documentId: insertedId,
      after: { ...doc, _id: result.insertedId },
      performedBy,
    });

    return { insertedId };
  }

  /**
   * Update a document on a branch collection.
   * Uses findOneAndUpdate for atomic before-state capture (Section 1.11).
   */
  async updateOne(
    branchName: string,
    collection: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    performedBy?: string
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    await this.assertWriteAllowed(branchName, collection, performedBy, "write");
    await this.ensureMaterialized(branchName, collection);
    const db = await this.resolveBranchDb(branchName);
    const coll = db.collection(collection);

    // Atomic: capture before-state AND apply update in one round-trip
    const before = await coll.findOneAndUpdate(
      filter as any,
      update as any,
      { returnDocument: "before" }
    );

    if (before) {
      // Fetch the after-state (now guaranteed consistent since update already applied)
      const after = await coll.findOne({ _id: before._id });
      await this.oplog.record({
        branchName,
        collection,
        operation: "update",
        documentId: before._id.toString(),
        before: before as Record<string, unknown>,
        after: after as Record<string, unknown> | undefined,
        performedBy,
      });
      return { matchedCount: 1, modifiedCount: 1 };
    }

    return { matchedCount: 0, modifiedCount: 0 };
  }

  /**
   * Delete a document from a branch collection.
   * Uses findOneAndDelete for atomic before-state capture (Section 1.12).
   */
  async deleteOne(
    branchName: string,
    collection: string,
    filter: Record<string, unknown>,
    performedBy?: string
  ): Promise<{ deletedCount: number }> {
    await this.assertWriteAllowed(branchName, collection, performedBy, "delete");
    await this.ensureMaterialized(branchName, collection);
    const db = await this.resolveBranchDb(branchName);
    const coll = db.collection(collection);

    // Atomic: capture before-state AND delete in one round-trip
    const before = await coll.findOneAndDelete(filter as any);

    if (before) {
      await this.oplog.record({
        branchName,
        collection,
        operation: "delete",
        documentId: before._id.toString(),
        before: before as Record<string, unknown>,
        performedBy,
      });
      return { deletedCount: 1 };
    }

    return { deletedCount: 0 };
  }

  /**
   * Find documents on a branch (reads from source for unmaterialized lazy collections).
   */
  async find(
    branchName: string,
    collection: string,
    filter: Record<string, unknown> = {},
    options?: { limit?: number; sort?: Record<string, 1 | -1> }
  ): Promise<Record<string, unknown>[]> {
    const db = await this.resolveReadDb(branchName, collection);
    let cursor = db.collection(collection).find(filter as any);
    if (options?.sort) cursor = cursor.sort(options.sort);
    if (options?.limit) cursor = cursor.limit(options.limit);
    return cursor.toArray() as Promise<Record<string, unknown>[]>;
  }

  /**
   * Run an aggregation pipeline on a branch collection.
   * Read-only — uses resolveReadDb for lazy branch support.
   * API: collection.aggregate(pipeline).toArray()
   * @see https://mongodb.github.io/node-mongodb-native/6.16/classes/Collection.html#aggregate
   */
  async aggregate(
    branchName: string,
    collection: string,
    pipeline: Record<string, unknown>[]
  ): Promise<Record<string, unknown>[]> {
    const db = await this.resolveReadDb(branchName, collection);
    return db.collection(collection).aggregate(pipeline as Document[]).toArray() as Promise<Record<string, unknown>[]>;
  }

  /**
   * Count documents matching a filter on a branch collection.
   * Read-only — uses resolveReadDb for lazy branch support.
   * API: collection.countDocuments(filter)
   * @see https://mongodb.github.io/node-mongodb-native/6.16/classes/Collection.html#countDocuments
   */
  async countDocuments(
    branchName: string,
    collection: string,
    filter: Record<string, unknown> = {}
  ): Promise<number> {
    const db = await this.resolveReadDb(branchName, collection);
    return db.collection(collection).countDocuments(filter as any);
  }

  /**
   * List collections in the branch database.
   * For lazy branches, merges parent collections + materialized collections.
   * API: db.listCollections().toArray()
   * @see https://mongodb.github.io/node-mongodb-native/6.16/classes/Db.html#listCollections
   */
  async listCollections(
    branchName: string
  ): Promise<{ name: string; type: string }[]> {
    const meta = await this.getMeta(branchName);
    if (!meta) throw new Error(`Branch "${branchName}" not found`);

    if (meta.lazy) {
      // For lazy branches: merge parent-visible collections + materialized collections.
      // Nested lazy branches must inherit the parent's visible state, not always root main.
      const parentCols = meta.parentBranch && meta.parentBranch !== MAIN_BRANCH
        ? await this.listCollections(meta.parentBranch)
        : await this.listDbCollections(this.client.db(this.config.sourceDatabase));
      const branchDb = this.client.db(meta.branchDatabase);
      const branchCols = await this.listDbCollections(branchDb);

      // Merge: branch collections override parent-visible collections
      const colMap = new Map<string, string>();
      for (const c of parentCols) colMap.set(c.name, c.type);
      for (const c of branchCols) colMap.set(c.name, c.type);
      return Array.from(colMap.entries()).map(([name, type]) => ({ name, type }));
    }

    return this.listDbCollections(this.client.db(meta.branchDatabase));
  }

  /**
   * Update multiple documents on a branch collection.
   * Records a single oplog entry for the batch operation.
   * API: collection.updateMany(filter, update)
   * @see https://mongodb.github.io/node-mongodb-native/6.16/classes/Collection.html#updateMany
   */
  async updateMany(
    branchName: string,
    collection: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    performedBy?: string
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    await this.assertWriteAllowed(branchName, collection, performedBy, "write");
    await this.ensureMaterialized(branchName, collection);
    const db = await this.resolveBranchDb(branchName);
    const coll = db.collection(collection);

    const result = await coll.updateMany(filter as any, update as any);

    await this.oplog.record({
      branchName,
      collection,
      operation: "update",
      documentId: `batch:${result.matchedCount}`,
      before: { filter, matchedCount: result.matchedCount },
      after: { update, modifiedCount: result.modifiedCount },
      performedBy,
    });

    return {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    };
  }

  /**
   * Infer the schema of a branch collection by sampling documents.
   * Samples up to `sampleSize` documents and extracts field names + types.
   * Uses $sample aggregation stage for random sampling.
   * @see https://mongodb.github.io/node-mongodb-native/6.16/classes/Collection.html#aggregate
   */
  async inferSchema(
    branchName: string,
    collection: string,
    sampleSize: number = 100
  ): Promise<{ fields: Record<string, { types: string[]; count: number }>; totalSampled: number }> {
    const db = await this.resolveReadDb(branchName, collection);
    const docs = await db.collection(collection)
      .aggregate([{ $sample: { size: sampleSize } }])
      .toArray();

    const fields: Record<string, { types: Set<string>; count: number }> = {};

    for (const doc of docs) {
      for (const [key, value] of Object.entries(doc)) {
        if (!fields[key]) {
          fields[key] = { types: new Set(), count: 0 };
        }
        const field = fields[key]!;
        field.count++;
        if (value === null) field.types.add("null");
        else if (Array.isArray(value)) field.types.add("array");
        else if (value instanceof Date) field.types.add("date");
        else if (value instanceof ObjectId) field.types.add("objectId");
        else field.types.add(typeof value);
      }
    }

    // Convert Sets to arrays for JSON serialization
    const result: Record<string, { types: string[]; count: number }> = {};
    for (const [key, val] of Object.entries(fields)) {
      result[key] = { types: Array.from(val.types), count: val.count };
    }

    return { fields: result, totalSampled: docs.length };
  }

  /**
   * Ensure a collection is materialized on a lazy branch before writing.
   */
  private async ensureMaterialized(branchName: string, collection: string): Promise<void> {
    const meta = await this.getMeta(branchName);
    if (!meta) throw new Error(`Branch "${branchName}" not found`);

    if (meta.lazy) {
      await this.branchManager.materializeCollection(branchName, collection);
    }
  }

  /**
   * Resolve the branch database for writes (always the branch DB).
   */
  private async resolveBranchDb(branchName: string): Promise<Db> {
    const meta = await this.getMeta(branchName);
    if (!meta) throw new Error(`Branch "${branchName}" not found`);
    return this.client.db(meta.branchDatabase);
  }

  /**
   * Resolve the read database — for lazy branches, unmaterialized collections
   * read from the source (parent) database.
   */
  private async resolveReadDb(branchName: string, collection: string): Promise<Db> {
    const meta = await this.getMeta(branchName);
    if (!meta) throw new Error(`Branch "${branchName}" not found`);

    if (meta.lazy) {
      const materialized = meta.materializedCollections ?? [];
      if (!materialized.includes(collection)) {
        const parentBranch = meta.parentBranch ?? MAIN_BRANCH;
        if (parentBranch === MAIN_BRANCH) {
          return this.client.db(this.config.sourceDatabase);
        }
        return this.resolveReadDb(parentBranch, collection);
      }
    }

    return this.client.db(meta.branchDatabase);
  }

  private async assertWriteAllowed(
    branchName: string,
    collection: string,
    performedBy: string | undefined,
    operation: ScopePermission
  ): Promise<void> {
    const meta = await this.getMeta(branchName);
    if (!meta) throw new Error(`Branch "${branchName}" not found`);
    if (meta.readOnly) throw new Error(`Branch "${branchName}" is read-only`);

    const protection = await this.protectionManager.checkWritePermission(branchName, false);
    if (!protection.allowed) {
      throw new Error(protection.reason ?? `Writes are blocked on "${branchName}"`);
    }

    if (!performedBy) return;

    const scope = await this.scopeManager.checkPermission(performedBy, collection, operation);
    if (scope.allowed) return;

    await this.scopeManager.logViolation({
      agentId: performedBy,
      branchName,
      collection,
      operation,
      reason: scope.reason ?? "permission denied",
    }).catch(() => {});

    throw new Error(scope.reason ?? `Agent "${performedBy}" is not allowed to ${operation} ${collection}`);
  }

  private async listDbCollections(db: Db): Promise<{ name: string; type: string }[]> {
    const cols = await db.listCollections().toArray();
    return cols
      .filter((c) => c.name !== META_COLLECTION)
      .map((c) => ({ name: c.name, type: c.type ?? "collection" }));
  }

  private async getMeta(branchName: string): Promise<BranchMetadata | null> {
    return this.client
      .db(this.config.metaDatabase)
      .collection<BranchMetadata>(META_COLLECTION)
      .findOne({ name: branchName, status: "active" });
  }
}
