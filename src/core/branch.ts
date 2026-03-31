/**
 * MongoBranch — Branch Engine
 *
 * Creates, lists, switches, and deletes MongoDB database branches.
 * Each branch = a separate database with copied data from source.
 */
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
    await col.createIndex({ name: 1 }, { unique: true });
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

    // Sanitize branch name for MongoDB database name (/ is invalid in DB names)
    const safeName = name.replace(/\//g, "--");
    const branchDatabase = `${this.config.branchPrefix}${safeName}`;
    const sourceDb = this.resolveDatabase(from);
    const branchDb = this.client.db(branchDatabase);

    // Discover collections in source (exclude system collections)
    const collectionInfos = await sourceDb.listCollections().toArray();
    const collections = collectionInfos
      .filter((c) => !c.name.startsWith("system."))
      .map((c) => c.name);

    const isLazy = options.lazy ?? false;

    // Copy collections unless lazy mode (copy-on-write)
    if (!isLazy) {
      await this.copyCollections(sourceDb, branchDb, collections);
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
      { $set: { expiresAt: newExpiry, updatedAt: new Date() } }
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
        { $unset: { expiresAt: "" }, $set: { updatedAt: new Date() } }
      );
    } else {
      await this.metaDb.collection(META_COLLECTION).updateOne(
        { name, status: { $ne: "deleted" } },
        { $set: { expiresAt, updatedAt: new Date() } }
      );
    }
  }

  /**
   * Reset branch from parent — drop all data, re-copy from source.
   */
  async resetFromParent(name: string): Promise<BranchMetadata> {
    const branch = await this.getBranch(name);
    if (!branch) throw new Error(`Branch "${name}" not found`);

    const sourceDb = this.resolveDatabase(branch.parentBranch);
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
      { $set: { collections, updatedAt: new Date() } }
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
      { $set: { status: "deleted", updatedAt: new Date() } }
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

    // Copy the collection data
    const docs = await sourceDb.collection(collectionName).find({}).toArray();
    if (docs.length > 0) {
      await branchDb.collection(collectionName).insertMany(docs);
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

    let documentsRestored = 0;
    for (const collName of collections) {
      const docs = await sourceDb.collection(collName).find({}).toArray();
      if (docs.length > 0) {
        await branchDb.collection(collName).insertMany(docs);
        documentsRestored += docs.length;
      }
      // Copy indexes
      const indexes = await sourceDb.collection(collName).indexes();
      for (const idx of indexes) {
        if (idx.name === "_id_") continue;
        const { key, ...indexOpts } = idx;
        try {
          await branchDb.collection(collName).createIndex(key, indexOpts);
        } catch { /* index already exists */ }
      }
    }

    // Update metadata
    await this.metaDb.collection(META_COLLECTION).updateOne(
      { name },
      { $set: { updatedAt: new Date(), collections } }
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
    return this.client.db(`${this.config.branchPrefix}${branchName}`);
  }

  private async copyCollections(
    sourceDb: Db,
    targetDb: Db,
    collections: string[]
  ): Promise<void> {
    for (const collName of collections) {
      const docs = await sourceDb.collection(collName).find({}).toArray();
      if (docs.length > 0) {
        await targetDb.collection(collName).insertMany(docs);
      }

      // Copy indexes (except default _id index)
      const indexes = await sourceDb.collection(collName).indexes();
      for (const idx of indexes) {
        if (idx.name === "_id_") continue;
        const { key, ...options } = idx;
        try {
          // v is internal, remove before creating
          const { v, ...cleanOptions } = options as Record<string, unknown>;
          await targetDb.collection(collName).createIndex(key, cleanOptions);
        } catch {
          // Index creation may fail for some types — log but don't block
        }
      }
    }
  }
}
