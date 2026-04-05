/**
 * MongoBranch — Deploy Request Tests
 *
 * Phase 6.3: PR-like workflow for merging to protected branches
 * Flow: open → approve → execute (merge)
 *
 * TDD, real MongoDB, zero mocks.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient } from "mongodb";
import { startMongoDB, stopMongoDB } from "../setup.ts";
import { BranchManager } from "../../src/core/branch.ts";
import { CommitEngine } from "../../src/core/commit.ts";
import { DeployRequestManager } from "../../src/core/deploy.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";

let client: MongoClient;
let branchManager: BranchManager;
let deployManager: DeployRequestManager;
let commitEngine: CommitEngine;

const config: MongoBranchConfig = {
  uri: "",
  sourceDatabase: "test_deploy_source",
  metaDatabase: "__mongobranch_deploy",
  branchPrefix: "__mb_dr_",
};

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
  branchManager = new BranchManager(client, config);
  deployManager = new DeployRequestManager(client, config);
  commitEngine = new CommitEngine(client, config);
  await branchManager.initialize();
  await deployManager.initialize();
  await commitEngine.initialize();
}, 30_000);

afterAll(async () => {
  if (client) {
    const dbs = await client.db().admin().listDatabases();
    for (const db of dbs.databases) {
      if (db.name.startsWith("__mb_dr_") || db.name.startsWith("__mongobranch_deploy") || db.name === "test_deploy_source") {
        await client.db(db.name).dropDatabase();
      }
    }
  }
  await stopMongoDB();
}, 10_000);

beforeEach(async () => {
  await client.db(config.metaDatabase).collection("branches").deleteMany({});
  await client.db(config.metaDatabase).collection("deploy_requests").deleteMany({});
  await client.db(config.metaDatabase).collection("hooks").deleteMany({});
  await client.db(config.metaDatabase).collection("commits").deleteMany({});
  await client.db(config.metaDatabase).collection("commit_data").deleteMany({});
  await client.db(config.metaDatabase).collection("tags").deleteMany({});

  // Drop branch databases with retry and clear source collections in place.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { databases } = await client.db("admin").command({ listDatabases: 1 });
      for (const db of databases) {
        if (db.name.startsWith(config.branchPrefix)) {
          await client.db(db.name).dropDatabase().catch(() => {});
        }
      }

      const sourceDb = client.db(config.sourceDatabase);
      const collections = await sourceDb.listCollections().toArray().catch(() => []);
      for (const collection of collections) {
        if (collection.name.startsWith("system.")) continue;
        await sourceDb.collection(collection.name).deleteMany({});
      }

      await sourceDb.collection("users").insertMany([
        { name: "Alice", role: "admin" },
        { name: "Bob", role: "user" },
      ]);
      break;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 2 || !message.includes("being dropped")) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
});

// ── Deploy Request Tests ──────────────────────────────────

describe("DeployRequest — open", () => {
  it("creates a deploy request with diff", async () => {
    await branchManager.createBranch({ name: "feature-1" });
    // main doesn't exist as a branch — create it
    await branchManager.createBranch({ name: "main-target" });

    // Make changes on feature-1
    const branchDb = client.db(`${config.branchPrefix}feature-1`);
    await branchDb.collection("users").insertOne({ name: "Charlie", role: "viewer" });

    const dr = await deployManager.open({
      sourceBranch: "feature-1",
      targetBranch: "main-target",
      description: "Add Charlie user",
      createdBy: "alice",
    });

    expect(dr.id).toBeDefined();
    expect(dr.id.length).toBe(8);
    expect(dr.sourceBranch).toBe("feature-1");
    expect(dr.targetBranch).toBe("main-target");
    expect(dr.status).toBe("open");
    expect(dr.createdBy).toBe("alice");
    expect(dr.description).toBe("Add Charlie user");
  });

  it("allows deploy requests that target main", async () => {
    await branchManager.createBranch({ name: "feature-main" });
    const branchDb = client.db(`${config.branchPrefix}feature-main`);
    await branchDb.collection("users").insertOne({ name: "Main Target User", role: "viewer" });

    const dr = await deployManager.open({
      sourceBranch: "feature-main",
      targetBranch: "main",
      description: "Promote to main",
      createdBy: "alice",
    });

    expect(dr.targetBranch).toBe("main");
    expect(dr.status).toBe("open");
  });

  it("rejects duplicate open requests for same source→target", async () => {
    await branchManager.createBranch({ name: "feat-dup" });
    await branchManager.createBranch({ name: "tgt-dup" });

    await deployManager.open({
      sourceBranch: "feat-dup",
      targetBranch: "tgt-dup",
      description: "First",
      createdBy: "alice",
    });

    await expect(
      deployManager.open({
        sourceBranch: "feat-dup",
        targetBranch: "tgt-dup",
        description: "Duplicate",
        createdBy: "bob",
      })
    ).rejects.toThrow(/already open/);
  });

  it("throws for non-existent source branch", async () => {
    await branchManager.createBranch({ name: "tgt-exists" });

    await expect(
      deployManager.open({
        sourceBranch: "ghost",
        targetBranch: "tgt-exists",
        description: "nope",
        createdBy: "alice",
      })
    ).rejects.toThrow(/not found/);
  });
});

describe("DeployRequest — approve & reject", () => {
  it("approves an open deploy request", async () => {
    await branchManager.createBranch({ name: "feat-approve" });
    await branchManager.createBranch({ name: "tgt-approve" });

    const dr = await deployManager.open({
      sourceBranch: "feat-approve",
      targetBranch: "tgt-approve",
      description: "Approve me",
      createdBy: "alice",
    });

    const approved = await deployManager.approve(dr.id, "bob");
    expect(approved.status).toBe("approved");
    expect(approved.reviewedBy).toBe("bob");
    expect(approved.approvalCapturedAt).toBeDefined();
    expect(approved.approvalOperationTime).toBeDefined();
  });

  it("rejects a deploy request with reason", async () => {
    await branchManager.createBranch({ name: "feat-reject" });
    await branchManager.createBranch({ name: "tgt-reject" });

    const dr = await deployManager.open({
      sourceBranch: "feat-reject",
      targetBranch: "tgt-reject",
      description: "Reject me",
      createdBy: "alice",
    });

    const rejected = await deployManager.reject(dr.id, "charlie", "Needs more tests");
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toBe("Needs more tests");
  });

  it("cannot approve a rejected request", async () => {
    await branchManager.createBranch({ name: "feat-rej2" });
    await branchManager.createBranch({ name: "tgt-rej2" });

    const dr = await deployManager.open({
      sourceBranch: "feat-rej2",
      targetBranch: "tgt-rej2",
      description: "Will reject",
      createdBy: "alice",
    });

    await deployManager.reject(dr.id, "charlie", "No");

    await expect(
      deployManager.approve(dr.id, "bob")
    ).rejects.toThrow(/Cannot approve/);
  });
});

describe("DeployRequest — execute", () => {
  it("executes an approved request and merges", async () => {
    await branchManager.createBranch({ name: "feat-exec" });
    await branchManager.createBranch({ name: "tgt-exec" });

    // Add data to source branch
    const branchDb = client.db(`${config.branchPrefix}feat-exec`);
    await branchDb.collection("users").insertOne({ name: "NewUser", role: "guest" });

    const dr = await deployManager.open({
      sourceBranch: "feat-exec",
      targetBranch: "tgt-exec",
      description: "Merge new user",
      createdBy: "alice",
    });

    await deployManager.approve(dr.id, "bob");
    const result = await deployManager.execute(dr.id);

    expect(result.deployRequest.status).toBe("merged");
    expect(result.deployRequest.mergedAt).toBeDefined();
    expect(result.mergeResult.success).toBe(true);
  });

  it("rejects execution of non-approved request", async () => {
    await branchManager.createBranch({ name: "feat-noexec" });
    await branchManager.createBranch({ name: "tgt-noexec" });

    const dr = await deployManager.open({
      sourceBranch: "feat-noexec",
      targetBranch: "tgt-noexec",
      description: "Not approved",
      createdBy: "alice",
    });

    await expect(
      deployManager.execute(dr.id)
    ).rejects.toThrow(/must be approved/);
  });

  it("blocks stale deploy requests when main has newer conflicting data", async () => {
    await branchManager.createBranch({ name: "feat-growth" });
    await branchManager.createBranch({ name: "feat-hotfix" });

    const growthDb = client.db(`${config.branchPrefix}feat-growth`);
    await growthDb.collection("users").updateOne(
      { name: "Alice" },
      { $set: { role: "manager" } }
    );
    await commitEngine.commit({
      branchName: "feat-growth",
      message: "Growth wants manager role",
    });

    const hotfixDb = client.db(`${config.branchPrefix}feat-hotfix`);
    await hotfixDb.collection("users").updateOne(
      { name: "Alice" },
      { $set: { role: "owner" } }
    );
    await commitEngine.commit({
      branchName: "feat-hotfix",
      message: "Hotfix needs owner role",
    });

    const hotfixDr = await deployManager.open({
      sourceBranch: "feat-hotfix",
      targetBranch: "main",
      description: "Promote owner role hotfix",
      createdBy: "alice",
    });
    await deployManager.approve(hotfixDr.id, "bob");
    await deployManager.execute(hotfixDr.id);

    const growthDr = await deployManager.open({
      sourceBranch: "feat-growth",
      targetBranch: "main",
      description: "Promote growth role update",
      createdBy: "alice",
    });
    await deployManager.approve(growthDr.id, "bob");

    await expect(deployManager.execute(growthDr.id)).rejects.toThrow(/merge conflicts/i);

    const mainAlice = await client.db(config.sourceDatabase).collection("users").findOne({ name: "Alice" });
    expect(mainAlice?.role).toBe("owner");

    const persisted = await deployManager.get(growthDr.id);
    expect(persisted?.status).toBe("approved");
  });

  it("blocks execution when target branch changes after approval even without a merge conflict", async () => {
    await branchManager.createBranch({ name: "feat-target-drift" });

    const featureDb = client.db(`${config.branchPrefix}feat-target-drift`);
    await featureDb.collection("users").insertOne({ name: "Charlie", role: "viewer" });

    const dr = await deployManager.open({
      sourceBranch: "feat-target-drift",
      targetBranch: "main",
      description: "Add Charlie",
      createdBy: "alice",
    });
    await deployManager.approve(dr.id, "bob");

    await client.db(config.sourceDatabase).collection("users").insertOne({
      name: "Zoe",
      role: "auditor",
    });

    await expect(deployManager.execute(dr.id)).rejects.toThrow(/changed since approval/i);

    const persisted = await deployManager.get(dr.id);
    expect(persisted?.status).toBe("approved");
    expect(persisted?.approvalInvalidationReason).toMatch(/target branch "main" changed since approval/i);

    const mainUsers = await client.db(config.sourceDatabase).collection("users").find({}).toArray();
    expect(mainUsers.some((user) => user.name === "Charlie")).toBe(false);
    expect(mainUsers.some((user) => user.name === "Zoe")).toBe(true);
  });

  it("blocks execution when source branch changes after approval", async () => {
    await branchManager.createBranch({ name: "feat-source-drift" });

    const featureDb = client.db(`${config.branchPrefix}feat-source-drift`);
    await featureDb.collection("users").insertOne({ name: "Charlie", role: "viewer" });

    const dr = await deployManager.open({
      sourceBranch: "feat-source-drift",
      targetBranch: "main",
      description: "Add Charlie safely",
      createdBy: "alice",
    });
    await deployManager.approve(dr.id, "bob");

    await featureDb.collection("users").insertOne({ name: "Dana", role: "operator" });

    await expect(deployManager.execute(dr.id)).rejects.toThrow(/changed since approval/i);

    const persisted = await deployManager.get(dr.id);
    expect(persisted?.status).toBe("approved");
    expect(persisted?.approvalInvalidationReason).toMatch(/source branch "feat-source-drift" changed since approval/i);

    const mainUsers = await client.db(config.sourceDatabase).collection("users").find({}).toArray();
    expect(mainUsers.some((user) => user.name === "Charlie")).toBe(false);
    expect(mainUsers.some((user) => user.name === "Dana")).toBe(false);
  });
});

describe("DeployRequest — list & get", () => {
  it("lists deploy requests filtered by status", async () => {
    await branchManager.createBranch({ name: "feat-list1" });
    await branchManager.createBranch({ name: "tgt-list1" });
    await branchManager.createBranch({ name: "feat-list2" });
    await branchManager.createBranch({ name: "tgt-list2" });

    await deployManager.open({
      sourceBranch: "feat-list1",
      targetBranch: "tgt-list1",
      description: "DR 1",
      createdBy: "alice",
    });

    const dr2 = await deployManager.open({
      sourceBranch: "feat-list2",
      targetBranch: "tgt-list2",
      description: "DR 2",
      createdBy: "bob",
    });
    await deployManager.approve(dr2.id, "charlie");

    const openDRs = await deployManager.list({ status: "open" });
    expect(openDRs.length).toBe(1);
    expect(openDRs[0]!.description).toBe("DR 1");

    const approvedDRs = await deployManager.list({ status: "approved" });
    expect(approvedDRs.length).toBe(1);
    expect(approvedDRs[0]!.description).toBe("DR 2");

    const allDRs = await deployManager.list();
    expect(allDRs.length).toBe(2);
  });

  it("gets a specific deploy request by ID", async () => {
    await branchManager.createBranch({ name: "feat-get" });
    await branchManager.createBranch({ name: "tgt-get" });

    const dr = await deployManager.open({
      sourceBranch: "feat-get",
      targetBranch: "tgt-get",
      description: "Get me",
      createdBy: "alice",
    });

    const found = await deployManager.get(dr.id);
    expect(found).not.toBeNull();
    expect(found!.description).toBe("Get me");

    const notFound = await deployManager.get("nonexistent");
    expect(notFound).toBeNull();
  });
});
