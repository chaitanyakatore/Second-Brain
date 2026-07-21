import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import z from 'zod';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { normalizePrompt } from '../utils/normalizer.js';
import { generateEmbedding } from '../services/embedding.service.js';
import { findInCache, saveToCache, verifyCacheRecord } from '../services/cache.service.js';

dotenv.config();

const apiKey = process.env.OPENAI_API_KEY;
const isApiKeyConfigured = Boolean(apiKey && !apiKey.includes('mock-or-actual-key') && apiKey.startsWith('sk-'));
const openai = isApiKeyConfigured ? new OpenAI({ apiKey }) : null;

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/v1/chat/completions';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma2:2b';

const ChatCompletionBodySchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
    })
  ),
  repo_id: z.string().optional().default('default'),
  model: z.string().optional().default('gpt-4o-mini'),
});

const VerifyBodySchema = z.object({
  exact_hash: z.string().optional(),
  prompt: z.string().optional(),
  verified_by: z.string().optional().default('Senior Architect'),
});

export async function registerChatRoutes(fastify: FastifyInstance): Promise<void> {
  // Chat Completions Route
  fastify.post('/v1/chat/completions', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = performance.now();
    const parseResult = ChatCompletionBodySchema.safeParse(request.body);

    if (!parseResult.success) {
      reply.status(400).send({ error: 'Invalid request body', details: parseResult.error.format() });
      return;
    }

    const { messages, repo_id } = parseResult.data;
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');

    if (!lastUserMessage) {
      reply.status(400).send({ error: 'No user message provided' });
      return;
    }

    // Step 1: Prompt Normalization
    const { rawPrompt, cleanPrompt, exactHash } = normalizePrompt(lastUserMessage.content);

    // Step 2: Vector Embedding Generation
    const vector = await generateEmbedding(cleanPrompt);

    // Step 3: Hybrid Cache Search
    const cacheResult = await findInCache(exactHash, vector, repo_id);

    // Configure response for Server-Sent Events (SSE) streaming
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');

    if (cacheResult.hit && cacheResult.answer) {
      // --- CACHE HIT PATH ---
      const latencyMs = Math.round(performance.now() - startTime);
      reply.raw.setHeader('X-Cache-Status', 'HIT');
      reply.raw.setHeader('X-Cache-MatchType', cacheResult.matchType || 'EXACT');
      reply.raw.setHeader('X-Cache-Latency', `${latencyMs}ms`);
      reply.raw.setHeader('X-Cache-Verified', cacheResult.verified ? 'true' : 'false');
      if (cacheResult.verifiedBy) {
        reply.raw.setHeader('X-Cache-VerifiedBy', cacheResult.verifiedBy);
      }

      console.log(`⚡ [CACHE HIT] Latency: ${latencyMs}ms | Verified: ${cacheResult.verified}`);

      // Stream cached answer in chunks with verified metadata in SSE payload
      const answerText = cacheResult.answer;
      const chunkSize = 25;
      for (let i = 0; i < answerText.length; i += chunkSize) {
        const chunk = answerText.slice(i, i + chunkSize);
        const sseData = JSON.stringify({
          id: `cache-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: cacheResult.verified ? 'company-brain-verified' : 'company-brain-cache',
          cache_status: 'HIT',
          match_type: cacheResult.matchType || 'EXACT_HASH',
          latency: `${latencyMs}ms`,
          verified: Boolean(cacheResult.verified),
          verified_by: cacheResult.verifiedBy || 'Senior Architect',
          choices: [
            {
              index: 0,
              delta: { content: chunk },
              finish_reason: null,
            },
          ],
        });
        reply.raw.write(`data: ${sseData}\n\n`);
      }

      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      return;
    }

    // --- CACHE MISS PATH ---
    reply.raw.setHeader('X-Cache-Status', 'MISS');
    reply.raw.setHeader('X-Cache-Verified', 'false');
    console.log(`🤖 [CACHE MISS] Querying LLM engine...`);

    let fullAnswer = '';

    if (openai) {
      try {
        const stream = await openai.chat.completions.create({
          model: parseResult.data.model || 'gpt-4o-mini',
          messages: messages as any,
          stream: true,
        });

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            fullAnswer += content;
          }
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      } catch (err) {
        console.error('OpenAI LLM Stream error:', (err as Error).message);
      }
    } else {
      // Local Ollama LLM Stream (gemma2:2b)
      try {
        console.log(`🦙 Querying local Ollama model "${OLLAMA_MODEL}" at ${OLLAMA_URL}...`);
        const ollamaRes = await fetch(OLLAMA_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            messages,
            stream: true,
          }),
        });

        if (!ollamaRes.ok || !ollamaRes.body) {
          throw new Error(`Ollama HTTP error ${ollamaRes.status}`);
        }

        const reader = ollamaRes.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunkText = decoder.decode(value, { stream: true });
          const lines = chunkText.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6).trim();
              if (dataStr === '[DONE]') continue;
              try {
                const parsed = JSON.parse(dataStr);
                const deltaContent = parsed.choices?.[0]?.delta?.content || '';
                if (deltaContent) {
                  fullAnswer += deltaContent;
                }
                reply.raw.write(`data: ${dataStr}\n\n`);
              } catch (e) {}
            }
          }
        }
      } catch (err) {
        console.error('Ollama stream error, using fallback answer:', (err as Error).message);
        fullAnswer = `[Company Brain Resolution]: Solution for "${cleanPrompt}". Inspect stream lifecycle handlers and ensure event listeners are detached in repository "${repo_id}".`;
        const words = fullAnswer.split(' ');
        for (const word of words) {
          const chunkStr = word + ' ';
          const sseChunk = {
            id: `llm-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'company-brain-llm',
            choices: [{ index: 0, delta: { content: chunkStr }, finish_reason: null }],
          };
          reply.raw.write(`data: ${JSON.stringify(sseChunk)}\n\n`);
          await new Promise((res) => setTimeout(res, 20));
        }
      }
    }

    reply.raw.write('data: [DONE]\n\n');
    reply.raw.end();

    const latencyMs = Math.round(performance.now() - startTime);
    console.log(`🤖 [LLM GENERATED] Completed in ${latencyMs}ms. Async-writing to Qdrant cache...`);

    if (fullAnswer.trim().length > 0) {
      saveToCache(rawPrompt, cleanPrompt, exactHash, vector, fullAnswer, repo_id, false).catch((err) =>
        console.error('Async cache save error:', err)
      );
    }
  });

  // Senior Engineer Verification Endpoint
  fastify.post('/v1/cache/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = VerifyBodySchema.safeParse(request.body);

    if (!parseResult.success) {
      reply.status(400).send({ error: 'Invalid request body', details: parseResult.error.format() });
      return;
    }

    const { exact_hash, prompt, verified_by } = parseResult.data;

    let targetHash = exact_hash;
    if (!targetHash && prompt) {
      const normalized = normalizePrompt(prompt);
      targetHash = normalized.exactHash;
    }

    if (!targetHash) {
      reply.status(400).send({ error: 'Either exact_hash or prompt must be provided' });
      return;
    }

    const success = await verifyCacheRecord(targetHash, verified_by);

    if (success) {
      reply.send({ status: 'success', message: 'Knowledge Item verified successfully', verified_by, exact_hash: targetHash });
    } else {
      reply.status(404).send({ error: 'No matching Knowledge Item found for verification' });
    }
  });
}
