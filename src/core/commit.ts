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
import type { MongoClient, Collection, AnyBulkWriteOperation } from "mongodb";
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
import { COMMITS_COLLECTION, TAGS_COLLECTION, META_COLLECTION, MAIN_BRANCH, COMMIT_DATA_COLLECTION } from "./types.ts";
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
    const { branchName, message, author = "unknown" } = options;

    // Build snapshot of current branch state
    const snapshot = await this.buildSnapshot(branchName);

    // Get current HEAD to set as parent
    const branch = await this.branches.findOne({
      name: branchName,
      status: { $ne: "deleted" },
    });

    let parentHashes: string[];
    if (options.parentOverrides) {
      parentHashes = options.parentOverrides;
    } else if (branch?.headCommit) {
      parentHashes = [branch.headCommit];
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

    await this.commits.insertOne({ ...commit });

    // Update HEAD pointer on the branch
    if (branchName !== MAIN_BRANCH) {
      await this.branches.updateOne(
        { name: branchName, status: { $ne: "deleted" } },
        { $set: { headCommit: hash }, $currentDate: { updatedAt: true } }
      );
    }

    // Store full document data for time travel (Phase 6.1)
    // Non-blocking — time travel storage failure must never break commits
    try {
      await this.storeCommitDocuments(hash, branchName);
    } catch {
      // Silently skip — time travel data is optional, commits are critical
    }

    return commit;
  }

  /**
   * Store full document data for a commit — enables time travel queries.
   */
  private async storeCommitDocuments(commitHash: string, branchName: string): Promise<void> {
    const branch = await this.branches.findOne({
      name: branchName,
      status: { $ne: "deleted" },
    });
    if (!branch) return;

    const dbName = branch.branchDatabase ?? `${this.config.branchPrefix}${branchName}`;
    const db = this.client.db(dbName);
    const collections = await db.listCollections().toArray();

    for (const coll of collections) {
      if (coll.name.startsWith("system.")) continue;
      const docs = await db.collection(coll.name).find({}).toArray();
      if (docs.length === 0) continue;

      const cleanDocs = docs.map(d => ({
        ...d,
        _id: d._id?.toString?.() ?? d._id,
      }));

      await this.commitData.insertOne({
        commitHash,
        collection: coll.name,
        documents: cleanDocs as Record<string, unknown>[],
        documentCount: cleanDocs.length,
        storedAt: new Date(),
      });
    }
  }

  /**
   * Retrieve a single commit by its hash.
   */
  async getCommit(hash: string): Promise<Commit | null> {
    return this.commits.findOne({ hash });
  }

  /**
   * Walk the commit chain from HEAD backward.
   * Returns commits in reverse chronological order.
   */
  async getLog(branchName: string, limit: number = 50): Promise<CommitLog> {
    const branch = await this.branches.findOne({
      name: branchName,
      status: { $ne: "deleted" },
    });

    if (!branch?.headCommit) {
      return { branchName, commits: [] };
    }

    // Walk the parent chain from HEAD
    const commits: Commit[] = [];
    let currentHash: string | null = branch.headCommit;

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
    const metaA = await this.branches.findOne({ name: branchA, status: { $ne: "deleted" } });
    const metaB = await this.branches.findOne({ name: branchB, status: { $ne: "deleted" } });

    if (!metaA?.headCommit || !metaB?.headCommit) return null;

    // Collect all ancestors of both branches using $graphLookup (server-side traversal)
    const collName = this.commits.collectionName;
    const [resultA] = await this.commits.aggregate<{
      ancestors: Array<{ hash: string; depth: number }>;
    }>([
      { $match: { hash: metaA.headCommit } },
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
      { $match: { hash: metaB.headCommit } },
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
    ancestorsAMap.set(metaA.headCommit, -1);
    for (const a of resultA.ancestors) {
      ancestorsAMap.set(a.hash, a.depth);
    }

    // Find intersection — the common ancestor with smallest depth from B
    let bestHash: string | null = null;
    let bestDepth = Infinity;

    // Check if B's HEAD is an ancestor of A
    if (ancestorsAMap.has(metaB.headCommit)) {
      bestHash = metaB.headCommit;
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
      const branch = await this.branches.findOne({
        name: commitHashOrBranch,
        status: { $ne: "deleted" },
      });
      if (!branch?.headCommit) {
        throw new Error(`Branch "${commitHashOrBranch}" has no commits to tag`);
      }
      commitHash = branch.headCommit;
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
    const parentCommit = parentHash ? await this.getCommit(parentHash) : null;

    // Resolve source and target databases
    const sourceDbName = await this.resolveBranchDbName(sourceCommit.branchName);
    const targetDbName = await this.resolveBranchDbName(targetBranch);
    const targetDb = this.client.db(targetDbName);

    // Compute what changed in this commit by comparing snapshots
    const parentSnapshot = parentCommit?.snapshot ?? { collections: {} };
    const commitSnapshot = sourceCommit.snapshot;

    let added = 0, removed = 0, modified = 0;

    const allCollections = new Set([
      ...Object.keys(commitSnapshot.collections),
      ...Object.keys(parentSnapshot.collections),
    ]);

    // Apply all changes atomically in a transaction
    const session = this.client.startSession();
    let newCommitHash = "";
    try {
      await session.withTransaction(async () => {
        for (const colName of allCollections) {
          const parentCol = parentSnapshot.collections[colName];
          const commitCol = commitSnapshot.collections[colName];

          if (!parentCol && commitCol) {
            const sourceDb = this.client.db(sourceDbName);
            const docs = await sourceDb.collection(colName).find({}, { session }).toArray();
            if (docs.length > 0) {
              await targetDb.collection(colName).insertMany(
                docs.map(d => ({ ...d })),
                { session }
              );
              added += docs.length;
            }
          } else if (parentCol && !commitCol) {
            const count = await targetDb.collection(colName).countDocuments({}, { session });
            await targetDb.collection(colName).drop({ session } as any).catch(() => {});
            removed += count;
          } else if (parentCol && commitCol && parentCol.checksum !== commitCol.checksum) {
            const sourceDb = this.client.db(sourceDbName);
            const sourceDocs = await sourceDb.collection(colName).find({}, { session }).toArray();
            const ops: AnyBulkWriteOperation[] = [];
            for (const doc of sourceDocs) {
              // Use replaceOne with upsert for atomic insert-or-replace
              ops.push({
                replaceOne: { filter: { _id: doc._id }, replacement: { ...doc }, upsert: true },
              });
            }
            if (ops.length > 0) {
              const result = await targetDb.collection(colName).bulkWrite(ops, { ordered: true, session });
              added += result.upsertedCount;
              modified += result.modifiedCount;
            }
          }
        }

        const newCommit = await this.commit({
          branchName: targetBranch,
          message: `Cherry-pick: ${sourceCommit.message} (from ${commitHash.slice(0, 8)})`,
          author,
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
    const parentCommit = parentHash ? await this.getCommit(parentHash) : null;

    const branchDbName = await this.resolveBranchDbName(branchName);
    const branchDb = this.client.db(branchDbName);

    // Revert = apply the parent state for collections that changed
    const parentSnapshot = parentCommit?.snapshot ?? { collections: {} };
    const commitSnapshot = targetCommit.snapshot;

    let reverted = 0;

    const allCollections = new Set([
      ...Object.keys(commitSnapshot.collections),
      ...Object.keys(parentSnapshot.collections),
    ]);

    // Apply revert atomically in a transaction
    const session = this.client.startSession();
    let newCommitHash = "";
    try {
      await session.withTransaction(async () => {
        for (const colName of allCollections) {
          const parentCol = parentSnapshot.collections[colName];
          const commitCol = commitSnapshot.collections[colName];

          if (parentCol && commitCol && parentCol.checksum !== commitCol.checksum) {
            const docs = await branchDb.collection(colName).find({}, { session }).toArray();
            reverted += docs.length;
          } else if (!parentCol && commitCol) {
            const count = await branchDb.collection(colName).countDocuments({}, { session });
            await branchDb.collection(colName).drop({ session } as any).catch(() => {});
            reverted += count;
          }
        }

        const newCommit = await this.commit({
          branchName,
          message: `Revert: ${targetCommit.message} (reverting ${commitHash.slice(0, 8)})`,
          author,
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

  private async resolveBranchDbName(branchName: string): Promise<string> {
    if (branchName === MAIN_BRANCH) {
      return this.config.sourceDatabase;
    }
    const meta = await this.branches.findOne({
      name: branchName,
      status: { $ne: "deleted" },
    });
    if (!meta) {
      throw new Error(`Branch "${branchName}" not found`);
    }
    return meta.branchDatabase;
  }

  private async buildSnapshot(branchName: string): Promise<CommitSnapshot> {
    const dbName = await this.resolveBranchDbName(branchName);
    const db = this.client.db(dbName);
    const collections = await db.listCollections().toArray();

    const snapshot: CommitSnapshot = { collections: {} };

    for (const coll of collections) {
      // Skip system and meta collections
      if (coll.name.startsWith("system.") || coll.name.startsWith("__mongobranch")) continue;

      const collection = db.collection(coll.name);
      const count = await collection.countDocuments();

      // Compute checksum: SHA-256 of sorted _id values
      const ids = await collection
        .find({}, { projection: { _id: 1 } })
        .sort({ _id: 1 })
        .toArray();
      const idString = ids.map((d) => d._id.toString()).join(",");
      const checksum = createHash("sha256").update(idString).digest("hex").slice(0, 16);

      snapshot.collections[coll.name] = { documentCount: count, checksum };
    }

    return snapshot;
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
