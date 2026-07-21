import OpenAI from 'openai';
import dotenv from 'dotenv';
import crypto from 'node:crypto';

dotenv.config();

const apiKey = process.env.OPENAI_API_KEY;
const isApiKeyConfigured = Boolean(apiKey && !apiKey.includes('mock-or-actual-key') && apiKey.startsWith('sk-'));
const openai = isApiKeyConfigured ? new OpenAI({ apiKey }) : null;

const OLLAMA_EMBED_URL = process.env.OLLAMA_EMBED_URL || 'http://127.0.0.1:11434/api/embeddings';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

/**
 * Seeded pseudo-random number generator (Mulberry32)
 */
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates an orthogonal 1536-dimensional unit vector for text hash
 */
function generateDeterministicVector(text: string, dimensions = 1536): number[] {
  const hashHex = crypto.createHash('sha256').update(text).digest('hex');
  const seed = parseInt(hashHex.slice(0, 8), 16);
  const prng = mulberry32(seed);

  const vector: number[] = new Array(dimensions);
  let normSquare = 0;

  for (let i = 0; i < dimensions; i++) {
    const u1 = Math.max(prng(), 1e-10);
    const u2 = prng();
    const val = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    vector[i] = val;
    normSquare += val * val;
  }

  const norm = Math.sqrt(normSquare) || 1;
  return vector.map((v) => v / norm);
}

/**
 * Generates a 1536-dimensional vector embedding for the normalized prompt.
 * 1. Uses OpenAI text-embedding-3-small if API key is present.
 * 2. Tries local Ollama nomic-embed-text if available.
 * 3. Falls back to orthogonal Mulberry32 PRNG unit vectors.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (openai) {
    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        encoding_format: 'float',
      });
      return response.data[0].embedding;
    } catch (err) {
      console.warn('OpenAI Embedding API error:', (err as Error).message);
    }
  }

  // Try local Ollama nomic-embed-text
  try {
    const res = await fetch(OLLAMA_EMBED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_EMBED_MODEL,
        prompt: text,
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as { embedding: number[] };
      if (data.embedding && Array.isArray(data.embedding)) {
        // Expand/pad 768-dim vector to 1536-dim for Qdrant collection compatibility
        const rawVec = data.embedding;
        const targetDim = 1536;
        const padded: number[] = new Array(targetDim);
        let normSquare = 0;

        for (let i = 0; i < targetDim; i++) {
          const val = rawVec[i % rawVec.length];
          padded[i] = val;
          normSquare += val * val;
        }
        const norm = Math.sqrt(normSquare) || 1;
        return padded.map((v) => v / norm);
      }
    }
  } catch (err) {
    // Fallback to PRNG vector
  }

  return generateDeterministicVector(text);
}
