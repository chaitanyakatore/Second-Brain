import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';
import crypto from 'node:crypto';

dotenv.config();

const QDRANT_URL = process.env.QDRANT_URL || 'http://127.0.0.1:6333';
export const COLLECTION_NAME = 'company_brain_cache';
export const COSINE_SIMILARITY_THRESHOLD = 0.92;

export const qdrantClient = new QdrantClient({ url: QDRANT_URL, checkCompatibility: false });

export interface CacheRecordPayload {
  raw_prompt: string;
  clean_prompt: string;
  exact_hash: string;
  answer: string;
  repo_id: string;
  created_at: number;
  verified?: boolean;
  verified_by?: string;
}

export interface CacheSearchResult {
  hit: boolean;
  matchType?: 'EXACT_HASH' | 'SEMANTIC_VECTOR';
  score?: number;
  answer?: string;
  rawPrompt?: string;
  verified?: boolean;
  verifiedBy?: string;
  pointId?: string;
}

/**
 * Initializes the Qdrant collection for Company Brain cache if not already existing.
 */
export async function initializeCacheCollection(): Promise<void> {
  try {
    const result = await qdrantClient.getCollections();
    const exists = result.collections.some((c) => c.name === COLLECTION_NAME);

    if (!exists) {
      console.log(`Creating Qdrant collection "${COLLECTION_NAME}"...`);
      await qdrantClient.createCollection(COLLECTION_NAME, {
        vectors: {
          size: 1536,
          distance: 'Cosine',
        },
      });

      // Create payload index for fast exact_hash and repo_id lookups
      await qdrantClient.createPayloadIndex(COLLECTION_NAME, {
        field_name: 'exact_hash',
        field_schema: 'keyword',
      });

      await qdrantClient.createPayloadIndex(COLLECTION_NAME, {
        field_name: 'repo_id',
        field_schema: 'keyword',
      });

      console.log(`Qdrant collection "${COLLECTION_NAME}" initialized successfully.`);
    }
  } catch (error) {
    console.error('Failed to initialize Qdrant cache collection:', (error as Error).message);
  }
}

/**
 * Perform two-stage hybrid cache evaluation:
 * 1. O(1) Exact Hash Match lookup.
 * 2. Semantic Vector Similarity search with Cosine distance >= 0.92.
 */
export async function findInCache(
  exactHash: string,
  vector: number[],
  repoId: string = 'default'
): Promise<CacheSearchResult> {
  try {
    // Stage 1: Exact Hash Match
    const scrollResult = await qdrantClient.scroll(COLLECTION_NAME, {
      filter: {
        must: [
          { key: 'exact_hash', match: { value: exactHash } },
          { key: 'repo_id', match: { value: repoId } },
        ],
      },
      limit: 1,
      with_payload: true,
    });

    if (scrollResult.points.length > 0) {
      const point = scrollResult.points[0];
      const matchPayload = point.payload as unknown as CacheRecordPayload;
      return {
        hit: true,
        matchType: 'EXACT_HASH',
        score: 1.0,
        answer: matchPayload.answer,
        rawPrompt: matchPayload.raw_prompt,
        verified: Boolean(matchPayload.verified),
        verifiedBy: matchPayload.verified_by,
        pointId: String(point.id),
      };
    }

    // Stage 2: Semantic Vector Similarity Search
    const searchResults = await qdrantClient.search(COLLECTION_NAME, {
      vector,
      filter: {
        must: [{ key: 'repo_id', match: { value: repoId } }],
      },
      limit: 1,
      score_threshold: COSINE_SIMILARITY_THRESHOLD,
      with_payload: true,
    });

    if (searchResults.length > 0) {
      const bestMatch = searchResults[0];
      const matchPayload = bestMatch.payload as unknown as CacheRecordPayload;
      return {
        hit: true,
        matchType: 'SEMANTIC_VECTOR',
        score: bestMatch.score,
        answer: matchPayload.answer,
        rawPrompt: matchPayload.raw_prompt,
        verified: Boolean(matchPayload.verified),
        verifiedBy: matchPayload.verified_by,
        pointId: String(bestMatch.id),
      };
    }

    return { hit: false };
  } catch (error) {
    console.error('Error querying Qdrant cache:', (error as Error).message);
    return { hit: false };
  }
}

/**
 * Asynchronously persist a resolved query and LLM answer into Qdrant vector memory.
 */
export async function saveToCache(
  rawPrompt: string,
  cleanPrompt: string,
  exactHash: string,
  vector: number[],
  answer: string,
  repoId: string = 'default',
  verified: boolean = false,
  verifiedBy?: string
): Promise<string> {
  try {
    const pointId = crypto.randomUUID();
    const payload: CacheRecordPayload = {
      raw_prompt: rawPrompt,
      clean_prompt: cleanPrompt,
      exact_hash: exactHash,
      answer,
      repo_id: repoId,
      created_at: Date.now(),
      verified,
      verified_by: verifiedBy,
    };

    await qdrantClient.upsert(COLLECTION_NAME, {
      wait: true,
      points: [
        {
          id: pointId,
          vector,
          payload: payload as unknown as Record<string, unknown>,
        },
      ],
    });

    console.log(`[Cache Persisted] ID: ${pointId} | Hash: ${exactHash.slice(0, 8)}... | Verified: ${verified}`);
    return pointId;
  } catch (error) {
    console.error('Failed to save response to Qdrant cache:', (error as Error).message);
    return '';
  }
}

/**
 * Update a Knowledge Item to mark it verified by a Senior Engineer / Tech Lead.
 */
export async function verifyCacheRecord(
  exactHash: string,
  verifiedBy: string = 'Senior Architect'
): Promise<boolean> {
  try {
    const scrollResult = await qdrantClient.scroll(COLLECTION_NAME, {
      filter: {
        must: [{ key: 'exact_hash', match: { value: exactHash } }],
      },
      limit: 1,
      with_payload: true,
    });

    if (scrollResult.points.length === 0) {
      return false;
    }

    const point = scrollResult.points[0];
    await qdrantClient.setPayload(COLLECTION_NAME, {
      points: [point.id],
      payload: {
        verified: true,
        verified_by: verifiedBy,
        verified_at: Date.now(),
      },
    });

    console.log(`[Cache Verified] Point ID: ${point.id} by ${verifiedBy}`);
    return true;
  } catch (error) {
    console.error('Failed to verify cache record:', (error as Error).message);
    return false;
  }
}
