/**
 * MongoBranch — Branch Engine
 *
 * Creates, lists, switches, and deletes MongoDB database branches.
 * Each branch = a separate database with copied data from source.
 */
import { MongoServerError } from "mongodb";
import type { MongoClient, Db } from "mongodb";
import {
  type BranchMetadata,
  type BranchCreateOptions,
  type BranchListOptions,
  type BranchSwitchResult,
  type BranchDeleteResult,
  type BranchRollbackResult,
  type MongoBranchConfig,
  MAIN_BRANCH,
  META_COLLECTION,
  COMMITS_COLLECTION,
  sanitizeBranchDbName,
} from "./types.ts";

const BRANCH_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._\-\/]*$/;

export class BranchManager {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private currentBranch: string = MAIN_BRANCH;
  private metaDb: Db;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
    this.metaDb = client.db(config.metaDatabase);
  }

  async initialize(): Promise<void> {
    const col = this.metaDb.collection(META_COLLECTION);

    // $jsonSchema validation: prevent malformed branch metadata (14.3)
    await this.metaDb.command({
      collMod: META_COLLECTION,
      validator: {
        $jsonSchema: {
          bsonType: "object",
          required: ["name", "status", "branchDatabase", "createdAt"],
          properties: {
            name: { bsonType: "string", minLength: 1, maxLength: 200 },
            status: { enum: ["active", "merged", "deleted"] },
            branchDatabase: { bsonType: "string" },
            parentBranch: { bsonType: "string" },
            headCommit: { bsonType: "string" },
            createdAt: { bsonType: "date" },
            updatedAt: { bsonType: "date" },
          },
        },
      },
      validationLevel: "moderate", // Only validate inserts + updates, not existing docs
      validationAction: "error",
    }).catch(() => {}); // Collection may not exist yet on first run

    // Migrate: drop any old-style unique index on name (without partial filter)
    // that blocks re-creation of deleted branches.
    try {
      const indexes = await col.indexes();
      for (const idx of indexes) {
        const key = idx.key as Record<string, unknown> | undefined;
        if (key?.name === 1 && idx.unique) {
          // Check if it's the old non-partial index OR a stale partial index
          const pf = idx.partialFilterExpression as Record<string, unknown> | undefined;
          const isOldStyle = !pf;
          const isStalePartial = pf && JSON.stringify(pf) !== JSON.stringify({ status: "active" });
          if (isOldStyle || isStalePartial) {
            await col.dropIndex(idx.name!).catch(() => {});
          }
        }
      }
    } catch {
      // Collection may not exist yet — fine
    }

    // Partial unique index: only enforce uniqueness for active branches.
    // Deleted/merged branches don't block re-creation of the same name.
    // Collation strength:2 = case-insensitive (Feature/X and feature/x collide).
    await col.createIndex(
      { name: 1 },
      {
        unique: true,
        partialFilterExpression: { status: "active" },
        collation: { locale: "en", strength: 2 },
      }
    ).catch(() => {
      // Index may already exist with correct definition — fine
    });

    // TTL index: automatically expire branches based on expiresAt field.
    // MongoDB's background thread deletes expired documents every 60 seconds.
    await col.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 }
    ).catch(() => {
      // Index may already exist — fine
    });
  }

  getCurrentBranch(): string {
    return this.currentBranch;
  }

  async createBranch(options: BranchCreateOptions): Promise<BranchMetadata> {
    const { name, description, createdBy } = options;
    const from = options.from ?? MAIN_BRANCH;

    this.validateBranchName(name);

    const existing = await this.metaDb
      .collection(META_COLLECTION)
      .findOne({ name, status: { $ne: "deleted" } });
    if (existing) {
      throw new Error(`Branch "${name}" already exists`);
    }

    // Clean up old deleted records with the same name
    await this.metaDb.collection(META_COLLECTION).deleteMany({ name, status: "deleted" });

    // Sanitize branch name for MongoDB database name
    // Per MongoDB docs: /\."$ are invalid in database names on Unix/Linux
    const safeName = sanitizeBranchDbName(name);
    const branchDatabase = `${this.config.branchPrefix}${safeName}`;
    const sourceDb = this.resolveDatabase(from);
    const branchDb = this.client.db(branchDatabase);

    // Drop any leftover branch database from a previous (deleted) branch.
    // Wait for async drop to complete — Atlas Local can be slow.
    try {
      await branchDb.dropDatabase();
      // Wait for drop to propagate, then verify it's gone
      for (let i = 0; i < 10; i++) {
        const colls = await branchDb.listCollections().toArray();
        if (colls.length === 0) break;
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch {
      // Database may not exist — fine
    }

    // Discover collections in source (exclude system collections)
    const collectionInfos = await sourceDb.listCollections().toArray();
    let collections = collectionInfos
      .filter((c) => !c.name.startsWith("system."))
      .map((c) => c.name);

    // Partial branching: filter to only requested collections
    if (options.collections && options.collections.length > 0) {
      const requested = new Set(options.collections);
      const available = new Set(collections);
      const missing = options.collections.filter((c) => !available.has(c));
      if (missing.length > 0) {
        throw new Error(`Collections not found in source: ${missing.join(", ")}`);
      }
      collections = collections.filter((c) => requested.has(c));
    }

    const isLazy = options.lazy ?? false;
    const isSchemaOnly = options.schemaOnly ?? false;

    // Copy collections unless lazy mode (copy-on-write)
    if (!isLazy) {
      if (isSchemaOnly) {
        await this.copySchemaOnly(sourceDb, branchDb, collections);
      } else {
        await this.copyCollections(sourceDb, branchDb, collections);
      }
    }

    // Calculate nesting depth
    let parentDepth = 0;
    if (from !== MAIN_BRANCH) {
      const parentMeta = await this.metaDb
        .collection<BranchMetadata>(META_COLLECTION)
        .findOne({ name: from, status: { $ne: "deleted" } });
      if (parentMeta) {
        parentDepth = (parentMeta.parentDepth ?? 0) + 1;
      }
      const maxDepth = options.maxDepth ?? 5;
      if (parentDepth > maxDepth) {
        throw new Error(`Max branch nesting depth (${maxDepth}) exceeded. Current depth would be ${parentDepth}`);
      }
    }

    const now = new Date();
    const metadata: BranchMetadata = {
      name,
      parentBranch: from === MAIN_BRANCH ? MAIN_BRANCH : from,
      sourceDatabase: this.config.sourceDatabase,
      branchDatabase,
      status: "active",
      createdAt: now,
      updatedAt: now,
      createdBy: createdBy ?? "unknown",
      collections,
      description,
      parentDepth,
      ...(options.readOnly ? { readOnly: true } : {}),
      ...(isLazy ? { lazy: true, materializedCollections: [] } : {}),
      ...(options.ttlMinutes ? { expiresAt: new Date(now.getTime() + options.ttlMinutes * 60_000) } : {}),
    };

    await this.metaDb.collection(META_COLLECTION).insertOne({ ...metadata });
    return metadata;
  }

  /**
   * Get a single branch by name.
   */
  async getBranch(name: string): Promise<BranchMetadata | null> {
    return this.metaDb
      .collection<BranchMetadata>(META_COLLECTION)
      .findOne({ name, status: { $ne: "deleted" } });
  }

  /**
   * Get branch metadata enriched with head commit info via $lookup.
   * Single query instead of two separate lookups.
   */
  async getBranchWithHead(name: string): Promise<(BranchMetadata & {
    headCommitInfo?: { message: string; author: string; timestamp: Date; parentHashes: string[] };
  }) | null> {
    const results = await this.metaDb
      .collection<BranchMetadata>(META_COLLECTION)
      .aggregate([
        { $match: { name, status: { $ne: "deleted" } } },
        { $lookup: {
            from: COMMITS_COLLECTION,
            localField: "headCommit",
            foreignField: "hash",
            as: "_headCommitDocs",
        }},
        { $addFields: {
            headCommitInfo: { $arrayElemAt: ["$_headCommitDocs", 0] },
        }},
        { $project: { _headCommitDocs: 0 } },
      ])
      .toArray();

    return (results[0] as any) ?? null;
  }

  /**
   * Get storage stats for a branch database using $collStats.
   * Returns per-collection sizes and totals in a single server-side pipeline.
   */
  async getBranchStats(branchName: string): Promise<{
    totalDocuments: number;
    totalStorageBytes: number;
    collections: Array<{ name: string; count: number; storageBytes: number }>;
  }> {
    const db = this.resolveDatabase(branchName);
    const collNames = (await db.listCollections().toArray())
      .map((c) => c.name)
      .filter((n) => !n.startsWith("system."));

    let totalDocuments = 0;
    let totalStorageBytes = 0;
    const collections: Array<{ name: string; count: number; storageBytes: number }> = [];

    for (const name of collNames) {
      const [stats] = await db.collection(name).aggregate([
        { $collStats: { storageStats: {} } },
      ]).toArray().catch(() => [null]);

      if (stats?.storageStats) {
        const count = stats.storageStats.count ?? 0;
        const storageBytes = stats.storageStats.size ?? 0;
        totalDocuments += count;
        totalStorageBytes += storageBytes;
        collections.push({ name, count, storageBytes });
      } else {
        // Fallback: use estimatedDocumentCount
        const count = await db.collection(name).estimatedDocumentCount();
        totalDocuments += count;
        collections.push({ name, count, storageBytes: 0 });
      }
    }

    return { totalDocuments, totalStorageBytes, collections };
  }

  /**
   * Quick branch summary using estimatedDocumentCount (1.15).
   * Much faster than countDocuments for approximate totals.
   */
  async getBranchSummary(): Promise<{
    totalBranches: number;
    activeBranches: number;
  }> {
    const col = this.metaDb.collection(META_COLLECTION);
    const total = await col.estimatedDocumentCount();
    const active = await col.countDocuments({ status: "active" });
    return { totalBranches: total, activeBranches: active };
  }

  /**
   * Comprehensive system status: active branches, storage, recent activity.
   */
  async getSystemStatus(): Promise<{
    activeBranches: number;
    mergedBranches: number;
    totalStorageBytes: number;
    branches: Array<{
      name: string;
      status: string;
      createdAt: Date;
      collections: number;
      storageBytes: number;
      lazy: boolean;
      readOnly: boolean;
    }>;
    recentActivity: Date | null;
  }> {
    const all = await this.metaDb
      .collection<BranchMetadata>(META_COLLECTION)
      .find({ status: { $ne: "deleted" } })
      .sort({ createdAt: -1 })
      .toArray();

    let totalStorageBytes = 0;
    const branches: Array<{
      name: string; status: string; createdAt: Date;
      collections: number; storageBytes: number; lazy: boolean; readOnly: boolean;
    }> = [];

    for (const b of all) {
      let storageBytes = 0;
      if (b.status === "active") {
        try {
          const stats = await this.getBranchStats(b.name);
          storageBytes = stats.totalStorageBytes;
        } catch { /* branch DB may not exist yet for lazy */ }
      }
      totalStorageBytes += storageBytes;
      branches.push({
        name: b.name,
        status: b.status,
        createdAt: b.createdAt,
        collections: b.collections?.length ?? 0,
        storageBytes,
        lazy: !!(b as any).lazy,
        readOnly: !!(b as any).readOnly,
      });
    }

    const active = all.filter((b) => b.status === "active").length;
    const merged = all.filter((b) => b.status === "merged").length;
    const recentActivity = all.length > 0 ? all[0].updatedAt : null;

    return { activeBranches: active, mergedBranches: merged, totalStorageBytes, branches, recentActivity };
  }

  async listBranches(options?: BranchListOptions): Promise<BranchMetadata[]> {
    const filter: Record<string, unknown> = {};

    if (!options?.includeDeleted) {
      filter.status = { $ne: "deleted" };
    }
    if (options?.status) {
      filter.status = options.status;
    }

    return this.metaDb
      .collection<BranchMetadata>(META_COLLECTION)
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();
  }

  /**
   * Extend a branch's TTL by N minutes from now.
   */
  async extendBranch(name: string, additionalMinutes: number): Promise<Date> {
    const branch = await this.getBranch(name);
    if (!branch) throw new Error(`Branch "${name}" not found`);

    const newExpiry = new Date(Date.now() + additionalMinutes * 60_000);
    await this.metaDb.collection(META_COLLECTION).updateOne(
      { name, status: { $ne: "deleted" } },
      { $set: { expiresAt: newExpiry }, $currentDate: { updatedAt: true } }
    );
    return newExpiry;
  }

  /**
   * Set or remove expiration on a branch.
   */
  async setBranchExpiration(name: string, expiresAt: Date | null): Promise<void> {
    const branch = await this.getBranch(name);
    if (!branch) throw new Error(`Branch "${name}" not found`);

    if (expiresAt === null) {
      await this.metaDb.collection(META_COLLECTION).updateOne(
        { name, status: { $ne: "deleted" } },
        { $unset: { expiresAt: "" }, $currentDate: { updatedAt: true } }
      );
    } else {
      await this.metaDb.collection(META_COLLECTION).updateOne(
        { name, status: { $ne: "deleted" } },
        { $set: { expiresAt }, $currentDate: { updatedAt: true } }
      );
    }
  }

  /**
   * Reset branch from parent — drop all data, re-copy from source.
   */
  async resetFromParent(name: string): Promise<BranchMetadata> {
    const branch = await this.getBranch(name);
    if (!branch) throw new Error(`Branch "${name}" not found`);

    const sourceDb = this.resolveDatabase(branch.parentBranch ?? "main");
    const branchDb = this.client.db(branch.branchDatabase);

    // Drop all existing collections in the branch
    const existingCols = await branchDb.listCollections().toArray();
    for (const col of existingCols) {
      if (!col.name.startsWith("system.")) {
        await branchDb.collection(col.name).drop().catch(() => {});
      }
    }

    // Re-copy from source
    const collectionInfos = await sourceDb.listCollections().toArray();
    const collections = collectionInfos
      .filter((c) => !c.name.startsWith("system."))
      .map((c) => c.name);

    await this.copyCollections(sourceDb, branchDb, collections);

    // Update metadata
    await this.metaDb.collection(META_COLLECTION).updateOne(
      { name, status: { $ne: "deleted" } },
      { $set: { collections }, $currentDate: { updatedAt: true } }
    );

    return (await this.getBranch(name))!;
  }

  async switchBranch(name: string): Promise<BranchSwitchResult> {
    const previousBranch = this.currentBranch;

    if (name === MAIN_BRANCH) {
      this.currentBranch = MAIN_BRANCH;
      return {
        previousBranch,
        currentBranch: MAIN_BRANCH,
        database: this.config.sourceDatabase,
      };
    }

    const branch = await this.metaDb
      .collection<BranchMetadata>(META_COLLECTION)
      .findOne({ name, status: "active" });

    if (!branch) {
      throw new Error(`Branch "${name}" not found`);
    }

    this.currentBranch = name;
    return {
      previousBranch,
      currentBranch: name,
      database: branch.branchDatabase,
    };
  }

  async deleteBranch(name: string): Promise<BranchDeleteResult> {
    if (name === MAIN_BRANCH) {
      throw new Error("Cannot delete main branch");
    }

    const branch = await this.metaDb
      .collection<BranchMetadata>(META_COLLECTION)
      .findOne({ name, status: { $ne: "deleted" } });

    if (!branch) {
      throw new Error(`Branch "${name}" not found`);
    }

    // Drop the branch database
    await this.client.db(branch.branchDatabase).dropDatabase();

    // Mark as deleted in metadata
    await this.metaDb.collection(META_COLLECTION).updateOne(
      { name },
      { $set: { status: "deleted" }, $currentDate: { updatedAt: true } }
    );

    // If we deleted the current branch, switch back to main
    if (this.currentBranch === name) {
      this.currentBranch = MAIN_BRANCH;
    }

    return {
      name,
      databaseDropped: true,
      collectionsRemoved: branch.collections.length,
    };
  }

  /**
   * Materialize a collection on a lazy branch (copy-on-write).
   * Called on first write to that collection.
   */
  async materializeCollection(branchName: string, collectionName: string): Promise<boolean> {
    const meta = await this.metaDb
      .collection<BranchMetadata>(META_COLLECTION)
      .findOne({ name: branchName, status: "active" });

    if (!meta || !meta.lazy) return false;

    const materialized = meta.materializedCollections ?? [];
    if (materialized.includes(collectionName)) return false; // already materialized

    const sourceDb = this.resolveDatabase(meta.parentBranch ?? MAIN_BRANCH);
    const branchDb = this.client.db(meta.branchDatabase);

    // Copy collection data using $merge aggregation (server-side, no client memory)
    try {
      await sourceDb.collection(collectionName).aggregate([
        { $match: {} },
        { $merge: {
            into: { db: meta.branchDatabase, coll: collectionName },
            whenMatched: "replace",
            whenNotMatched: "insert",
        }},
      ]).toArray();
    } catch (err: unknown) {
      // NamespaceNotFound (code 26) = source collection was dropped between
      // listCollections and $merge (TOCTOU race). Per MongoDB official error codes
      // and Mongoose maintainer guidance, gracefully skip with empty target.
      // Ref: https://www.mongodb.com/docs/manual/reference/error-codes/ (code 26)
      if (err instanceof MongoServerError && err.code === 26) {
        await branchDb.createCollection(collectionName).catch(() => {});
      } else {
        throw err;
      }
    }

    // Copy indexes (source collection may not exist if it's new)
    try {
      const indexes = await sourceDb.collection(collectionName).indexes();
      for (const idx of indexes) {
        if (idx.name === "_id_") continue;
        const { key, ...opts } = idx;
        try {
          await branchDb.collection(collectionName).createIndex(key, opts);
        } catch { /* index exists */ }
      }
    } catch { /* collection may not have indexes or may not exist on source */ }

    // Update metadata
    await this.metaDb.collection(META_COLLECTION).updateOne(
      { name: branchName },
      { $push: { materializedCollections: collectionName } as any }
    );

    return true;
  }

  /**
   * Check if a branch is lazy and get its materialization status.
   */
  async getBranchMaterializationStatus(branchName: string): Promise<{
    lazy: boolean;
    materialized: string[];
    pending: string[];
  }> {
    const meta = await this.metaDb
      .collection<BranchMetadata>(META_COLLECTION)
      .findOne({ name: branchName });

    if (!meta) throw new Error(`Branch "${branchName}" not found`);
    if (!meta.lazy) return { lazy: false, materialized: meta.collections, pending: [] };

    const materialized = meta.materializedCollections ?? [];
    const pending = meta.collections.filter((c) => !materialized.includes(c));
    return { lazy: true, materialized, pending };
  }

  /**
   * Garbage collect — drop databases for merged/deleted branches
   * and remove their metadata entries.
   */
  async garbageCollect(): Promise<{ cleaned: number; databases: string[] }> {
    const stale = await this.metaDb
      .collection<BranchMetadata>(META_COLLECTION)
      .find({ status: { $in: ["merged", "deleted"] } })
      .toArray();

    const databases: string[] = [];
    for (const branch of stale) {
      // Try to drop the database (may already be dropped)
      try {
        await this.client.db(branch.branchDatabase).dropDatabase();
        databases.push(branch.branchDatabase);
      } catch { /* already gone */ }
    }

    // Remove metadata entries
    if (stale.length > 0) {
      await this.metaDb.collection(META_COLLECTION).deleteMany({
        status: { $in: ["merged", "deleted"] },
      });
    }

    return { cleaned: stale.length, databases };
  }

  /**
   * Rollback a branch — drop its database and re-copy from source.
   * Resets the branch to the exact state of main (or parent).
   */
  async rollbackBranch(name: string): Promise<BranchRollbackResult> {
    if (name === MAIN_BRANCH) {
      throw new Error("Cannot rollback main branch");
    }

    const branch = await this.metaDb
      .collection<BranchMetadata>(META_COLLECTION)
      .findOne({ name, status: "active" });

    if (!branch) {
      throw new Error(`Branch "${name}" not found or not active`);
    }

    const branchDb = this.client.db(branch.branchDatabase);
    const parentBranch = branch.parentBranch ?? MAIN_BRANCH;
    const sourceDb = this.resolveDatabase(parentBranch);

    // Drop all collections in the branch database
    const existingColls = await branchDb.listCollections().toArray();
    for (const coll of existingColls) {
      if (!coll.name.startsWith("system.")) {
        await branchDb.collection(coll.name).drop();
      }
    }

    // Re-copy from source
    const collectionInfos = await sourceDb.listCollections().toArray();
    const collections = collectionInfos
      .filter((c) => !c.name.startsWith("system."))
      .map((c) => c.name);

    // Re-copy using server-side $merge (same as copyCollections)
    await this.copyCollections(sourceDb, branchDb, collections);

    // Count restored documents
    let documentsRestored = 0;
    for (const collName of collections) {
      documentsRestored += await branchDb.collection(collName).estimatedDocumentCount();
    }

    // Update metadata
    await this.metaDb.collection(META_COLLECTION).updateOne(
      { name },
      { $set: { collections }, $currentDate: { updatedAt: true } }
    );

    return {
      name,
      collectionsReset: collections.length,
      documentsRestored,
    };
  }

  private validateBranchName(name: string): void {
    if (!name || name.trim() === "") {
      throw new Error("Invalid branch name: name cannot be empty");
    }
    if (name === MAIN_BRANCH) {
      throw new Error(`Branch name "${name}" is reserved`);
    }
    if (!BRANCH_NAME_REGEX.test(name)) {
      throw new Error(
        `Invalid branch name "${name}": use only letters, numbers, dots, dashes, underscores, slashes`
      );
    }
  }

  private resolveDatabase(branchName: string): Db {
    if (branchName === MAIN_BRANCH) {
      return this.client.db(this.config.sourceDatabase);
    }
    return this.client.db(`${this.config.branchPrefix}${sanitizeBranchDbName(branchName)}`);
  }

  /**
   * Copy only schema (indexes + validation rules) without data.
   * Creates empty collections with matching structure.
   */
  private async copySchemaOnly(
    sourceDb: Db,
    targetDb: Db,
    collections: string[]
  ): Promise<void> {
    const collectionInfos = await sourceDb.listCollections().toArray();
    const infoMap = new Map(collectionInfos.map((c) => [c.name, c]));

    for (const collName of collections) {
      const info = infoMap.get(collName) as Record<string, unknown> | undefined;
      const opts = (info?.options ?? {}) as Record<string, unknown>;
      // Create collection with validation rules if present
      const createOptions: Record<string, unknown> = {};
      if (opts.validator) {
        createOptions.validator = opts.validator;
      }
      if (opts.validationLevel) {
        createOptions.validationLevel = opts.validationLevel;
      }
      if (opts.validationAction) {
        createOptions.validationAction = opts.validationAction;
      }
      await targetDb.createCollection(collName, createOptions).catch(() => {});

      // Copy indexes (except default _id index)
      const indexes = await sourceDb.collection(collName).indexes();
      for (const idx of indexes) {
        if (idx.name === "_id_") continue;
        const { key, ...options } = idx;
        try {
          const { v, ...cleanOptions } = options as Record<string, unknown>;
          await targetDb.collection(collName).createIndex(key, cleanOptions);
        } catch {
          // Index creation may fail for some types — skip
        }
      }
    }
  }

  /**
   * Copy collections from source to target using server-side $merge.
   * Zero client memory — all data stays on the MongoDB server.
   */
  private async copyCollections(
    sourceDb: Db,
    targetDb: Db,
    collections: string[]
  ): Promise<void> {
    const targetDbName = targetDb.databaseName;

    for (const collName of collections) {
      try {
        // Use $merge aggregation for server-side copy (zero client memory)
        await sourceDb.collection(collName).aggregate([
          { $match: {} },
          { $merge: {
              into: { db: targetDbName, coll: collName },
              whenMatched: "replace",
              whenNotMatched: "insert",
          }},
        ]).toArray();
      } catch (err: unknown) {
        // NamespaceNotFound (code 26) = source collection was dropped between
        // listCollections and $merge (TOCTOU race in concurrent branch ops).
        // Per MongoDB official error codes, gracefully create empty target.
        // Ref: https://www.mongodb.com/docs/manual/reference/error-codes/ (code 26)
        if (err instanceof MongoServerError && err.code === 26) {
          await targetDb.createCollection(collName).catch(() => {});
          continue;
        }
        throw err;
      }

      // Copy indexes (except default _id index)
      try {
        const indexes = await sourceDb.collection(collName).indexes();
        for (const idx of indexes) {
          if (idx.name === "_id_") continue;
          const { key, ...options } = idx;
          const { v, ...cleanOptions } = options as Record<string, unknown>;
          await targetDb.collection(collName).createIndex(key, cleanOptions).catch(() => {});
        }
      } catch (err: unknown) {
        // Source collection may have been dropped between $merge and index copy — safe to skip
        if (!(err instanceof MongoServerError && err.code === 26)) throw err;
      }
    }
  }
}
