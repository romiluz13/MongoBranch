import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient } from "mongodb";
import { AccessControlManager } from "../../src/core/access-control.ts";
import { BranchManager } from "../../src/core/branch.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";
import { SEED_DATABASE } from "../seed.ts";
import { cleanupBranches, getTestEnvironment, startMongoDB, stopMongoDB } from "../setup.ts";

describe("AccessControlManager", () => {
  let client: MongoClient;
  let config: MongoBranchConfig;
  let manager: AccessControlManager;
  let branchManager: BranchManager;
  let createdUsers: string[] = [];

  async function cleanupUsers(): Promise<void> {
    const admin = client.db("admin");
    const profiles = await manager.listProfiles().catch(() => []);
    for (const profile of profiles) {
      await admin.command({ dropUser: profile.username }).catch(() => {});
      await admin.command({ dropRole: profile.roleName }).catch(() => {});
    }
    for (const username of createdUsers) {
      await admin.command({ dropUser: username }).catch(() => {});
    }
    createdUsers = [];
    await client.db(config.metaDatabase).collection("access_profiles").deleteMany({});
  }

  beforeAll(async () => {
    const env = await startMongoDB();
    client = env.client;
    config = {
      uri: env.uri,
      sourceDatabase: SEED_DATABASE,
      metaDatabase: "__mongobranch_access",
      branchPrefix: "__mb_access_",
    };
    manager = new AccessControlManager(client, config);
    branchManager = new BranchManager(client, config);
    await manager.initialize();
    await branchManager.initialize();
  }, 30_000);

  afterAll(async () => {
    await cleanupUsers();
    await stopMongoDB();
  }, 15_000);

  beforeEach(async () => {
    await getTestEnvironment();
    await cleanupBranches(client);
    await cleanupUsers();
    await client.db(config.metaDatabase).collection("branches").deleteMany({});
  }, 20_000);

  it("provisions a branch-scoped MongoDB user and records its profile", async () => {
    await branchManager.createBranch({ name: "access-branch" });
    const username = `branch_user_${Date.now()}`;
    createdUsers.push(username);

    const result = await manager.provisionBranchAccess({
      branchName: "access-branch",
      username,
      password: "secret123",
      collections: ["users"],
      createdBy: "ops",
    });

    expect(result.profile.kind).toBe("branch");
    expect(result.profile.branchName).toBe("access-branch");
    expect(result.profile.databaseName).toBe("__mb_access_access-branch");
    expect(result.connectionString).toContain("authSource=admin");

    const admin = client.db("admin");
    const usersInfo = await admin.command({ usersInfo: username });
    const rolesInfo = await admin.command({ rolesInfo: result.profile.roleName, showPrivileges: true });

    expect(usersInfo.users).toHaveLength(1);
    expect(rolesInfo.roles).toHaveLength(1);
    expect(rolesInfo.roles[0].privileges.some((entry: { resource: { db?: string } }) => entry.resource.db === "__mb_access_access-branch")).toBe(true);
  });

  it("reports auth context and a live enforcement probe result", async () => {
    const status = await manager.getStatus({ probeEnforcement: true });

    expect(status.adminDatabase).toBe("admin");
    expect(status.canManageUsers).toBe(true);
    expect(status.canManageRoles).toBe(true);
    expect(Array.isArray(status.authenticatedUsers)).toBe(true);
    expect(status.enforcementProbe).toBeDefined();
    expect(typeof status.enforcementProbe?.enforced).toBe("boolean");
    expect((status.enforcementProbe?.detail.length ?? 0)).toBeGreaterThan(0);
  }, 30_000);

  it("revokes a provisioned identity and marks the profile revoked", async () => {
    const username = `deploy_user_${Date.now()}`;
    createdUsers.push(username);
    const provisioned = await manager.provisionDeployerAccess({
      username,
      password: "secret123",
      createdBy: "ops",
      targetBranch: "main",
      allowWriteBlockBypass: true,
    });

    const revoked = await manager.revoke(username, "security");
    expect(revoked?.status).toBe("revoked");
    expect(revoked?.revokedBy).toBe("security");

    const admin = client.db("admin");
    const usersInfo = await admin.command({ usersInfo: username });
    const rolesInfo = await admin.command({ rolesInfo: provisioned.profile.roleName });
    expect(usersInfo.users ?? []).toHaveLength(0);
    expect(rolesInfo.roles ?? []).toHaveLength(0);

    const profiles = await manager.listProfiles();
    expect(profiles[0]?.status).toBe("revoked");
  });
});
