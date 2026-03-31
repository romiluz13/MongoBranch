/**
 * MongoBranch — Agent Scope Manager
 *
 * Controls what AI agents can and cannot do:
 * - Which collections they can access
 * - What operations they can perform (read/write/delete/merge)
 * - How many branches they can have
 * - Per-write document limits
 *
 * Every violation is logged for audit.
 */
import type { MongoClient, Collection } from "mongodb";
import type {
  MongoBranchConfig,
  AgentScope,
  ScopeViolation,
  ScopePermission,
} from "./types.ts";
import { AGENT_SCOPES_COLLECTION, SCOPE_VIOLATIONS_COLLECTION } from "./types.ts";

export class ScopeManager {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private scopes: Collection<AgentScope>;
  private violations: Collection<ScopeViolation>;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
    const metaDb = client.db(config.metaDatabase);
    this.scopes = metaDb.collection<AgentScope>(AGENT_SCOPES_COLLECTION);
    this.violations = metaDb.collection<ScopeViolation>(SCOPE_VIOLATIONS_COLLECTION);
  }

  async initialize(): Promise<void> {
    await this.scopes.createIndex({ agentId: 1 }, { unique: true });
    await this.violations.createIndex({ agentId: 1, timestamp: -1 });
  }

  /**
   * Set scope for an agent. Replaces existing scope.
   */
  async setScope(scope: Omit<AgentScope, "createdAt" | "updatedAt">): Promise<AgentScope> {
    const now = new Date();
    const full: AgentScope = {
      ...scope,
      createdAt: now,
      updatedAt: now,
    };

    await this.scopes.updateOne(
      { agentId: scope.agentId },
      { $set: { ...full }, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );

    return full;
  }

  /**
   * Get scope for an agent. Returns null if no scope set (unrestricted).
   */
  async getScope(agentId: string): Promise<AgentScope | null> {
    return this.scopes.findOne({ agentId });
  }

  /**
   * Remove scope for an agent (makes them unrestricted).
   */
  async removeScope(agentId: string): Promise<void> {
    await this.scopes.deleteOne({ agentId });
  }

  /**
   * Check if an agent is allowed to perform an operation.
   * Returns { allowed: true } or { allowed: false, reason: string }.
   */
  async checkPermission(
    agentId: string,
    collection: string,
    operation: ScopePermission,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const scope = await this.getScope(agentId);

    // No scope = unrestricted
    if (!scope) return { allowed: true };

    // Check permission type
    if (!scope.permissions.includes(operation)) {
      return {
        allowed: false,
        reason: `Agent "${agentId}" lacks "${operation}" permission`,
      };
    }

    // Check denied collections (deny overrides allow)
    if (scope.deniedCollections?.includes(collection)) {
      return {
        allowed: false,
        reason: `Collection "${collection}" is denied for agent "${agentId}"`,
      };
    }

    // Check allowed collections (if specified, only those are allowed)
    if (scope.allowedCollections && !scope.allowedCollections.includes(collection)) {
      return {
        allowed: false,
        reason: `Collection "${collection}" is not in allowed list for agent "${agentId}"`,
      };
    }

    return { allowed: true };
  }

  /**
   * Check if agent can create another branch (quota check).
   */
  async checkBranchQuota(agentId: string, currentBranchCount: number): Promise<{ allowed: boolean; reason?: string }> {
    const scope = await this.getScope(agentId);
    if (!scope || !scope.maxBranches) return { allowed: true };

    if (currentBranchCount >= scope.maxBranches) {
      return {
        allowed: false,
        reason: `Agent "${agentId}" has reached max branches (${scope.maxBranches})`,
      };
    }
    return { allowed: true };
  }

  /**
   * Log a scope violation for audit.
   */
  async logViolation(violation: Omit<ScopeViolation, "timestamp">): Promise<void> {
    await this.violations.insertOne({ ...violation, timestamp: new Date() });
  }

  /**
   * Get violations for an agent.
   */
  async getViolations(agentId: string, limit = 50): Promise<ScopeViolation[]> {
    return this.violations.find({ agentId }).sort({ timestamp: -1 }).limit(limit).toArray();
  }

  /**
   * List all agent scopes.
   */
  async listScopes(): Promise<AgentScope[]> {
    return this.scopes.find({}).toArray();
  }
}
