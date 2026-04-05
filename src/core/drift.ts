/**
 * MongoBranch — Drift Manager
 *
 * Captures branch review baselines and checks whether a branch changed since
 * that baseline using MongoDB change streams plus operationTime fences.
 */
import { randomUUID } from "crypto";
import type { MongoClient, Collection } from "mongodb";
import type {
  MongoBranchConfig,
  DriftBaseline,
  DriftBaselineStatus,
  DriftCheckResult,
} from "./types.ts";
import { DRIFT_BASELINES_COLLECTION } from "./types.ts";
import { hasBranchChangesSince, resolveWatchedDatabaseName } from "./watcher.ts";

export class DriftManager {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private baselines: Collection<DriftBaseline>;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
    this.baselines = client.db(config.metaDatabase)
      .collection<DriftBaseline>(DRIFT_BASELINES_COLLECTION);
  }

  async initialize(): Promise<void> {
    await this.baselines.createIndex({ id: 1 }, { unique: true });
    await this.baselines.createIndex({ branchName: 1, capturedAt: -1 });
    await this.baselines.createIndex({ status: 1, branchName: 1 });
  }

  async captureBaseline(options: {
    branchName: string;
    capturedBy?: string;
    reason?: string;
  }): Promise<DriftBaseline> {
    await resolveWatchedDatabaseName(this.client, this.config, options.branchName);

    const id = randomUUID().slice(0, 8);
    const now = new Date();
    const doc: Omit<DriftBaseline, "baselineOperationTime"> = {
      id,
      branchName: options.branchName,
      capturedBy: options.capturedBy ?? "unknown",
      reason: options.reason,
      status: "clean",
      capturedAt: now,
      updatedAt: now,
    };

    const result = await this.client.db(this.config.metaDatabase).command({
      insert: DRIFT_BASELINES_COLLECTION,
      documents: [doc],
    });
    const baselineOperationTime =
      result.operationTime ?? result.$clusterTime?.clusterTime ?? null;

    if (!baselineOperationTime) {
      await this.baselines.deleteOne({ id }).catch(() => {});
      throw new Error(
        `MongoDB did not return operationTime for drift baseline "${id}".`
      );
    }

    await this.baselines.updateOne(
      { id },
      {
        $set: { baselineOperationTime },
        $currentDate: { updatedAt: true },
      },
    );

    return {
      ...doc,
      baselineOperationTime,
      updatedAt: new Date(),
    };
  }

  async getBaseline(id: string): Promise<DriftBaseline | null> {
    return this.baselines.findOne({ id });
  }

  async getLatestBaseline(branchName: string): Promise<DriftBaseline | null> {
    return this.baselines.find({ branchName }).sort({ capturedAt: -1 }).limit(1).next();
  }

  async listBaselines(options: {
    branchName?: string;
    status?: DriftBaselineStatus;
    limit?: number;
  } = {}): Promise<DriftBaseline[]> {
    const filter: Record<string, unknown> = {};
    if (options.branchName) filter.branchName = options.branchName;
    if (options.status) filter.status = options.status;
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
    return this.baselines.find(filter).sort({ capturedAt: -1 }).limit(limit).toArray();
  }

  async checkBaseline(options: {
    baselineId?: string;
    branchName?: string;
  }): Promise<DriftCheckResult> {
    const baseline = await this.resolveBaseline(options);
    if (!baseline.baselineOperationTime) {
      throw new Error(
        `Drift baseline "${baseline.id}" is missing its operationTime fence. Capture a new baseline.`
      );
    }

    const drifted = await hasBranchChangesSince(
      this.client,
      this.config,
      baseline.branchName,
      baseline.baselineOperationTime,
    );
    const status: DriftBaselineStatus = drifted ? "drifted" : "clean";
    const statusReason = drifted
      ? `Branch "${baseline.branchName}" changed since baseline "${baseline.id}".`
      : `No changes detected on "${baseline.branchName}" since baseline "${baseline.id}".`;

    await this.baselines.updateOne(
      { id: baseline.id },
      {
        $set: {
          status,
          lastStatusReason: statusReason,
        },
        ...(drifted && !baseline.driftedAt
          ? { $currentDate: { driftedAt: true, lastCheckedAt: true, updatedAt: true } }
          : { $currentDate: { lastCheckedAt: true, updatedAt: true } }),
      },
    );

    const persisted = await this.baselines.findOne({ id: baseline.id });
    if (!persisted) {
      throw new Error(`Drift baseline "${baseline.id}" disappeared during update.`);
    }

    return {
      baseline: persisted,
      drifted,
      statusReason,
    };
  }

  private async resolveBaseline(options: {
    baselineId?: string;
    branchName?: string;
  }): Promise<DriftBaseline> {
    if (options.baselineId) {
      const baseline = await this.getBaseline(options.baselineId);
      if (!baseline) {
        throw new Error(`Drift baseline "${options.baselineId}" not found`);
      }
      return baseline;
    }

    if (!options.branchName) {
      throw new Error(`Provide either baselineId or branchName to check drift`);
    }

    const baseline = await this.getLatestBaseline(options.branchName);
    if (!baseline) {
      throw new Error(`No drift baseline found for branch "${options.branchName}"`);
    }
    return baseline;
  }
}
