/**
 * TDD Tests for MongoBranch Multi-Agent Support
 *
 * Tests run against REAL MongoDB. No mocks.
 * Validates agent registration, per-agent branching, and isolation.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient } from "mongodb";
import {
  startMongoDB,
  stopMongoDB,
  getTestEnvironment,
  cleanupBranches,
} from "../setup.ts";
import { AgentManager } from "../../src/core/agent.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";
import { SEED_DATABASE } from "../seed.ts";

let client: MongoClient;
let uri: string;
let config: MongoBranchConfig;
let agentManager: AgentManager;

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
  // Also clean agent registry
  await client.db("__mongobranch").collection("agents").deleteMany({});

  config = {
    uri,
    sourceDatabase: SEED_DATABASE,
    metaDatabase: "__mongobranch",
    branchPrefix: "__mb_",
  };

  agentManager = new AgentManager(client, config);
  await agentManager.initialize();
});

describe("AgentManager.registerAgent", () => {
  it("registers a new agent and returns metadata", async () => {
    const agent = await agentManager.registerAgent({
      agentId: "claude-code-1",
      name: "Claude Code",
      description: "Primary coding agent",
    });

    expect(agent.agentId).toBe("claude-code-1");
    expect(agent.name).toBe("Claude Code");
    expect(agent.status).toBe("active");
    expect(agent.registeredAt).toBeInstanceOf(Date);
  });

  it("rejects duplicate agent IDs", async () => {
    await agentManager.registerAgent({ agentId: "dup-agent" });
    await expect(
      agentManager.registerAgent({ agentId: "dup-agent" })
    ).rejects.toThrow(/already registered/);
  });
});

describe("AgentManager.createAgentBranch", () => {
  it("creates a branch owned by the agent", async () => {
    await agentManager.registerAgent({ agentId: "agent-a" });
    const branch = await agentManager.createAgentBranch("agent-a", {
      task: "fix-user-emails",
    });

    expect(branch.name).toContain("agent-a");
    expect(branch.createdBy).toBe("agent-a");
  });

  it("auto-generates branch name from agent ID + task", async () => {
    await agentManager.registerAgent({ agentId: "agent-b" });
    const branch = await agentManager.createAgentBranch("agent-b", {
      task: "update-prices",
    });

    expect(branch.name).toBe("agent-b/update-prices");
  });

  it("rejects creating branch for unregistered agent", async () => {
    await expect(
      agentManager.createAgentBranch("ghost-agent", { task: "nope" })
    ).rejects.toThrow(/not registered/);
  });
});

describe("AgentManager.listAgentBranches", () => {
  it("lists only branches belonging to a specific agent", async () => {
    await agentManager.registerAgent({ agentId: "agent-x" });
    await agentManager.registerAgent({ agentId: "agent-y" });

    await agentManager.createAgentBranch("agent-x", { task: "task-1" });
    await agentManager.createAgentBranch("agent-x", { task: "task-2" });
    await agentManager.createAgentBranch("agent-y", { task: "task-3" });

    const xBranches = await agentManager.listAgentBranches("agent-x");
    const yBranches = await agentManager.listAgentBranches("agent-y");

    expect(xBranches.length).toBe(2);
    expect(yBranches.length).toBe(1);
    expect(xBranches.every((b) => b.createdBy === "agent-x")).toBe(true);
  });
});

describe("AgentManager.getAgentStatus", () => {
  it("returns agent status with branch count", async () => {
    await agentManager.registerAgent({ agentId: "status-agent" });
    await agentManager.createAgentBranch("status-agent", { task: "job-1" });
    await agentManager.createAgentBranch("status-agent", { task: "job-2" });

    const status = await agentManager.getAgentStatus("status-agent");

    expect(status.agentId).toBe("status-agent");
    expect(status.status).toBe("active");
    expect(status.activeBranches).toBe(2);
  });

  it("returns error for unregistered agent", async () => {
    await expect(
      agentManager.getAgentStatus("nobody")
    ).rejects.toThrow(/not registered/);
  });
});

describe("Multi-agent isolation", () => {
  it("changes on agent-x branch do NOT affect agent-y branch", async () => {
    await agentManager.registerAgent({ agentId: "iso-a" });
    await agentManager.registerAgent({ agentId: "iso-b" });

    const branchA = await agentManager.createAgentBranch("iso-a", { task: "edit" });
    const branchB = await agentManager.createAgentBranch("iso-b", { task: "edit" });

    // Modify data on agent-a's branch
    const dbA = client.db(branchA.branchDatabase);
    await dbA.collection("users").insertOne({ name: "Agent A Only", role: "test" });

    // Agent-b's branch should NOT have that document
    const dbB = client.db(branchB.branchDatabase);
    const found = await dbB.collection("users").findOne({ name: "Agent A Only" });
    expect(found).toBeNull();
  });
});
