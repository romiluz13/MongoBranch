/**
 * Real Voyage AI embedding helper for stress tests.
 * Calls the actual Voyage AI API — NO simulated vectors.
 *
 * Endpoints:
 *   - Voyage AI direct: https://api.voyageai.com/v1/embeddings
 *   - MongoDB AI proxy: https://ai.mongodb.com/v1/embeddings
 */

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY || "";
const EMBEDDING_MODEL = "voyage-3-lite"; // 512 dimensions
const EMBEDDING_DIM = 512;

export interface EmbeddingResult {
  text: string;
  embedding: number[];
  model: string;
  dimensions: number;
}

/**
 * Generate real embeddings for one or more texts via Voyage AI API.
 * Returns 512-dimensional vectors from voyage-3-lite.
 */
export async function generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
  const response = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: texts,
      model: EMBEDDING_MODEL,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voyage AI API error (${response.status}): ${error}`);
  }

  const data = await response.json() as {
    data: Array<{ embedding: number[]; index: number }>;
    model: string;
    usage: { total_tokens: number };
  };

  return data.data.map((item, i) => ({
    text: texts[i],
    embedding: item.embedding,
    model: data.model,
    dimensions: item.embedding.length,
  }));
}

/**
 * Generate a single embedding for one text.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const results = await generateEmbeddings([text]);
  return results[0].embedding;
}

/**
 * Compute cosine similarity between two vectors.
 * Used to verify semantic similarity in tests.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Check if the Voyage AI API is reachable.
 * Returns false if the API is down or the key is invalid.
 */
export async function isVoyageAvailable(): Promise<boolean> {
  if (!VOYAGE_API_KEY) return false;
  try {
    const response = await fetch(VOYAGE_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${VOYAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: ["ping"],
        model: EMBEDDING_MODEL,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export { EMBEDDING_DIM, EMBEDDING_MODEL };
