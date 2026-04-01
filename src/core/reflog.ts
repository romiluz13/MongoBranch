/**
 * MongoBranch — Reflog
 *
 * Track every branch pointer movement — create, delete, merge, reset, checkout.
 * Survives branch deletion. Like `git reflog`.
 *
 * The reflog is the safety net: even after deleting a branch,
 * you can see what happened and potentially recover.
 */
import type { MongoClient, Collection } from "mongodb";
import type { MongoBranchConfig } from "./types.ts";

const REFLOG_COLLECTION = "reflog";

export type ReflogAction =
  | "create"
  | "delete"
  | "merge"
  | "reset"
  | "commit"
  | "cherry-pick"
  | "revert"
  | "stash"
  | "pop"
  | "switch";

export interface ReflogEntry {
  branchName: string;
  action: ReflogAction;
  detail: string;
  commitHash?: string;
  actor: string;
  timestamp: Date;
}

export class ReflogManager {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private entries: Collection<ReflogEntry>;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
    this.entries = client.db(config.metaDatabase).collection<ReflogEntry>(REFLOG_COLLECTION);
  }

  async initialize(): Promise<void> {
    await this.entries.createIndex({ branchName: 1, timestamp: -1 });
    await this.entries.createIndex({ timestamp: -1 });
    await this.entries.createIndex({ action: 1 });
  }

  /**
   * Record a reflog entry.
   */
  async record(entry: Omit<ReflogEntry, "timestamp">): Promise<ReflogEntry> {
    const full: ReflogEntry = { ...entry, timestamp: new Date() };
    await this.entries.insertOne(full);
    return full;
  }

  /**
   * Get reflog for a specific branch (most recent first).
   */
  async forBranch(branchName: string, limit = 50): Promise<ReflogEntry[]> {
    return this.entries
      .find({ branchName })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get full reflog across all branches (most recent first).
   */
  async all(limit = 100): Promise<ReflogEntry[]> {
    return this.entries
      .find({})
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get reflog entries for a specific action type.
   */
  async byAction(action: ReflogAction, limit = 50): Promise<ReflogEntry[]> {
    return this.entries
      .find({ action })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Check if a branch was ever created (even if now deleted).
   */
  async branchExisted(branchName: string): Promise<boolean> {
    const entry = await this.entries.findOne({
      branchName,
      action: "create",
    });
    return entry !== null;
  }

  /**
   * Get the last known state of a deleted branch.
   */
  async lastKnownState(branchName: string): Promise<ReflogEntry | null> {
    return this.entries.findOne(
      { branchName },
      { sort: { timestamp: -1, _id: -1 } }
    );
  }
}
