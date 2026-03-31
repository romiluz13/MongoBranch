/**
 * MongoBranch — Deploy Request Manager
 *
 * PR-like workflow for merging branches to protected targets.
 * Inspired by PlanetScale deploy requests and Dolt pull requests.
 *
 * Flow: open → approve → execute (merge)
 * Can also: reject, close
 */
import { randomUUID } from "crypto";
import type { MongoClient, Collection } from "mongodb";
import type {
  MongoBranchConfig,
  DeployRequest,
  DeployRequestStatus,
  MergeResult,
  DiffResult,
} from "./types.ts";
import { MergeEngine } from "./merge.ts";
import { DiffEngine } from "./diff.ts";
import { ProtectionManager } from "./protection.ts";
import { HookManager } from "./hooks.ts";

const DEPLOY_REQUESTS_COLLECTION = "deploy_requests";

export class DeployRequestManager {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private requests: Collection<DeployRequest>;
  private mergeEngine: MergeEngine;
  private diffEngine: DiffEngine;
  private protectionManager: ProtectionManager;
  private hookManager: HookManager;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
    const metaDb = client.db(config.metaDatabase);
    this.requests = metaDb.collection<DeployRequest>(DEPLOY_REQUESTS_COLLECTION);
    this.mergeEngine = new MergeEngine(client, config);
    this.diffEngine = new DiffEngine(client, config);
    this.protectionManager = new ProtectionManager(client, config);
    this.hookManager = new HookManager(client, config);
  }

  async initialize(): Promise<void> {
    await this.requests.createIndex({ id: 1 }, { unique: true });
    await this.requests.createIndex({ status: 1 });
    await this.requests.createIndex({ sourceBranch: 1, targetBranch: 1 });
    await this.protectionManager.initialize();
    await this.hookManager.initialize();
  }

  /**
   * Open a deploy request — proposes merging source into target.
   * Automatically computes the diff at creation time.
   */
  async open(options: {
    sourceBranch: string;
    targetBranch: string;
    description: string;
    createdBy: string;
  }): Promise<DeployRequest> {
    const { sourceBranch, targetBranch, description, createdBy } = options;

    // Verify branches exist
    const meta = this.client.db(this.config.metaDatabase);
    const srcBranch = await meta.collection("branches").findOne({
      name: sourceBranch, status: { $ne: "deleted" },
    });
    if (!srcBranch) throw new Error(`Source branch "${sourceBranch}" not found`);

    const tgtBranch = await meta.collection("branches").findOne({
      name: targetBranch, status: { $ne: "deleted" },
    });
    if (!tgtBranch) throw new Error(`Target branch "${targetBranch}" not found`);

    // Check no duplicate open request for same source→target
    const existing = await this.requests.findOne({
      sourceBranch,
      targetBranch,
      status: { $in: ["open", "approved"] as DeployRequestStatus[] },
    });
    if (existing) {
      throw new Error(
        `Deploy request #${existing.id} already open for ${sourceBranch} → ${targetBranch}`
      );
    }

    // Note if target is protected — deploy request is the correct workflow
    const isTargetProtected = await this.protectionManager.isProtected(targetBranch);

    // Compute diff
    let diff: DiffResult | undefined;
    try {
      diff = await this.diffEngine.diff(sourceBranch, targetBranch);
    } catch {
      // Diff may fail if branches have no overlap — still allow DR creation
    }

    const id = randomUUID().slice(0, 8);
    const now = new Date();
    const dr: DeployRequest = {
      id,
      sourceBranch,
      targetBranch,
      description,
      status: "open",
      diff: diff as unknown as Record<string, unknown>,
      createdBy,
      createdAt: now,
      updatedAt: now,
      isTargetProtected,
    };

    await this.requests.insertOne(dr);
    return dr;
  }

  /**
   * Approve a deploy request — marks it ready for execution.
   */
  async approve(id: string, reviewedBy: string): Promise<DeployRequest> {
    const dr = await this.requests.findOne({ id });
    if (!dr) throw new Error(`Deploy request "${id}" not found`);
    if (dr.status !== "open") {
      throw new Error(`Cannot approve deploy request in "${dr.status}" state`);
    }

    await this.requests.updateOne({ id }, {
      $set: { status: "approved", reviewedBy, updatedAt: new Date() },
    });

    return { ...dr, status: "approved", reviewedBy };
  }

  /**
   * Reject a deploy request with a reason.
   */
  async reject(id: string, reviewedBy: string, reason: string): Promise<DeployRequest> {
    const dr = await this.requests.findOne({ id });
    if (!dr) throw new Error(`Deploy request "${id}" not found`);
    if (dr.status !== "open") {
      throw new Error(`Cannot reject deploy request in "${dr.status}" state`);
    }

    await this.requests.updateOne({ id }, {
      $set: {
        status: "rejected",
        reviewedBy,
        rejectionReason: reason,
        updatedAt: new Date(),
      },
    });

    return { ...dr, status: "rejected", reviewedBy, rejectionReason: reason };
  }

  /**
   * Execute an approved deploy request — performs the actual merge.
   */
  async execute(id: string): Promise<{ deployRequest: DeployRequest; mergeResult: MergeResult }> {
    const dr = await this.requests.findOne({ id });
    if (!dr) throw new Error(`Deploy request "${id}" not found`);
    if (dr.status !== "approved") {
      throw new Error(`Cannot execute deploy request in "${dr.status}" state — must be approved`);
    }

    // Fire pre-merge hooks (can reject)
    const preCtx = HookManager.createContext("pre-merge", dr.sourceBranch, dr.createdBy);
    const preResult = await this.hookManager.executePreHooks(preCtx);
    if (!preResult.allow) {
      throw new Error(`Pre-merge hook rejected: ${preResult.reason ?? "unknown"}`);
    }

    // Perform the merge
    const mergeResult = await this.mergeEngine.merge(dr.sourceBranch, dr.targetBranch);

    const now = new Date();
    await this.requests.updateOne({ id }, {
      $set: { status: "merged", mergedAt: now, updatedAt: now },
    });

    // Fire post-merge hooks (fire-and-forget)
    const postCtx = HookManager.createContext("post-merge", dr.sourceBranch, dr.createdBy);
    this.hookManager.executePostHooks(postCtx).catch(() => {}); // post-hooks don't block

    return {
      deployRequest: { ...dr, status: "merged", mergedAt: now },
      mergeResult,
    };
  }

  /**
   * Get a deploy request by ID.
   */
  async get(id: string): Promise<DeployRequest | null> {
    return this.requests.findOne({ id });
  }

  /**
   * List deploy requests, optionally filtered by status.
   */
  async list(options?: {
    status?: DeployRequestStatus;
    targetBranch?: string;
  }): Promise<DeployRequest[]> {
    const filter: Record<string, unknown> = {};
    if (options?.status) filter.status = options.status;
    if (options?.targetBranch) filter.targetBranch = options.targetBranch;

    return this.requests.find(filter).sort({ createdAt: -1 }).toArray();
  }
}
