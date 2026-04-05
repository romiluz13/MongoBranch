/**
 * EnvironmentDoctor — live capability probes for Atlas Local preview.
 *
 * Verifies the exact MongoDB features MongoBranch depends on by executing
 * real operations against the connected deployment:
 * - transactions
 * - database change streams
 * - pre-images via collMod + watch()
 * - Atlas Search CRUD + query
 * - Atlas Vector Search CRUD + query
 */

import { randomUUID } from "crypto";
import type {
  ChangeStream,
  ChangeStreamDocument,
  Collection,
  Document,
  MongoClient,
} from "mongodb";
import type {
  EnvironmentCheckResult,
  EnvironmentCheckStatus,
  EnvironmentDoctorReport,
  MongoBranchConfig,
} from "./types.ts";
import { AccessControlManager } from "./access-control.ts";

interface DoctorOptions {
  timeoutMs?: number;
  includeSearch?: boolean;
  includeVectorSearch?: boolean;
}

export class EnvironmentDoctor {
  private client: MongoClient;
  private config: MongoBranchConfig;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
  }

  async run(options: DoctorOptions = {}): Promise<EnvironmentDoctorReport> {
    const checks: EnvironmentCheckResult[] = [];
    const timeoutMs = options.timeoutMs ?? 15_000;

    checks.push(await this.runCheck("ping", async () => this.checkPing()));
    checks.push(await this.runCheck("access_control_enforcement", async () => this.checkAccessControlEnforcement()));
    checks.push(await this.runCheck("transactions", async () => this.checkTransactions()));
    checks.push(await this.runCheck("database_change_streams", async () => this.checkDatabaseChangeStreams(timeoutMs)));
    checks.push(await this.runCheck("pre_images", async () => this.checkPreImages(timeoutMs)));

    if (options.includeSearch !== false) {
      checks.push(await this.runCheck("search_index_round_trip", async () => this.checkSearchIndexRoundTrip(timeoutMs)));
    }
    if (options.includeVectorSearch !== false) {
      checks.push(await this.runCheck("vector_search_round_trip", async () => this.checkVectorSearchRoundTrip(timeoutMs)));
    }

    const buildInfo = await this.client.db("admin").command({ buildInfo: 1 }).catch(() => null);
    const summary = {
      total: checks.length,
      passed: checks.filter((check) => check.status === "pass").length,
      warned: checks.filter((check) => check.status === "warn").length,
      failed: checks.filter((check) => check.status === "fail").length,
    };

    return {
      generatedAt: new Date(),
      config: {
        uri: this.config.uri,
        sourceDatabase: this.config.sourceDatabase,
        metaDatabase: this.config.metaDatabase,
        branchPrefix: this.config.branchPrefix,
      },
      serverInfo: buildInfo ? {
        version: typeof buildInfo.version === "string" ? buildInfo.version : undefined,
        gitVersion: typeof buildInfo.gitVersion === "string" ? buildInfo.gitVersion : undefined,
        modules: Array.isArray(buildInfo.modules) ? buildInfo.modules as string[] : undefined,
      } : undefined,
      summary,
      checks,
    };
  }

  private async runCheck(
    name: string,
    probe: () => Promise<Omit<EnvironmentCheckResult, "name">>,
  ): Promise<EnvironmentCheckResult> {
    try {
      const result = await probe();
      return { name, ...result };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        name,
        status: "fail",
        detail: message,
      };
    }
  }

  private async checkPing(): Promise<Omit<EnvironmentCheckResult, "name">> {
    const result = await this.client.db("admin").command({ ping: 1 });
    return {
      status: result.ok === 1 ? "pass" : "fail",
      detail: result.ok === 1
        ? "MongoDB responded to ping."
        : "MongoDB ping command returned a non-ok response.",
      data: { ok: result.ok },
    };
  }

  private async checkAccessControlEnforcement(): Promise<Omit<EnvironmentCheckResult, "name">> {
    const access = new AccessControlManager(this.client, this.config);
    await access.initialize();
    const status = await access.getStatus({ probeEnforcement: true });
    const probe = status.enforcementProbe;

    if (!probe) {
      return {
        status: "warn",
        detail: "MongoBranch could not determine whether MongoDB access control is enforced.",
      };
    }

    return {
      status: probe.enforced ? "pass" : "warn",
      detail: probe.detail,
      data: {
        authenticatedUsers: status.authenticatedUsers,
        authenticatedRoles: status.authenticatedRoles,
        canManageUsers: status.canManageUsers,
        canManageRoles: status.canManageRoles,
        ...(probe.data ?? {}),
      },
    };
  }

  private async checkTransactions(): Promise<Omit<EnvironmentCheckResult, "name">> {
    const dbName = this.createProbeDatabaseName("txn");
    const db = this.client.db(dbName);
    const coll = db.collection("txn_probe");
    const session = this.client.startSession();

    try {
      await coll.insertOne({ probeKey: "seed", ready: true });
      const transactionResult = await session.withTransaction(async (txnSession) => {
        await coll.insertOne({ probeKey: "txn-1", committed: true }, { session: txnSession });
        return coll.findOne({ probeKey: "txn-1" }, { session: txnSession });
      });
      const persisted = await coll.findOne({ probeKey: "txn-1" });
      const ok = Boolean(transactionResult && persisted?.committed === true);

      return {
        status: ok ? "pass" : "fail",
        detail: ok
          ? "Transaction committed and persisted the probe document."
          : "Transaction callback returned, but the probe document was not persisted as expected.",
      };
    } finally {
      await session.endSession().catch(() => {});
      await db.dropDatabase().catch(() => {});
    }
  }

  private async checkDatabaseChangeStreams(timeoutMs: number): Promise<Omit<EnvironmentCheckResult, "name">> {
    const dbName = this.createProbeDatabaseName("watch");
    const db = this.client.db(dbName);
    const coll = db.collection("watch_probe");
    const stream = db.watch([], { fullDocument: "updateLookup", maxAwaitTimeMS: timeoutMs });

    try {
      await this.sleep(200);
      const change = await this.awaitChange(
        stream,
        async () => {
          await coll.insertOne({ probeKey: "watch-1", title: "doctor insert" });
        },
        timeoutMs,
      );

      const collection =
        "ns" in change && change.ns && "coll" in change.ns
          ? change.ns.coll
          : undefined;
      const ok = change.operationType === "insert" && collection === "watch_probe";
      return {
        status: ok ? "pass" : "fail",
        detail: ok
          ? "Database change stream observed a live insert event."
          : `Unexpected change stream event type: ${change.operationType}`,
        data: {
          operationType: change.operationType,
          collection,
        },
      };
    } finally {
      await stream.close().catch(() => {});
      await db.dropDatabase().catch(() => {});
    }
  }

  private async checkPreImages(timeoutMs: number): Promise<Omit<EnvironmentCheckResult, "name">> {
    const dbName = this.createProbeDatabaseName("preimg");
    const db = this.client.db(dbName);
    const coll = db.collection("preimg_probe");
    await coll.insertOne({ probeKey: "pre-1", status: "draft" });

    try {
      await db.command({
        collMod: "preimg_probe",
        changeStreamPreAndPostImages: { enabled: true },
      });

      const stream = coll.watch([], {
        fullDocument: "updateLookup",
        fullDocumentBeforeChange: "whenAvailable",
        maxAwaitTimeMS: timeoutMs,
      });

      try {
        await this.sleep(200);
        const change = await this.awaitChange(
          stream,
          async () => {
            await coll.updateOne({ probeKey: "pre-1" }, { $set: { status: "live" } });
          },
          timeoutMs,
        );

        const before = (change as { fullDocumentBeforeChange?: { status?: string } }).fullDocumentBeforeChange;
        const after = (change as { fullDocument?: { status?: string } }).fullDocument;
        const ok = before?.status === "draft" && after?.status === "live";
        return {
          status: ok ? "pass" : "warn",
          detail: ok
            ? "Pre-images were enabled and returned the previous document state."
            : "Pre-image probe completed, but no usable fullDocumentBeforeChange payload was returned.",
          data: {
            operationType: change.operationType,
            beforeStatus: before?.status,
            afterStatus: after?.status,
          },
        };
      } finally {
        await stream.close().catch(() => {});
      }
    } finally {
      await db.dropDatabase().catch(() => {});
    }
  }

  private async checkSearchIndexRoundTrip(timeoutMs: number): Promise<Omit<EnvironmentCheckResult, "name">> {
    const dbName = this.createProbeDatabaseName("search");
    const db = this.client.db(dbName);
    const coll = db.collection("search_probe");
    const indexName = "doctor_search";

    try {
      await coll.insertOne({
        probeKey: "search-1",
        title: "Atlas Local preview health doctor",
        body: "Search canary document for MongoBranch.",
      });

      await coll.createSearchIndex({
        name: indexName,
        type: "search",
        definition: {
          mappings: {
            dynamic: false,
            fields: {
              title: { type: "string" },
              body: { type: "string" },
            },
          },
        },
      } as any);

      const readyIndex = await this.waitForIndex(coll, indexName, timeoutMs);
      const results = await coll.aggregate([
        {
          $search: {
            index: indexName,
            text: {
              query: "health doctor",
              path: ["title", "body"],
            },
          },
        },
        { $limit: 1 },
      ]).toArray();

      await coll.dropSearchIndex(indexName);
      await this.waitForIndexRemoval(coll, indexName, timeoutMs);

      const ok = results.length > 0;
      return {
        status: ok ? "pass" : "warn",
        detail: ok
          ? "Atlas Search index created, became queryable, answered a query, and was dropped cleanly."
          : "Search index lifecycle completed, but the canary query did not return any results.",
        data: {
          indexStatus: readyIndex.status ?? "unknown",
          queryable: readyIndex.queryable ?? false,
          resultCount: results.length,
        },
      };
    } finally {
      await db.dropDatabase().catch(() => {});
    }
  }

  private async checkVectorSearchRoundTrip(timeoutMs: number): Promise<Omit<EnvironmentCheckResult, "name">> {
    const dbName = this.createProbeDatabaseName("vector");
    const db = this.client.db(dbName);
    const coll = db.collection("vector_probe");
    const indexName = "doctor_vector";

    try {
      await coll.insertMany([
        { probeKey: "vec-1", title: "closest", embedding: [0.11, 0.22, 0.33] },
        { probeKey: "vec-2", title: "farther", embedding: [0.9, 0.1, 0.2] },
      ]);

      await coll.createSearchIndex({
        name: indexName,
        type: "vectorSearch",
        definition: {
          fields: [
            {
              type: "vector",
              path: "embedding",
              numDimensions: 3,
              similarity: "cosine",
            },
          ],
        },
      } as any);

      const readyIndex = await this.waitForIndex(coll, indexName, timeoutMs);
      const results = await coll.aggregate([
        {
          $vectorSearch: {
            index: indexName,
            path: "embedding",
            queryVector: [0.11, 0.22, 0.33],
            numCandidates: 2,
            limit: 1,
          },
        },
        { $project: { _id: 1, probeKey: 1, title: 1 } },
      ]).toArray();

      await coll.dropSearchIndex(indexName);
      await this.waitForIndexRemoval(coll, indexName, timeoutMs);

      const topKey = (results[0] as { probeKey?: string } | undefined)?.probeKey;
      const ok = topKey === "vec-1";
      return {
        status: ok ? "pass" : "warn",
        detail: ok
          ? "Vector Search index created, answered a nearest-neighbor query, and was dropped cleanly."
          : "Vector Search lifecycle completed, but the nearest-neighbor query did not return the expected document.",
        data: {
          indexStatus: readyIndex.status ?? "unknown",
          queryable: readyIndex.queryable ?? false,
          topId: topKey ?? "",
          resultCount: results.length,
        },
      };
    } finally {
      await db.dropDatabase().catch(() => {});
    }
  }

  private async waitForIndex(
    coll: Collection<Document>,
    indexName: string,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const indexes = await coll.listSearchIndexes().toArray().catch(() => []) as Array<{
        name?: string;
        queryable?: boolean;
        status?: string;
        [key: string]: unknown;
      }>;
      const index = indexes.find((candidate) => candidate.name === indexName);
      const status = typeof index?.status === "string" ? index.status.toUpperCase() : "";
      const ready = index && (
        index.queryable === true ||
        status === "READY" ||
        status === "ACTIVE"
      );
      if (ready) {
        return index as Record<string, unknown>;
      }
      await this.sleep(500);
    }

    throw new Error(`Timed out waiting for search index "${indexName}" to become queryable`);
  }

  private async waitForIndexRemoval(
    coll: Collection<Document>,
    indexName: string,
    timeoutMs: number,
  ): Promise<void> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const indexes = await coll.listSearchIndexes().toArray().catch(() => []) as Array<{ name?: string }>;
      if (!indexes.some((candidate) => candidate.name === indexName)) {
        return;
      }
      await this.sleep(500);
    }

    throw new Error(`Timed out waiting for search index "${indexName}" to be removed`);
  }

  private async awaitChange(
    stream: ChangeStream,
    trigger: () => Promise<void>,
    timeoutMs: number,
  ): Promise<ChangeStreamDocument<Document>> {
    const nextChange = stream.next() as Promise<ChangeStreamDocument<Document>>;
    await trigger();
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Timed out waiting for change stream event")), timeoutMs);
    });
    return Promise.race([nextChange, timeout]);
  }

  private createProbeDatabaseName(suffix: string): string {
    return `__mbdoc_${suffix}_${randomUUID().slice(0, 8)}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
