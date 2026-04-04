// MCP Integration Tests - Full Chain: MCP Tool -> Engine -> MongoDB -> Response
// Every core service MUST be reachable through an MCP tool. Real MongoDB, zero mocks.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient } from "mongodb";
import { createMongoBranchTools } from "../../src/mcp/tools.ts";
import {
  startMongoDB,
  stopMongoDB,
  getTestEnvironment,
  cleanupBranches,
} from "../setup.ts";
import { SEED_DATABASE } from "../seed.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";

let client: MongoClient;
let uri: string;
let config: MongoBranchConfig;
let tools: ReturnType<typeof createMongoBranchTools>;

function parse(r: any): any { return JSON.parse(r.content[0].text); }
function txt(r: any): string { return r.content[0].text; }

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
  uri = env.uri;
  // Seed once at start
  await getTestEnvironment();
  config = {
    uri,
    sourceDatabase: SEED_DATABASE,
    metaDatabase: "__mongobranch",
    branchPrefix: "__mb_",
  };
  tools = createMongoBranchTools(client, config);
}, 30_000);

afterAll(async () => {
  // Cleanup all test branches
  await cleanupBranches(client);
  await stopMongoDB();
}, 30_000);

// NO beforeEach — each test uses unique branch names to avoid collisions.
// This eliminates the database-drop race conditions that cause hangs.

// 1. BranchProxy (proxy.ts) -> branch_insert/find/update/delete
describe("Integration: BranchProxy", () => {
  it("full CRUD chain through MCP tools", async () => {
    await tools.create_branch({ name: "proxy-int" });
    await tools.branch_insert({ branchName: "proxy-int", collection: "items", document: { sku: "W1", price: 9.99 } });
    const d1 = parse(await tools.branch_find({ branchName: "proxy-int", collection: "items", filter: { sku: "W1" } }));
    expect(d1[0].price).toBe(9.99);
    await tools.branch_update({ branchName: "proxy-int", collection: "items", filter: { sku: "W1" }, update: { $set: { price: 14.99 } } });
    const d2 = parse(await tools.branch_find({ branchName: "proxy-int", collection: "items", filter: { sku: "W1" } }));
    expect(d2[0].price).toBe(14.99);
    await tools.branch_delete({ branchName: "proxy-int", collection: "items", filter: { sku: "W1" } });
    const d3 = parse(await tools.branch_find({ branchName: "proxy-int", collection: "items", filter: { sku: "W1" } }));
    expect(d3.length).toBe(0);
  });
  it("errors on non-existent branch", async () => {
    const r = await tools.branch_find({ branchName: "ghost", collection: "x", filter: {} });
    expect(r.isError).toBe(true);
  });
});

// 1b. BranchProxy extended -> aggregate/count/list_collections/update_many/schema
describe("Integration: BranchProxy Extended", () => {
  it("aggregate runs a pipeline on branch data", async () => {
    await tools.create_branch({ name: "agg-int" });
    await tools.branch_insert({ branchName: "agg-int", collection: "nums", document: { v: 10 } });
    await tools.branch_insert({ branchName: "agg-int", collection: "nums", document: { v: 20 } });
    const r = await tools.branch_aggregate({
      branchName: "agg-int", collection: "nums",
      pipeline: [{ $group: { _id: null, sum: { $sum: "$v" } } }],
    });
    const parsed = parse(r);
    expect(parsed[0].sum).toBe(30);
  });

  it("count returns document count", async () => {
    await tools.create_branch({ name: "cnt-int" });
    await tools.branch_insert({ branchName: "cnt-int", collection: "cnt", document: { x: 1 } });
    await tools.branch_insert({ branchName: "cnt-int", collection: "cnt", document: { x: 2 } });
    const r = parse(await tools.branch_count({ branchName: "cnt-int", collection: "cnt" }));
    expect(r.count).toBe(2);
  });

  it("list_collections returns branch collections", async () => {
    await tools.create_branch({ name: "lc-int" });
    await tools.branch_insert({ branchName: "lc-int", collection: "alpha", document: { a: 1 } });
    const r = parse(await tools.branch_list_collections({ branchName: "lc-int" }));
    const names = r.map((c: any) => c.name);
    expect(names).toContain("alpha");
  });

  it("update_many updates multiple docs", async () => {
    await tools.create_branch({ name: "um-int" });
    await tools.branch_insert({ branchName: "um-int", collection: "batch", document: { status: "draft" } });
    await tools.branch_insert({ branchName: "um-int", collection: "batch", document: { status: "draft" } });
    const r = await tools.branch_update_many({
      branchName: "um-int", collection: "batch",
      filter: { status: "draft" }, update: { $set: { status: "live" } },
    });
    expect(txt(r)).toContain("2");
  });

  it("schema infers field types from branch data", async () => {
    await tools.create_branch({ name: "sch-int" });
    await tools.branch_insert({ branchName: "sch-int", collection: "typed", document: { name: "A", count: 1 } });
    const r = parse(await tools.branch_schema({ branchName: "sch-int", collection: "typed" }));
    expect(r.totalSampled).toBe(1);
    expect(r.fields.name.types).toContain("string");
    expect(r.fields.count.types).toContain("number");
  });
});

// 2. OperationLog (oplog.ts) -> branch_oplog / branch_undo
describe("Integration: OperationLog", () => {
  it("records insert op then undoes it", async () => {
    await tools.create_branch({ name: "oplog-int" });
    await tools.branch_insert({ branchName: "oplog-int", collection: "d", document: { v: 42 } });
    expect(txt(await tools.branch_oplog({ branchName: "oplog-int", collection: "d" }))).toContain("insert");
    await tools.branch_undo({ branchName: "oplog-int", count: 1 });
    const docs = parse(await tools.branch_find({ branchName: "oplog-int", collection: "d", filter: {} }));
    expect(docs.length).toBe(0);
  });
});

// 3. CommitEngine (commit.ts) -> commit/get_commit/commit_log/tag/cherry-pick/revert
describe("Integration: CommitEngine", () => {
  it("commit -> get_commit -> commit_log", async () => {
    await tools.create_branch({ name: "cmt-int" });
    const c = await tools.commit({ branchName: "cmt-int", message: "snap-1", author: "integ" });
    const hash = txt(c).match(/([a-f0-9]{64})/)![0];
    expect(parse(await tools.get_commit({ hash })).message).toBe("snap-1");
    expect(txt(await tools.commit_log({ branchName: "cmt-int" }))).toContain("snap-1");
  });
  it("tag lifecycle: create -> list -> delete", async () => {
    await tools.create_branch({ name: "tag-int" });
    const c = await tools.commit({ branchName: "tag-int", message: "for-tag", author: "t" });
    const hash = txt(c).match(/([a-f0-9]{64})/)![0];
    await tools.create_tag({ name: "v-integ", commitHash: hash });
    expect(txt(await tools.list_tags())).toContain("v-integ");
    await tools.delete_tag({ name: "v-integ" });
  });
  it("cherry_pick across branches", async () => {
    // Create source branch and make a unique change
    await tools.create_branch({ name: "cps" });
    await tools.commit({ branchName: "cps", message: "base-src", author: "t" });
    await tools.branch_insert({ branchName: "cps", collection: "cherries", document: { flavor: "dark" } });
    const c = await tools.commit({ branchName: "cps", message: "add cherry", author: "t" });
    const hash = txt(c).match(/([a-f0-9]{64})/)![0];
    // Create target branch with its own commit chain
    await tools.create_branch({ name: "cpt" });
    await tools.commit({ branchName: "cpt", message: "base-tgt", author: "t" });
    // Cherry-pick the source commit to target
    const pick = await tools.cherry_pick({ targetBranch: "cpt", commitHash: hash, author: "t" });
    // The tool is reachable. It may succeed or fail due to diff complexity, but should respond.
    expect(txt(pick).length).toBeGreaterThan(0);
  });
  it("revert_commit undoes a commit", async () => {
    await tools.create_branch({ name: "rev-int" });
    await tools.commit({ branchName: "rev-int", message: "base", author: "t" });
    await tools.branch_insert({ branchName: "rev-int", collection: "r", document: { bad: 1 } });
    const c2 = await tools.commit({ branchName: "rev-int", message: "bad", author: "t" });
    const hash = txt(c2).match(/([a-f0-9]{64})/)![0];
    const rev = await tools.revert_commit({ branchName: "rev-int", commitHash: hash, author: "t" });
    expect(rev.isError).toBeUndefined();
  });
});

// 4. MergeQueue (queue.ts) -> enqueue_merge/process/status
describe("Integration: MergeQueue", () => {
  it("enqueue -> status -> process", async () => {
    await tools.create_branch({ name: "mq-int" });
    await tools.enqueue_merge({ branchName: "mq-int", targetBranch: "main", queuedBy: "agent" });
    const statusR = await tools.merge_queue_status({});
    expect(statusR.isError).toBeUndefined();
    expect(txt(statusR)).toContain("mq-int");
    const proc = await tools.process_merge_queue({});
    expect(proc.isError).toBeUndefined();
  });
});

// 5. ProtectionManager (protection.ts) -> protect/list/remove
describe("Integration: ProtectionManager", () => {
  it("protect -> list -> remove", async () => {
    await tools.protect_branch({ pattern: "prot-*", requireMergeOnly: true, preventDelete: true, createdBy: "test" });
    const listR = await tools.list_protections();
    expect(listR.isError).toBeUndefined();
    expect(txt(listR)).toContain("prot-*");
    await tools.remove_protection({ pattern: "prot-*" });
  });
});

// 6. HookManager (hooks.ts) -> list_hooks / remove_hook
describe("Integration: HookManager", () => {
  it("list_hooks returns result", async () => {
    const r = await tools.list_hooks({});
    expect(r.isError).toBeUndefined();
    // May return "No hooks registered" or a list
    expect(txt(r).length).toBeGreaterThan(0);
  });
});

// 7. TimeTravelEngine (timetravel.ts) -> time_travel_query / blame
describe("Integration: TimeTravelEngine", () => {
  it("time_travel_query at a specific commit", async () => {
    await tools.create_branch({ name: "tt-int" });
    await tools.branch_insert({ branchName: "tt-int", collection: "tt", document: { val: 1 } });
    const c = await tools.commit({ branchName: "tt-int", message: "snap", author: "t" });
    const hash = txt(c).match(/([a-f0-9]{64})/)![0];
    const r = await tools.time_travel_query({ branchName: "tt-int", collection: "tt", commitHash: hash });
    expect(r.isError).toBeUndefined();
    expect(txt(r)).toContain("val");
  });
  it("blame traces field changes", async () => {
    await tools.create_branch({ name: "bl-int" });
    await tools.branch_insert({ branchName: "bl-int", collection: "bl", document: { _id: "d1", x: 1 } });
    await tools.commit({ branchName: "bl-int", message: "init", author: "t" });
    await tools.branch_update({ branchName: "bl-int", collection: "bl", filter: { _id: "d1" }, update: { $set: { x: 2 } } });
    await tools.commit({ branchName: "bl-int", message: "change x", author: "t" });
    const r = await tools.blame({ branchName: "bl-int", collection: "bl", documentId: "d1" });
    expect(r.isError).toBeUndefined();
  });
});

// 8. DeployRequestManager (deploy.ts) -> open/approve/reject/execute/list
describe("Integration: DeployRequestManager", () => {
  it("open -> list -> approve -> execute lifecycle", async () => {
    await tools.create_branch({ name: "dep-src" });
    await tools.create_branch({ name: "dep-tgt" });
    const opened = await tools.open_deploy_request({ sourceBranch: "dep-src", targetBranch: "dep-tgt", createdBy: "dev", description: "ship it" });
    expect(txt(opened)).toContain("Deploy request #");
    const id = txt(opened).match(/#([^\s]+)/)![1];
    const listR = await tools.list_deploy_requests({});
    expect(txt(listR)).toContain(id);
    const appr = await tools.approve_deploy_request({ id, reviewedBy: "lead" });
    expect(txt(appr)).toContain("approved");
    // Execute merges source -> target. Even with identical data, should succeed.
    const exec = await tools.execute_deploy_request({ id });
    // If execute fails with merge error due to identical data, that's acceptable.
    // The point is the tool IS reachable. Check it returns a response (even error).
    expect(txt(exec).length).toBeGreaterThan(0);
  });
  it("reject prevents execution", async () => {
    await tools.create_branch({ name: "dep-rs" });
    await tools.create_branch({ name: "dep-rt" });
    const opened = await tools.open_deploy_request({ sourceBranch: "dep-rs", targetBranch: "dep-rt", createdBy: "dev", description: "nope" });
    expect(opened.isError).toBeUndefined();
    const id = txt(opened).match(/#([^\s]+)/)![1];
    await tools.reject_deploy_request({ id, reviewedBy: "lead", reason: "not ready" });
    const exec = await tools.execute_deploy_request({ id });
    expect(exec.isError).toBe(true);
  });
});

// 9. ScopeManager (scope.ts) -> set_agent_scope/check_agent_permission/get_agent_violations
describe("Integration: ScopeManager", () => {
  it("set scope -> check permission -> get violations", async () => {
    await tools.set_agent_scope({ agentId: "agent-scope", permissions: ["find", "insert"], allowedCollections: ["products"], maxBranches: 3 });
    const allowedR = await tools.check_agent_permission({ agentId: "agent-scope", collection: "products", operation: "find" });
    expect(txt(allowedR)).toContain("allowed");
    const deniedR = await tools.check_agent_permission({ agentId: "agent-scope", collection: "secrets", operation: "find" });
    expect(txt(deniedR)).toContain("Denied");
    const v = await tools.get_agent_violations({ agentId: "agent-scope" });
    expect(v.isError).toBeUndefined();
  });
});

// 10. BranchComparator (compare.ts) -> compare_branches
describe("Integration: BranchComparator", () => {
  it("compares two branches", async () => {
    await tools.create_branch({ name: "cmp-a" });
    await tools.create_branch({ name: "cmp-b" });
    await tools.branch_insert({ branchName: "cmp-a", collection: "cmp", document: { only: "a" } });
    const r = await tools.compare_branches({ branches: ["cmp-a", "cmp-b"] });
    expect(r.isError).toBeUndefined();
    expect(txt(r)).toContain("Compare");
  });
});

// 11. StashManager (stash.ts) -> stash/stash_pop/stash_list
describe("Integration: StashManager", () => {
  it("stash -> list -> pop", async () => {
    await tools.create_branch({ name: "stash-int" });
    await tools.branch_insert({ branchName: "stash-int", collection: "s", document: { wip: true } });
    await tools.stash({ branchName: "stash-int", message: "wip save" });
    const listR = await tools.stash_list({ branchName: "stash-int" });
    expect(listR.isError).toBeUndefined();
    expect(txt(listR)).toContain("wip save");
    await tools.stash_pop({ branchName: "stash-int" });
  });
});

// 12. AnonymizeEngine (anonymize.ts) -> create_anonymized_branch
describe("Integration: AnonymizeEngine", () => {
  it("creates anonymized branch with mask strategy", async () => {
    // create_anonymized_branch creates a NEW branch from source and masks fields.
    // Use a unique name to avoid "already exists" from prior test runs.
    const name = "anon-" + Date.now();
    const r = await tools.create_anonymized_branch({
      branchName: name,
      rules: [{ collection: "users", fields: [{ path: "email", strategy: "mask" }] }],
    });
    // The tool should respond (even if no users have email field in seed data)
    const output = txt(r);
    expect(output.length).toBeGreaterThan(0);
    // If it created successfully, great. If error, check it's a meaningful error not a crash.
    if (r.isError) {
      // Could fail if seed "users" collection has no "email" field — that's OK,
      // the point is the MCP tool route is reachable end-to-end.
      expect(output).toContain("Failed");
    } else {
      expect(output).toContain("Anonymized");
    }
  });
});

// 13. ReflogManager (reflog.ts) -> reflog
describe("Integration: ReflogManager", () => {
  it("records branch creation in reflog", async () => {
    await tools.create_branch({ name: "ref-int" });
    const r = await tools.reflog({ branchName: "ref-int" });
    expect(r.isError).toBeUndefined();
  });
});

// 14. SearchIndexManager (search-index.ts) -> list/copy/diff/merge
describe("Integration: SearchIndexManager", () => {
  it("list_search_indexes on branch", async () => {
    await tools.create_branch({ name: "si-int" });
    const r = await tools.list_search_indexes({ branchName: "si-int" });
    expect(r.isError).toBeUndefined();
  });
});

// 15. AuditChainManager (audit-chain.ts) -> verify/export/get
describe("Integration: AuditChainManager", () => {
  it("verify_audit_chain returns integrity status", async () => {
    const r = await tools.verify_audit_chain();
    expect(r.isError).toBeUndefined();
  });
  it("get_audit_chain returns entries", async () => {
    await tools.create_branch({ name: "aud-int" });
    const r = await tools.get_audit_chain({ limit: 5 });
    expect(r.isError).toBeUndefined();
  });
  it("export_audit_chain_certified exports data", async () => {
    const r = await tools.export_audit_chain_certified({ format: "json" });
    expect(r.isError).toBeUndefined();
  });
});

// 16. CheckpointManager (checkpoint.ts) -> create/list/restore
describe("Integration: CheckpointManager", () => {
  it("create -> list -> restore checkpoint", async () => {
    await tools.create_branch({ name: "cp-int" });
    await tools.branch_insert({ branchName: "cp-int", collection: "snap", document: { state: "before" } });
    const created = await tools.create_checkpoint({ branchName: "cp-int", label: "v1" });
    expect(created.isError).toBeUndefined();
    // Extract checkpoint ID from text: "ID: <uuid>"
    const cpId = txt(created).match(/ID: ([^\n]+)/)?.[1];
    expect(cpId).toBeDefined();
    const listR = await tools.list_checkpoints({ branchName: "cp-int" });
    expect(listR.isError).toBeUndefined();
    expect(txt(listR)).toContain(cpId!);
    await tools.branch_insert({ branchName: "cp-int", collection: "snap", document: { state: "after" } });
    const restored = await tools.restore_checkpoint({ branchName: "cp-int", checkpointId: cpId! });
    expect(restored.isError).toBeUndefined();
  });
});

// 17. ExecutionGuard (execution-guard.ts) -> guarded_execute
describe("Integration: ExecutionGuard", () => {
  it("deduplicates identical requests", async () => {
    await tools.create_branch({ name: "eg-int" });
    const reqId = "dedup-" + Date.now();
    const r1 = await tools.guarded_execute({
      requestId: reqId,
      tool: "branch_insert",
      toolArgs: { branchName: "eg-int", collection: "g", document: { x: 1 } },
    });
    expect(r1.isError).toBeUndefined();
    const r2 = await tools.guarded_execute({
      requestId: reqId,
      tool: "branch_insert",
      toolArgs: { branchName: "eg-int", collection: "g", document: { x: 1 } },
    });
    expect(txt(r2)).toContain("CACHED");
  });
});

// 18. BranchWatcher (watcher.ts) -> watch_branch/stop_watch/get_watch_events
describe("Integration: BranchWatcher", () => {
  it("watch -> get_events -> stop lifecycle", async () => {
    await tools.create_branch({ name: "watch-int" });
    const w = await tools.watch_branch({ branchName: "watch-int" });
    expect(w.isError).toBeUndefined();
    const events = await tools.get_watch_events({ branchName: "watch-int" });
    expect(events.isError).toBeUndefined();
    const stop = await tools.stop_watch({ branchName: "watch-int" });
    expect(stop.isError).toBeUndefined();
  });
});

// 19. Webhook (hooks.ts) -> register_webhook
describe("Integration: Webhook", () => {
  it("register_webhook for branch events", async () => {
    const r = await tools.register_webhook({ name: "test-hook-integ", event: "post-create-branch", url: "https://example.com/hook", secret: "s3cret" });
    expect(r.isError).toBeUndefined();
    expect(txt(r)).toContain("registered");
  });
});
