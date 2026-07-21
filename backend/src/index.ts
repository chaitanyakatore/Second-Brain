import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { initializeCacheCollection } from './services/cache.service.js';
import { registerChatRoutes } from './routes/chat.routes.js';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

const fastify = Fastify({
  logger: true,
});

async function main() {
  try {
    // Register CORS plugin
    await fastify.register(cors, {
      origin: '*',
      methods: ['GET', 'POST', 'OPTIONS'],
      exposedHeaders: [
        'X-Cache-Status',
        'X-Cache-MatchType',
        'X-Cache-Latency',
        'X-Cache-Verified',
        'X-Cache-VerifiedBy',
      ],
    });

    // Health check endpoint
    fastify.get('/health', async () => {
      return { status: 'ok', engine: 'Company Brain & Semantic Cache Engine' };
    });

    // Register Chat & Cache Routes
    await fastify.register(registerChatRoutes);

    console.log('Initializing Qdrant Cache Collection...');
    await initializeCacheCollection();

    await fastify.listen({ port: PORT, host: HOST });
    console.log(`🚀 Company Brain Backend Gateway running on http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
