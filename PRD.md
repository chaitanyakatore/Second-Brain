# Product Requirement Document (PRD)

## Project Title
**Company Brain & Enterprise Semantic Cache Engine**

**Document Version:** 1.0.0  
**Status:** In Development (POC Phase)  
**Author / Lead Architect:** Senior AI Engineering Team  

---

## 1. Executive Summary & Problem Statement

### The Problem
Engineering teams repeatedly encounter identical bugs, stack traces, and framework edge cases. Currently, when Developer A solves an issue using an AI coding assistant (e.g., Copilot, Cursor, ChatGPT), that solution remains isolated to that session. When Developer B encounters the exact same bug weeks later, the team incurs:
1. **Redundant LLM Token Expenses:** Repetitive API queries costs thousands of dollars monthly across large engineering orgs.
2. **Context Window Latency Overhead:** Re-sending local workspace context and waiting 5–15 seconds for LLM generation reduces developer flow.
3. **Loss of Organizational Memory:** Fixes verified by senior engineers are lost, and junior engineers often receive generic AI hallucinations instead of company-standard solutions.

### The Solution
The **Company Brain** acts as a centralized intelligence proxy and memory store for IDEs. It introduces:
* **Sub-20ms Semantic Caching:** Instant zero-cost resolution for identical or semantically similar queries.
* **Pre-Indexed Repository Knowledge:** Centralized AST/code knowledge graphs, eliminating local `@workspace` re-computation.
* **Organizational Memory Harvesting:** Capturing verified resolutions from GitHub PRs, post-mortems, and developer upvotes into permanent Knowledge Items (KIs).

---

## 2. High-Level Architecture Diagram

┌──────────────────────────────────────────────────────────────────────────────────┐
│                            DEVELOPER IDE LAYER (VS Code)                         │
│                                                                                  │
│   ┌──────────────────────────────────────────────────────────────────────────┐   │
│   │                         VS Code Sidebar Extension                        │   │
│   │ - Intercepts User Prompts & Selected Code Context                        │   │
│   │ - Renders Real-Time SSE Streams & Cache Badges (⚡ HIT / 🤖 MISS)        │   │
│   └────────────────────────────────────┬─────────────────────────────────────┘   │
└────────────────────────────────────────┼─────────────────────────────────────────┘
│ HTTP SSE Stream (POST /v1/chat/completions)
▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                     INTELLIGENCE PROXY & SEMANTIC CACHE ENGINE                   │
│                               (Node.js / Fastify)                                │
│                                                                                  │
│  ┌─────────────────────────────┐   ┌──────────────────────────────────────────┐  │
│  │ 1. Prompt Normalizer        │   │ 2. SHA-256 Exact Hash Evaluator          │  │
│  │    Strips local file paths, │──>│    Performs O(1) lookup on normalized   │  │
│  │    formatting & noise       │   │    prompt string                         │  │
│  └─────────────────────────────┘   └────────────────────┬─────────────────────┘  │
│                                                         │                        │
│                                                         ▼                        │
│                                    ┌──────────────────────────────────────────┐  │
│                                    │ 3. Vector Embedding Engine               │  │
│                                    │    Generates 1536-dim dense vector      │  │
│                                    │    via OpenAI text-embedding-3-small     │  │
│                                    └────────────────────┬─────────────────────┘  │
└─────────────────────────────────────────────────────────┼────────────────────────┘
│ Vector Search
▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             CENTRAL VECTOR STORE (Qdrant)                        │
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │ Collection: company_brain_cache (Distance Metric: Cosine)                │  │
│  │ Metadata Filters: repo_id == "target-repo", status == "ACTIVE"             │  │
│  └──────────────────────────────────────┬─────────────────────────────────────┘  │
└─────────────────────────────────────────┼────────────────────────────────────────┘
│
┌─────────────────┴─────────────────┐
│                                   │
Cosine Score ≥ 0.92                 Cosine Score < 0.92
(CACHE HIT)                         (CACHE MISS)
│                                   │
▼                                   ▼
┌───────────────────────────┐       ┌───────────────────────────┐
│ Return Cached Answer      │       │ Forward Query to LLM      │
│ - Latency: ~15-20ms       │       │ - Stream tokens via SSE   │
│ - Token Cost: $0.00       │       │ - Async-save result into  │
│                           │       │   Qdrant for future devs  │
└───────────────────────────┘       └───────────────────────────┘

## 3. Product Features & Functional Requirements

### Feature 1: Prompt Normalization & Anonymization Engine
* **Requirement:** Raw prompts must be cleaned before vector embedding to maximize cache efficiency across developer laptops.
* **Specification:**
  * Convert prompts to lowercase and strip excess whitespace and newlines.
  * Abstract local file paths (e.g., `/Users/dev/project/src/OrderService.java` or `C:\Users\...`) into unified tokens (`<FILE_PATH>`).
  * Calculate an exact SHA-256 string hash of the clean prompt.

### Feature 2: Hybrid Cache Matcher ($O(1)$ Hash + Vector Search)
* **Requirement:** Perform two-stage cache evaluation to maximize execution speed.
* **Specification:**
  * **Stage 1 (Exact Hash Match):** If SHA-256 hash exists in cache metadata, return immediately ($O(1)$ lookup, sub-5ms latency).
  * **Stage 2 (Semantic Vector Search):** Generate a 1536-dimensional vector using OpenAI `text-embedding-3-small`. Query Qdrant with `repo_id` metadata scoping.
  * **Cosine Similarity Threshold:** Matches with score $\ge 0.92$ are flagged as **CACHE HIT**. Scores $< 0.92$ are flagged as **CACHE MISS**.

### Feature 3: Token Streaming Proxy Gateway (Server-Sent Events)
* **Requirement:** Provide instant token streaming compatibility for IDE interfaces.
* **Specification:**
  * Expose an OpenAPI-compliant endpoint: `POST /v1/chat/completions`.
  * Return responses via `text/event-stream` (Server-Sent Events).
  * Send custom HTTP header: `X-Cache-Status: HIT` or `X-Cache-Status: MISS`.

### Feature 4: VS Code Sidebar Extension
* **Requirement:** Provide an in-editor user interface so developers don't have to context switch.
* **Specification:**
  * Webview Sidebar Chat View registered in VS Code.
  * Displays user prompt history and streams markdown answers.
  * Renders visual indicators: `⚡ CACHE HIT (15ms, $0.00)` vs `🤖 LLM GENERATED`.

---

## 4. Technical Stack & Tooling

| Component | Technology / Tool Selected | Reason for Selection |
| :--- | :--- | :--- |
| **Backend Framework** | Node.js (TypeScript + Fastify) | High-concurrency async streaming support for SSE; minimal boilerplate. |
| **Vector Database** | Qdrant (via Docker) | Low-latency vector similarity search with rich JSON payload metadata filtering. |
| **Embedding Engine** | OpenAI `text-embedding-3-small` | High dimensional density (1536 dims) at low operational cost. |
| **LLM Provider** | OpenAI `gpt-4o-mini` / `gpt-4o` | Fast streaming completion engine for Cache Misses. |
| **IDE Client** | VS Code Extension API | Native Webview sidebar integration for developer workflow adoption. |

---

## 5. Non-Functional Requirements & Key Metrics (KPIs)

* **Cache Hit Latency (P99):** $< 30\text{ms}$ execution time for cache hits.
* **Cache Precision Rate:** $> 95\%$ accuracy (zero false positive cache hits that return wrong fixes).
* **Token Reduction Target:** Reduce total LLM token usage by $30\%\text{--}50\%$ across a 10-person engineering team during standard sprint execution.
* **Concurrency:** The Fastify proxy must support at least 500 simultaneous open SSE connections without dropping packets.

---

## 6. Implementation Roadmap (Phases)

* [x] **Phase 1: Environment & Infrastructure Setup**
  * Spin up Qdrant using Docker Compose on port 6333.
* [ ] **Phase 2: Backend Core Engine & Normalizer**
  * Build prompt normalizer, SHA-256 hash generator, and Qdrant cache service.
* [ ] **Phase 3: Fastify Streaming Proxy API**
  * Implement `POST /v1/chat/completions` with SSE streaming and async cache write-backs.
* [ ] **Phase 4: VS Code Sidebar UI Integration**
  * Build Webview panel streaming client and wire with proxy gateway.
* [ ] **Phase 5: Knowledge Bank & Verification Hooks**
  * Add endpoint `/v1/cache/verify` to mark high-confidence answers approved by Senior Engineers.