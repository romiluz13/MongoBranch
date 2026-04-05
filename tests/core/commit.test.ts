/**
 * TDD Tests for MongoBranch Commit Engine
 *
 * Content-addressed commit graph with SHA-256 hashing, parent chains,
 * merge commits, and common ancestor (merge base) detection.
 * Real MongoDB — no mocks.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient } from "mongodb";
import {
  startMongoDB,
  stopMongoDB,
  getTestEnvironment,
  cleanupBranches,
} from "../setup.ts";
import { CommitEngine } from "../../src/core/commit.ts";
import { BranchManager } from "../../src/core/branch.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";
import { SEED_DATABASE } from "../seed.ts";

let client: MongoClient;
let uri: string;
let config: MongoBranchConfig;
let commitEngine: CommitEngine;
let branchManager: BranchManager;

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
  uri = env.uri;
}, 30_000);

afterAll(async () => {
  await stopMongoDB();
}, 10_000);

beforeEach(async () => {
  await getTestEnvironment();
  await cleanupBranches(client);
  await client.db("__mongobranch").collection("commits").deleteMany({});
  await client.db("__mongobranch").collection("tags").deleteMany({});
  await client.db("__mongobranch").collection("commit_data").deleteMany({});

  config = {
    uri,
    sourceDatabase: SEED_DATABASE,
    metaDatabase: "__mongobranch",
    branchPrefix: "__mb_",
  };

  branchManager = new BranchManager(client, config);
  await branchManager.initialize();
  commitEngine = new CommitEngine(client, config);
  await commitEngine.initialize();
});

describe("CommitEngine.commit", () => {
  it("creates the first branch commit on top of the bootstrapped main baseline", async () => {
    const branch = await branchManager.createBranch({ name: "feat-commit" });

    const commit = await commitEngine.commit({
      branchName: "feat-commit",
      message: "Initial commit",
      author: "test-agent",
    });

    expect(commit.hash).toBeDefined();
    expect(commit.hash).toHaveLength(64); // SHA-256
    expect(commit.parentHashes).toEqual([branch.headCommit!]);
    expect(commit.branchName).toBe("feat-commit");
    expect(commit.message).toBe("Initial commit");
    expect(commit.author).toBe("test-agent");
    expect(commit.timestamp).toBeInstanceOf(Date);
    expect(commit.snapshot.collections).toBeDefined();
  });

  it("creates a chained commit with parent pointing to previous HEAD", async () => {
    await branchManager.createBranch({ name: "feat-chain" });

    const first = await commitEngine.commit({
      branchName: "feat-chain",
      message: "First commit",
    });

    const second = await commitEngine.commit({
      branchName: "feat-chain",
      message: "Second commit",
    });

    expect(second.parentHashes).toEqual([first.hash]);
    expect(second.hash).not.toBe(first.hash);
  });

  it("generates unique hashes for different messages on same state", async () => {
    await branchManager.createBranch({ name: "feat-hash" });

    const a = await commitEngine.commit({
      branchName: "feat-hash",
      message: "Message A",
    });
    // Reset HEAD to force same parent
    const b = await commitEngine.commit({
      branchName: "feat-hash",
      message: "Message B",
    });

    expect(a.hash).not.toBe(b.hash);
  });

  it("captures snapshot with collection document counts and checksums", async () => {
    await branchManager.createBranch({ name: "feat-snap" });

    const commit = await commitEngine.commit({
      branchName: "feat-snap",
      message: "Snapshot test",
    });

    const collections = Object.keys(commit.snapshot.collections);
    expect(collections.length).toBeGreaterThan(0);

    for (const name of collections) {
      const snap = commit.snapshot.collections[name]!;
      expect(snap.documentCount).toBeGreaterThan(0);
      expect(snap.checksum).toBeDefined();
      expect(snap.checksum.length).toBe(16); // truncated SHA-256
    }
  });
});

describe("CommitEngine.getCommit", () => {
  it("retrieves a commit by hash", async () => {
    await branchManager.createBranch({ name: "feat-get" });

    const created = await commitEngine.commit({
      branchName: "feat-get",
      message: "Findable commit",
    });

    const found = await commitEngine.getCommit(created.hash);
    expect(found).not.toBeNull();
    expect(found!.hash).toBe(created.hash);
    expect(found!.message).toBe("Findable commit");
  });

  it("returns null for non-existent hash", async () => {
    const result = await commitEngine.getCommit("deadbeef".repeat(8));
    expect(result).toBeNull();
  });
});

describe("CommitEngine.getLog", () => {
  it("walks the parent chain from HEAD in reverse chronological order", async () => {
    await branchManager.createBranch({ name: "feat-log" });

    await commitEngine.commit({ branchName: "feat-log", message: "Commit 1" });
    await commitEngine.commit({ branchName: "feat-log", message: "Commit 2" });
    await commitEngine.commit({ branchName: "feat-log", message: "Commit 3" });

    const log = await commitEngine.getLog("feat-log");
    expect(log.commits).toHaveLength(4);
    expect(log.commits[0]!.message).toBe("Commit 3"); // Most recent first
    expect(log.commits[1]!.message).toBe("Commit 2");
    expect(log.commits[2]!.message).toBe("Commit 1");
    expect(log.commits[3]!.message).toBe("chore: bootstrap main history");
  });

  it("returns empty log for branch with no commits", async () => {
    await branchManager.createBranch({ name: "feat-empty" });
    const log = await commitEngine.getLog("feat-empty");
    expect(log.commits).toHaveLength(1);
    expect(log.commits[0]!.message).toBe("chore: bootstrap main history");
  });

  it("respects limit parameter", async () => {
    await branchManager.createBranch({ name: "feat-limit" });

    for (let i = 0; i < 5; i++) {
      await commitEngine.commit({ branchName: "feat-limit", message: `Commit ${i}` });
    }

    const log = await commitEngine.getLog("feat-limit", 2);
    expect(log.commits).toHaveLength(2);
    expect(log.commits[0]!.message).toBe("Commit 4"); // Most recent
  });
});

describe("CommitEngine.getCommonAncestor", () => {
  it("finds the nearest common ancestor of two branches", async () => {
    // Create branch A, make a shared commit
    await branchManager.createBranch({ name: "ancestor-a" });
    const shared = await commitEngine.commit({
      branchName: "ancestor-a",
      message: "Shared ancestor",
    });

    // Create branch B from same source, and give it the same shared commit as base
    await branchManager.createBranch({ name: "ancestor-b" });
    // Give branch B a commit with shared as parent
    await commitEngine.commit({
      branchName: "ancestor-b",
      message: "Branch B start",
      parentOverrides: [shared.hash],
    });

    // Diverge: add more commits to both branches
    await commitEngine.commit({ branchName: "ancestor-a", message: "A diverges" });
    await commitEngine.commit({ branchName: "ancestor-b", message: "B diverges" });

    const ancestor = await commitEngine.getCommonAncestor("ancestor-a", "ancestor-b");
    expect(ancestor).not.toBeNull();
    expect(ancestor!.hash).toBe(shared.hash);
    expect(ancestor!.message).toBe("Shared ancestor");
  });

  it("returns null when branches have no common ancestor", async () => {
    await branchManager.createBranch({ name: "island-a" });
    await branchManager.createBranch({ name: "island-b" });

    await commitEngine.commit({
      branchName: "island-a",
      message: "A alone",
      parentOverrides: [],
    });
    await commitEngine.commit({
      branchName: "island-b",
      message: "B alone",
      parentOverrides: [],
    });

    const ancestor = await commitEngine.getCommonAncestor("island-a", "island-b");
    expect(ancestor).toBeNull();
  });
});

describe("CommitEngine — branch ancestry wiring", () => {
  it("bootstraps main history when creating the first branch from main", async () => {
    const created = await branchManager.createBranch({ name: "main-derived" });
    const mainLog = await commitEngine.getLog("main");

    expect(mainLog.commits).toHaveLength(1);
    expect(mainLog.commits[0]!.message).toBe("chore: bootstrap main history");
    expect(created.headCommit).toBe(mainLog.commits[0]!.hash);
  });

  it("inherits the parent head commit when creating a child branch", async () => {
    await branchManager.createBranch({ name: "parent-head" });
    const base = await commitEngine.commit({
      branchName: "parent-head",
      message: "Parent base",
    });

    await branchManager.createBranch({ name: "child-head", from: "parent-head" });
    const child = await branchManager.getBranch("child-head");
    expect(child).not.toBeNull();
    expect(child!.headCommit).toBe(base.hash);

    const childCommit = await commitEngine.commit({
      branchName: "child-head",
      message: "Child change",
    });
    expect(childCommit.parentHashes).toEqual([base.hash]);
  });
});

describe("CommitEngine.getCommitCount", () => {
  it("counts total commits on a branch", async () => {
    await branchManager.createBranch({ name: "feat-count" });

    await commitEngine.commit({ branchName: "feat-count", message: "One" });
    await commitEngine.commit({ branchName: "feat-count", message: "Two" });
    await commitEngine.commit({ branchName: "feat-count", message: "Three" });

    const count = await commitEngine.getCommitCount("feat-count");
    expect(count).toBe(4);
  });
});

describe("CommitEngine — merge commits", () => {
  it("supports merge commits with two parent hashes", async () => {
    await branchManager.createBranch({ name: "merge-src" });

    const baseCommit = await commitEngine.commit({
      branchName: "merge-src",
      message: "Base for merge",
    });

    await branchManager.createBranch({ name: "merge-target" });
    const targetCommit = await commitEngine.commit({
      branchName: "merge-target",
      message: "Target HEAD",
    });

    // Create a merge commit on merge-target with two parents
    const mergeCommit = await commitEngine.commit({
      branchName: "merge-target",
      message: "Merge merge-src into merge-target",
      parentOverrides: [targetCommit.hash, baseCommit.hash],
    });

    expect(mergeCommit.parentHashes).toHaveLength(2);
    expect(mergeCommit.parentHashes[0]).toBe(targetCommit.hash);
    expect(mergeCommit.parentHashes[1]).toBe(baseCommit.hash);
  });
});



// ── Tag Tests ──────────────────────────────────────────────

describe("CommitEngine.createTag", () => {
  it("creates a tag pointing to a commit hash", async () => {
    await branchManager.createBranch({ name: "feat-tag" });
    const commit = await commitEngine.commit({
      branchName: "feat-tag",
      message: "Tag target",
    });

    const tag = await commitEngine.createTag("v1.0", commit.hash, {
      message: "First release",
      author: "tester",
    });

    expect(tag.name).toBe("v1.0");
    expect(tag.commitHash).toBe(commit.hash);
    expect(tag.message).toBe("First release");
    expect(tag.createdBy).toBe("tester");
    expect(tag.createdAt).toBeInstanceOf(Date);
  });

  it("creates a tag from branch HEAD when isBranch=true", async () => {
    await branchManager.createBranch({ name: "feat-tag-head" });
    const commit = await commitEngine.commit({
      branchName: "feat-tag-head",
      message: "HEAD commit",
    });

    const tag = await commitEngine.createTag("latest", "feat-tag-head", {
      isBranch: true,
    });

    expect(tag.commitHash).toBe(commit.hash);
  });

  it("rejects duplicate tag names (immutability enforcement)", async () => {
    await branchManager.createBranch({ name: "feat-dup-tag" });
    const commit = await commitEngine.commit({
      branchName: "feat-dup-tag",
      message: "For duplication test",
    });

    await commitEngine.createTag("v2.0", commit.hash);

    await expect(
      commitEngine.createTag("v2.0", commit.hash)
    ).rejects.toThrow(/already exists/);
  });

  it("rejects tag to non-existent commit", async () => {
    await expect(
      commitEngine.createTag("phantom", "deadbeef".repeat(8))
    ).rejects.toThrow(/not found/);
  });
});

describe("CommitEngine.getTag", () => {
  it("resolves a tag to its commit", async () => {
    await branchManager.createBranch({ name: "feat-resolve" });
    const commit = await commitEngine.commit({
      branchName: "feat-resolve",
      message: "Resolvable",
    });

    await commitEngine.createTag("resolvable", commit.hash);
    const result = await commitEngine.getTag("resolvable");

    expect(result).not.toBeNull();
    expect(result!.tag.name).toBe("resolvable");
    expect(result!.commit.hash).toBe(commit.hash);
    expect(result!.commit.message).toBe("Resolvable");
  });

  it("returns null for non-existent tag", async () => {
    const result = await commitEngine.getTag("nope");
    expect(result).toBeNull();
  });
});

describe("CommitEngine.listTags", () => {
  it("lists all tags sorted by creation date (newest first)", async () => {
    await branchManager.createBranch({ name: "feat-list-tags" });
    const c1 = await commitEngine.commit({ branchName: "feat-list-tags", message: "C1" });
    const c2 = await commitEngine.commit({ branchName: "feat-list-tags", message: "C2" });

    await commitEngine.createTag("alpha", c1.hash);
    // Small delay to ensure distinct timestamps for sort ordering
    await new Promise((r) => setTimeout(r, 50));
    await commitEngine.createTag("beta", c2.hash);

    const tags = await commitEngine.listTags();
    expect(tags.length).toBeGreaterThanOrEqual(2);
    const names = tags.map((t) => t.name);
    expect(names.indexOf("beta")).toBeLessThan(names.indexOf("alpha"));
  });
});

describe("CommitEngine.deleteTag", () => {
  it("deletes a tag by name", async () => {
    await branchManager.createBranch({ name: "feat-del-tag" });
    const commit = await commitEngine.commit({
      branchName: "feat-del-tag",
      message: "Delete me",
    });

    await commitEngine.createTag("deletable", commit.hash);
    await commitEngine.deleteTag("deletable");

    const result = await commitEngine.getTag("deletable");
    expect(result).toBeNull();
  });

  it("throws when deleting non-existent tag", async () => {
    await expect(commitEngine.deleteTag("ghost")).rejects.toThrow(/not found/);
  });
});

// ── Cherry-Pick Tests ──────────────────────────────────────

describe("CommitEngine.cherryPick", () => {
  it("applies a single commit's changes to a target branch", async () => {
    await branchManager.createBranch({ name: "cp-source" });
    await branchManager.createBranch({ name: "cp-target" });

    // Commit on source
    await commitEngine.commit({ branchName: "cp-source", message: "Base state" });

    // Make a change in source branch
    const sourceDb = client.db("__mb_cp-source");
    await sourceDb.collection("cherry_test").insertOne({ name: "cherry-data", value: 42 });
    const changeCommit = await commitEngine.commit({
      branchName: "cp-source",
      message: "Add cherry-data",
    });

    // Commit on target so it has a HEAD
    await commitEngine.commit({ branchName: "cp-target", message: "Target base" });

    // Cherry-pick the change commit onto target
    const result = await commitEngine.cherryPick("cp-target", changeCommit.hash, "picker");

    expect(result.success).toBe(true);
    expect(result.sourceCommitHash).toBe(changeCommit.hash);
    expect(result.newCommitHash).toBeDefined();
    expect(result.newCommitHash).not.toBe(changeCommit.hash);
  });

  it("creates a new commit on the target branch with cherry-pick message", async () => {
    await branchManager.createBranch({ name: "cp-msg-src" });
    await branchManager.createBranch({ name: "cp-msg-tgt" });

    await commitEngine.commit({ branchName: "cp-msg-src", message: "Base" });
    const sourceDb = client.db("__mb_cp-msg-src");
    await sourceDb.collection("cp_msg").insertOne({ data: true });
    const pickMe = await commitEngine.commit({ branchName: "cp-msg-src", message: "Important change" });

    await commitEngine.commit({ branchName: "cp-msg-tgt", message: "Target base" });
    await commitEngine.cherryPick("cp-msg-tgt", pickMe.hash);

    const log = await commitEngine.getLog("cp-msg-tgt");
    expect(log.commits[0]!.message).toContain("Cherry-pick");
    expect(log.commits[0]!.message).toContain("Important change");
  });

  it("throws for non-existent commit hash", async () => {
    await branchManager.createBranch({ name: "cp-err" });
    await expect(
      commitEngine.cherryPick("cp-err", "deadbeef".repeat(8))
    ).rejects.toThrow(/not found/);
  });

  it("replays content-only document updates onto the target branch", async () => {
    await branchManager.createBranch({ name: "cp-content-src" });
    await branchManager.createBranch({ name: "cp-content-tgt" });

    await commitEngine.commit({ branchName: "cp-content-src", message: "Base" });
    await commitEngine.commit({ branchName: "cp-content-tgt", message: "Target base" });

    const sourceDb = client.db("__mb_cp-content-src");
    await sourceDb.collection("users").updateOne(
      { name: "Alice Chen" },
      { $set: { salary: 150000 } }
    );
    const changeCommit = await commitEngine.commit({
      branchName: "cp-content-src",
      message: "Raise Alice salary",
    });

    await commitEngine.cherryPick("cp-content-tgt", changeCommit.hash, "picker");

    const targetDb = client.db("__mb_cp-content-tgt");
    const alice = await targetDb.collection("users").findOne({ name: "Alice Chen" });
    expect(alice).not.toBeNull();
    expect(alice!.salary).toBe(150000);
  });

  it("captures the cherry-picked state in the new commit snapshot", async () => {
    await branchManager.createBranch({ name: "cp-snap-src" });
    await branchManager.createBranch({ name: "cp-snap-tgt" });

    await commitEngine.commit({ branchName: "cp-snap-src", message: "Base" });
    await commitEngine.commit({ branchName: "cp-snap-tgt", message: "Target base" });

    const sourceDb = client.db("__mb_cp-snap-src");
    await sourceDb.collection("users").updateOne(
      { name: "Alice Chen" },
      { $set: { salary: 155000 } }
    );
    const changeCommit = await commitEngine.commit({
      branchName: "cp-snap-src",
      message: "Raise Alice salary again",
    });

    const result = await commitEngine.cherryPick("cp-snap-tgt", changeCommit.hash, "picker");
    const snapshot = await commitEngine.getCommitDocuments(result.newCommitHash);
    const alice = snapshot.users?.find((doc) => doc.name === "Alice Chen");

    expect(alice).toBeDefined();
    expect(alice!.salary).toBe(155000);
  });
});

// ── Revert Tests ───────────────────────────────────────────

describe("CommitEngine.revert", () => {
  it("creates a revert commit that undoes a previous commit", async () => {
    await branchManager.createBranch({ name: "rev-test" });

    const first = await commitEngine.commit({ branchName: "rev-test", message: "First" });

    // Make a change
    const db = client.db("__mb_rev-test");
    await db.collection("rev_data").insertOne({ temp: true });
    const second = await commitEngine.commit({ branchName: "rev-test", message: "Add temp data" });

    // Revert the second commit
    const result = await commitEngine.revert("rev-test", second.hash, "reverter");

    expect(result.success).toBe(true);
    expect(result.revertedCommitHash).toBe(second.hash);
    expect(result.newCommitHash).toBeDefined();
  });

  it("creates a revert commit with proper message", async () => {
    await branchManager.createBranch({ name: "rev-msg" });
    await commitEngine.commit({ branchName: "rev-msg", message: "Base" });

    const db = client.db("__mb_rev-msg");
    await db.collection("rev_msg_data").insertOne({ x: 1 });
    const toRevert = await commitEngine.commit({ branchName: "rev-msg", message: "Bad change" });

    await commitEngine.revert("rev-msg", toRevert.hash);

    const log = await commitEngine.getLog("rev-msg");
    expect(log.commits[0]!.message).toContain("Revert");
    expect(log.commits[0]!.message).toContain("Bad change");
  });

  it("throws for non-existent commit hash", async () => {
    await branchManager.createBranch({ name: "rev-err" });
    await expect(
      commitEngine.revert("rev-err", "deadbeef".repeat(8))
    ).rejects.toThrow(/not found/);
  });

  it("restores content for reverted field-only changes", async () => {
    await branchManager.createBranch({ name: "rev-content" });
    await commitEngine.commit({ branchName: "rev-content", message: "Base" });

    const db = client.db("__mb_rev-content");
    await db.collection("users").updateOne(
      { name: "Bob Martinez" },
      { $set: { salary: 125000 } }
    );
    const badCommit = await commitEngine.commit({
      branchName: "rev-content",
      message: "Bad salary edit",
    });

    await commitEngine.revert("rev-content", badCommit.hash, "reverter");

    const bob = await db.collection("users").findOne({ name: "Bob Martinez" });
    expect(bob).not.toBeNull();
    expect(bob!.salary).toBe(120000);
  });

  it("captures the reverted state in the new commit snapshot", async () => {
    await branchManager.createBranch({ name: "rev-snap" });
    await commitEngine.commit({ branchName: "rev-snap", message: "Base" });

    const db = client.db("__mb_rev-snap");
    await db.collection("users").updateOne(
      { name: "Bob Martinez" },
      { $set: { salary: 130000 } }
    );
    const badCommit = await commitEngine.commit({
      branchName: "rev-snap",
      message: "Bad salary raise",
    });

    const result = await commitEngine.revert("rev-snap", badCommit.hash, "reverter");
    const snapshot = await commitEngine.getCommitDocuments(result.newCommitHash);
    const bob = snapshot.users?.find((doc) => doc.name === "Bob Martinez");

    expect(bob).toBeDefined();
    expect(bob!.salary).toBe(120000);
  });
});
