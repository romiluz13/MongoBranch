/**
 * MongoBranch — Reflog Tests
 *
 * Phase 7.5: Branch pointer movement tracking
 * TDD, real MongoDB, zero mocks.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient } from "mongodb";
import { startMongoDB, stopMongoDB } from "../setup.ts";
import { ReflogManager } from "../../src/core/reflog.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";

let client: MongoClient;
let reflog: ReflogManager;

const config: MongoBranchConfig = {
  sourceDatabase: "test_reflog_source",
  metaDatabase: "__mongobranch_reflog",
  branchPrefix: "__mb_reflog_",
};

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
  reflog = new ReflogManager(client, config);
  await reflog.initialize();
}, 30_000);

afterAll(async () => {
  if (client) {
    const dbs = await client.db().admin().listDatabases();
    for (const db of dbs.databases) {
      if (db.name.startsWith("__mb_reflog_") || db.name === "__mongobranch_reflog") {
        await client.db(db.name).dropDatabase();
      }
    }
  }
  await stopMongoDB();
}, 10_000);

beforeEach(async () => {
  await client.db(config.metaDatabase).collection("reflog").deleteMany({});
});

describe("ReflogManager — record & query", () => {
  it("records and retrieves branch events", async () => {
    await reflog.record({
      branchName: "feature-x",
      action: "create",
      detail: "Created from main",
      actor: "alice",
    });

    await reflog.record({
      branchName: "feature-x",
      action: "commit",
      detail: "Added user docs",
      commitHash: "abc12345",
      actor: "alice",
    });

    const entries = await reflog.forBranch("feature-x");
    expect(entries.length).toBe(2);
    expect(entries[0].action).toBe("commit"); // newest first
    expect(entries[1].action).toBe("create");
  });

  it("tracks branch across deletion (survives delete)", async () => {
    await reflog.record({
      branchName: "ephemeral",
      action: "create",
      detail: "Created",
      actor: "bot",
    });

    await reflog.record({
      branchName: "ephemeral",
      action: "delete",
      detail: "Deleted after merge",
      actor: "bot",
    });

    const existed = await reflog.branchExisted("ephemeral");
    expect(existed).toBe(true);

    const last = await reflog.lastKnownState("ephemeral");
    expect(last!.action).toBe("delete");
  });

  it("queries all entries across branches", async () => {
    await reflog.record({ branchName: "a", action: "create", detail: "a", actor: "x" });
    await reflog.record({ branchName: "b", action: "create", detail: "b", actor: "y" });
    await reflog.record({ branchName: "c", action: "merge", detail: "c", actor: "z" });

    const all = await reflog.all();
    expect(all.length).toBe(3);
  });

  it("filters by action type", async () => {
    await reflog.record({ branchName: "x", action: "create", detail: "created", actor: "a" });
    await reflog.record({ branchName: "x", action: "commit", detail: "committed", actor: "a" });
    await reflog.record({ branchName: "y", action: "create", detail: "created", actor: "b" });

    const creates = await reflog.byAction("create");
    expect(creates.length).toBe(2);

    const commits = await reflog.byAction("commit");
    expect(commits.length).toBe(1);
  });

  it("reports non-existent branch correctly", async () => {
    const existed = await reflog.branchExisted("never-existed");
    expect(existed).toBe(false);

    const last = await reflog.lastKnownState("never-existed");
    expect(last).toBeNull();
  });
});
