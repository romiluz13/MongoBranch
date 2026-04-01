/**
 * MongoBranch — Agent Scope Tests
 *
 * Phase 7.1: Agent permissions and scopes
 * TDD, real MongoDB, zero mocks.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient } from "mongodb";
import { startMongoDB, stopMongoDB } from "../setup.ts";
import { ScopeManager } from "../../src/core/scope.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";

let client: MongoClient;
let scopeManager: ScopeManager;

const config: MongoBranchConfig = {
  sourceDatabase: "test_scope_source",
  metaDatabase: "__mongobranch_scope",
  branchPrefix: "__mb_scope_",
};

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
  scopeManager = new ScopeManager(client, config);
  await scopeManager.initialize();
}, 30_000);

afterAll(async () => {
  if (client) {
    const dbs = await client.db().admin().listDatabases();
    for (const db of dbs.databases) {
      if (db.name.startsWith("__mb_scope_") || db.name === "__mongobranch_scope" || db.name === "test_scope_source") {
        await client.db(db.name).dropDatabase();
      }
    }
  }
  await stopMongoDB();
}, 10_000);

beforeEach(async () => {
  await client.db(config.metaDatabase).collection("agent_scopes").deleteMany({});
  await client.db(config.metaDatabase).collection("scope_violations").deleteMany({});
});

// ── Scope CRUD ──────────────────────────────────────

describe("ScopeManager — set & get", () => {
  it("sets and retrieves an agent scope", async () => {
    const scope = await scopeManager.setScope({
      agentId: "agent-alpha",
      allowedCollections: ["users", "products"],
      permissions: ["read", "write"],
      maxBranches: 3,
    });

    expect(scope.agentId).toBe("agent-alpha");
    expect(scope.permissions).toEqual(["read", "write"]);

    const found = await scopeManager.getScope("agent-alpha");
    expect(found).not.toBeNull();
    expect(found!.allowedCollections).toEqual(["users", "products"]);
    expect(found!.maxBranches).toBe(3);
  });

  it("returns null for agents with no scope (unrestricted)", async () => {
    const scope = await scopeManager.getScope("no-scope-agent");
    expect(scope).toBeNull();
  });

  it("removes a scope", async () => {
    await scopeManager.setScope({
      agentId: "temp-agent",
      permissions: ["read"],
    });

    await scopeManager.removeScope("temp-agent");
    const found = await scopeManager.getScope("temp-agent");
    expect(found).toBeNull();
  });

  it("lists all scopes", async () => {
    await scopeManager.setScope({ agentId: "a1", permissions: ["read"] });
    await scopeManager.setScope({ agentId: "a2", permissions: ["read", "write"] });

    const all = await scopeManager.listScopes();
    expect(all.length).toBe(2);
  });
});

// ── Permission Checks ───────────────────────────────

describe("ScopeManager — permission checks", () => {
  it("allows unrestricted agents (no scope set)", async () => {
    const result = await scopeManager.checkPermission("free-agent", "anything", "delete");
    expect(result.allowed).toBe(true);
  });

  it("blocks operations not in permissions list", async () => {
    await scopeManager.setScope({
      agentId: "reader",
      permissions: ["read"],
    });

    const read = await scopeManager.checkPermission("reader", "users", "read");
    expect(read.allowed).toBe(true);

    const write = await scopeManager.checkPermission("reader", "users", "write");
    expect(write.allowed).toBe(false);
    expect(write.reason).toMatch(/lacks "write" permission/);
  });

  it("blocks denied collections (deny overrides allow)", async () => {
    await scopeManager.setScope({
      agentId: "partial",
      allowedCollections: ["users", "secrets"],
      deniedCollections: ["secrets"],
      permissions: ["read", "write"],
    });

    const users = await scopeManager.checkPermission("partial", "users", "read");
    expect(users.allowed).toBe(true);

    const secrets = await scopeManager.checkPermission("partial", "secrets", "read");
    expect(secrets.allowed).toBe(false);
    expect(secrets.reason).toMatch(/denied/);
  });

  it("blocks collections not in allowed list", async () => {
    await scopeManager.setScope({
      agentId: "scoped",
      allowedCollections: ["users"],
      permissions: ["read", "write"],
    });

    const ok = await scopeManager.checkPermission("scoped", "users", "write");
    expect(ok.allowed).toBe(true);

    const blocked = await scopeManager.checkPermission("scoped", "orders", "write");
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/not in allowed list/);
  });
});



// ── Branch Quota ────────────────────────────────────

describe("ScopeManager — branch quota", () => {
  it("allows branch creation within quota", async () => {
    await scopeManager.setScope({
      agentId: "limited",
      permissions: ["read", "write"],
      maxBranches: 3,
    });

    const result = await scopeManager.checkBranchQuota("limited", 2);
    expect(result.allowed).toBe(true);
  });

  it("blocks branch creation at quota limit", async () => {
    await scopeManager.setScope({
      agentId: "full",
      permissions: ["read", "write"],
      maxBranches: 2,
    });

    const result = await scopeManager.checkBranchQuota("full", 2);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/max branches/);
  });

  it("allows unlimited branches when no quota set", async () => {
    await scopeManager.setScope({
      agentId: "unlimited",
      permissions: ["read", "write"],
    });

    const result = await scopeManager.checkBranchQuota("unlimited", 100);
    expect(result.allowed).toBe(true);
  });
});

// ── Violation Logging ───────────────────────────────

describe("ScopeManager — violations", () => {
  it("logs and retrieves violations", async () => {
    await scopeManager.logViolation({
      agentId: "bad-agent",
      branchName: "bad-branch",
      collection: "secrets",
      operation: "write",
      reason: "Collection 'secrets' is denied",
    });

    await scopeManager.logViolation({
      agentId: "bad-agent",
      branchName: "bad-branch",
      collection: "admin",
      operation: "delete",
      reason: "Lacks 'delete' permission",
    });

    const violations = await scopeManager.getViolations("bad-agent");
    expect(violations.length).toBe(2);
    const collections = violations.map((v: { collection: string }) => v.collection).sort();
    expect(collections).toEqual(["admin", "secrets"]);
  });
});
