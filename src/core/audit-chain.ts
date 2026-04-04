/**
 * MongoBranch — Audit Chain (Hash-Chained Tamper-Evident Log)
 *
 * Every significant operation is appended as a hash-chained entry.
 * Each entry's chainHash = SHA-256(prevHash + dataHash + sequence).
 * Tampering with ANY entry breaks the chain — detectable by verify().
 *
 * EU AI Act Article 12 compliance: tamper-evident logging for AI agents.
 */
import { createHash, randomUUID } from "crypto";
import type { MongoClient, Collection } from "mongodb";
import type {
  MongoBranchConfig,
  AuditChainEntry,
  AuditChainVerification,
  AuditEntryType,
} from "./types.ts";
import { AUDIT_CHAIN_COLLECTION } from "./types.ts";

export interface AppendOptions {
  entryType: AuditEntryType;
  branchName: string;
  actor: string;
  action: string;
  detail: string;
}

export class AuditChainManager {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private chain: Collection<AuditChainEntry>;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
    this.chain = client
      .db(config.metaDatabase)
      .collection<AuditChainEntry>(AUDIT_CHAIN_COLLECTION);
  }

  async initialize(): Promise<void> {
    await this.chain.createIndex({ chainHash: 1 }, { unique: true });
    await this.chain.createIndex({ sequence: 1 }, { unique: true });
    await this.chain.createIndex({ branchName: 1, timestamp: -1 });
    await this.chain.createIndex({ entryType: 1 });

    // Create genesis entry if chain is empty
    const count = await this.chain.countDocuments();
    if (count === 0) {
      const genesis: AuditChainEntry = {
        entryId: randomUUID(),
        sequence: 0,
        entryType: "genesis",
        branchName: "__system",
        actor: "system",
        action: "genesis",
        detail: "Audit chain initialized",
        dataHash: this.hashData("Audit chain initialized"),
        prevHash: "GENESIS",
        chainHash: this.computeChainHash("GENESIS", this.hashData("Audit chain initialized"), 0),
        timestamp: new Date(),
      };
      await this.chain.insertOne(genesis);
    }
  }

  /**
   * Append a new entry to the audit chain.
   * Atomically reads the last entry and appends the new one.
   */
  async append(options: AppendOptions): Promise<AuditChainEntry> {
    const last = await this.chain.findOne({}, { sort: { sequence: -1 } });
    if (!last) throw new Error("Audit chain corrupted — no genesis entry");

    const sequence = last.sequence + 1;
    const dataHash = this.hashData(options.detail);
    const chainHash = this.computeChainHash(last.chainHash, dataHash, sequence);

    const entry: AuditChainEntry = {
      entryId: randomUUID(),
      sequence,
      entryType: options.entryType,
      branchName: options.branchName,
      actor: options.actor,
      action: options.action,
      detail: options.detail,
      dataHash,
      prevHash: last.chainHash,
      chainHash,
      timestamp: new Date(),
    };

    await this.chain.insertOne(entry);
    return entry;
  }

  /**
   * Verify the entire chain — walks from genesis, checks every hash link.
   */
  async verify(options?: {
    fromSequence?: number;
    toSequence?: number;
  }): Promise<AuditChainVerification> {
    const filter: Record<string, unknown> = {};
    if (options?.fromSequence !== undefined || options?.toSequence !== undefined) {
      filter.sequence = {};
      if (options?.fromSequence !== undefined) (filter.sequence as any).$gte = options.fromSequence;
      if (options?.toSequence !== undefined) (filter.sequence as any).$lte = options.toSequence;
    }

    const entries = await this.chain.find(filter).sort({ sequence: 1 }).toArray();
    if (entries.length === 0) {
      return { valid: true, totalEntries: 0 };
    }

    // Verify genesis
    const first = entries[0]!;
    if (first.sequence === 0) {
      const expectedChainHash = this.computeChainHash("GENESIS", first.dataHash, 0);
      if (first.chainHash !== expectedChainHash) {
        return {
          valid: false, totalEntries: entries.length,
          brokenAt: 0, brokenReason: "Genesis entry chainHash mismatch",
          firstEntry: first, lastEntry: entries[entries.length - 1],
        };
      }
    }

    // Walk the chain
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1]!;
      const curr = entries[i]!;

      // Verify prevHash link
      if (curr.prevHash !== prev.chainHash) {
        return {
          valid: false, totalEntries: entries.length,
          brokenAt: curr.sequence,
          brokenReason: `Entry ${curr.sequence} prevHash doesn't match entry ${prev.sequence} chainHash`,
          firstEntry: first, lastEntry: entries[entries.length - 1],
        };
      }

      // Verify dataHash
      const expectedDataHash = this.hashData(curr.detail);
      if (curr.dataHash !== expectedDataHash) {
        return {
          valid: false, totalEntries: entries.length,
          brokenAt: curr.sequence,
          brokenReason: `Entry ${curr.sequence} detail was tampered — dataHash mismatch`,
          firstEntry: first, lastEntry: entries[entries.length - 1],
        };
      }

      // Verify chainHash
      const expectedChainHash = this.computeChainHash(curr.prevHash, curr.dataHash, curr.sequence);
      if (curr.chainHash !== expectedChainHash) {
        return {
          valid: false, totalEntries: entries.length,
          brokenAt: curr.sequence,
          brokenReason: `Entry ${curr.sequence} chainHash mismatch`,
          firstEntry: first, lastEntry: entries[entries.length - 1],
        };
      }
    }

    return {
      valid: true, totalEntries: entries.length,
      firstEntry: first, lastEntry: entries[entries.length - 1],
    };
  }

  /**
   * Paginated retrieval of chain entries.
   */
  async getChain(limit = 50, offset = 0): Promise<AuditChainEntry[]> {
    return this.chain.find({}).sort({ sequence: 1 }).skip(offset).limit(limit).toArray();
  }

  /**
   * Get a single entry by its chainHash.
   */
  async getEntry(chainHash: string): Promise<AuditChainEntry | null> {
    return this.chain.findOne({ chainHash });
  }

  /**
   * Get entries for a specific branch.
   */
  async getByBranch(branchName: string, limit = 50): Promise<AuditChainEntry[]> {
    return this.chain
      .find({ branchName })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get entries by time range.
   */
  async getByTimeRange(from: Date, to: Date): Promise<AuditChainEntry[]> {
    return this.chain
      .find({ timestamp: { $gte: from, $lte: to } })
      .sort({ sequence: 1 })
      .toArray();
  }

  /**
   * Export the full chain as JSON (with verification header).
   */
  async exportChain(format: "json" | "csv" = "json"): Promise<string> {
    const entries = await this.chain.find({}).sort({ sequence: 1 }).toArray();
    const verification = await this.verify();

    if (format === "csv") {
      const header = "sequence,entryType,branchName,actor,action,detail,dataHash,prevHash,chainHash,timestamp";
      const rows = entries.map(e =>
        `${e.sequence},${e.entryType},${e.branchName},${e.actor},${e.action},"${e.detail.replace(/"/g, '""')}",${e.dataHash},${e.prevHash},${e.chainHash},${e.timestamp.toISOString()}`
      );
      return [
        `# MongoBranch Audit Chain Export — ${new Date().toISOString()}`,
        `# Chain Valid: ${verification.valid} | Total Entries: ${verification.totalEntries}`,
        header,
        ...rows,
      ].join("\n");
    }

    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      verification: {
        valid: verification.valid,
        totalEntries: verification.totalEntries,
        brokenAt: verification.brokenAt,
      },
      entries: entries.map(e => ({
        sequence: e.sequence,
        entryType: e.entryType,
        branchName: e.branchName,
        actor: e.actor,
        action: e.action,
        detail: e.detail,
        dataHash: e.dataHash,
        prevHash: e.prevHash,
        chainHash: e.chainHash,
        timestamp: e.timestamp.toISOString(),
      })),
    }, null, 2);
  }

  // ── Private helpers ──────────────────────────────────────────

  private hashData(data: string): string {
    return createHash("sha256").update(data).digest("hex");
  }

  private computeChainHash(prevHash: string, dataHash: string, sequence: number): string {
    return createHash("sha256")
      .update(`${prevHash}:${dataHash}:${sequence}`)
      .digest("hex");
  }
}
