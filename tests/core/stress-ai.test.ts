/**
 * MongoBranch — AI Embedding Stress Tests
 *
 * Uses REAL Voyage AI API (voyage-3-lite, 512 dims) — ZERO simulated vectors.
 * Tests real seeded data through branch → diff → merge with real embeddings.
 * Validates the sequential merge fix with real vector data.
 *
 * Skips automatically if Voyage AI API is unavailable.
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
import { DiffEngine } from "../../src/core/diff.ts";
import { MergeEngine } from "../../src/core/merge.ts";
import { OperationLog } from "../../src/core/oplog.ts";
import { BranchProxy } from "../../src/core/proxy.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";
import { SEED_DATABASE } from "../seed.ts";
import {
  generateEmbeddings,
  generateEmbedding,
  cosineSimilarity,
  isVoyageAvailable,
  EMBEDDING_DIM,
} from "../embedding.ts";

let client: MongoClient;
let uri: string;
let config: MongoBranchConfig;
let branchManager: BranchManager;
let diffEngine: DiffEngine;
let mergeEngine: MergeEngine;
let oplog: OperationLog;
let proxy: BranchProxy;
let voyageAvailable: boolean;

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
  uri = env.uri;
  voyageAvailable = await isVoyageAvailable();
  if (!voyageAvailable) {
    console.warn("⚠️  Voyage AI API not available — AI embedding tests will be skipped");
  }
}, 30_000);

afterAll(async () => {
  await stopMongoDB();
}, 10_000);

// Collections created by AI stress tests that must be cleaned between runs
const AI_TEST_COLLECTIONS = [
  "product_vectors", "knowledge_base", "user_profiles", "movies",
  "ai_experiments", "product_embeddings", "user_embeddings",
];

beforeEach(async () => {
  await getTestEnvironment();
  await cleanupBranches(client);

  // Drop AI-test collections from prior runs
  const sourceDb = client.db(SEED_DATABASE);
  for (const name of AI_TEST_COLLECTIONS) {
    try { await sourceDb.dropCollection(name); } catch { /* may not exist */ }
  }

  config = {
    uri,
    sourceDatabase: SEED_DATABASE,
    metaDatabase: "__mongobranch",
    branchPrefix: "__mb_",
  };
  branchManager = new BranchManager(client, config);
  diffEngine = new DiffEngine(client, config);
  mergeEngine = new MergeEngine(client, config);
  oplog = new OperationLog(client, config);
  proxy = new BranchProxy(client, config, branchManager, oplog);
  await oplog.initialize();
});

// ── Real Voyage AI Embedding Lifecycle ──────────────────────

describe("Stress: real Voyage AI embeddings through branch lifecycle", () => {
  it("embeds real product descriptions, branches, diffs, and merges with real vectors", async () => {
    if (!voyageAvailable) return;

    // Generate REAL embeddings for actual seed product descriptions
    const productTexts = [
      "CloudSync Pro — enterprise cloud synchronization SaaS platform with real-time file sync",
      "DataVault Enterprise — secure database backup and disaster recovery solution",
      "APIGateway Lite — free open-source API gateway with rate limiting and load balancing",
    ];
    const embeddings = await generateEmbeddings(productTexts);

    // Verify real API response
    expect(embeddings).toHaveLength(3);
    expect(embeddings[0].dimensions).toBe(EMBEDDING_DIM);
    expect(embeddings[0].model).toBe("voyage-3-lite");

    // Create branch and insert products with REAL embeddings
    await branchManager.createBranch({ name: "real-embed" });

    for (let i = 0; i < productTexts.length; i++) {
      await proxy.insertOne("real-embed", "product_vectors", {
        productName: ["CloudSync Pro", "DataVault Enterprise", "APIGateway Lite"][i],
        description: productTexts[i],
        embedding: embeddings[i].embedding,
        model: embeddings[i].model,
        dimensions: embeddings[i].dimensions,
        category: ["SaaS", "Database", "API"][i],
        createdAt: new Date(),
      });
    }

    // Verify proxy stored real 512-dim vectors
    const docs = await proxy.find("real-embed", "product_vectors");
    expect(docs).toHaveLength(3);
    for (const doc of docs) {
      const emb = doc.embedding as number[];
      expect(emb).toHaveLength(EMBEDDING_DIM);
      // Real embeddings are normalized — values should be between -1 and 1
      expect(emb.every((v: number) => v >= -1 && v <= 1)).toBe(true);
      expect(doc.model).toBe("voyage-3-lite");
    }

    // Diff captures all real-vector documents
    const diff = await diffEngine.diffBranches("real-embed", "main");
    expect(diff.collections["product_vectors"]).toBeDefined();
    expect(diff.collections["product_vectors"].added).toHaveLength(3);

    // Merge real vectors to main
    const mergeResult = await mergeEngine.merge("real-embed", "main");
    expect(mergeResult.success).toBe(true);

    // Verify main has intact real embeddings
    const mainDb = client.db(config.sourceDatabase);
    const merged = await mainDb.collection("product_vectors").find({}).toArray();
    expect(merged).toHaveLength(3);
    for (const doc of merged) {
      expect(doc.embedding).toHaveLength(EMBEDDING_DIM);
    }
  }, 45_000);



  it("re-embeds updated content and preserves vector integrity through merge", async () => {
    if (!voyageAvailable) return;

    await branchManager.createBranch({ name: "re-embed" });
    const originalText = "MongoDB Atlas provides fully managed database hosting with built-in security";
    const originalEmb = await generateEmbedding(originalText);

    await proxy.insertOne("re-embed", "knowledge_base", {
      title: "Atlas Overview",
      content: originalText,
      content_embedding: originalEmb,
      version: 1,
    });

    // Update content and re-embed with REAL new vector
    const updatedText = "MongoDB Atlas now includes vector search with automated embeddings powered by Voyage AI";
    const updatedEmb = await generateEmbedding(updatedText);

    await proxy.updateOne("re-embed", "knowledge_base",
      { title: "Atlas Overview" },
      { $set: { content: updatedText, content_embedding: updatedEmb, version: 2 } }
    );

    // Real embeddings are semantically different
    const similarity = cosineSimilarity(originalEmb, updatedEmb);
    expect(similarity).toBeGreaterThan(0.3);
    expect(similarity).toBeLessThan(0.95);

    // Oplog tracks both ops
    const summary = await oplog.getOpSummary("re-embed");
    expect(summary.inserts).toBe(1);
    expect(summary.updates).toBe(1);

    // Diff sees the new doc
    const diff = await diffEngine.diffBranches("re-embed", "main");
    expect(diff.collections["knowledge_base"]).toBeDefined();
    expect(diff.collections["knowledge_base"].added).toHaveLength(1);

    // Merge and verify updated vector survived
    const mergeResult = await mergeEngine.merge("re-embed", "main");
    expect(mergeResult.success).toBe(true);

    const mainDb = client.db(config.sourceDatabase);
    const doc = await mainDb.collection("knowledge_base").findOne({ title: "Atlas Overview" });
    expect(doc).not.toBeNull();
    expect(doc!.content_embedding).toHaveLength(EMBEDDING_DIM);
    expect(doc!.version).toBe(2);
    const mergedSim = cosineSimilarity(doc!.content_embedding, updatedEmb);
    expect(mergedSim).toBeGreaterThan(0.999);
  }, 45_000);

  it("semantic similarity holds through branch → diff → merge with real seed user data", async () => {
    if (!voyageAvailable) return;

    const userBios = [
      "Alice Chen is an admin in Engineering who specializes in TypeScript, MongoDB, and React, based in San Francisco",
      "Bob Martinez is a developer in Engineering skilled in Python, PostgreSQL, and FastAPI, based in Austin Texas",
      "Carol Nakamura is a designer in Product who works with Figma, CSS, and Design Systems, based in Seattle",
      "David Okonkwo is a developer in Engineering proficient in Go, Kubernetes, and gRPC, based in Denver Colorado",
    ];
    const bioEmbeddings = await generateEmbeddings(userBios);

    await branchManager.createBranch({ name: "user-vectors" });
    const seedNames = ["Alice Chen", "Bob Martinez", "Carol Nakamura", "David Okonkwo"];
    for (let i = 0; i < userBios.length; i++) {
      await proxy.insertOne("user-vectors", "user_profiles", {
        name: seedNames[i],
        bio: userBios[i],
        bio_embedding: bioEmbeddings[i].embedding,
        embeddedAt: new Date(),
      });
    }

    // Developers more similar to each other than to designer
    const bobDavidSim = cosineSimilarity(bioEmbeddings[1].embedding, bioEmbeddings[3].embedding);
    const bobCarolSim = cosineSimilarity(bioEmbeddings[1].embedding, bioEmbeddings[2].embedding);
    expect(bobDavidSim).toBeGreaterThan(bobCarolSim);

    const diff = await diffEngine.diffBranches("user-vectors", "main");
    expect(diff.collections["user_profiles"].added).toHaveLength(4);

    const mergeResult = await mergeEngine.merge("user-vectors", "main");
    expect(mergeResult.success).toBe(true);

    const mainDb = client.db(config.sourceDatabase);
    const profiles = await mainDb.collection("user_profiles").find({}).toArray();
    expect(profiles).toHaveLength(4);
    for (const profile of profiles) {
      expect(profile.bio_embedding).toHaveLength(EMBEDDING_DIM);
    }
  }, 60_000);
});

// ── Hybrid Search Data Through Branches (Real Vectors) ──────

describe("Stress: hybrid search data with real embeddings", () => {
  it("branch CRUD preserves real embedding + text fields for hybrid search", async () => {
    if (!voyageAvailable) return;

    await branchManager.createBranch({ name: "hybrid-real" });

    const movieTexts = [
      "A lone astronaut discovers an ancient alien artifact orbiting Jupiter, leading to first contact",
      "A team of database engineers build a revolutionary distributed system that changes data storage",
      "An AI agent achieves consciousness and must navigate the ethical implications of sentience",
    ];
    const movieEmbeddings = await generateEmbeddings(movieTexts);

    const movieDocs = [
      { title: "Contact Beyond Jupiter", plot: movieTexts[0], genres: ["sci-fi", "adventure"], year: 2025 },
      { title: "The Distributed System", plot: movieTexts[1], genres: ["technology", "drama"], year: 2024 },
      { title: "Sentient", plot: movieTexts[2], genres: ["sci-fi", "thriller"], year: 2026 },
    ];

    for (let i = 0; i < movieDocs.length; i++) {
      await proxy.insertOne("hybrid-real", "movies", {
        ...movieDocs[i],
        plot_embedding: movieEmbeddings[i].embedding,
        embeddingModel: movieEmbeddings[i].model,
      });
    }

    // Verify real vectors + text survived proxy layer
    const docs = await proxy.find("hybrid-real", "movies");
    expect(docs).toHaveLength(3);
    for (const doc of docs) {
      expect((doc.plot_embedding as number[]).length).toBe(EMBEDDING_DIM);
      expect(doc.embeddingModel).toBe("voyage-3-lite");
    }

    // Sci-fi movies more similar to each other than to tech drama
    const sciFiSim = cosineSimilarity(movieEmbeddings[0].embedding, movieEmbeddings[2].embedding);
    const crossSim = cosineSimilarity(movieEmbeddings[0].embedding, movieEmbeddings[1].embedding);
    expect(sciFiSim).toBeGreaterThan(crossSim);

    // Diff and merge
    const diff = await diffEngine.diffBranches("hybrid-real", "main");
    expect(diff.collections["movies"].added).toHaveLength(3);

    const mergeResult = await mergeEngine.merge("hybrid-real", "main");
    expect(mergeResult.success).toBe(true);

    const mainDb = client.db(config.sourceDatabase);
    const mainMovies = await mainDb.collection("movies").find({}).toArray();
    expect(mainMovies).toHaveLength(3);
    for (const movie of mainMovies) {
      expect(movie.plot_embedding).toHaveLength(EMBEDDING_DIM);
    }
  }, 60_000);

  it("lazy branch with real AI embeddings materializes and merges correctly", async () => {
    if (!voyageAvailable) return;

    const branch = await branchManager.createBranch({ name: "ai-lazy-real", lazy: true });
    expect(branch.lazy).toBe(true);

    const inputText = "MongoDB aggregation pipelines enable powerful real-time data transformations";
    const realEmbedding = await generateEmbedding(inputText);
    expect(realEmbedding).toHaveLength(EMBEDDING_DIM);

    await proxy.insertOne("ai-lazy-real", "ai_experiments", {
      experiment: "real-embedding-quality",
      model: "voyage-3-lite",
      input: inputText,
      embedding: realEmbedding,
      dimensions: EMBEDDING_DIM,
      metadata: { source: "voyage-api", timestamp: new Date() },
    });

    // Verify materialization
    const status = await branchManager.getBranchMaterializationStatus("ai-lazy-real");
    expect(status.materialized).toContain("ai_experiments");

    // Diff only shows materialized AI collection, NOT seed data
    const diff = await diffEngine.diffBranches("ai-lazy-real", "main");
    expect(diff.collections["ai_experiments"]).toBeDefined();
    expect(diff.collections["ai_experiments"].added).toHaveLength(1);
    expect(diff.collections["users"]).toBeUndefined();
    expect(diff.collections["products"]).toBeUndefined();
    expect(diff.collections["orders"]).toBeUndefined();

    const mergeResult = await mergeEngine.merge("ai-lazy-real", "main");
    expect(mergeResult.success).toBe(true);

    const mainDb = client.db(config.sourceDatabase);
    const experiment = await mainDb.collection("ai_experiments").findOne({
      experiment: "real-embedding-quality",
    });
    expect(experiment).not.toBeNull();
    expect(experiment!.embedding).toHaveLength(EMBEDDING_DIM);
    // The merged embedding should be byte-identical to what we inserted
    const fidelity = cosineSimilarity(experiment!.embedding, realEmbedding);
    expect(fidelity).toBeGreaterThan(0.999);
  }, 45_000);

  it("sequential merges from multiple branches preserve real embedding data", async () => {
    if (!voyageAvailable) return;

    // This tests the EXACT bug we fixed: sequential merges losing data
    const productTexts = ["CloudSync Pro cloud synchronization platform", "DataVault Enterprise database backup"];
    const userTexts = ["Senior TypeScript engineer specializing in MongoDB", "Full-stack Python developer with FastAPI"];

    const [productEmbs, userEmbs] = await Promise.all([
      generateEmbeddings(productTexts),
      generateEmbeddings(userTexts),
    ]);

    // Branch A: product vectors
    await branchManager.createBranch({ name: "seq-a-vectors" });
    for (let i = 0; i < productTexts.length; i++) {
      await proxy.insertOne("seq-a-vectors", "product_embeddings", {
        text: productTexts[i], embedding: productEmbs[i].embedding, source: "branch-a",
      });
    }

    // Branch B: user vectors
    await branchManager.createBranch({ name: "seq-b-vectors" });
    for (let i = 0; i < userTexts.length; i++) {
      await proxy.insertOne("seq-b-vectors", "user_embeddings", {
        text: userTexts[i], embedding: userEmbs[i].embedding, source: "branch-b",
      });
    }

    // Merge A → main
    const mergeA = await mergeEngine.merge("seq-a-vectors", "main");
    expect(mergeA.success).toBe(true);

    // Merge B → main (cascade deletion bug would destroy A's data here)
    const mergeB = await mergeEngine.merge("seq-b-vectors", "main");
    expect(mergeB.success).toBe(true);

    // CRITICAL: Both sets of vectors must exist on main
    const mainDb = client.db(config.sourceDatabase);
    const productVecs = await mainDb.collection("product_embeddings").find({}).toArray();
    const userVecs = await mainDb.collection("user_embeddings").find({}).toArray();

    expect(productVecs).toHaveLength(2);
    expect(userVecs).toHaveLength(2);

    for (const doc of productVecs) {
      expect(doc.embedding).toHaveLength(EMBEDDING_DIM);
      expect(doc.source).toBe("branch-a");
    }
    for (const doc of userVecs) {
      expect(doc.embedding).toHaveLength(EMBEDDING_DIM);
      expect(doc.source).toBe("branch-b");
    }

    // Verify seed data wasn't destroyed either
    const users = await mainDb.collection("users").find({}).toArray();
    const products = await mainDb.collection("products").find({}).toArray();
    const orders = await mainDb.collection("orders").find({}).toArray();
    expect(users).toHaveLength(4);
    expect(products).toHaveLength(3);
    expect(orders).toHaveLength(3);
  }, 60_000);
});
