/**
 * BranchWatcher — Real-time change stream monitoring for branch databases.
 *
 * Uses MongoDB change streams to watch a branch database for inserts, updates,
 * deletes, and collection-level events. Emits typed events to registered handlers.
 */

import type { MongoClient, ChangeStream, ChangeStreamDocument, ResumeToken, Timestamp } from "mongodb";
import type { MongoBranchConfig, BranchMetadata } from "./types";
import { META_COLLECTION, MAIN_BRANCH } from "./types";

export type WatchEventType = "insert" | "update" | "replace" | "delete" | "drop" | "invalidate";

export interface BranchChangeEvent {
  type: WatchEventType;
  branchName: string;
  database: string;
  collection?: string;
  documentId?: unknown;
  fullDocument?: Record<string, unknown>;
  fullDocumentBeforeChange?: Record<string, unknown>;
  updatedFields?: Record<string, unknown>;
  removedFields?: string[];
  timestamp: Date;
  resumeToken: ResumeToken;
}

export type BranchChangeHandler = (event: BranchChangeEvent) => void | Promise<void>;

export async function resolveWatchedDatabaseName(
  client: MongoClient,
  config: MongoBranchConfig,
  branchName: string,
): Promise<string> {
  if (branchName === MAIN_BRANCH) {
    return config.sourceDatabase;
  }

  const meta = await client
    .db(config.metaDatabase)
    .collection<BranchMetadata>(META_COLLECTION)
    .findOne({ name: branchName, status: { $ne: "deleted" } });
  if (!meta?.branchDatabase) {
    throw new Error(`Branch "${branchName}" not found`);
  }
  return meta.branchDatabase;
}

export async function captureOperationTime(
  client: MongoClient,
): Promise<Timestamp | null> {
  const hello = await client.db("admin").command({ hello: 1 });
  return hello.operationTime ?? hello.$clusterTime?.clusterTime ?? null;
}

export async function hasBranchChangesSince(
  client: MongoClient,
  config: MongoBranchConfig,
  branchName: string,
  operationTime: Timestamp,
): Promise<boolean> {
  const dbName = await resolveWatchedDatabaseName(client, config, branchName);
  const changeStream = client.db(dbName).watch([], {
    startAtOperationTime: operationTime,
    maxAwaitTimeMS: 500,
  });

  try {
    const change = await changeStream.tryNext();
    return change !== null;
  } finally {
    await changeStream.close().catch(() => {});
  }
}

export class BranchWatcher {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private handlers: BranchChangeHandler[] = [];
  private changeStream: ChangeStream | null = null;
  private running = false;
  private branchName: string | null = null;
  private lastResumeToken: ResumeToken | null = null;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
  }

  on(handler: BranchChangeHandler): void {
    this.handlers.push(handler);
  }

  off(handler: BranchChangeHandler): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  async watch(branchName: string, options?: {
    resumeAfter?: ResumeToken;
    /** Enable pre-image capture (requires collection changeStreamPreAndPostImages) */
    includeBeforeImage?: boolean;
  }): Promise<void> {
    if (this.running) {
      throw new Error(`Watcher already running on branch "${this.branchName}"`);
    }

    const dbName = await resolveWatchedDatabaseName(this.client, this.config, branchName);

    this.branchName = branchName;
    this.running = true;

    const watchOpts: Record<string, unknown> = { fullDocument: "updateLookup" };
    if (options?.includeBeforeImage) {
      watchOpts.fullDocumentBeforeChange = "whenAvailable";
    }
    if (options?.resumeAfter) watchOpts.resumeAfter = options.resumeAfter;

    const db = this.client.db(dbName);
    const changeStream = db.watch([], watchOpts);
    this.changeStream = changeStream;

    (async () => {
      try {
        for await (const change of changeStream as AsyncIterable<ChangeStreamDocument>) {
          if (!this.running || this.changeStream !== changeStream) break;
          const event = this.mapEvent(change, branchName, dbName);
          if (!event) continue;
          this.lastResumeToken = event.resumeToken;
          for (const handler of this.handlers) {
            try { await handler(event); } catch (err) {
              // Handler errors must not kill the stream, but log for debuggability
              console.warn(`[BranchWatcher] handler error on ${branchName}:`, err instanceof Error ? err.message : err);
            }
          }
        }
      } catch (err) {
        if (this.running && this.changeStream === changeStream) {
          console.warn(`[BranchWatcher] change stream error:`, err instanceof Error ? err.message : err);
        }
        this.running = false;
      } finally {
        if (this.changeStream === changeStream && !this.running) {
          this.changeStream = null;
        }
      }
    })();
  }

  async stop(): Promise<void> {
    this.running = false;
    const changeStream = this.changeStream;
    this.changeStream = null;
    if (changeStream) {
      await changeStream.close();
    }
  }

  isRunning(): boolean { return this.running; }
  getResumeToken(): ResumeToken | null { return this.lastResumeToken; }
  getBranchName(): string | null { return this.branchName; }

  private mapEvent(
    change: ChangeStreamDocument, branchName: string, database: string
  ): BranchChangeEvent | null {
    const opType = change.operationType as WatchEventType;
    const base: BranchChangeEvent = {
      type: opType, branchName, database,
      timestamp: new Date(), resumeToken: change._id,
    };

    if ("ns" in change && change.ns) base.collection = (change.ns as any).coll;
    if ("fullDocumentBeforeChange" in change && change.fullDocumentBeforeChange) {
      base.fullDocumentBeforeChange = change.fullDocumentBeforeChange as Record<string, unknown>;
    }

    switch (opType) {
      case "insert":
        if ("fullDocument" in change) {
          base.fullDocument = change.fullDocument as Record<string, unknown>;
          base.documentId = (change as any).documentKey?._id;
        }
        return base;
      case "update":
      case "replace":
        if ("fullDocument" in change) base.fullDocument = change.fullDocument as Record<string, unknown>;
        if ("updateDescription" in change) {
          const desc = (change as any).updateDescription;
          base.updatedFields = desc?.updatedFields;
          base.removedFields = desc?.removedFields;
        }
        base.documentId = (change as any).documentKey?._id;
        return base;
      case "delete":
        base.documentId = (change as any).documentKey?._id;
        return base;
      case "drop":
      case "invalidate":
        return base;
      default:
        return null;
    }
  }
}
