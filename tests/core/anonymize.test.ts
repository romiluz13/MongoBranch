/**
 * MongoBranch — Anonymization Tests
 *
 * Phase 7.4: Data anonymization on branch creation
 * TDD, real MongoDB, zero mocks.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient } from "mongodb";
import { startMongoDB, stopMongoDB } from "../setup.ts";
import { AnonymizeEngine } from "../../src/core/anonymize.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";

let client: MongoClient;
let anonymizeEngine: AnonymizeEngine;

const config: MongoBranchConfig = {
  sourceDatabase: "test_anon_source",
  metaDatabase: "__mongobranch_anon",
  branchPrefix: "__mb_anon_",
};

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
  anonymizeEngine = new AnonymizeEngine(client, config);
}, 30_000);

afterAll(async () => {
  if (client) {
    const dbs = await client.db().admin().listDatabases();
    for (const db of dbs.databases) {
      if (db.name.startsWith("__mb_anon_") || db.name === "__mongobranch_anon" || db.name === "test_anon_source") {
        await client.db(db.name).dropDatabase();
      }
    }
  }
  await stopMongoDB();
}, 10_000);

beforeEach(async () => {
  await client.db(config.metaDatabase).collection("branches").deleteMany({});
  const sourceDb = client.db(config.sourceDatabase);
  await sourceDb.dropDatabase();
  await sourceDb.collection("users").insertMany([
    { name: "Alice Smith", email: "alice@example.com", ssn: "123-45-6789" },
    { name: "Bob Jones", email: "bob@example.com", ssn: "987-65-4321" },
  ]);
});

describe("AnonymizeEngine", () => {
  it("anonymizes with hash strategy", async () => {
    const result = await anonymizeEngine.createAnonymizedBranch("anon-hash", [
      { collection: "users", fields: [{ path: "ssn", strategy: "hash" }] },
    ]);

    expect(result.documentsProcessed).toBe(2);
    expect(result.fieldsAnonymized).toBe(2);

    const branchDb = client.db(`${config.branchPrefix}anon-hash`);
    const alice = await branchDb.collection("users").findOne({ name: "Alice Smith" });
    expect(alice!.ssn).not.toBe("123-45-6789");
    expect(typeof alice!.ssn).toBe("string");
    expect((alice!.ssn as string).length).toBe(16); // SHA-256 truncated
  });

  it("anonymizes with mask strategy (email)", async () => {
    const result = await anonymizeEngine.createAnonymizedBranch("anon-mask", [
      { collection: "users", fields: [{ path: "email", strategy: "mask" }] },
    ]);

    const branchDb = client.db(`${config.branchPrefix}anon-mask`);
    const alice = await branchDb.collection("users").findOne({ name: "Alice Smith" });
    expect(alice!.email).not.toBe("alice@example.com");
    expect((alice!.email as string)).toContain("@example.com"); // domain preserved
    expect((alice!.email as string)).toContain("*"); // masked
  });

  it("anonymizes with null strategy", async () => {
    const result = await anonymizeEngine.createAnonymizedBranch("anon-null", [
      { collection: "users", fields: [{ path: "ssn", strategy: "null" }] },
    ]);

    const branchDb = client.db(`${config.branchPrefix}anon-null`);
    const alice = await branchDb.collection("users").findOne({ name: "Alice Smith" });
    expect(alice!.ssn).toBeNull();
  });

  it("anonymizes with redact strategy", async () => {
    const result = await anonymizeEngine.createAnonymizedBranch("anon-redact", [
      { collection: "users", fields: [{ path: "name", strategy: "redact" }] },
    ]);

    const branchDb = client.db(`${config.branchPrefix}anon-redact`);
    const docs = await branchDb.collection("users").find({}).toArray();
    for (const doc of docs) {
      expect(doc.name).toBe("[REDACTED]");
    }
  });

  it("applies multiple rules to multiple fields", async () => {
    const result = await anonymizeEngine.createAnonymizedBranch("anon-multi", [
      {
        collection: "users",
        fields: [
          { path: "email", strategy: "mask" },
          { path: "ssn", strategy: "null" },
          { path: "name", strategy: "hash" },
        ],
      },
    ]);

    expect(result.fieldsAnonymized).toBe(6); // 3 fields × 2 docs

    const branchDb = client.db(`${config.branchPrefix}anon-multi`);
    const doc = await branchDb.collection("users").findOne({});
    expect(doc!.ssn).toBeNull();
    expect((doc!.email as string)).toContain("*");
    expect(doc!.name).not.toBe("Alice Smith");
    expect(doc!.name).not.toBe("Bob Jones");
  });
});
