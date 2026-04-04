/**
 * MongoBranch — Stash Manager
 *
 * Save uncommitted changes, reset branch to clean state, restore later.
 * Like `git stash` — but for MongoDB data.
 *
 * Operations: stash (save + reset), pop (restore + remove), list, drop
 */
import type { MongoClient, Collection } from "mongodb";
import { type MongoBranchConfig, sanitizeBranchDbName } from "./types.ts";

const STASH_COLLECTION = "stashes";

export interface StashEntry {
  id: string;
  branchName: string;
  message: string;
  data: Record<string, Record<string, unknown>[]>; // collection → documents
  createdBy: string;
  createdAt: Date;
  index: number; // stack position (0 = most recent)
}

export class StashManager {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private stashes: Collection<StashEntry>;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
    this.stashes = client.db(config.metaDatabase).collection<StashEntry>(STASH_COLLECTION);
  }

  async initialize(): Promise<void> {
    await this.stashes.createIndex({ branchName: 1, index: 1 });
    await this.stashes.createIndex({ id: 1 }, { unique: true });
  }

  /**
   * Stash current branch state — saves all docs, then clears collections.
   */
  async stash(branchName: string, message: string, createdBy = "cli"): Promise<StashEntry> {
    const branchDbName = `${this.config.branchPrefix}${sanitizeBranchDbName(branchName)}`;
    const branchDb = this.client.db(branchDbName);

    // Collect all documents from all collections
    const data: Record<string, Record<string, unknown>[]> = {};
    const collections = await branchDb.listCollections().toArray();

    for (const col of collections) {
      if (col.name.startsWith("system.")) continue;
      const docs = await branchDb.collection(col.name).find({}).toArray();
      if (docs.length > 0) {
        data[col.name] = docs as Record<string, unknown>[];
      }
    }

    if (Object.keys(data).length === 0) {
      throw new Error(`Nothing to stash on branch "${branchName}" — no data`);
    }

    // Shift existing stash indexes up
    await this.stashes.updateMany(
      { branchName },
      { $inc: { index: 1 } }
    );

    const id = `stash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: StashEntry = {
      id,
      branchName,
      message,
      data,
      createdBy,
      createdAt: new Date(),
      index: 0,
    };

    await this.stashes.insertOne(entry);

    // Clear branch data (the "reset" part of stash)
    for (const colName of Object.keys(data)) {
      await branchDb.collection(colName).deleteMany({});
    }

    return entry;
  }

  /**
   * Pop the most recent stash — restore data and remove stash entry.
   */
  async pop(branchName: string): Promise<StashEntry> {
    const entry = await this.stashes.findOne({ branchName, index: 0 });
    if (!entry) throw new Error(`No stash found for branch "${branchName}"`);

    // Restore data
    const branchDb = this.client.db(`${this.config.branchPrefix}${sanitizeBranchDbName(branchName)}`);
    for (const [colName, docs] of Object.entries(entry.data)) {
      if (docs.length > 0) {
        await branchDb.collection(colName).insertMany(docs);
      }
    }

    // Remove entry and shift remaining indexes down
    await this.stashes.deleteOne({ id: entry.id });
    await this.stashes.updateMany(
      { branchName, index: { $gt: 0 } },
      { $inc: { index: -1 } }
    );

    return entry;
  }

  /**
   * List stashes for a branch (most recent first).
   */
  async list(branchName: string): Promise<StashEntry[]> {
    return this.stashes.find({ branchName }).sort({ index: 1 }).toArray();
  }

  /**
   * Drop a specific stash by index.
   */
  async drop(branchName: string, index = 0): Promise<void> {
    const entry = await this.stashes.findOne({ branchName, index });
    if (!entry) throw new Error(`No stash at index ${index} for branch "${branchName}"`);

    await this.stashes.deleteOne({ id: entry.id });
    // Shift higher indexes down
    await this.stashes.updateMany(
      { branchName, index: { $gt: index } },
      { $inc: { index: -1 } }
    );
  }

  /**
   * Count stashes for a branch.
   */
  async count(branchName: string): Promise<number> {
    return this.stashes.countDocuments({ branchName });
  }
}
