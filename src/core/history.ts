/**
 * HistoryManager — Snapshot tracking and audit trail for MongoBranch
 *
 * Records events (branch created, merged, data modified) as snapshots.
 * Provides branch log for audit trail and future rollback support.
 */
import type { MongoClient, Collection } from "mongodb";
import type {
  MongoBranchConfig,
  Snapshot,
  SnapshotEvent,
  BranchLog,
} from "./types.ts";
import { SNAPSHOTS_COLLECTION } from "./types.ts";

export interface RecordSnapshotOptions {
  branchName: string;
  event: SnapshotEvent;
  summary: string;
  metadata?: Record<string, unknown>;
}

export class HistoryManager {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private snapshots: Collection<Snapshot>;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
    this.snapshots = client
      .db(config.metaDatabase)
      .collection<Snapshot>(SNAPSHOTS_COLLECTION);
  }

  async initialize(): Promise<void> {
    await this.snapshots.createIndex({ branchName: 1, timestamp: 1 });
  }

  /**
   * Record a snapshot event for a branch.
   */
  async recordSnapshot(options: RecordSnapshotOptions): Promise<Snapshot> {
    const snapshot: Snapshot = {
      branchName: options.branchName,
      event: options.event,
      summary: options.summary,
      timestamp: new Date(),
      metadata: options.metadata,
    };

    await this.snapshots.insertOne(snapshot);
    return snapshot;
  }

  /**
   * Get the full event log for a branch, ordered by timestamp.
   */
  async getBranchLog(branchName: string): Promise<BranchLog> {
    const entries = await this.snapshots
      .find({ branchName })
      .sort({ timestamp: 1 })
      .toArray();

    return { branchName, entries };
  }

  /**
   * Get all logs across all branches (for global audit view).
   */
  async getAllLogs(limit: number = 50): Promise<Snapshot[]> {
    return this.snapshots
      .find({})
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Export audit log as JSON string.
   * Supports filtering by branch, date range, and event type.
   */
  async exportJSON(options?: {
    branchName?: string;
    since?: Date;
    until?: Date;
    event?: SnapshotEvent;
  }): Promise<string> {
    const entries = await this.querySnapshots(options);
    return JSON.stringify(entries, null, 2);
  }

  /**
   * Export audit log as CSV string.
   */
  async exportCSV(options?: {
    branchName?: string;
    since?: Date;
    until?: Date;
    event?: SnapshotEvent;
  }): Promise<string> {
    const entries = await this.querySnapshots(options);
    const header = "timestamp,branchName,event,summary";
    const rows = entries.map((e) => {
      const ts = e.timestamp instanceof Date ? e.timestamp.toISOString() : String(e.timestamp);
      const summary = `"${(e.summary ?? "").replace(/"/g, '""')}"`;
      return `${ts},${e.branchName},${e.event},${summary}`;
    });
    return [header, ...rows].join("\n");
  }

  /**
   * Query snapshots with filters.
   */
  private async querySnapshots(options?: {
    branchName?: string;
    since?: Date;
    until?: Date;
    event?: SnapshotEvent;
  }): Promise<Snapshot[]> {
    const filter: Record<string, unknown> = {};
    if (options?.branchName) filter.branchName = options.branchName;
    if (options?.event) filter.event = options.event;
    if (options?.since || options?.until) {
      const ts: Record<string, Date> = {};
      if (options?.since) ts.$gte = options.since;
      if (options?.until) ts.$lte = options.until;
      filter.timestamp = ts;
    }
    return this.snapshots.find(filter).sort({ timestamp: 1 }).toArray();
  }
}
