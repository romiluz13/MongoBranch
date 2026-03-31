/**
 * MongoBranch — Deploy Request Tests
 *
 * Phase 6.3: PR-like workflow for merging to protected branches
 * Flow: open → approve → execute (merge)
 *
 * TDD, real MongoDB, zero mocks.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { MongoClient } from "mongodb";
import { startMongoDB, stopMongoDB } from "../setup.ts";
import { BranchManager } from "../../src/core/branch.ts";
import { DeployRequestManager } from "../../src/core/deploy.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";

let client: MongoClient;
let branchManager: BranchManager;
let deployManager: DeployRequestManager;

const config: MongoBranchConfig = {
  sourceDatabase: "test_deploy_source",
  metaDatabase: "__mongobranch_deploy",
  branchPrefix: "__mb_dr_",
};

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
  branchManager = new BranchManager(client, config);
  deployManager = new DeployRequestManager(client, config);
  await branchManager.initialize();
  await deployManager.initialize();
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

  // Seed source DB
  const sourceDb = client.db(config.sourceDatabase);
  await sourceDb.dropDatabase();
  await sourceDb.collection("users").insertMany([
    { name: "Alice", role: "admin" },
    { name: "Bob", role: "user" },
  ]);
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
    expect(openDRs[0].description).toBe("DR 1");

    const approvedDRs = await deployManager.list({ status: "approved" });
    expect(approvedDRs.length).toBe(1);
    expect(approvedDRs[0].description).toBe("DR 2");

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
