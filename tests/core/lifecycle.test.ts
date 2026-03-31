/**
 * TDD Tests for MongoBranch Lifecycle Features (Wave 5)
 *
 * Branch TTL, Reset from Parent, Branch Protection, Hooks.
 * Real MongoDB — no mocks.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient } from "mongodb";
import {
  startMongoDB,
  stopMongoDB,
  getTestEnvironment,
  cleanupBranches,
} from "../setup.ts";
import { BranchManager } from "../../src/core/branch.ts";
import { CommitEngine } from "../../src/core/commit.ts";
import { ProtectionManager } from "../../src/core/protection.ts";
import { HookManager } from "../../src/core/hooks.ts";
import type { MongoBranchConfig, HookContext } from "../../src/core/types.ts";
import { SEED_DATABASE } from "../seed.ts";

let client: MongoClient;
let uri: string;
let config: MongoBranchConfig;
let branchManager: BranchManager;
let commitEngine: CommitEngine;
let protectionManager: ProtectionManager;
let hookManager: HookManager;

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
  uri = env.uri;
}, 30_000);

afterAll(async () => {
  await stopMongoDB();
}, 10_000);

beforeEach(async () => {
  await getTestEnvironment();
  await cleanupBranches(client);
  await client.db("__mongobranch").collection("commits").deleteMany({});
  await client.db("__mongobranch").collection("tags").deleteMany({});
  await client.db("__mongobranch").collection("protections").deleteMany({});
  await client.db("__mongobranch").collection("hooks").deleteMany({});

  config = {
    uri,
    sourceDatabase: SEED_DATABASE,
    metaDatabase: "__mongobranch",
    branchPrefix: "__mb_",
  };

  branchManager = new BranchManager(client, config);
  await branchManager.initialize();
  commitEngine = new CommitEngine(client, config);
  await commitEngine.initialize();
  protectionManager = new ProtectionManager(client, config);
  await protectionManager.initialize();
  hookManager = new HookManager(client, config);
  await hookManager.initialize();
});

// ── Branch TTL Tests ────────────────────────────────────────

describe("Branch TTL & Expiration", () => {
  it("creates a branch with TTL — expiresAt is set", async () => {
    const before = Date.now();
    await branchManager.createBranch({ name: "ttl-branch", ttlMinutes: 60 });

    const branch = await branchManager.getBranch("ttl-branch");
    expect(branch).not.toBeNull();
    expect(branch!.expiresAt).toBeInstanceOf(Date);
    // Should expire ~60 minutes from now
    const diff = branch!.expiresAt!.getTime() - before;
    expect(diff).toBeGreaterThan(59 * 60_000);
    expect(diff).toBeLessThan(61 * 60_000);
  });

  it("creates a branch without TTL — no expiresAt", async () => {
    await branchManager.createBranch({ name: "no-ttl-branch" });
    const branch = await branchManager.getBranch("no-ttl-branch");
    expect(branch!.expiresAt).toBeUndefined();
  });

  it("extends a branch TTL", async () => {
    await branchManager.createBranch({ name: "ext-ttl", ttlMinutes: 30 });
    const newExpiry = await branchManager.extendBranch("ext-ttl", 120);

    expect(newExpiry).toBeInstanceOf(Date);
    const diff = newExpiry.getTime() - Date.now();
    expect(diff).toBeGreaterThan(119 * 60_000);
    expect(diff).toBeLessThan(121 * 60_000);

    const branch = await branchManager.getBranch("ext-ttl");
    expect(branch!.expiresAt!.getTime()).toBe(newExpiry.getTime());
  });

  it("sets expiration on branch that had none", async () => {
    await branchManager.createBranch({ name: "set-ttl" });
    const futureDate = new Date(Date.now() + 3600_000);
    await branchManager.setBranchExpiration("set-ttl", futureDate);

    const branch = await branchManager.getBranch("set-ttl");
    expect(branch!.expiresAt).toBeInstanceOf(Date);
  });

  it("removes expiration from a branch", async () => {
    await branchManager.createBranch({ name: "rm-ttl", ttlMinutes: 30 });
    await branchManager.setBranchExpiration("rm-ttl", null);

    const branch = await branchManager.getBranch("rm-ttl");
    expect(branch!.expiresAt).toBeUndefined();
  });

  it("TTL appears in branch listing", async () => {
    await branchManager.createBranch({ name: "list-ttl", ttlMinutes: 45 });
    const branches = await branchManager.listBranches();
    const found = branches.find(b => b.name === "list-ttl");
    expect(found).toBeDefined();
    expect(found!.expiresAt).toBeInstanceOf(Date);
  });
});

// ── Reset from Parent Tests ─────────────────────────────────

describe("Reset from Parent", () => {
  it("re-materializes branch data from source", async () => {
    await branchManager.createBranch({ name: "reset-me" });

    // Modify branch data
    const branchDb = client.db("__mb_reset-me");
    await branchDb.collection("users").insertOne({ name: "Temporary User" });
    const beforeReset = await branchDb.collection("users").countDocuments();

    // Reset from parent (source)
    await branchManager.resetFromParent("reset-me");

    // The temporary user should be gone
    const afterReset = await branchDb.collection("users").countDocuments();
    const tempUser = await branchDb.collection("users").findOne({ name: "Temporary User" });
    expect(tempUser).toBeNull();
    // Count should match source
    const sourceCount = await client.db(SEED_DATABASE).collection("users").countDocuments();
    expect(afterReset).toBe(sourceCount);
  });

  it("preserves branch metadata after reset", async () => {
    await branchManager.createBranch({
      name: "reset-meta",
      description: "Important branch",
    });

    await branchManager.resetFromParent("reset-meta");

    const branch = await branchManager.getBranch("reset-meta");
    expect(branch).not.toBeNull();
    expect(branch!.name).toBe("reset-meta");
    expect(branch!.status).toBe("active");
  });
});



// ── Branch Protection Tests ──────────────────────────────────

describe("Branch Protection", () => {
  it("protects a branch by exact name", async () => {
    const rule = await protectionManager.protectBranch("main", {
      createdBy: "admin",
    });

    expect(rule.pattern).toBe("main");
    expect(rule.requireMergeOnly).toBe(true);
    expect(rule.preventDelete).toBe(true);
  });

  it("rejects direct write to protected branch", async () => {
    await protectionManager.protectBranch("guarded");

    const check = await protectionManager.checkWritePermission("guarded", false);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("protected");
  });

  it("allows merge to protected branch", async () => {
    await protectionManager.protectBranch("merge-only");

    const check = await protectionManager.checkWritePermission("merge-only", true);
    expect(check.allowed).toBe(true);
  });

  it("supports glob patterns", async () => {
    await protectionManager.protectBranch("prod-*");

    const check1 = await protectionManager.checkWritePermission("prod-v1", false);
    expect(check1.allowed).toBe(false);

    const check2 = await protectionManager.checkWritePermission("staging-v1", false);
    expect(check2.allowed).toBe(true);
  });

  it("removes protection", async () => {
    await protectionManager.protectBranch("temp-protected");
    await protectionManager.removeProtection("temp-protected");

    const check = await protectionManager.checkWritePermission("temp-protected", false);
    expect(check.allowed).toBe(true);
  });

  it("lists all protection rules", async () => {
    await protectionManager.protectBranch("rule-a");
    await protectionManager.protectBranch("rule-b");

    const rules = await protectionManager.listProtections();
    expect(rules.length).toBeGreaterThanOrEqual(2);
    const patterns = rules.map(r => r.pattern);
    expect(patterns).toContain("rule-a");
    expect(patterns).toContain("rule-b");
  });

  it("rejects duplicate protection rules", async () => {
    await protectionManager.protectBranch("dup-rule");
    await expect(protectionManager.protectBranch("dup-rule")).rejects.toThrow(/already exists/);
  });
});

// ── Hook Tests ──────────────────────────────────────────────

describe("HookManager — Pre-hooks (reject/allow)", () => {
  it("pre-commit hook can reject a commit", async () => {
    await hookManager.registerHook("no-empty-msg", "pre-commit", async (ctx) => {
      return { allow: false, reason: "Empty commits not allowed" };
    });

    const ctx = HookManager.createContext("pre-commit", "test-branch");
    const result = await hookManager.executePreHooks(ctx);
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("Empty commits not allowed");
  });

  it("pre-merge hook can allow a merge", async () => {
    await hookManager.registerHook("allow-merge", "pre-merge", async () => {
      return { allow: true };
    });

    const ctx = HookManager.createContext("pre-merge", "test-branch");
    const result = await hookManager.executePreHooks(ctx);
    expect(result.allow).toBe(true);
  });

  it("hooks execute in priority order (lowest first, fail-fast)", async () => {
    const order: string[] = [];

    await hookManager.registerHook("hook-low", "pre-commit", async () => {
      order.push("low");
      return { allow: true };
    }, { priority: 10 });

    await hookManager.registerHook("hook-high", "pre-commit", async () => {
      order.push("high");
      return { allow: false, reason: "Blocked by high" };
    }, { priority: 20 });

    const ctx = HookManager.createContext("pre-commit", "test-branch");
    const result = await hookManager.executePreHooks(ctx);

    expect(order).toEqual(["low", "high"]); // Low runs first
    expect(result.allow).toBe(false); // High rejects
  });
});

describe("HookManager — Post-hooks (fire-and-forget)", () => {
  it("post-merge hooks execute without blocking", async () => {
    let called = false;
    await hookManager.registerHook("post-notify", "post-merge", async () => {
      called = true;
      return { allow: true }; // Return value ignored for post-hooks
    });

    const ctx = HookManager.createContext("post-merge", "test-branch");
    await hookManager.executePostHooks(ctx);
    expect(called).toBe(true);
  });

  it("post-hooks swallow errors silently", async () => {
    await hookManager.registerHook("post-crash", "post-commit", async () => {
      throw new Error("Post-hook crash — should be swallowed");
    });

    const ctx = HookManager.createContext("post-commit", "test-branch");
    // Should NOT throw
    await hookManager.executePostHooks(ctx);
  });
});

describe("HookManager — CRUD", () => {
  it("lists hooks filtered by event", async () => {
    await hookManager.registerHook("list-a", "pre-commit", async () => ({ allow: true }));
    await hookManager.registerHook("list-b", "pre-merge", async () => ({ allow: true }));

    const commitHooks = await hookManager.listHooks("pre-commit");
    expect(commitHooks.length).toBeGreaterThanOrEqual(1);
    expect(commitHooks.every(h => h.event === "pre-commit")).toBe(true);
  });

  it("removes a hook", async () => {
    await hookManager.registerHook("removable", "pre-commit", async () => ({ allow: true }));
    await hookManager.removeHook("removable");

    const hooks = await hookManager.listHooks("pre-commit");
    expect(hooks.find(h => h.name === "removable")).toBeUndefined();
  });

  it("rejects duplicate hook names", async () => {
    await hookManager.registerHook("unique-hook", "pre-commit", async () => ({ allow: true }));
    await expect(
      hookManager.registerHook("unique-hook", "pre-merge", async () => ({ allow: true }))
    ).rejects.toThrow(/already registered/);
  });
});
