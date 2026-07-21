---
description: Build the Enterprise Company Brain & Semantic Cache POC step by step
---

// turbo-all
# Workflow: Enterprise Brain & Semantic Cache Build

Follow these phases sequentially. Do not advance to the next phase until the current phase is built and verified.

## Phase 1: Local Infrastructure Setup
1. Create a `docker-compose.yml` file in the project root to run Qdrant vector database (`qdrant/qdrant:v1.9.2`) exposing ports 6333 and 6334.
2. Run `docker-compose up -d` to launch Qdrant.
3. Explain to the user why Qdrant is selected and how vector distance metrics work for code search.

## Phase 2: Backend Core Initialization
1. Initialize a TypeScript Fastify project in `./backend`.
2. Install `@qdrant/js-client-rest`, `openai`, `fastify`, `dotenv`, and `zod`.
3. Create `./backend/src/utils/normalizer.ts`:
   - Strip local file paths (`/Users/...` or `C:\...`) and replace with `<FILE_PATH>`.
   - Lowercase, trim extra spaces, and calculate a SHA-256 hash of the cleaned prompt for fast $O(1)$ exact lookup.
4. Create `./backend/src/services/embedding.service.ts` using OpenAI's `text-embedding-3-small` model.
5. Create `./backend/src/services/cache.service.ts`:
   - Initialize Qdrant collection `company_brain_cache` with Cosine distance.
   - Implement `findInCache()` searching scoped by `repo_id` with a similarity threshold $\ge 0.92$.
   - Implement `saveToCache()` storing raw prompt, normalized prompt, vector, answer text, and repo ID.

## Phase 3: Streaming API Gateway
1. Create `./backend/src/routes/chat.routes.ts`:
   - Route: `POST /v1/chat/completions`.
   - On **Cache Hit ($\ge 0.92$)**: Stream cached solution directly via Server-Sent Events (SSE) with `X-Cache-Status: HIT`.
   - On **Cache Miss**: Call OpenAI `gpt-4o-mini` with `stream: true`, stream chunks to client with `X-Cache-Status: MISS`, and asynchronously save result into Qdrant.
2. Test the server with two `curl` commands demonstrating a Cache Miss followed by an instant Cache Hit.

## Phase 4: VS Code Extension Sidebar
1. Scaffold a VS Code Extension in `./vscode-extension`.
2. Register a Webview View Provider for the sidebar chat UI.
3. Wire the Webview chat input to `http://localhost:3000/v1/chat/completions`.
4. Parse the SSE stream in the extension and display a badge indicating whether the answer was a `⚡ CACHE HIT (0ms, $0)` or `🤖 LLM GENERATED`.