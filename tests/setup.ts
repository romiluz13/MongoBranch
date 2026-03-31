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
 *
 * Connection priority:
 *   1. MONGOBRANCH_TEST_URI or MONGODB_URI env var
 *   2. Atlas Local Docker on port 27018 (docker compose up — our docker-compose.yml)
 *   3. Atlas Local Docker on port 27017 (standalone atlas-local:preview container)
 *   4. Fallback: mongodb-memory-server (auto-download mongod binary)
 */
export async function startMongoDB(): Promise<{ uri: string; client: MongoClient }> {
  // 1. Check for explicit URI (either env var name)
  const explicitUri = process.env.MONGOBRANCH_TEST_URI || process.env.MONGODB_URI;
  if (explicitUri) {
    client = new MongoClient(explicitUri);
    await client.connect();
    usingAtlasLocal = true;
    currentUri = explicitUri;
    console.log(`  ✅ Connected to MongoDB via env var: ${explicitUri}`);
    return { uri: explicitUri, client };
  }

  // 2. Try Atlas Local Docker on port 27018 (our docker-compose.yml maps 27018→27017)
  const atlasLocal27018 = "mongodb://localhost:27018/?directConnection=true";
  if (await tryAtlasLocal(atlasLocal27018)) {
    client = new MongoClient(atlasLocal27018);
    await client.connect();
    usingAtlasLocal = true;
    currentUri = atlasLocal27018;
    console.log(`  ✅ Connected to Atlas Local Docker (localhost:27018)`);
    return { uri: atlasLocal27018, client };
  }

  // 3. Try Atlas Local Docker on port 27017 (standalone container, e.g. atlas-local:preview)
  const atlasLocal27017 = "mongodb://localhost:27017/?directConnection=true";
  if (await tryAtlasLocal(atlasLocal27017)) {
    client = new MongoClient(atlasLocal27017);
    await client.connect();
    usingAtlasLocal = true;
    currentUri = atlasLocal27017;
    console.log(`  ✅ Connected to Atlas Local Docker (localhost:27017)`);
    return { uri: atlasLocal27017, client };
  }

  // 4. Fallback: mongodb-memory-server
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
 * Drops and re-creates each collection to avoid duplicate key errors.
 * Retries on "database is being dropped" errors from concurrent cleanup.
 */
export async function seedDatabase(db: Db): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      for (const [collectionName, documents] of Object.entries(SEED_COLLECTIONS)) {
        const collection = db.collection(collectionName);
        // Drop the collection entirely to avoid any state from previous tests
        await collection.drop().catch(() => {}); // Ignore "ns not found"
        if (documents.length > 0) {
          await collection.insertMany(documents.map((doc) => ({ ...doc })));
        }
      }
      return; // Success
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("being dropped") || msg.includes("duplicate key")) {
        // Race condition — wait and retry
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw error; // Unexpected error
    }
  }
  throw new Error("seedDatabase failed after 3 retries");
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
 * Retries on "database is being dropped" errors and waits for completion.
 */
export async function cleanupBranches(mongoClient: MongoClient): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const adminDb = mongoClient.db("admin");
      const { databases } = await adminDb.command({ listDatabases: 1 });

      for (const dbInfo of databases) {
        if (dbInfo.name.startsWith("__mb_") || dbInfo.name === "__mongobranch") {
          try {
            await mongoClient.db(dbInfo.name).dropDatabase();
          } catch (dropErr: unknown) {
            const msg = dropErr instanceof Error ? dropErr.message : String(dropErr);
            if (msg.includes("being dropped")) {
              // Already being dropped — wait for it
              await new Promise((r) => setTimeout(r, 300));
              continue;
            }
            throw dropErr;
          }
        }
      }

      // Wait briefly for all async drops to complete on the server
      await new Promise((r) => setTimeout(r, 200));
      return;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("being dropped")) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw error;
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
