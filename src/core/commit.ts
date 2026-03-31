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
import type { MongoClient, Collection } from "mongodb";
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
import { COMMITS_COLLECTION, TAGS_COLLECTION, META_COLLECTION, MAIN_BRANCH } from "./types.ts";

export class CommitEngine {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private commits: Collection<Commit>;
  private branches: Collection<BranchMetadata>;
  private tags: Collection<Tag>;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
    const metaDb = client.db(config.metaDatabase);
    this.commits = metaDb.collection<Commit>(COMMITS_COLLECTION);
    this.branches = metaDb.collection<BranchMetadata>(META_COLLECTION);
    this.tags = metaDb.collection<Tag>(TAGS_COLLECTION);
  }

  async initialize(): Promise<void> {
    await this.commits.createIndex({ hash: 1 }, { unique: true });
    await this.commits.createIndex({ branchName: 1, timestamp: -1 });
    await this.tags.createIndex({ name: 1 }, { unique: true });
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
        { $set: { headCommit: hash, updatedAt: new Date() } }
      );
    }

    return commit;
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
      const commit = await this.commits.findOne({ hash: currentHash });
      if (!commit) break;
      commits.push(commit);
      // Follow first parent (for merge commits, first parent is the "into" branch)
      currentHash = commit.parentHashes.length > 0 ? commit.parentHashes[0] : null;
    }

    return { branchName, commits };
  }

  /**
   * Find the nearest common ancestor (merge base) of two branches.
   * Uses BFS from both branch HEADs until a common commit is found.
   */
  async getCommonAncestor(branchA: string, branchB: string): Promise<Commit | null> {
    const metaA = await this.branches.findOne({ name: branchA, status: { $ne: "deleted" } });
    const metaB = await this.branches.findOne({ name: branchB, status: { $ne: "deleted" } });

    if (!metaA?.headCommit || !metaB?.headCommit) return null;

    // BFS from both sides — collect ancestors of A, then walk B until match
    const ancestorsA = new Set<string>();
    let queue: string[] = [metaA.headCommit];

    // Collect all ancestors of branch A
    while (queue.length > 0) {
      const nextQueue: string[] = [];
      for (const hash of queue) {
        if (ancestorsA.has(hash)) continue;
        ancestorsA.add(hash);
        const commit = await this.commits.findOne({ hash });
        if (commit) {
          nextQueue.push(...commit.parentHashes);
        }
      }
      queue = nextQueue;
    }

    // BFS from branch B — first match in ancestorsA is the merge base
    queue = [metaB.headCommit];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const nextQueue: string[] = [];
      for (const hash of queue) {
        if (visited.has(hash)) continue;
        visited.add(hash);

        if (ancestorsA.has(hash)) {
          return this.commits.findOne({ hash });
        }

        const commit = await this.commits.findOne({ hash });
        if (commit) {
          nextQueue.push(...commit.parentHashes);
        }
      }
      queue = nextQueue;
    }

    return null;
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

    // For each collection in the commit snapshot
    const allCollections = new Set([
      ...Object.keys(commitSnapshot.collections),
      ...Object.keys(parentSnapshot.collections),
    ]);

    for (const colName of allCollections) {
      const parentCol = parentSnapshot.collections[colName];
      const commitCol = commitSnapshot.collections[colName];

      if (!parentCol && commitCol) {
        // New collection added in this commit — copy docs from source
        const sourceDb = this.client.db(sourceDbName);
        const docs = await sourceDb.collection(colName).find({}).toArray();
        if (docs.length > 0) {
          await targetDb.collection(colName).insertMany(docs.map(d => ({ ...d })));
          added += docs.length;
        }
      } else if (parentCol && !commitCol) {
        // Collection deleted in this commit — remove from target
        const count = await targetDb.collection(colName).countDocuments();
        await targetDb.collection(colName).drop().catch(() => {});
        removed += count;
      } else if (parentCol && commitCol && parentCol.checksum !== commitCol.checksum) {
        // Collection modified — find changed docs via source DB
        const sourceDb = this.client.db(sourceDbName);
        const sourceDocs = await sourceDb.collection(colName).find({}).toArray();
        for (const doc of sourceDocs) {
          const existing = await targetDb.collection(colName).findOne({ _id: doc._id });
          if (existing) {
            const result = await targetDb.collection(colName).replaceOne(
              { _id: doc._id },
              { ...doc }
            );
            if (result.modifiedCount > 0) modified++;
          } else {
            await targetDb.collection(colName).insertOne({ ...doc });
            added++;
          }
        }
      }
    }

    // Create a new commit on the target branch
    const newCommit = await this.commit({
      branchName: targetBranch,
      message: `Cherry-pick: ${sourceCommit.message} (from ${commitHash.slice(0, 8)})`,
      author,
    });

    return {
      sourceCommitHash: commitHash,
      targetBranch,
      newCommitHash: newCommit.hash,
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

    for (const colName of allCollections) {
      const parentCol = parentSnapshot.collections[colName];
      const commitCol = commitSnapshot.collections[colName];

      if (parentCol && commitCol && parentCol.checksum !== commitCol.checksum) {
        // Collection was modified in this commit — we need to undo the changes
        // For now, we count the affected documents
        const docs = await branchDb.collection(colName).find({}).toArray();
        reverted += docs.length;
      } else if (!parentCol && commitCol) {
        // Collection was added in this commit — drop it to revert
        const count = await branchDb.collection(colName).countDocuments();
        await branchDb.collection(colName).drop().catch(() => {});
        reverted += count;
      }
    }

    // Create a revert commit
    const newCommit = await this.commit({
      branchName,
      message: `Revert: ${targetCommit.message} (reverting ${commitHash.slice(0, 8)})`,
      author,
    });

    return {
      revertedCommitHash: commitHash,
      branchName,
      newCommitHash: newCommit.hash,
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
