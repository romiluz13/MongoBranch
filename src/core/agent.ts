/**
 * AgentManager — Multi-agent branch isolation for MongoBranch
 *
 * Each AI agent registers with a unique ID, gets its own branches
 * (namespaced as `{agentId}/{task}`), and operates in full isolation.
 */
import type { MongoClient, Collection } from "mongodb";
import { BranchManager } from "./branch.ts";
import type {
  MongoBranchConfig,
  AgentMetadata,
  AgentRegisterOptions,
  AgentBranchOptions,
  AgentStatusResult,
  BranchMetadata,
} from "./types.ts";
import { AGENTS_COLLECTION } from "./types.ts";

export class AgentManager {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private branchManager: BranchManager;
  private agentsCollection: Collection<AgentMetadata>;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
    this.branchManager = new BranchManager(client, config);
    this.agentsCollection = client
      .db(config.metaDatabase)
      .collection<AgentMetadata>(AGENTS_COLLECTION);
  }

  async initialize(): Promise<void> {
    await this.branchManager.initialize();
    await this.agentsCollection.createIndex({ agentId: 1 }, { unique: true });
  }

  /**
   * Register a new agent. Each agent gets a unique identity for branch ownership.
   */
  async registerAgent(options: AgentRegisterOptions): Promise<AgentMetadata> {
    const existing = await this.agentsCollection.findOne({
      agentId: options.agentId,
    });
    if (existing) {
      throw new Error(`Agent "${options.agentId}" is already registered`);
    }

    const now = new Date();
    const agent: AgentMetadata = {
      agentId: options.agentId,
      name: options.name,
      description: options.description,
      status: "active",
      registeredAt: now,
      lastActiveAt: now,
    };

    await this.agentsCollection.insertOne(agent);
    return agent;
  }

  /**
   * Create a branch owned by a specific agent.
   * Branch name format: `{agentId}/{task}`
   */
  async createAgentBranch(
    agentId: string,
    options: AgentBranchOptions
  ): Promise<BranchMetadata> {
    const agent = await this.agentsCollection.findOne({ agentId });
    if (!agent) {
      throw new Error(`Agent "${agentId}" is not registered`);
    }

    const branchName = `${agentId}/${options.task}`;

    // Update agent last active timestamp
    await this.agentsCollection.updateOne(
      { agentId },
      { $currentDate: { lastActiveAt: true } }
    );

    return this.branchManager.createBranch({
      name: branchName,
      description: options.description ?? `Agent task: ${options.task}`,
      createdBy: agentId,
    });
  }

  /**
   * List all branches belonging to a specific agent.
   */
  async listAgentBranches(agentId: string): Promise<BranchMetadata[]> {
    const all = await this.branchManager.listBranches({});
    return all.filter((b) => b.createdBy === agentId);
  }

  /**
   * Get the current status of a registered agent.
   */
  async getAgentStatus(agentId: string): Promise<AgentStatusResult> {
    const agent = await this.agentsCollection.findOne({ agentId });
    if (!agent) {
      throw new Error(`Agent "${agentId}" is not registered`);
    }

    const branches = await this.listAgentBranches(agentId);
    const activeBranches = branches.filter((b) => b.status === "active").length;

    return {
      agentId: agent.agentId,
      name: agent.name,
      status: agent.status,
      activeBranches,
      registeredAt: agent.registeredAt,
      lastActiveAt: agent.lastActiveAt,
    };
  }
}
