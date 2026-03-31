/**
 * MongoBranch — Data Anonymization
 *
 * Create branches with anonymized/masked data for safe agent experimentation.
 * Strategies: hash, mask, null, faker (placeholder-based).
 *
 * Inspired by Neon's anonymization branches.
 */
import { createHash } from "crypto";
import type { MongoClient } from "mongodb";
import type { MongoBranchConfig } from "./types.ts";
import { BranchManager } from "./branch.ts";

export type AnonymizeStrategy = "hash" | "mask" | "null" | "redact";

export interface AnonymizeRule {
  collection: string;
  fields: { path: string; strategy: AnonymizeStrategy }[];
}

export interface AnonymizeResult {
  branchName: string;
  documentsProcessed: number;
  fieldsAnonymized: number;
  rules: AnonymizeRule[];
}

export class AnonymizeEngine {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private branchManager: BranchManager;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
    this.branchManager = new BranchManager(client, config);
  }

  /**
   * Create an anonymized branch — copies data then applies rules.
   */
  async createAnonymizedBranch(
    branchName: string,
    rules: AnonymizeRule[],
  ): Promise<AnonymizeResult> {
    // Create the branch (copies data from source)
    await this.branchManager.initialize();
    await this.branchManager.createBranch({ name: branchName });

    const branchDb = this.client.db(`${this.config.branchPrefix}${branchName}`);
    let totalDocs = 0;
    let totalFields = 0;

    for (const rule of rules) {
      const collection = branchDb.collection(rule.collection);
      const docs = await collection.find({}).toArray();

      for (const doc of docs) {
        const updates: Record<string, unknown> = {};
        let changed = false;

        for (const field of rule.fields) {
          const value = this.getNestedValue(doc, field.path);
          if (value !== undefined) {
            const anonymized = this.anonymize(value, field.strategy);
            updates[field.path] = anonymized;
            changed = true;
            totalFields++;
          }
        }

        if (changed) {
          await collection.updateOne({ _id: doc._id }, { $set: updates });
          totalDocs++;
        }
      }
    }

    return {
      branchName,
      documentsProcessed: totalDocs,
      fieldsAnonymized: totalFields,
      rules,
    };
  }

  /**
   * Apply anonymization strategy to a value.
   */
  private anonymize(value: unknown, strategy: AnonymizeStrategy): unknown {
    const str = String(value);

    switch (strategy) {
      case "hash":
        return createHash("sha256").update(str).digest("hex").slice(0, 16);
      case "mask":
        if (str.includes("@")) {
          // Email: mask local part
          const [local, domain] = str.split("@");
          return `${local[0]}${"*".repeat(Math.max(local.length - 2, 1))}${local.slice(-1)}@${domain}`;
        }
        if (str.length <= 2) return "*".repeat(str.length);
        return `${str[0]}${"*".repeat(str.length - 2)}${str.slice(-1)}`;
      case "null":
        return null;
      case "redact":
        return "[REDACTED]";
      default:
        return value;
    }
  }

  /**
   * Get a nested value from a document using dot notation.
   */
  private getNestedValue(doc: Record<string, unknown>, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = doc;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}
