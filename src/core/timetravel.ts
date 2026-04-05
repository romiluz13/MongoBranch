/**
 * MongoBranch — Time Travel Engine
 *
 * Query data at any past commit or timestamp.
 * Stores full document snapshots at commit time.
 * Supports filter queries against historical data.
 */
import type { MongoClient, Collection } from "mongodb";
import type {
  MongoBranchConfig,
  Commit,
  CommitData,
  TimeTravelQuery,
  TimeTravelResult,
  BlameEntry,
  BlameResult,
} from "./types.ts";
import { COMMITS_COLLECTION, COMMIT_DATA_COLLECTION, sanitizeBranchDbName } from "./types.ts";

export class TimeTravelEngine {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private commits: Collection<Commit>;
  private commitData: Collection<CommitData>;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
    const metaDb = client.db(config.metaDatabase);
    this.commits = metaDb.collection<Commit>(COMMITS_COLLECTION);
    this.commitData = metaDb.collection<CommitData>(COMMIT_DATA_COLLECTION);
  }

  async initialize(): Promise<void> {
    await this.commitData.createIndex({ commitHash: 1, collection: 1 });
    await this.commitData.createIndex({ commitHash: 1 });
  }

  /**
   * Store full document data for a commit.
   * Called during commit() to persist point-in-time snapshot.
   */
  async storeCommitData(commitHash: string, branchName: string): Promise<number> {
    const branch = await this.client.db(this.config.metaDatabase)
      .collection("branches")
      .findOne({ name: branchName, status: { $ne: "deleted" } });

    if (!branch) throw new Error(`Branch "${branchName}" not found`);

    const dbName = (branch as any).branchDatabase || `${this.config.branchPrefix}${sanitizeBranchDbName(branchName)}`;
    const db = this.client.db(dbName);
    const collections = await db.listCollections().toArray();

    let totalDocs = 0;

    for (const coll of collections) {
      if (coll.name.startsWith("system.")) continue;

      const docs = await db.collection(coll.name).find({}).toArray();
      if (docs.length === 0) continue;

      await this.commitData.insertOne({
        commitHash,
        collection: coll.name,
        documents: docs as Record<string, unknown>[],
        documentCount: docs.length,
        storedAt: new Date(),
      });

      totalDocs += docs.length;
    }

    return totalDocs;
  }

  /**
   * Query data at a specific commit hash or timestamp.
   */
  async findAt(query: TimeTravelQuery): Promise<TimeTravelResult> {
    const { branchName, collection, filter, at } = query;

    // Resolve commit — by hash or by timestamp
    const commit = await this.resolveCommit(branchName, at);
    if (!commit) {
      throw new Error(`No commit found for "${at}" on branch "${branchName}"`);
    }

    // Get stored data for this commit + collection
    const data = await this.commitData.findOne({
      commitHash: commit.hash,
      collection,
    });

    let documents = data?.documents ?? [];

    // Apply filter if provided
    if (filter && Object.keys(filter).length > 0) {
      documents = documents.filter(doc => this.matchesFilter(doc, filter));
    }

    return {
      branchName,
      collection,
      commitHash: commit.hash,
      commitMessage: commit.message,
      commitTimestamp: commit.timestamp,
      documents,
      documentCount: documents.length,
    };
  }

  /**
   * List collections available at a specific commit.
   */
  async listCollectionsAt(branchName: string, at: string): Promise<string[]> {
    const commit = await this.resolveCommit(branchName, at);
    if (!commit) throw new Error(`No commit found for "${at}" on branch "${branchName}"`);

    const entries = await this.commitData.find({ commitHash: commit.hash }).toArray();
    return entries.map(e => e.collection).sort();
  }

  /**
   * Blame: who changed each field and when.
   * Walks commit chain backward tracking per-field attribution.
   */
  async blame(
    branchName: string,
    collection: string,
    documentId: string
  ): Promise<BlameResult> {
    // Walk commit chain from HEAD backward
    const commitChain = await this.getCommitChain(branchName);
    const fields: Record<string, BlameEntry[]> = {};
    let previousDoc: Record<string, unknown> | null = null;

    // Walk newest → oldest
    for (const commit of commitChain) {
      const data = await this.commitData.findOne({
        commitHash: commit.hash,
        collection,
      });

      if (!data) continue;

      const doc = data.documents.find(d =>
        String((d as any)._id) === String(documentId)
      );

      if (!doc && previousDoc) {
        // Document was created AFTER this commit — previous commit is the creator
        break;
      }

      if (doc && !previousDoc) {
        // First time seeing this doc (from newest commit) — it exists now
        previousDoc = doc;
        continue;
      }

      if (doc && previousDoc) {
        // Compare fields between this commit and the next (previousDoc is newer)
        for (const key of Object.keys(previousDoc)) {
          if (key === "_id") continue;
          const oldVal = (doc as any)[key];
          const newVal = (previousDoc as any)[key];

          if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
            if (!fields[key]) fields[key] = [];
            // The NEWER commit changed this field
            const newerCommit = commitChain[commitChain.indexOf(commit) - 1] ?? commitChain[0]!;
            fields[key]!.push({
              field: key,
              value: newVal,
              commitHash: newerCommit.hash,
              author: newerCommit.author,
              timestamp: newerCommit.timestamp,
              message: newerCommit.message,
            });
          }
        }

        // Check for fields that exist in current but not in previous (newly added fields)
        for (const key of Object.keys(doc)) {
          if (key === "_id") continue;
          if (!(key in previousDoc)) {
            // Field was removed in the newer commit — skip for blame
          }
        }

        previousDoc = doc;
      }
    }

    // For fields that were never changed (set at creation), attribute to first commit
    if (previousDoc) {
      const firstCommitWithDoc = await this.findCreationCommit(
        branchName,
        commitChain,
        previousDoc,
        collection,
        documentId
      );
      if (firstCommitWithDoc) {
        for (const key of Object.keys(previousDoc)) {
          if (key === "_id") continue;
          if (!fields[key]) {
            fields[key] = [{
              field: key,
              value: (previousDoc as any)[key],
              commitHash: firstCommitWithDoc.hash,
              author: firstCommitWithDoc.author,
              timestamp: firstCommitWithDoc.timestamp,
              message: firstCommitWithDoc.message,
            }];
          }
        }
      }
    }

    return {
      branchName,
      collection,
      documentId,
      fields,
      totalCommitsScanned: commitChain.length,
    };
  }

  // ── Private Helpers ──────────────────────────────────────

  private async findCreationCommit(
    branchName: string,
    chain: Commit[],
    doc: Record<string, unknown>,
    collection: string,
    documentId: string,
  ): Promise<Commit | null> {
    const branchLocalChain = chain.filter((commit) => commit.branchName === branchName);

    for (let i = branchLocalChain.length - 1; i >= 0; i--) {
      const commit = branchLocalChain[i];
      const snapshot = await this.commitData.findOne({
        commitHash: commit!.hash,
        collection,
      });
      if (snapshot) {
        const found = snapshot.documents.find(
          (d: Record<string, unknown>) => String((d as any)._id) === String(documentId)
        );
        if (found) return commit ?? null;
      }
    }

    // Walk from oldest to newest, find the first commit that contains the doc
    for (let i = chain.length - 1; i >= 0; i--) {
      const commit = chain[i];
      const snapshot = await this.commitData.findOne({
        commitHash: commit!.hash,
        collection,
      });
      if (snapshot) {
        const found = snapshot.documents.find(
          (d: Record<string, unknown>) => String((d as any)._id) === String(documentId)
        );
        if (found) return commit ?? null;
      }
    }
    // Fallback to oldest commit
    return chain[chain.length - 1] ?? null;
  }

  private async resolveCommit(branchName: string, at: string): Promise<Commit | null> {
    // Try as commit hash first
    const byHash = await this.commits.findOne({ hash: at });
    if (byHash) return byHash;

    // Try as ISO timestamp — find nearest commit before that time
    const asDate = new Date(at);
    if (!isNaN(asDate.getTime())) {
      return this.commits.findOne(
        { branchName, timestamp: { $lte: asDate } },
        { sort: { timestamp: -1 } }
      );
    }

    return null;
  }

  private async getCommitChain(branchName: string): Promise<Commit[]> {
    const branch = await this.client.db(this.config.metaDatabase)
      .collection("branches")
      .findOne({ name: branchName, status: { $ne: "deleted" } });

    if (!branch || !(branch as any).headCommit) return [];

    const commits: Commit[] = [];
    let currentHash: string | null = (branch as any).headCommit;

    while (currentHash) {
      const commit = await this.commits.findOne({ hash: currentHash });
      if (!commit) break;
      commits.push(commit);
      currentHash = commit.parentHashes[0] ?? null;
    }

    return commits; // Newest first
  }

  private matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(filter)) {
      const docVal = (doc as any)[key];
      if (JSON.stringify(docVal) !== JSON.stringify(value)) return false;
    }
    return true;
  }
}
