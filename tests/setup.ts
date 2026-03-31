/**
 * Test setup — connects to REAL MongoDB Atlas Local (Docker).
 *
 * Priority:
 *   1. MONGOBRANCH_TEST_URI env var (explicit connection)
 *   2. Atlas Local Docker on localhost:27018 (docker compose up)
 *   3. Fallback: mongodb-memory-server (auto-download mongod binary)
 *
 * NO MOCKS. Every test hits a real MongoDB instance with real data.
 *
 * To use Atlas Local Docker (recommended):
 *   docker compose up -d
 *   bun test
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { SEED_DATABASE, SEED_COLLECTIONS } from "./seed.ts";

let replSet: MongoMemoryReplSet | null = null;
let client: MongoClient | null = null;
let currentUri: string | null = null;
let usingAtlasLocal = false;

/**
 * Try to connect to Atlas Local Docker on localhost:27018.
 * Returns true if connection succeeded.
 */
async function tryAtlasLocal(uri: string): Promise<boolean> {
  const testClient = new MongoClient(uri, {
    serverSelectionTimeoutMS: 2000,
    connectTimeoutMS: 2000,
  });
  try {
    await testClient.connect();
    await testClient.db("admin").command({ ping: 1 });
    await testClient.close();
    return true;
  } catch {
    await testClient.close().catch(() => {});
    return false;
  }
}

/**
 * Start MongoDB connection.
 * Prefers Atlas Local Docker, falls back to mongodb-memory-server.
 */
export async function startMongoDB(): Promise<{ uri: string; client: MongoClient }> {
  // 1. Check for explicit URI
  const explicitUri = process.env.MONGOBRANCH_TEST_URI;
  if (explicitUri) {
    client = new MongoClient(explicitUri);
    await client.connect();
    usingAtlasLocal = true;
    currentUri = explicitUri;
    console.log(`  ✅ Connected to MongoDB via MONGOBRANCH_TEST_URI`);
    return { uri: explicitUri, client };
  }

  // 2. Try Atlas Local Docker on port 27018 (avoids conflict with other local MongoDB)
  const atlasLocalUri = "mongodb://localhost:27018/?directConnection=true";
  if (await tryAtlasLocal(atlasLocalUri)) {
    client = new MongoClient(atlasLocalUri);
    await client.connect();
    usingAtlasLocal = true;
    currentUri = atlasLocalUri;
    console.log(`  ✅ Connected to Atlas Local Docker (localhost:27018)`);
    return { uri: atlasLocalUri, client };
  }

  // 3. Fallback: mongodb-memory-server
  console.log(`  ⚠️  Atlas Local Docker not found, falling back to mongodb-memory-server`);
  console.log(`     Run "docker compose up -d" for the real Atlas experience`);
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });

  const uri = replSet.getUri();
  client = new MongoClient(uri);
  await client.connect();
  usingAtlasLocal = false;
  currentUri = uri;
  return { uri, client };
}

/**
 * Seed the source database with realistic test data.
 * Inserts users, products, orders into the source DB.
 */
export async function seedDatabase(db: Db): Promise<void> {
  for (const [collectionName, documents] of Object.entries(SEED_COLLECTIONS)) {
    const collection = db.collection(collectionName);
    await collection.deleteMany({});
    if (documents.length > 0) {
      await collection.insertMany(documents.map((doc) => ({ ...doc })));
    }
  }
}

/**
 * Get a fresh seeded database for testing.
 * Returns the client and a pre-seeded source database.
 */
export async function getTestEnvironment(): Promise<{
  uri: string;
  client: MongoClient;
  sourceDb: Db;
  sourceDatabase: string;
}> {
  if (!client || !currentUri) {
    throw new Error("MongoDB not started. Call startMongoDB() first.");
  }

  const sourceDatabase = SEED_DATABASE;
  const sourceDb = client.db(sourceDatabase);
  await seedDatabase(sourceDb);

  return {
    uri: currentUri,
    client,
    sourceDb,
    sourceDatabase,
  };
}

/**
 * Clean up all branch databases (anything starting with __mb_).
 */
export async function cleanupBranches(mongoClient: MongoClient): Promise<void> {
  const adminDb = mongoClient.db("admin");
  const { databases } = await adminDb.command({ listDatabases: 1 });

  for (const dbInfo of databases) {
    if (dbInfo.name.startsWith("__mb_") || dbInfo.name === "__mongobranch") {
      await mongoClient.db(dbInfo.name).dropDatabase();
    }
  }
}

/**
 * Returns true if tests are running against Atlas Local Docker.
 */
export function isAtlasLocal(): boolean {
  return usingAtlasLocal;
}

/**
 * Stop MongoDB and clean up. Called after all tests.
 */
export async function stopMongoDB(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
  if (replSet) {
    await replSet.stop();
    replSet = null;
  }
}
