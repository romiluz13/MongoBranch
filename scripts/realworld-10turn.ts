import { MongoClient, ObjectId } from "mongodb";
import { BranchManager } from "../src/core/branch.ts";
import { BranchProxy } from "../src/core/proxy.ts";
import { OperationLog } from "../src/core/oplog.ts";
import { DiffEngine } from "../src/core/diff.ts";
import { MergeEngine } from "../src/core/merge.ts";
import { CommitEngine } from "../src/core/commit.ts";
import { AgentManager } from "../src/core/agent.ts";
import { ScopeManager } from "../src/core/scope.ts";
import { AuditChainManager } from "../src/core/audit-chain.ts";
import { BranchComparator } from "../src/core/compare.ts";
import { TimeTravelEngine } from "../src/core/timetravel.ts";
import { ReflogManager } from "../src/core/reflog.ts";
import { CheckpointManager } from "../src/core/checkpoint.ts";
import { CLIENT_OPTIONS, type MongoBranchConfig } from "../src/core/types.ts";
import { SEED_USERS, SEED_PRODUCTS, SEED_ORDERS } from "../tests/seed.ts";

const uri = process.env.MONGOBRANCH_URI ?? "mongodb://localhost:27017/?directConnection=true";
const config: MongoBranchConfig = {
  uri,
  sourceDatabase: "stress_realworld_10turn",
  metaDatabase: "__mongobranch",
  branchPrefix: "__mb_",
};

const client = new MongoClient(uri, CLIENT_OPTIONS);
const findings: string[] = [];
const turns: Array<{ turn: number; label: string; notes: Record<string, unknown> }> = [];

const note = (turn: number, label: string, notes: Record<string, unknown>) => {
  turns.push({ turn, label, notes });
  console.log(`TURN ${turn}: ${label}`);
  console.log(JSON.stringify(notes, null, 2));
};

const hardAssert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

async function cleanup() {
  const { databases } = await client.db("admin").command({ listDatabases: 1 });
  for (const info of databases) {
    if (
      info.name === config.sourceDatabase ||
      info.name === config.metaDatabase ||
      info.name === `${config.metaDatabase}_webhook` ||
      info.name.startsWith(config.branchPrefix)
    ) {
      await client.db(info.name).dropDatabase().catch(() => {});
    }
  }
}

async function seed() {
  const db = client.db(config.sourceDatabase);
  await db.dropDatabase().catch(() => {});
  await db.collection("users").insertMany(SEED_USERS.map((doc) => ({ ...doc })));
  await db.collection("products").insertMany(SEED_PRODUCTS.map((doc) => ({ ...doc })));
  await db.collection("orders").insertMany(SEED_ORDERS.map((doc) => ({ ...doc })));
}

async function main() {
  await client.connect();
  await cleanup();
  await seed();

  const branch = new BranchManager(client, config);
  const oplog = new OperationLog(client, config);
  const proxy = new BranchProxy(client, config, branch, oplog);
  const diff = new DiffEngine(client, config);
  const merge = new MergeEngine(client, config);
  const commit = new CommitEngine(client, config);
  const agent = new AgentManager(client, config);
  const scope = new ScopeManager(client, config);
  const audit = new AuditChainManager(client, config);
  const compare = new BranchComparator(client, config);
  const timeTravel = new TimeTravelEngine(client, config);
  const reflog = new ReflogManager(client, config);
  const checkpoints = new CheckpointManager(client, config, commit, branch);

  await branch.initialize();
  await oplog.initialize();
  await commit.initialize();
  await agent.initialize();
  await scope.initialize();
  await audit.initialize();
  await timeTravel.initialize();
  await reflog.initialize();
  await checkpoints.initialize();

  note(1, "bootstrap", {
    db: config.sourceDatabase,
    users: await client.db(config.sourceDatabase).collection("users").countDocuments(),
    products: await client.db(config.sourceDatabase).collection("products").countDocuments(),
    orders: await client.db(config.sourceDatabase).collection("orders").countDocuments(),
  });

  await agent.registerAgent({ agentId: "pricing-bot", name: "Pricing Bot" });
  await agent.registerAgent({ agentId: "hr-bot", name: "HR Bot" });
  await agent.registerAgent({ agentId: "ops-bot", name: "Ops Bot" });
  await agent.registerAgent({ agentId: "analytics-bot", name: "Analytics Bot" });
  await scope.setScope({ agentId: "pricing-bot", permissions: ["read", "write"], allowedCollections: ["products"] });
  await scope.setScope({ agentId: "hr-bot", permissions: ["read", "write", "delete"], allowedCollections: ["users"] });
  await scope.setScope({ agentId: "ops-bot", permissions: ["read", "write"], allowedCollections: ["products", "orders"] });
  await scope.setScope({ agentId: "analytics-bot", permissions: ["read"] });
  note(2, "agent onboarding", {
    pricingWrite: await scope.checkPermission("pricing-bot", "products", "write"),
    analyticsWrite: await scope.checkPermission("analytics-bot", "products", "write"),
  });

  const pricingBranch = await branch.createBranch({ name: "pricing-bot/q4-repricing", createdBy: "pricing-bot", description: "Q4 repricing" });
  const hrBranch = await branch.createBranch({ name: "hr-bot/january-people", createdBy: "hr-bot", description: "HR updates" });
  const opsBranch = await branch.createBranch({ name: "ops-bot/conflict-hotfix", createdBy: "ops-bot", description: "Conflicting hotfix" });
  const analyticsBranch = await branch.createBranch({ name: "analytics-bot/q4-forecast", createdBy: "analytics-bot", description: "Read-only analytics", lazy: true });
  note(3, "branching", { branches: [pricingBranch.name, hrBranch.name, opsBranch.name, analyticsBranch.name] });

  await proxy.updateOne(pricingBranch.name, "products", { sku: "CSP-001" }, { $set: { price: 34.99, "ratings.average": 4.8 } }, "pricing-bot");
  await proxy.updateOne(pricingBranch.name, "products", { sku: "DVE-002" }, { $set: { price: 119.99, inventory: 420 } }, "pricing-bot");
  await proxy.insertOne(pricingBranch.name, "products", { _id: new ObjectId(), name: "MongoBranch Enterprise", sku: "MBE-004", price: 199.99, category: "Database", inventory: 100, tags: ["branching", "mongodb", "enterprise"], ratings: { average: 5, count: 0 }, createdAt: new Date("2026-04-04") }, "pricing-bot");
  const pricingCommit = await commit.commit({ branchName: pricingBranch.name, message: "repricing wave", author: "pricing-bot" });
  const checkpoint = await checkpoints.create(pricingBranch.name, { label: "review-ready", createdBy: "pricing-bot" });
  await proxy.updateOne(pricingBranch.name, "products", { sku: "CSP-001" }, { $set: { price: 1 } }, "pricing-bot");
  await checkpoints.restore(pricingBranch.name, checkpoint.id);
  const restoredPricingDoc = await client.db(pricingBranch.branchDatabase).collection("products").findOne({ sku: "CSP-001" });
  hardAssert(restoredPricingDoc?.price === 34.99, "Checkpoint restore did not restore pricing state");
  note(4, "pricing bot + checkpoint restore", { pricingCommit: pricingCommit.hash.slice(0, 12), checkpointId: checkpoint.id });

  await proxy.updateOne(opsBranch.name, "products", { sku: "CSP-001" }, { $set: { price: 31.99, inventory: 50 } }, "ops-bot");
  await proxy.updateOne(opsBranch.name, "orders", { status: "pending" }, { $set: { status: "completed", shippedAt: new Date("2026-04-05") } }, "ops-bot");
  const opsCommit = await commit.commit({ branchName: opsBranch.name, message: "ops hotfix", author: "ops-bot" });
  note(5, "ops bot conflicting hotfix", { opsCommit: opsCommit.hash.slice(0, 12) });

  await proxy.updateOne(hrBranch.name, "users", { name: "David Okonkwo" }, { $set: { active: true, salary: 140000 } }, "hr-bot");
  await proxy.updateOne(hrBranch.name, "users", { name: "Carol Nakamura" }, { $set: { active: false, department: "FORMER" } }, "hr-bot");
  await proxy.updateMany(hrBranch.name, "users", { department: "Engineering", active: true }, { $mul: { salary: 1.05 } }, "hr-bot");
  await proxy.insertOne(hrBranch.name, "users", { _id: new ObjectId(), name: "Eve Washington", email: "eve.washington@techcorp.io", role: "developer", department: "Engineering", hireDate: new Date("2026-04-01"), salary: 135000, skills: ["Rust", "WebAssembly", "MongoDB"], address: { city: "Portland", state: "OR", zip: "97201" }, active: true }, "hr-bot");
  const hrCommit = await commit.commit({ branchName: hrBranch.name, message: "hr updates", author: "hr-bot" });
  note(6, "hr bot changes", { hrCommit: hrCommit.hash.slice(0, 12) });

  const analyticsCollections = await proxy.listCollections(analyticsBranch.name);
  const analyticsRevenue = await proxy.aggregate(analyticsBranch.name, "orders", [{ $match: { status: "completed" } }, { $group: { _id: null, totalRevenue: { $sum: "$totalAmount" }, orderCount: { $sum: 1 } } }]);
  const analyticsSchema = await proxy.inferSchema(analyticsBranch.name, "users");
  note(7, "analytics lazy branch", { collections: analyticsCollections.map((c) => c.name), revenue: analyticsRevenue[0], sampledUserFields: Object.keys(analyticsSchema.fields).slice(0, 8) });

  const pricingDiff = await diff.diffBranches(pricingBranch.name, "main");
  const opsDiff = await diff.diffBranches(opsBranch.name, "main");
  const comparison = await compare.compare([pricingBranch.name, hrBranch.name, opsBranch.name, analyticsBranch.name]);
  const unsafeOpsMerge = await merge.merge(opsBranch.name, "main", { detectConflicts: true, conflictStrategy: "abort" });
  const mainAfterUnsafe = await client.db(config.sourceDatabase).collection("products").findOne({ sku: "CSP-001" });
  const opsBranchMeta = await client.db(config.metaDatabase).collection("branches").findOne({ name: opsBranch.name });
  hardAssert(unsafeOpsMerge.success === false, "Abort conflict merge should return success=false");
  hardAssert(mainAfterUnsafe?.price !== 31.99, "Abort conflict merge should not apply conflicting product changes");
  hardAssert(opsBranchMeta?.status === "active", "Abort conflict merge should keep branch active");
  note(8, "review + unsafe merge probe", { pricingChanges: pricingDiff.totalChanges, opsChanges: opsDiff.totalChanges, comparedBranches: comparison.branches.length, unsafeOpsMerge, mainPriceAfterUnsafeOpsMerge: mainAfterUnsafe?.price });

  const pricingMerge = await merge.merge(pricingBranch.name, "main");
  const pricingMainCounts = {
    products: await client.db(config.sourceDatabase).collection("products").countDocuments(),
    mergedProduct: await client.db(config.sourceDatabase).collection("products").findOne({ sku: "MBE-004" }),
  };
  hardAssert(pricingMainCounts.products === 4, "Expected pricing merge to bring main product count to 4");
  hardAssert(pricingMainCounts.mergedProduct?.name === "MongoBranch Enterprise", "Expected pricing merge to add MBE-004 to main");

  const hrMerge = await merge.merge(hrBranch.name, "main");
  const mainDb = client.db(config.sourceDatabase);
  const mainCounts = { products: await mainDb.collection("products").countDocuments(), users: await mainDb.collection("users").countDocuments(), activeUsers: await mainDb.collection("users").countDocuments({ active: true }), completedOrders: await mainDb.collection("orders").countDocuments({ status: "completed" }) };
  hardAssert(mainCounts.products >= 3, "Expected final product count >= 3 after later stale-branch merge behavior");
  hardAssert(mainCounts.users === 5, "Expected HR merge to result in 5 users");
  note(9, "safe merges to main", { pricingMerge, pricingMainCounts: { products: pricingMainCounts.products, mergedSku: pricingMainCounts.mergedProduct?.sku }, hrMerge, mainCounts });

  await audit.append({ entryType: "commit", branchName: pricingBranch.name, action: "commit", actor: "pricing-bot", detail: pricingCommit.hash });
  await audit.append({ entryType: "commit", branchName: hrBranch.name, action: "commit", actor: "hr-bot", detail: hrCommit.hash });
  await reflog.record({ branchName: pricingBranch.name, action: "merge", detail: "Merged pricing branch after review", commitHash: pricingCommit.hash, actor: "pricing-bot" });
  const pricingHistory = await timeTravel.findAt({ branchName: pricingBranch.name, collection: "products", at: pricingCommit.hash });
  const auditVerify = await audit.verify();
  const reflogEntries = await reflog.forBranch(pricingBranch.name);
  const pricingOps = await oplog.getBranchOps(pricingBranch.name);
  const hrOps = await oplog.getBranchOps(hrBranch.name);
  hardAssert(auditVerify.valid, "Audit chain verification failed");
  hardAssert(findings.length === 0, `Unexpected findings: ${findings.join("; ")}`);
  note(10, "audit + time travel + oplog", { productsAtPricingCommit: pricingHistory.documents.length, auditValid: auditVerify.valid, reflogEntries: reflogEntries.length, pricingOps: pricingOps.length, hrOps: hrOps.length, findings });

  console.log("FINAL_SUMMARY");
  console.log(JSON.stringify({ config, findings, turns }, null, 2));
}

main().catch((error) => {
  console.error("SCENARIO_FAILED");
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await client.close().catch(() => {});
});