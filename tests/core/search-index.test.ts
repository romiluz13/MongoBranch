/**
 * Tests: SearchIndexManager — Atlas Search index branching
 *
 * REQUIRES Atlas Local Docker (preview) with mongot.
 * Skips gracefully if Atlas Local is not available.
 *
 * Tests:
 *   1. List search indexes (empty branch)
 *   2. Create and list search indexes on main
 *   3. Copy search indexes to a branch
 *   4. Diff search indexes between branches
 *   5. Merge search indexes from branch to main
 *   6. Merge with removeOrphans option
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient } from "mongodb";
import {
  startMongoDB,
  stopMongoDB,
  seedDatabase,
  cleanupBranches,
  isAtlasLocal,
} from "../setup.js";
import { SEED_DATABASE } from "../seed.js";
import { SearchIndexManager } from "../../src/core/search-index.js";
import { BranchManager } from "../../src/core/branch.js";
import { type MongoBranchConfig, MAIN_BRANCH } from "../../src/core/types.js";

let client: MongoClient;
let config: MongoBranchConfig;
let searchMgr: SearchIndexManager;
let branchMgr: BranchManager;
let skipSearchTests = false;

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
  config = {
    uri: "",
    sourceDatabase: SEED_DATABASE,
    metaDatabase: "__mongobranch",
    branchPrefix: "__mb_",
  };
  searchMgr = new SearchIndexManager(client, config);
  branchMgr = new BranchManager(client, config);

  // Check if Atlas Local is available (search indexes need mongot)
  if (!isAtlasLocal()) {
    skipSearchTests = true;
    console.log(
      "  ⚠️  Skipping search index tests — Atlas Local Docker required"
    );
  } else {
    // Probe whether mongot is actually running and persisting indexes.
    // Some Atlas Local builds expose the commands but never surface created indexes.
    try {
      const probeDb = client.db(`${SEED_DATABASE}_search_probe`);
      await probeDb.dropDatabase().catch(() => {});
      await probeDb.collection("probe").insertOne({ hello: "world" });
      await probeDb.collection("probe").createSearchIndex({
        name: "probe_search",
        type: "search",
        definition: {
          mappings: { dynamic: true },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const indexes = await probeDb
        .collection("probe")
        .listSearchIndexes()
        .toArray();

      if (!indexes.some((index: any) => index.name === "probe_search")) {
        skipSearchTests = true;
        console.log(
          "  ⚠️  Skipping search index tests — Atlas Local accepted createSearchIndex but did not surface the index"
        );
      }

      await probeDb.collection("probe").dropSearchIndex("probe_search").catch(() => {});
      await probeDb.dropDatabase().catch(() => {});
    } catch (err: unknown) {
      const code = (err as { codeName?: string }).codeName;
      const msg = err instanceof Error ? err.message : String(err);
      if (
        code === "SearchNotEnabled" ||
        msg.includes("listSearchIndexes") ||
        msg.includes("Search")
      ) {
        skipSearchTests = true;
        console.log(
          "  ⚠️  Skipping search index tests — mongot not available on this Atlas Local instance"
        );
      }
    }
  }
}, 30_000);

afterAll(async () => {
  if (client) {
    await cleanupBranches(client);
  }
  await stopMongoDB();
}, 15_000);

beforeEach(async () => {
  if (skipSearchTests) return;
  await cleanupBranches(client);
  const sourceDb = client.db(SEED_DATABASE);
  await seedDatabase(sourceDb);
}, 15_000);

describe("SearchIndexManager", () => {
  it("lists empty search indexes on a branch with no indexes", async () => {
    if (skipSearchTests) return;

    await branchMgr.createBranch({ name: "search-empty" });
    const indexes = await searchMgr.listIndexes("search-empty");
    expect(indexes).toEqual([]);
  }, 15_000);

  it("creates and lists search indexes on main", async () => {
    if (skipSearchTests) return;

    const sourceDb = client.db(SEED_DATABASE);

    // Create a dynamic search index on users collection
    await sourceDb.collection("users").createSearchIndex({
      name: "users_search",
      type: "search",
      definition: {
        mappings: { dynamic: true },
      },
    });

    // Wait for index to register
    await sleep(2000);

    const indexes = await searchMgr.listIndexes(MAIN_BRANCH, "users");
    expect(indexes.length).toBeGreaterThanOrEqual(1);

    const usersIdx = indexes.find((i) => i.name === "users_search");
    expect(usersIdx).toBeDefined();
    expect(usersIdx!.type).toBe("search");
    expect(usersIdx!.collectionName).toBe("users");

    // Cleanup
    await sourceDb.collection("users").dropSearchIndex("users_search");
  }, 30_000);

  it("copies search indexes from main to branch", async () => {
    if (skipSearchTests) return;

    const sourceDb = client.db(SEED_DATABASE);

    // Create search index on main
    await sourceDb.collection("products").createSearchIndex({
      name: "products_search",
      type: "search",
      definition: {
        mappings: { dynamic: true },
      },
    });

    await sleep(2000);

    // Create branch with data
    await branchMgr.createBranch({ name: "search-copy" });

    // Copy search indexes
    const result = await searchMgr.copyIndexes(MAIN_BRANCH, "search-copy", "products");
    expect(result.indexesCopied).toBeGreaterThanOrEqual(1);
    expect(result.indexesFailed).toBe(0);

    // Verify indexes exist on branch
    await sleep(2000);
    const branchIndexes = await searchMgr.listIndexes("search-copy", "products");
    const copied = branchIndexes.find((i) => i.name === "products_search");
    expect(copied).toBeDefined();

    // Cleanup main
    await sourceDb.collection("products").dropSearchIndex("products_search");
  }, 45_000);

  it("diffs search indexes between branches", async () => {
    if (skipSearchTests) return;

    const sourceDb = client.db(SEED_DATABASE);

    // Create index on main only
    await sourceDb.collection("users").createSearchIndex({
      name: "diff_test_idx",
      type: "search",
      definition: {
        mappings: { dynamic: true },
      },
    });
    await sleep(2000);

    // Branch has no search indexes
    await branchMgr.createBranch({ name: "search-diff" });

    const diffs = await searchMgr.diffIndexes(MAIN_BRANCH, "search-diff", "users");
    expect(diffs.length).toBeGreaterThanOrEqual(1);

    const usersDiff = diffs.find((d) => d.collection === "users");
    expect(usersDiff).toBeDefined();
    expect(usersDiff!.added.length).toBeGreaterThanOrEqual(1);
    expect(usersDiff!.added.some((a) => a.name === "diff_test_idx")).toBe(true);

    // Cleanup
    await sourceDb.collection("users").dropSearchIndex("diff_test_idx");
  }, 45_000);

  it("merges search indexes from branch to main", async () => {
    if (skipSearchTests) return;

    await branchMgr.createBranch({ name: "search-merge-src" });
    const branchDb = client.db("__mb_search-merge-src");
    await branchDb.collection("products").insertOne({ _id: "merge-test" as any, name: "test" });

    await branchDb.collection("products").createSearchIndex({
      name: "merge_idx",
      type: "search",
      definition: { mappings: { dynamic: true } },
    });
    await sleep(2000);

    const result = await searchMgr.mergeIndexes("search-merge-src", MAIN_BRANCH, "products");
    expect(result.indexesCreated).toBeGreaterThanOrEqual(1);
    expect(result.success).toBe(true);

    await sleep(2000);
    const mainIndexes = await searchMgr.listIndexes(MAIN_BRANCH, "products");
    expect(mainIndexes.find((i) => i.name === "merge_idx")).toBeDefined();

    // Cleanup
    const srcDb = client.db(SEED_DATABASE);
    await srcDb.collection("products").dropSearchIndex("merge_idx");
  }, 60_000);

  it("handles diff with no differences", async () => {
    if (skipSearchTests) return;

    await branchMgr.createBranch({ name: "search-nodiff-a" });
    await branchMgr.createBranch({ name: "search-nodiff-b" });

    const diffs = await searchMgr.diffIndexes("search-nodiff-a", "search-nodiff-b");
    expect(diffs).toEqual([]);
  }, 15_000);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
