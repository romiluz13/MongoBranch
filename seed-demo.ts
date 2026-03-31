/**
 * Seed the ecommerce_app database with demo data.
 * Run: bun seed-demo.ts
 */
import { MongoClient } from "mongodb";
import { SEED_COLLECTIONS, SEED_DATABASE } from "./tests/seed.ts";

const uri = process.env.MONGOBRANCH_URI ?? process.env.MONGODB_URI ?? "mongodb://localhost:27017/?directConnection=true";

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(SEED_DATABASE);

  console.log(`\n🌱 Seeding "${SEED_DATABASE}" on ${uri}\n`);

  for (const [name, docs] of Object.entries(SEED_COLLECTIONS)) {
    await db.collection(name).drop().catch(() => {});
    if (docs.length > 0) {
      await db.collection(name).insertMany(docs.map((d) => ({ ...d })));
      console.log(`  ✅ ${name}: ${docs.length} documents`);
    }
  }

  console.log(`\n🎉 Done! Database "${SEED_DATABASE}" is ready.\n`);
  await client.close();
}

main().catch((err) => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});
