import { normalizePrompt } from '../utils/normalizer.js';
import { generateEmbedding } from '../services/embedding.service.js';
import { saveToCache, initializeCacheCollection } from '../services/cache.service.js';

interface KnowledgeItem {
  prompt: string;
  answer: string;
  repoId: string;
  verifiedBy: string;
}

const enterpriseKIs: KnowledgeItem[] = [
  {
    prompt: 'How to fix ECONNRESET in PostgreSQL connection pool /Users/dev/db.ts?',
    answer: `[Company Verified Solution]:
1. Set pool 'idleTimeoutMillis: 30000' and 'connectionTimeoutMillis: 5000' in pg.Pool constructor.
2. Add an explicit error listener on the pool instance: pool.on('error', (err) => console.error('Unexpected PG pool error', err)).
3. Ensure all checkout clients are released in a try...finally block.`,
    repoId: 'vscode-workspace',
    verifiedBy: 'Staff Infrastructure Architect',
  },
  {
    prompt: 'How to resolve CORS blocked request header /Users/dev/server.ts?',
    answer: `[Company Verified Solution]:
Enable Fastify CORS plugin with explicit exposed headers:
await fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  exposedHeaders: ['X-Cache-Status', 'X-Cache-MatchType', 'X-Cache-Latency', 'X-Cache-Verified']
});`,
    repoId: 'vscode-workspace',
    verifiedBy: 'Lead Security Engineer',
  },
];

async function runSeed() {
  console.log('🌱 Starting Enterprise Knowledge Items (KI) Seeding...');
  await initializeCacheCollection();

  for (const ki of enterpriseKIs) {
    const { rawPrompt, cleanPrompt, exactHash } = normalizePrompt(ki.prompt);
    const vector = await generateEmbedding(cleanPrompt);
    await saveToCache(rawPrompt, cleanPrompt, exactHash, vector, ki.answer, ki.repoId, true, ki.verifiedBy);
    console.log(`✅ Pre-indexed verified KI: "${ki.prompt}"`);
  }

  console.log('🎉 Enterprise Knowledge Items Seeding Complete!');
  process.exit(0);
}

runSeed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
