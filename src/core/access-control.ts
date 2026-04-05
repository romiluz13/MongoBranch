/**
 * AccessControlManager — least-privilege MongoDB users and roles for MongoBranch.
 *
 * MongoBranch cannot prevent raw direct writes at the server layer unless MongoDB
 * access control is actually enforced. This manager provisions branch-scoped and
 * deploy-scoped identities, records them in metadata, and can run a live probe to
 * check whether the current deployment is enforcing the created privileges.
 */
import { randomUUID } from "crypto";
import { MongoClient, type Collection, type Document } from "mongodb";
import type {
  AccessControlProbeResult,
  AccessControlStatus,
  AccessProfile,
  MongoBranchConfig,
  ProvisionAccessResult,
  ProvisionBranchAccessOptions,
  ProvisionDeployerAccessOptions,
} from "./types.ts";
import {
  ACCESS_CONTROL_ADMIN_DB,
  ACCESS_PROFILES_COLLECTION,
  MAIN_BRANCH,
  sanitizeBranchDbName,
} from "./types.ts";

type Privilege = {
  resource: { db?: string; collection?: string; cluster?: boolean };
  actions: string[];
};

const BASE_READ_ACTIONS = ["find", "listIndexes"] as const;
const BASE_WRITE_ACTIONS = ["insert", "update", "remove", "createCollection", "createIndex", "dropCollection", "dropIndex", "collMod"] as const;
const DATABASE_ACTIONS = ["listCollections", "dbStats"] as const;
const SEARCH_ACTIONS = ["createSearchIndexes", "dropSearchIndex", "listSearchIndexes", "updateSearchIndex"] as const;

export class AccessControlManager {
  private client: MongoClient;
  private config: MongoBranchConfig;
  private profiles: Collection<AccessProfile>;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
    this.profiles = client
      .db(config.metaDatabase)
      .collection<AccessProfile>(ACCESS_PROFILES_COLLECTION);
  }

  async initialize(): Promise<void> {
    await this.profiles.createIndex({ username: 1 }, { unique: true });
    await this.profiles.createIndex({ status: 1, kind: 1, branchName: 1 });
  }

  async getStatus(options: { probeEnforcement?: boolean } = {}): Promise<AccessControlStatus> {
    const adminDb = this.client.db(ACCESS_CONTROL_ADMIN_DB);
    const connection = await adminDb.command({ connectionStatus: 1, showPrivileges: true });
    const authenticatedUsers = Array.isArray(connection.authInfo?.authenticatedUsers)
      ? connection.authInfo.authenticatedUsers as Array<{ user?: string; db?: string }>
      : [];
    const authenticatedRoles = Array.isArray(connection.authInfo?.authenticatedUserRoles)
      ? connection.authInfo.authenticatedUserRoles as Array<{ role?: string; db?: string }>
      : [];

    const canManageUsers = await this.canRunAdminCommand({ usersInfo: 1 });
    const canManageRoles = await this.canRunAdminCommand({ rolesInfo: 1 });

    return {
      adminDatabase: ACCESS_CONTROL_ADMIN_DB,
      authenticatedUsers,
      authenticatedRoles,
      canManageUsers,
      canManageRoles,
      ...(options.probeEnforcement ? {
        enforcementProbe: await this.probeEnforcement(),
      } : {}),
    };
  }

  async provisionBranchAccess(options: ProvisionBranchAccessOptions): Promise<ProvisionAccessResult> {
    const databaseName = await this.assertBranchDatabase(options.branchName);
    const roleName = this.buildRoleName("branch", options.username, options.branchName);
    await this.assertIdentityAvailable(options.username, roleName);

    const privileges = this.buildBranchPrivileges(
      databaseName,
      options.collections,
      options.readOnly ?? false,
      options.includeSearchIndexes !== false,
    );

    await this.createRole(roleName, privileges);
    await this.createUser(options.username, options.password, roleName);

    const now = new Date();
    const profile: AccessProfile = {
      username: options.username,
      roleName,
      kind: "branch",
      status: "provisioned",
      branchName: options.branchName,
      databaseName,
      collections: options.collections,
      readOnly: options.readOnly ?? false,
      includeSearchIndexes: options.includeSearchIndexes !== false,
      createdBy: options.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    await this.profiles.insertOne(profile);

    return {
      profile,
      connectionString: this.buildConnectionString(options.username, options.password),
    };
  }

  async provisionDeployerAccess(options: ProvisionDeployerAccessOptions): Promise<ProvisionAccessResult> {
    const targetBranch = options.targetBranch ?? MAIN_BRANCH;
    const databaseName = targetBranch === MAIN_BRANCH
      ? this.config.sourceDatabase
      : await this.assertBranchDatabase(targetBranch);
    const roleName = this.buildRoleName("deployer", options.username, targetBranch);
    await this.assertIdentityAvailable(options.username, roleName);

    const privileges = this.buildDeployerPrivileges(
      databaseName,
      options.includeSearchIndexes !== false,
      options.allowWriteBlockBypass === true,
    );

    await this.createRole(roleName, privileges);
    await this.createUser(options.username, options.password, roleName);

    const now = new Date();
    const profile: AccessProfile = {
      username: options.username,
      roleName,
      kind: "deployer",
      status: "provisioned",
      targetBranch,
      databaseName,
      includeSearchIndexes: options.includeSearchIndexes !== false,
      allowWriteBlockBypass: options.allowWriteBlockBypass === true,
      createdBy: options.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    await this.profiles.insertOne(profile);

    return {
      profile,
      connectionString: this.buildConnectionString(options.username, options.password),
    };
  }

  async revoke(username: string, revokedBy: string): Promise<AccessProfile | null> {
    const profile = await this.profiles.findOne({ username, status: "provisioned" });
    if (!profile) {
      return null;
    }

    const adminDb = this.client.db(ACCESS_CONTROL_ADMIN_DB);
    await adminDb.command({ dropUser: username }).catch(() => {});
    await adminDb.command({ dropRole: profile.roleName }).catch(() => {});

    const revokedAt = new Date();
    await this.profiles.updateOne(
      { username },
      {
        $set: {
          status: "revoked",
          revokedBy,
          revokedAt,
        },
        $currentDate: { updatedAt: true },
      },
    );

    return {
      ...profile,
      status: "revoked",
      revokedBy,
      revokedAt,
      updatedAt: revokedAt,
    };
  }

  async listProfiles(): Promise<AccessProfile[]> {
    return this.profiles.find({}).sort({ createdAt: -1 }).toArray();
  }

  async probeEnforcement(): Promise<AccessControlProbeResult> {
    const probeId = randomUUID().replace(/-/g, "").slice(0, 12);
    const probeDb = `mb_access_probe_${probeId}`;
    const probeRole = `mb_probe_role_${probeId}`;
    const probeUser = `mb_probe_user_${probeId}`;
    const probePassword = `mb-probe-${probeId}`;
    const adminDb = this.client.db(ACCESS_CONTROL_ADMIN_DB);

    try {
      await adminDb.command({
        createRole: probeRole,
        privileges: this.buildBranchPrivileges(probeDb, ["allowed"], false, false),
        roles: [],
      });
      await adminDb.command({
        createUser: probeUser,
        pwd: probePassword,
        roles: [{ role: probeRole, db: ACCESS_CONTROL_ADMIN_DB }],
      });

      const probeClient = new MongoClient(this.buildConnectionString(probeUser, probePassword));
      await probeClient.connect();

      try {
        await probeClient.db(probeDb).collection("allowed").insertOne({ probe: true, path: "allowed" });
        const forbiddenResult = await this.captureWriteAttempt(probeClient, `mb_forbidden_${probeId}`);
        if (forbiddenResult.allowed) {
          return {
            enforced: false,
            detail: "MongoDB accepted a forbidden write from a restricted probe user. User/role provisioning works, but access control is not currently enforcing least privilege.",
            data: forbiddenResult.data,
          };
        }
        return {
          enforced: true,
          detail: "MongoDB denied a forbidden write from a restricted probe user. Least-privilege access control is being enforced.",
          data: forbiddenResult.data,
        };
      } finally {
        await probeClient.close().catch(() => {});
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        enforced: false,
        detail: `Unable to verify access control enforcement with a live restricted-user probe: ${message}`,
      };
    } finally {
      await adminDb.command({ dropUser: probeUser }).catch(() => {});
      await adminDb.command({ dropRole: probeRole }).catch(() => {});
      await this.client.db(probeDb).dropDatabase().catch(() => {});
    }
  }

  private async captureWriteAttempt(client: MongoClient, dbName: string): Promise<{ allowed: boolean; data: Record<string, unknown> }> {
    try {
      await client.db(dbName).collection("forbidden").insertOne({ probe: true, path: "forbidden" });
      return { allowed: true, data: { deniedDatabase: dbName } };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        allowed: false,
        data: {
          deniedDatabase: dbName,
          error: message,
        },
      };
    }
  }

  private async canRunAdminCommand(command: Document): Promise<boolean> {
    try {
      await this.client.db(ACCESS_CONTROL_ADMIN_DB).command(command);
      return true;
    } catch {
      return false;
    }
  }

  private async assertBranchDatabase(branchName: string): Promise<string> {
    if (branchName === MAIN_BRANCH) {
      return this.config.sourceDatabase;
    }
    const branch = await this.client
      .db(this.config.metaDatabase)
      .collection("branches")
      .findOne({ name: branchName, status: { $ne: "deleted" } });
    if (!branch) {
      throw new Error(`Branch "${branchName}" not found`);
    }
    return `${this.config.branchPrefix}${sanitizeBranchDbName(branchName)}`;
  }

  private async assertIdentityAvailable(username: string, roleName: string): Promise<void> {
    const adminDb = this.client.db(ACCESS_CONTROL_ADMIN_DB);
    const existingUser = await adminDb.command({ usersInfo: username });
    if ((existingUser.users?.length ?? 0) > 0) {
      throw new Error(`MongoDB user "${username}" already exists. Revoke it first or choose a different username.`);
    }
    const existingRole = await adminDb.command({ rolesInfo: roleName });
    if ((existingRole.roles?.length ?? 0) > 0) {
      throw new Error(`MongoDB role "${roleName}" already exists. Revoke it first or choose a different username.`);
    }
  }

  private async createRole(roleName: string, privileges: Privilege[]): Promise<void> {
    await this.client.db(ACCESS_CONTROL_ADMIN_DB).command({
      createRole: roleName,
      privileges,
      roles: [],
    });
  }

  private async createUser(username: string, password: string, roleName: string): Promise<void> {
    await this.client.db(ACCESS_CONTROL_ADMIN_DB).command({
      createUser: username,
      pwd: password,
      roles: [{ role: roleName, db: ACCESS_CONTROL_ADMIN_DB }],
    });
  }

  private buildBranchPrivileges(
    databaseName: string,
    collections: string[] | undefined,
    readOnly: boolean,
    includeSearchIndexes: boolean,
  ): Privilege[] {
    const collectionActions = [
      ...BASE_READ_ACTIONS,
      ...(readOnly ? [] : BASE_WRITE_ACTIONS),
      ...(includeSearchIndexes ? SEARCH_ACTIONS : []),
    ];

    if (!collections || collections.length === 0) {
      return [
        { resource: { db: databaseName, collection: "" }, actions: [...DATABASE_ACTIONS, ...collectionActions] },
      ];
    }

    return [
      { resource: { db: databaseName, collection: "" }, actions: [...DATABASE_ACTIONS] },
      ...collections.map((collection) => ({
        resource: { db: databaseName, collection },
        actions: [...collectionActions],
      })),
    ];
  }

  private buildDeployerPrivileges(
    databaseName: string,
    includeSearchIndexes: boolean,
    allowWriteBlockBypass: boolean,
  ): Privilege[] {
    const dbActions = [
      ...DATABASE_ACTIONS,
      ...BASE_READ_ACTIONS,
      ...BASE_WRITE_ACTIONS,
      ...(includeSearchIndexes ? SEARCH_ACTIONS : []),
    ];
    const privileges: Privilege[] = [
      { resource: { db: databaseName, collection: "" }, actions: dbActions },
      { resource: { db: ACCESS_CONTROL_ADMIN_DB, collection: "" }, actions: ["find"] },
      { resource: { cluster: true }, actions: ["setUserWriteBlockMode", ...(allowWriteBlockBypass ? ["bypassWriteBlockingMode"] : [])] },
    ];
    return privileges;
  }

  private buildConnectionString(username: string, password: string): string {
    const url = new URL(this.config.uri);
    url.username = username;
    url.password = password;
    url.pathname = `/${ACCESS_CONTROL_ADMIN_DB}`;
    url.searchParams.set("authSource", ACCESS_CONTROL_ADMIN_DB);
    url.searchParams.set("directConnection", url.searchParams.get("directConnection") ?? "true");
    return url.toString();
  }

  private buildRoleName(kind: "branch" | "deployer", username: string, scope: string): string {
    const safeUser = sanitizeBranchDbName(username).replace(/[^a-zA-Z0-9_-]/g, "-");
    const safeScope = sanitizeBranchDbName(scope).replace(/[^a-zA-Z0-9_-]/g, "-");
    return `mb_${kind}_${safeUser}_${safeScope}`;
  }
}
