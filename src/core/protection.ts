/**
 * MongoBranch — Branch Protection
 *
 * Prevent direct writes to protected branches. Only merges allowed.
 * Supports exact names and glob patterns (e.g., "prod-*").
 */
import type { MongoClient, Collection } from "mongodb";
import type { MongoBranchConfig, BranchProtection } from "./types.ts";
import { PROTECTIONS_COLLECTION } from "./types.ts";

export class ProtectionManager {
  private protections: Collection<BranchProtection>;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    const metaDb = client.db(config.metaDatabase);
    this.protections = metaDb.collection<BranchProtection>(PROTECTIONS_COLLECTION);
  }

  async initialize(): Promise<void> {
    await this.protections.createIndex({ pattern: 1 }, { unique: true });
  }

  /**
   * Protect a branch or pattern.
   */
  async protectBranch(
    pattern: string,
    options: { requireMergeOnly?: boolean; preventDelete?: boolean; createdBy?: string } = {}
  ): Promise<BranchProtection> {
    const existing = await this.protections.findOne({ pattern });
    if (existing) {
      throw new Error(`Protection rule for "${pattern}" already exists`);
    }

    const rule: BranchProtection = {
      pattern,
      requireMergeOnly: options.requireMergeOnly ?? true,
      preventDelete: options.preventDelete ?? true,
      createdBy: options.createdBy ?? "unknown",
      createdAt: new Date(),
    };

    await this.protections.insertOne({ ...rule });
    return rule;
  }

  /**
   * Remove protection from a branch/pattern.
   */
  async removeProtection(pattern: string): Promise<boolean> {
    const result = await this.protections.deleteOne({ pattern });
    if (result.deletedCount === 0) {
      throw new Error(`No protection rule found for "${pattern}"`);
    }
    return true;
  }

  /**
   * List all protection rules.
   */
  async listProtections(): Promise<BranchProtection[]> {
    return this.protections.find().sort({ createdAt: -1 }).toArray();
  }

  /**
   * Check if a branch is protected.
   * Matches exact name and glob patterns.
   */
  async isProtected(branchName: string): Promise<BranchProtection | null> {
    const rules = await this.protections.find().toArray();

    for (const rule of rules) {
      if (this.matchesPattern(branchName, rule.pattern)) {
        return rule;
      }
    }

    return null;
  }

  /**
   * Check if a write operation is allowed on a branch.
   * Returns { allowed, reason }.
   */
  async checkWritePermission(
    branchName: string,
    isMerge: boolean = false
  ): Promise<{ allowed: boolean; reason?: string }> {
    const protection = await this.isProtected(branchName);
    if (!protection) return { allowed: true };

    if (protection.requireMergeOnly && !isMerge) {
      return {
        allowed: false,
        reason: `Branch "${branchName}" is protected (matches rule "${protection.pattern}"). Only merges are allowed.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Simple glob matching — supports "*" as wildcard.
   */
  private matchesPattern(name: string, pattern: string): boolean {
    if (pattern === name) return true;
    if (!pattern.includes("*")) return false;

    const regex = new RegExp(
      "^" + pattern.replace(/\*/g, ".*") + "$"
    );
    return regex.test(name);
  }
}
