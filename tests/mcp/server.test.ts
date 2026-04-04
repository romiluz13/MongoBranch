/**
 * TDD Tests for MongoBranch MCP Server
 *
 * Tests the MCP tool handlers directly against real MongoDB.
 * No mocks — real BranchManager, DiffEngine, MergeEngine.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient } from "mongodb";
import {
  startMongoDB,
  stopMongoDB,
  getTestEnvironment,
  cleanupBranches,
} from "../setup.ts";
import { createMongoBranchTools } from "../../src/mcp/tools.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";
import { SEED_DATABASE } from "../seed.ts";

let client: MongoClient;
let uri: string;
let config: MongoBranchConfig;
let tools: ReturnType<typeof createMongoBranchTools>;

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
  await client.db("__mongobranch").collection("agents").deleteMany({});

  config = {
    uri,
    sourceDatabase: SEED_DATABASE,
    metaDatabase: "__mongobranch",
    branchPrefix: "__mb_",
  };

  tools = createMongoBranchTools(client, config);
});

describe("MCP Tools — create_branch", () => {
  it("creates a branch and returns success", async () => {
    const result = await tools.create_branch({ name: "feature-x" });
    expect(result.content[0]!.type).toBe("text");
    const text = result.content[0]!.text;
    expect(text).toContain("feature-x");
    expect(text).toContain("created");
  });

  it("returns error for invalid branch name", async () => {
    const result = await tools.create_branch({ name: "bad name!" });
    expect(result.isError).toBe(true);
  });

  it("returns error for duplicate branch", async () => {
    await tools.create_branch({ name: "dup" });
    const result = await tools.create_branch({ name: "dup" });
    expect(result.isError).toBe(true);
  });
});

describe("MCP Tools — list_branches", () => {
  it("returns empty list when no branches", async () => {
    const result = await tools.list_branches({});
    const text = result.content[0]!.text;
    const parsed = JSON.parse(text);
    expect(parsed.branches).toEqual([]);
  });

  it("lists created branches", async () => {
    await tools.create_branch({ name: "alpha" });
    await tools.create_branch({ name: "beta" });
    const result = await tools.list_branches({});
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.branches.length).toBe(2);
    expect(parsed.branches.map((b: any) => b.name).sort()).toEqual(["alpha", "beta"]);
  });
});

describe("MCP Tools — diff_branch", () => {
  it("returns no changes for unmodified branch", async () => {
    await tools.create_branch({ name: "clean" });
    const result = await tools.diff_branch({ source: "clean", target: "main" });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.totalChanges).toBe(0);
  });

  it("detects added documents", async () => {
    await tools.create_branch({ name: "add-test" });
    // Insert a doc directly into branch DB
    const branchDb = client.db("__mb_add-test");
    await branchDb.collection("users").insertOne({
      name: "New Agent User",
      role: "agent",
    });

    const result = await tools.diff_branch({ source: "add-test", target: "main" });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.totalChanges).toBeGreaterThan(0);
  });

  it("returns error for non-existent branch", async () => {
    const result = await tools.diff_branch({ source: "ghost", target: "main" });
    expect(result.isError).toBe(true);
  });
});

describe("MCP Tools — merge_branch", () => {
  it("merges branch into main", async () => {
    await tools.create_branch({ name: "merge-me" });
    const branchDb = client.db("__mb_merge-me");
    await branchDb.collection("users").insertOne({
      name: "Merged User",
      role: "tester",
    });

    const result = await tools.merge_branch({ source: "merge-me", into: "main" });
    const text = result.content[0]!.text;
    expect(text).toContain("Merged");
    expect(result.isError).toBeUndefined();
  });

  it("returns error for non-existent source", async () => {
    const result = await tools.merge_branch({ source: "nope", into: "main" });
    expect(result.isError).toBe(true);
  });
});

describe("MCP Tools — delete_branch", () => {
  it("deletes a branch and returns confirmation", async () => {
    await tools.create_branch({ name: "to-delete" });
    const result = await tools.delete_branch({ name: "to-delete" });
    expect(result.content[0]!.text).toContain("deleted");
    expect(result.isError).toBeUndefined();

    // Verify it's gone from list
    const listResult = await tools.list_branches({});
    const parsed = JSON.parse(listResult.content[0]!.text);
    expect(parsed.branches.find((b: any) => b.name === "to-delete")).toBeUndefined();
  });

  it("returns error when deleting main", async () => {
    const result = await tools.delete_branch({ name: "main" });
    expect(result.isError).toBe(true);
  });

  it("returns error for non-existent branch", async () => {
    const result = await tools.delete_branch({ name: "ghost" });
    expect(result.isError).toBe(true);
  });
});

// ── Agent MCP Tools ────────────────────────────────────────

describe("MCP Tools — register_agent", () => {
  it("registers an agent and returns confirmation", async () => {
    const result = await tools.register_agent({
      agentId: "claude-1",
      name: "Claude Code",
    });
    expect(result.content[0]!.text).toContain("claude-1");
    expect(result.content[0]!.text).toContain("registered");
  });

  it("returns error for duplicate agent", async () => {
    await tools.register_agent({ agentId: "dup" });
    const result = await tools.register_agent({ agentId: "dup" });
    expect(result.isError).toBe(true);
  });
});

describe("MCP Tools — create_agent_branch", () => {
  it("creates a namespaced branch for agent", async () => {
    await tools.register_agent({ agentId: "agent-m" });
    const result = await tools.create_agent_branch({
      agentId: "agent-m",
      task: "fix-data",
    });
    expect(result.content[0]!.text).toContain("agent-m/fix-data");
    expect(result.content[0]!.text).toContain("created");
  });

  it("returns error for unregistered agent", async () => {
    const result = await tools.create_agent_branch({
      agentId: "nobody",
      task: "x",
    });
    expect(result.isError).toBe(true);
  });
});

describe("MCP Tools — agent_status", () => {
  it("returns agent status with branch count", async () => {
    await tools.register_agent({ agentId: "stat-agent" });
    await tools.create_agent_branch({ agentId: "stat-agent", task: "t1" });

    const result = await tools.agent_status({ agentId: "stat-agent" });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.agentId).toBe("stat-agent");
    expect(parsed.activeBranches).toBe(1);
  });

  it("returns error for unregistered agent", async () => {
    const result = await tools.agent_status({ agentId: "ghost" });
    expect(result.isError).toBe(true);
  });
});

// ── Workflow Tools ─────────────────────────────────────────

describe("MCP Tools — start_task", () => {
  it("registers agent + creates branch in one call", async () => {
    const result = await tools.start_task({
      agentId: "workflow-agent",
      task: "migrate-users",
    });
    const text = result.content[0]!.text;
    expect(text).toContain("workflow-agent/migrate-users");
    expect(text).toContain("created");
    expect(result.isError).toBeUndefined();
  });

  it("reuses existing agent registration on second task", async () => {
    await tools.start_task({ agentId: "repeat-agent", task: "task-1" });
    const result = await tools.start_task({ agentId: "repeat-agent", task: "task-2" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("repeat-agent/task-2");
  });
});

describe("MCP Tools — complete_task", () => {
  it("diffs and returns summary for a task branch", async () => {
    await tools.start_task({ agentId: "done-agent", task: "cleanup" });

    // Make a change on the branch
    const branchDb = client.db("__mb_done-agent--cleanup");
    await branchDb.collection("users").insertOne({
      name: "Cleanup Result",
      role: "test",
    });

    const result = await tools.complete_task({
      agentId: "done-agent",
      task: "cleanup",
    });
    const text = result.content[0]!.text;
    expect(text).toContain("totalChanges");
    expect(result.isError).toBeUndefined();
  });

  it("auto-merges when autoMerge is true", async () => {
    await tools.start_task({ agentId: "merge-agent", task: "fix" });
    const branchDb = client.db("__mb_merge-agent--fix");
    await branchDb.collection("users").insertOne({
      name: "Auto Merged User",
      role: "test",
    });

    const result = await tools.complete_task({
      agentId: "merge-agent",
      task: "fix",
      autoMerge: true,
    });
    const text = result.content[0]!.text;
    expect(text).toContain("Merged");
    expect(result.isError).toBeUndefined();

    // Verify data is in main
    const mainDb = client.db(SEED_DATABASE);
    const merged = await mainDb.collection("users").findOne({ name: "Auto Merged User" });
    expect(merged).not.toBeNull();
  });

  it("returns error for non-existent task", async () => {
    await tools.register_agent({ agentId: "lost-agent" });
    const result = await tools.complete_task({
      agentId: "lost-agent",
      task: "nope",
    });
    expect(result.isError).toBe(true);
  });
});
