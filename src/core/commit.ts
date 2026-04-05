/**
 * MongoBranch — Commit Engine
 *
 * Content-addressed commit graph for MongoDB data version control.
 * Every commit gets a SHA-256 hash. Every hash is immutable.
 * Supports: single-parent commits, merge commits (two parents), HEAD tracking.
 *
 * This is the backbone — tags, cherry-pick, revert, time-travel all need commits.
 */
import { createHash } from "crypto";
import type { MongoClient, Collection, AnyBulkWriteOperation, ClientSession } from "mongodb";
import { ObjectId } from "mongodb";
import type {
  MongoBranchConfig,
  Commit,
  CommitOptions,
  CommitLog,
  CommitSnapshot,
  CollectionSnapshot,
  BranchMetadata,
  Tag,
  CherryPickResult,
  RevertResult,
} from "./types.ts";
import { COMMITS_COLLECTION, TAGS_COLLECTION, META_COLLECTION, MAIN_BRANCH, COMMIT_DATA_COLLECTION, sanitizeBranchDbName } from "./types.ts";
import type { CommitData } from "./types.ts";

export class CommitEngine {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private commits: Collection<Commit>;
  private branches: Collection<BranchMetadata>;
  private tags: Collection<Tag>;
  private commitData: Collection<CommitData>;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
    const metaDb = client.db(config.metaDatabase);
    this.commits = metaDb.collection<Commit>(COMMITS_COLLECTION);
    this.branches = metaDb.collection<BranchMetadata>(META_COLLECTION);
    this.tags = metaDb.collection<Tag>(TAGS_COLLECTION);
    this.commitData = metaDb.collection<CommitData>(COMMIT_DATA_COLLECTION);
  }

  async initialize(): Promise<void> {
    await this.commits.createIndex({ hash: 1 }, { unique: true });
    await this.commits.createIndex({ branchName: 1, timestamp: -1 });
    // Index on parentHashes for $graphLookup ancestor traversal
    await this.commits.createIndex({ parentHashes: 1 });
    await this.tags.createIndex({ name: 1 }, { unique: true });
    await this.commitData.createIndex({ commitHash: 1, collection: 1 });

    // $jsonSchema validation: prevent malformed commits (14.3)
    await this.client.db(this.config.metaDatabase).command({
      collMod: COMMITS_COLLECTION,
      validator: {
        $jsonSchema: {
          bsonType: "object",
          required: ["hash", "branchName", "message", "author", "timestamp", "parentHashes"],
          properties: {
            hash: { bsonType: "string", minLength: 64, maxLength: 64 },
            branchName: { bsonType: "string" },
            message: { bsonType: "string" },
            author: { bsonType: "string" },
            timestamp: { bsonType: "date" },
            parentHashes: { bsonType: "array", items: { bsonType: "string" } },
          },
        },
      },
      validationLevel: "moderate",
      validationAction: "error",
    }).catch(() => {});
  }

  /**
   * Create a commit — snapshot current branch state into an immutable record.
   */
  async commit(options: CommitOptions): Promise<Commit> {
    const collectionNames = await this.listSnapshotCollections(
      options.branchName,
      options.collectionNames ?? []
    );

    if (options.session) {
      return this.commitWithSession({ ...options, collectionNames }, options.session);
    }

    const session = this.client.startSession();
    let created: Commit | null = null;
    try {
      await session.withTransaction(async () => {
        created = await this.commitWithSession(
          { ...options, session, collectionNames },
          session
        );
      });
    } finally {
      await session.endSession();
    }

    if (!created) {
      throw new Error(`Commit "${options.message}" did not complete`);
    }

    return created;
  }

  private async commitWithSession(options: CommitOptions, session: ClientSession): Promise<Commit> {
    const { branchName, message, author = "unknown", collectionNames = [] } = options;

    // Build snapshot of current branch state
    const snapshot = await this.buildSnapshot(branchName, session, collectionNames);

    const branch = branchName === MAIN_BRANCH
      ? null
      : await this.branches.findOne({
          name: branchName,
          status: { $ne: "deleted" },
        }, { session });
    if (branchName !== MAIN_BRANCH && !branch) {
      throw new Error(`Branch "${branchName}" not found`);
    }
    const headCommit = await this.getHeadCommitHash(branchName, session);

    let parentHashes: string[];
    if (options.parentOverrides) {
      parentHashes = options.parentOverrides;
    } else if (headCommit) {
      parentHashes = [headCommit];
    } else {
      parentHashes = []; // Root commit (first commit on branch)
    }

    const timestamp = new Date();

    // Content-addressed hash: SHA-256 of deterministic content
    const hash = this.computeHash(branchName, parentHashes, message, author, timestamp, snapshot);

    const commit: Commit = {
      hash,
      branchName,
      parentHashes,
      message,
      author,
      timestamp,
      snapshot,
    };

    await this.commits.insertOne({ ...commit }, { session });

    // Update HEAD pointer on the branch
    if (branchName !== MAIN_BRANCH) {
      await this.branches.updateOne(
        { name: branchName, status: { $ne: "deleted" } },
        { $set: { headCommit: hash }, $currentDate: { updatedAt: true } },
        { session }
      );
    }

    // Stored snapshots now back time travel, merge-base reconstruction, cherry-pick, and revert.
    await this.storeCommitDocuments(hash, branchName, session, collectionNames);

    return commit;
  }

  /**
   * Store full document data for a commit — enables time travel queries.
   */
  private async storeCommitDocuments(
    commitHash: string,
    branchName: string,
    session: ClientSession,
    collectionNames: string[]
  ): Promise<void> {
    const branch = branchName === MAIN_BRANCH
      ? null
      : await this.branches.findOne({
          name: branchName,
          status: { $ne: "deleted" },
        }, { session });

    if (branchName !== MAIN_BRANCH && !branch) {
      throw new Error(`Branch "${branchName}" not found`);
    }

    const dbName = branchName === MAIN_BRANCH
      ? this.config.sourceDatabase
      : branch!.branchDatabase ?? `${this.config.branchPrefix}${sanitizeBranchDbName(branchName)}`;
    const db = this.client.db(dbName);

    for (const collectionName of collectionNames) {
      if (collectionName.startsWith("system.")) continue;

      const docs = await db.collection(collectionName).find({}, { session }).toArray().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("ns not found") || message.includes("NamespaceNotFound")) {
          return [];
        }
        throw error;
      });
      if (docs.length === 0) continue;

      await this.commitData.insertOne({
        commitHash,
        collection: collectionName,
        documents: docs as Record<string, unknown>[],
        documentCount: docs.length,
        storedAt: new Date(),
      }, { session });
    }
  }

  /**
   * Retrieve a single commit by its hash.
   */
  async getCommit(hash: string): Promise<Commit | null> {
    return this.commits.findOne({ hash });
  }

  /**
   * Load the stored per-collection documents for a commit snapshot.
   */
  async getCommitDocuments(commitHash: string): Promise<Record<string, Record<string, unknown>[]>> {
    const rows = await this.commitData.find({ commitHash }).toArray();
    const snapshot: Record<string, Record<string, unknown>[]> = {};

    for (const row of rows) {
      snapshot[row.collection] = row.documents.map((doc) => ({ ...doc }));
    }

    return snapshot;
  }

  async getHeadCommitHash(branchName: string, session?: ClientSession): Promise<string | null> {
    if (branchName === MAIN_BRANCH) {
      const options = session
        ? { session, sort: { timestamp: -1 as const } }
        : { sort: { timestamp: -1 as const } };
      const mainHead = await this.commits.findOne({ branchName: MAIN_BRANCH }, options);
      return mainHead?.hash ?? null;
    }

    const branch = await this.branches.findOne(
      { name: branchName, status: { $ne: "deleted" } },
      session ? { session } : {}
    );
    return branch?.headCommit ?? null;
  }

  /**
   * Walk the commit chain from HEAD backward.
   * Returns commits in reverse chronological order.
   */
  async getLog(branchName: string, limit: number = 50): Promise<CommitLog> {
    const headCommit = await this.getHeadCommitHash(branchName);
    if (!headCommit) {
      return { branchName, commits: [] };
    }

    // Walk the parent chain from HEAD
    const commits: Commit[] = [];
    let currentHash: string | null = headCommit;

    while (currentHash && commits.length < limit) {
      const commit: Commit | null = await this.commits.findOne({ hash: currentHash });
      if (!commit) break;
      commits.push(commit);
      // Follow first parent (for merge commits, first parent is the "into" branch)
      currentHash = commit.parentHashes.length > 0 ? commit.parentHashes[0]! : null;
    }

    return { branchName, commits };
  }

  /**
   * Find the nearest common ancestor (merge base) of two branches.
   * Uses $graphLookup to traverse commit ancestry server-side.
   */
  async getCommonAncestor(branchA: string, branchB: string): Promise<Commit | null> {
    const headA = await this.getHeadCommitHash(branchA);
    const headB = await this.getHeadCommitHash(branchB);
    if (!headA || !headB) return null;

    // Collect all ancestors of both branches using $graphLookup (server-side traversal)
    const collName = this.commits.collectionName;
    const [resultA] = await this.commits.aggregate<{
      ancestors: Array<{ hash: string; depth: number }>;
    }>([
      { $match: { hash: headA } },
      { $graphLookup: {
          from: collName,
          startWith: "$parentHashes",
          connectFromField: "parentHashes",
          connectToField: "hash",
          as: "ancestors",
          depthField: "depth",
      }},
      { $project: { ancestors: { hash: 1, depth: 1 } } },
    ]).toArray();

    const [resultB] = await this.commits.aggregate<{
      ancestors: Array<{ hash: string; depth: number }>;
    }>([
      { $match: { hash: headB } },
      { $graphLookup: {
          from: collName,
          startWith: "$parentHashes",
          connectFromField: "parentHashes",
          connectToField: "hash",
          as: "ancestors",
          depthField: "depth",
      }},
      { $project: { ancestors: { hash: 1, depth: 1 } } },
    ]).toArray();

    if (!resultA || !resultB) return null;

    // Include the HEAD commits themselves as depth -1 candidates
    const ancestorsAMap = new Map<string, number>();
    ancestorsAMap.set(headA, -1);
    for (const a of resultA.ancestors) {
      ancestorsAMap.set(a.hash, a.depth);
    }

    // Find intersection — the common ancestor with smallest depth from B
    let bestHash: string | null = null;
    let bestDepth = Infinity;

    // Check if B's HEAD is an ancestor of A
    if (ancestorsAMap.has(headB)) {
      bestHash = headB;
      bestDepth = -1;
    }

    for (const b of resultB.ancestors) {
      if (ancestorsAMap.has(b.hash) && b.depth < bestDepth) {
        bestHash = b.hash;
        bestDepth = b.depth;
      }
    }

    if (!bestHash) return null;
    return this.commits.findOne({ hash: bestHash });
  }

  /**
   * Count total commits on a branch.
   */
  async getCommitCount(branchName: string): Promise<number> {
    const log = await this.getLog(branchName, 10000);
    return log.commits.length;
  }

  // ── Tag Methods ────────────────────────────────────────────

  /**
   * Create an immutable tag pointing to a commit hash.
   * If no commitHash provided, tags the HEAD of the given branch.
   */
  async createTag(
    name: string,
    commitHashOrBranch: string,
    options: { message?: string; author?: string; isBranch?: boolean } = {}
  ): Promise<Tag> {
    let commitHash = commitHashOrBranch;

    // If isBranch, resolve to HEAD commit of that branch
    if (options.isBranch) {
      const headCommit = await this.getHeadCommitHash(commitHashOrBranch);
      if (!headCommit) {
        throw new Error(`Branch "${commitHashOrBranch}" has no commits to tag`);
      }
      commitHash = headCommit;
    }

    // Verify commit exists
    const commit = await this.commits.findOne({ hash: commitHash });
    if (!commit) {
      throw new Error(`Commit "${commitHash}" not found`);
    }

    // Check for duplicate tag name
    const existing = await this.tags.findOne({ name });
    if (existing) {
      throw new Error(`Tag "${name}" already exists (points to ${existing.commitHash.slice(0, 8)}). Delete it first to retag.`);
    }

    const tag: Tag = {
      name,
      commitHash,
      message: options.message,
      createdBy: options.author ?? "unknown",
      createdAt: new Date(),
    };

    await this.tags.insertOne({ ...tag });
    return tag;
  }

  /**
   * Delete a tag by name.
   */
  async deleteTag(name: string): Promise<boolean> {
    const result = await this.tags.deleteOne({ name });
    if (result.deletedCount === 0) {
      throw new Error(`Tag "${name}" not found`);
    }
    return true;
  }

  /**
   * List all tags, sorted by creation date (newest first).
   */
  async listTags(): Promise<Tag[]> {
    return this.tags.find().sort({ createdAt: -1 }).toArray();
  }

  /**
   * Get a tag by name, resolving it to its commit.
   */
  async getTag(name: string): Promise<{ tag: Tag; commit: Commit } | null> {
    const tag = await this.tags.findOne({ name });
    if (!tag) return null;

    const commit = await this.commits.findOne({ hash: tag.commitHash });
    if (!commit) return null;

    return { tag, commit };
  }

  // ── Cherry-Pick & Revert ───────────────────────────────────

  /**
   * Cherry-pick: apply ONE commit's changes to a target branch.
   * Computes the diff between the commit and its parent, then applies it.
   */
  async cherryPick(
    targetBranch: string,
    commitHash: string,
    author: string = "unknown"
  ): Promise<CherryPickResult> {
    const sourceCommit = await this.getCommit(commitHash);
    if (!sourceCommit) throw new Error(`Commit "${commitHash}" not found`);

    // Get the parent commit to compute the diff
    const parentHash = sourceCommit.parentHashes[0];
    const parentSnapshotDocs = parentHash ? await this.getCommitDocuments(parentHash) : {};
    const commitSnapshotDocs = await this.getCommitDocuments(sourceCommit.hash);

    // Resolve target database
    const targetDbName = await this.resolveBranchDbName(targetBranch);
    const targetDb = this.client.db(targetDbName);

    let added = 0, removed = 0, modified = 0;

    const allCollections = new Set([
      ...Object.keys(commitSnapshotDocs),
      ...Object.keys(parentSnapshotDocs),
    ]);

    // Apply all changes atomically in a transaction
    const session = this.client.startSession();
    let newCommitHash = "";
    try {
      await session.withTransaction(async () => {
        for (const colName of allCollections) {
          const delta = await this.applyCollectionDelta(
            targetDb,
            colName,
            parentSnapshotDocs[colName] ?? [],
            commitSnapshotDocs[colName] ?? [],
            session
          );
          if (delta.changed) {
            added += delta.added;
            removed += delta.removed;
            modified += delta.modified;
          }
        }

        const newCommit = await this.commit({
          branchName: targetBranch,
          message: `Cherry-pick: ${sourceCommit.message} (from ${commitHash.slice(0, 8)})`,
          author,
          collectionNames: Array.from(allCollections),
          session,
        });
        newCommitHash = newCommit.hash;
      });
    } finally {
      await session.endSession();
    }

    return {
      sourceCommitHash: commitHash,
      targetBranch,
      newCommitHash,
      documentsAdded: added,
      documentsRemoved: removed,
      documentsModified: modified,
      success: true,
    };
  }

  /**
   * Revert: undo ONE commit by applying inverse changes.
   * Creates a new commit that reverses the specified commit's changes.
   */
  async revert(
    branchName: string,
    commitHash: string,
    author: string = "unknown"
  ): Promise<RevertResult> {
    const targetCommit = await this.getCommit(commitHash);
    if (!targetCommit) throw new Error(`Commit "${commitHash}" not found`);

    const parentHash = targetCommit.parentHashes[0];
    const parentSnapshotDocs = parentHash ? await this.getCommitDocuments(parentHash) : {};
    const targetSnapshotDocs = await this.getCommitDocuments(targetCommit.hash);

    const branchDbName = await this.resolveBranchDbName(branchName);
    const branchDb = this.client.db(branchDbName);

    let reverted = 0;

    const allCollections = new Set([
      ...Object.keys(targetSnapshotDocs),
      ...Object.keys(parentSnapshotDocs),
    ]);

    // Apply revert atomically in a transaction
    const session = this.client.startSession();
    let newCommitHash = "";
    try {
      await session.withTransaction(async () => {
        for (const colName of allCollections) {
          const delta = await this.applyCollectionDelta(
            branchDb,
            colName,
            targetSnapshotDocs[colName] ?? [],
            parentSnapshotDocs[colName] ?? [],
            session
          );
          if (delta.changed) {
            reverted += delta.added + delta.removed + delta.modified;
          }
        }

        const newCommit = await this.commit({
          branchName,
          message: `Revert: ${targetCommit.message} (reverting ${commitHash.slice(0, 8)})`,
          author,
          collectionNames: Array.from(allCollections),
          session,
        });
        newCommitHash = newCommit.hash;
      });
    } finally {
      await session.endSession();
    }

    return {
      revertedCommitHash: commitHash,
      branchName,
      newCommitHash,
      documentsReverted: reverted,
      success: true,
    };
  }

  // ── Private Helpers ───────────────────────────────────────

  private async resolveBranchDbName(branchName: string, session?: ClientSession): Promise<string> {
    if (branchName === MAIN_BRANCH) {
      return this.config.sourceDatabase;
    }
    const meta = await this.branches.findOne({
      name: branchName,
      status: { $ne: "deleted" },
    }, session ? { session } : {});
    if (!meta) {
      throw new Error(`Branch "${branchName}" not found`);
    }
    return meta.branchDatabase;
  }

  private async applyCollectionDelta(
    db: { collection: (name: string) => { bulkWrite: Function } },
    collectionName: string,
    fromDocs: Record<string, unknown>[],
    toDocs: Record<string, unknown>[],
    session: ClientSession
  ): Promise<{ added: number; removed: number; modified: number; changed: boolean }> {
    const fromMap = new Map<string, Record<string, unknown>>();
    const toMap = new Map<string, Record<string, unknown>>();

    for (const doc of fromDocs) {
      fromMap.set(this.getDocumentKey(doc._id), doc);
    }
    for (const doc of toDocs) {
      toMap.set(this.getDocumentKey(doc._id), doc);
    }

    const ops: AnyBulkWriteOperation[] = [];
    let added = 0;
    let removed = 0;
    let modified = 0;

    for (const [key, toDoc] of toMap) {
      const fromDoc = fromMap.get(key);
      if (!fromDoc) {
        ops.push({
          replaceOne: {
            filter: { _id: toDoc._id as any },
            replacement: { ...toDoc },
            upsert: true,
          },
        });
        added++;
        continue;
      }

      if (this.stableSerialize(fromDoc) !== this.stableSerialize(toDoc)) {
        ops.push({
          replaceOne: {
            filter: { _id: toDoc._id as any },
            replacement: { ...toDoc },
            upsert: true,
          },
        });
        modified++;
      }
    }

    for (const [key, fromDoc] of fromMap) {
      if (!toMap.has(key)) {
        ops.push({
          deleteOne: { filter: { _id: fromDoc._id as any } },
        });
        removed++;
      }
    }

    if (ops.length > 0) {
      await db.collection(collectionName).bulkWrite(ops, { ordered: true, session });
    }

    return {
      added,
      removed,
      modified,
      changed: ops.length > 0,
    };
  }

  private async buildSnapshot(
    branchName: string,
    session: ClientSession,
    collectionNames: string[]
  ): Promise<CommitSnapshot> {
    const dbName = await this.resolveBranchDbName(branchName, session);
    const db = this.client.db(dbName);

    const snapshot: CommitSnapshot = { collections: {} };

    for (const collectionName of collectionNames) {
      // Skip system and meta collections
      if (collectionName.startsWith("system.") || collectionName.startsWith("__mongobranch")) continue;

      const collection = db.collection(collectionName);
      const docs = await collection
        .find({}, { session })
        .sort({ _id: 1 })
        .toArray()
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("ns not found") || message.includes("NamespaceNotFound")) {
            return [];
          }
          throw error;
        });
      const checksum = createHash("sha256")
        .update(docs.map((doc) => this.stableSerialize(doc as Record<string, unknown>)).join("\n"))
        .digest("hex")
        .slice(0, 16);

      snapshot.collections[collectionName] = { documentCount: docs.length, checksum };
    }

    return snapshot;
  }

  private async listSnapshotCollections(
    branchName: string,
    extraCollectionNames: string[]
  ): Promise<string[]> {
    const dbName = await this.resolveBranchDbName(branchName);
    const db = this.client.db(dbName);
    const collections = await db.listCollections().toArray();
    const names = new Set<string>();

    for (const coll of collections) {
      if (coll.name.startsWith("system.") || coll.name.startsWith("__mongobranch")) continue;
      names.add(coll.name);
    }
    for (const collectionName of extraCollectionNames) {
      if (collectionName.startsWith("system.") || collectionName.startsWith("__mongobranch")) continue;
      names.add(collectionName);
    }

    return Array.from(names).sort();
  }

  private getDocumentKey(id: unknown): string {
    if (id instanceof ObjectId) return id.toHexString();
    if (id instanceof Date) return id.toISOString();
    return JSON.stringify(id);
  }

  private stableSerialize(value: unknown): string {
    return JSON.stringify(this.normalizeForChecksum(value));
  }

  private normalizeForChecksum(value: unknown): unknown {
    if (value instanceof Date) {
      return { $date: value.toISOString() };
    }
    if (value instanceof ObjectId) {
      return { $oid: value.toHexString() };
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeForChecksum(item));
    }
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, this.normalizeForChecksum(child)]);
      return Object.fromEntries(entries);
    }
    return value;
  }

  private computeHash(
    branchName: string,
    parentHashes: string[],
    message: string,
    author: string,
    timestamp: Date,
    snapshot: CommitSnapshot
  ): string {
    const content = JSON.stringify({
      branchName,
      parentHashes,
      message,
      author,
      timestamp: timestamp.toISOString(),
      snapshot,
    });
    return createHash("sha256").update(content).digest("hex");
  }
}
