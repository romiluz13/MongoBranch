/**
 * MongoBranch — Branch-Scoped CRUD Proxy
 *
 * Provides insert/update/delete operations scoped to a branch.
 * Automatically materializes lazy collections and records operations.
 */
import type { MongoClient, Db, Document, Filter, UpdateFilter, OptionalUnlessRequiredId } from "mongodb";
import { ObjectId } from "mongodb";
import type { MongoBranchConfig, BranchMetadata } from "./types.ts";
import { META_COLLECTION, MAIN_BRANCH } from "./types.ts";
import { BranchManager } from "./branch.ts";
import { OperationLog } from "./oplog.ts";

export class BranchProxy {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private branchManager: BranchManager;
  private oplog: OperationLog;

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
   */
  async updateOne(
    branchName: string,
    collection: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    performedBy?: string
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    await this.ensureMaterialized(branchName, collection);
    const db = await this.resolveBranchDb(branchName);
    const coll = db.collection(collection);

    // Capture before state
    const before = await coll.findOne(filter as any);

    const result = await coll.updateOne(filter as any, update as any);

    if (before && result.modifiedCount > 0) {
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
    }

    return {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    };
  }

  /**
   * Delete a document from a branch collection.
   */
  async deleteOne(
    branchName: string,
    collection: string,
    filter: Record<string, unknown>,
    performedBy?: string
  ): Promise<{ deletedCount: number }> {
    await this.ensureMaterialized(branchName, collection);
    const db = await this.resolveBranchDb(branchName);
    const coll = db.collection(collection);

    // Capture before state
    const before = await coll.findOne(filter as any);

    const result = await coll.deleteOne(filter as any);

    if (before && result.deletedCount > 0) {
      await this.oplog.record({
        branchName,
        collection,
        operation: "delete",
        documentId: before._id.toString(),
        before: before as Record<string, unknown>,
        performedBy,
      });
    }

    return { deletedCount: result.deletedCount };
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
   * Ensure a collection is materialized on a lazy branch before writing.
   */
  private async ensureMaterialized(branchName: string, collection: string): Promise<void> {
    const meta = await this.getMeta(branchName);
    if (!meta) throw new Error(`Branch "${branchName}" not found`);
    if (meta.readOnly) throw new Error(`Branch "${branchName}" is read-only`);

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
        // Read from source
        return this.client.db(this.config.sourceDatabase);
      }
    }

    return this.client.db(meta.branchDatabase);
  }

  private async getMeta(branchName: string): Promise<BranchMetadata | null> {
    return this.client
      .db(this.config.metaDatabase)
      .collection<BranchMetadata>(META_COLLECTION)
      .findOne({ name: branchName, status: "active" });
  }
}
