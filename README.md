# Folkore

**Dementia patients forget names, dates, and faces. The people who love them remember everything.**

Folkore gives that knowledge to Alexa. Family members curate a living memory graph — stories, names, places, moments that matter. When a parent forgets their grandson's name, asks what year it is, or just needs grounding, Alexa answers from memory the family built — not from a generic AI.

Every morning, Alexa proactively surfaces a rotating memory. Every confusion signal is logged, tracked, and surfaced back to the family as a weekly insight. The more the family adds, the better Alexa gets at helping.

No app. No screen. No training required. Just voice, memory, and the people who matter.

Built for the **Build, Ship, Shape: Amazon Developer Hackathon 2026** — Alexa+ track.

---

## How It Works

A family member sets up Folkore once — Frank's daughter Sarah opens the web UI and starts adding memories. "Dad loves fishing at Lake Tahoe. He's been going every July for 20 years." "His grandson Marcus is 8. Loves dinosaurs. Wants to be a paleontologist." Each memory is stored with who, what, when, and tags. Relationships are extracted automatically into a graph — Marcus is linked to his memories, Lake Tahoe is linked to its stories.

When Frank talks to Alexa and can't remember his grandson's name, Alexa retrieves the right memories and responds warmly: *"That's okay, names can slip. Your grandson is Marcus — he's 8 and absolutely loves dinosaurs. He has a big school project this month."*

When the family checks in, the Insight Agent tells them how Frank's been doing: mood trends, confusion patterns, which memories are resonating. Not a dashboard — a narrative.

---

## Architecture

```
Alexa+ ──► MCP Tool ──► Supervisor ──► Specialist Agent ──► Tools ──► Response
                                                                  │
                                                     logInteraction (every turn, server-side)
```

A TypeScript MCP server exposes two tools to Alexa+: `converse` and `morning_memory`. Every request passes through a Supervisor that classifies intent and routes to one of three specialist agents. Each agent runs a real agentic tool-use loop — the LLM decides which tools to call, in which order, based on its system prompt. No hardcoded function chains.

| Agent | Triggered by | Tools | Responsibility |
|---|---|---|---|
| **Conversation** | Parent speaking to Alexa | `get_memory` | Retrieves relevant memories via hybrid retrieval, responds warmly. Confusion detection and logging run server-side after every turn. |
| **Curation** | Family adding a memory | `add_memory`, `add_node`, `add_edge` | Validates completeness (who + what + when), stores the memory, extracts named entity relationships into the graph, confirms. |
| **Insight** | Family checking on the parent | `get_insight_summary`, `surface_morning_memory` | Synthesizes mood trends, confusion rates, and unvisited memories into a human narrative. |

The Supervisor is the fourth agent — it runs a classification loop and hands off. No business logic lives in the Supervisor itself.

---

## Memory Retrieval

Retrieving the right memory at the right moment is the hardest problem Folkore solves. A single query — "tell me about my grandson" — needs to find memories that may be stored under different words, different tags, or linked through a graph relationship.

Folkore uses a three-layer hybrid retrieval pipeline:

```
Query
  │
  ├─ 1. Graph traversal     ─ Named entity match → follow edges → collect memory IDs
  │                           Instant. "Marcus" → node → subject_of edges → 3 memory IDs.
  │
  ├─ 2. DynamoDB keyword    ─ Fetch all memories, score by field overlap (who/what/when/tags)
  │                           Always fresh — catches memories added seconds ago.
  │
  └─ 3. Bedrock KB semantic ─ Vector similarity search via Bedrock Knowledge Base
                              Best-effort augmentation. Failures are silently swallowed.
                              May lag by one KB sync cycle — DynamoDB layers always cover freshness.

Results: merge + deduplicate → update last_referenced + reference_count → return
```

The graph layer is what makes entity-centric queries work. If a family member asks Alexa about Marcus, the graph traversal finds all three Marcus memories before keyword scoring even runs. The KB layer adds semantic distance — "the boy who loves bones" can still find the dinosaur memory.

---

## Memory Graph

Every named person and place in Frank's world is a node. Memories are connected to those nodes via typed edges.

```
Marcus (node)  ──subject_of──►  "Marcus is 8 and loves dinosaurs" (memory)
               ──subject_of──►  "Marcus visits every other weekend" (memory)
               ──subject_of──►  "Marcus has a school project in October" (memory)

Lake Tahoe (node) ──subject_of──► "Frank fished there every July for 20 years" (memory)
                  ──subject_of──► "Frank caught a 12-pound trout in 1983" (memory)
```

When the Curation Agent stores a memory that mentions a named entity, it calls `add_node` and `add_edge` automatically. The family never thinks about graph construction — they just tell Folkore what they remember.

DynamoDB stores nodes and edges as two lightweight tables. Neptune is the right production answer for native graph traversal; DynamoDB is the pragmatic hackathon choice — adequate for 100–200 memories and 2–3 hop queries at demo scale.

---

## Key Design Decisions

**Prompts as first-class artifacts, not code strings.** Every agent's system prompt lives in `src/server/prompts/*.txt` — version-controlled independently, diffable in PRs, readable without TypeScript. A clinician reviewing what Folkore says to a dementia patient should be able to open a text file and read it. Changing a prompt never requires a code deploy.

**HARD RULES in every prompt.** The model sees what "unacceptable" means before anything else. The Conversation Agent's rule #1: always call `get_memory` before forming any response. Never answer from prior knowledge. The parent's real memories are the only source of truth.

**Logging is the system's responsibility, not the agent's.** `logInteraction` runs unconditionally in the server wrapper after every conversation turn — not as an LLM tool call. Logging is guaranteed even if the agent errors, hits max iterations, or produces an empty response. The agent's only job is to retrieve and speak.

**Confusion detection is deterministic, not LLM-judged.** A regex classifier on the utterance detects confusion signals before the agent runs — temporal (what year/day is it), person (misidentified someone), place (wrong location). The result is written to `folkore_conversation_log` with a typed `confusion_type` enum. The LLM never decides what counts as confusion.

**KB sync guard instead of fire-and-forget.** Every `add_memory` call checks for an already-running ingestion job via `ListIngestionJobs` before firing `StartIngestionJob`. If a job is in progress, the new S3 file is skipped — the running job will pick it up incrementally. `ConflictException` is swallowed silently. DynamoDB keyword retrieval ensures the memory is immediately queryable regardless of KB sync state.

**OpenAI-compatible inference via AWS Mantle.** All LLM calls go through AWS's Mantle gateway at `https://bedrock-mantle.us-east-1.api.aws/v1` using `deepseek.v3.2`. The agent loop is 80 lines of fetch — no SDK dependency on the inference path.

---

## Agent Loop

Each specialist agent runs a real agentic tool-use loop. The LLM receives tool definitions, decides which to call, receives results, and continues until it produces a final response with no pending tool calls. Max 8 iterations per turn.

```
callLLM(messages, tools)
  → tool_calls present → execute → append tool results → loop
  → no tool_calls       → return content
```

---

## Data Layer

Six DynamoDB tables:

| Table | Key | Purpose |
|---|---|---|
| `folkore_person_profile` | `person_id` | Parent profile — name, age, condition notes |
| `folkore_memory_graph` | `person_id` + `memory_id` | Memory records — who, what, when, tags, type, last_referenced, reference_count |
| `folkore_conversation_log` | `person_id` + `session_id` | Per-turn log — mood, confusion type, memories referenced. No raw transcript stored. |
| `folkore_family_contacts` | `person_id` + `contact_id` | Family members — name, relationship, notification preferences |
| `folkore_memory_nodes` | `person_id` + `node_id` | Named entity nodes — people, places, events with typed attributes |
| `folkore_memory_edges` | `person_id` + `edge_id` | Typed relationships between nodes and memories |

Memories are also written to S3 (`folkore-memory-kb`) as plain text files and indexed by Bedrock Knowledge Base for semantic retrieval. DynamoDB is the source of truth for structured queries; the KB augments retrieval with semantic similarity.

---

## AWS Integrations

Every part of Folkore's memory pipeline runs on AWS. There are no third-party databases, no external inference providers, no services outside the AWS ecosystem.

| Service | SDK Package | How it's used |
|---|---|---|
| **Amazon DynamoDB** | `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb` | Primary data store for all 6 tables — person profiles, memories, conversation logs, family contacts, graph nodes, and edges. Every read and write in the hot path goes here. |
| **Amazon S3** | `@aws-sdk/client-s3` | Every memory is written as a plain text file to `folkore-memory-kb` under `memories/{person_id}/{memory_id}.txt`. S3 is the source bucket for Bedrock Knowledge Base ingestion. |
| **Amazon Bedrock Knowledge Base** | `@aws-sdk/client-bedrock-agent-runtime` | Semantic vector search over the memory corpus. Called as the third layer of hybrid retrieval — after graph traversal and DynamoDB keyword scoring — for natural language queries like "fishing trips with the family". |
| **Amazon Bedrock Agent** | `@aws-sdk/client-bedrock-agent` | Manages KB sync — `ListIngestionJobsCommand` checks for a running job before firing `StartIngestionJobCommand`. Prevents concurrent ingestion conflicts on rapid memory adds. |
| **AWS Bedrock Mantle gateway** | HTTP fetch (OpenAI-compatible) | All LLM inference goes through `https://bedrock-mantle.us-east-1.api.aws/v1` using `deepseek.v3.2`. The agent loop is a direct HTTP call — no additional SDK on the inference path. |
| **Amazon EventBridge** *(planned)* | — | Scheduled trigger for `morning_memory` — fires once per morning per registered parent. Calls the MCP server's `morning_memory` tool via HTTP. |
| **Amazon SNS** *(planned)* | — | Weekly digest to family contacts — mood trends, confusion signals, surfaced memories. |

All integrations are live and called in code. See `src/server/db.ts` for DynamoDB, S3, and Bedrock imports and usage.

---

## Proactive Morning Memory

Each morning, EventBridge triggers `morning_memory` for each registered parent. The Supervisor routes system-initiated requests directly to `surfaceMorningMemory` — the least-recently-referenced memory in the graph — bypassing the classifier entirely.

Alexa leads the conversation: *"Good morning Frank. Marcus has a dinosaur project at school this week. He's been working on it all month."*

Family members receive a weekly digest via SNS with mood trends, confusion signals, and which memories have been surfaced.

---

## Project Structure

```
folkore/
├── src/
│   ├── server/
│   │   ├── agents/
│   │   │   ├── loop.ts                  # Agentic tool-use loop — shared engine for all agents
│   │   │   ├── supervisor.ts            # Intent classification + routing
│   │   │   ├── conversation.ts          # Parent-facing agent — memory retrieval + logging
│   │   │   ├── curation.ts              # Family-facing agent — memory intake + graph extraction
│   │   │   └── insight.ts               # Analytics agent — mood trends + weekly narrative
│   │   ├── prompts/
│   │   │   ├── conversation.txt         # Conversation Agent system prompt
│   │   │   ├── curation.txt             # Curation Agent system prompt
│   │   │   ├── insight.txt              # Insight Agent system prompt
│   │   │   └── supervisor-classify.txt  # Intent classifier prompt
│   │   ├── schema/
│   │   │   └── dynamodb.ts              # DynamoDB table definitions + provisioning
│   │   ├── db.ts                        # Data layer — DynamoDB, S3, Bedrock KB, memory graph
│   │   ├── server.ts                    # MCP server — tool + resource registration
│   │   └── main.ts                      # Entry point — HTTP + stdio transports
│   └── client/
│       └── mcp-app.tsx                  # React MCP App — Alexa+ voice UI simulation
├── scripts/
│   ├── smoke-test.ts                    # 13-step end-to-end test — db, agents, Frank's seed data
│   └── seed-frank.ts                    # Demo seed — Frank Henderson persona, 24 memories, 6 weeks of natural curation
├── .env.sample                          # Required env vars template
├── tsconfig.json                        # Client (bundler)
├── tsconfig.server.json                 # Server (NodeNext)
└── vite.config.ts                       # MCP App bundle config
```

---

## Setup

### Prerequisites

- Node.js 18+
- AWS account with:
  - DynamoDB (6 tables provisioned — see step 3)
  - S3 bucket for memory files
  - Bedrock Knowledge Base with an S3 data source pointing at that bucket
  - AWS credentials configured locally (`aws configure` or a named profile)
- Mantle API key — request from AWS for Bedrock Mantle gateway access

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.sample .env
```

Open `.env` and fill in every value:

| Variable | Where to get it |
|---|---|
| `AWS_REGION` | Your AWS region, e.g. `us-east-1` |
| `AWS_PROFILE` | Named profile from `~/.aws/credentials`, or remove this line if using default |
| `FOLKORE_KB_ID` | Bedrock console → Knowledge Bases → your KB → Knowledge base ID |
| `FOLKORE_KB_DATA_SOURCE_ID` | `aws bedrock-agent list-data-sources --knowledge-base-id <your-kb-id>` |
| `FOLKORE_KB_BUCKET` | S3 bucket name you configured as the KB data source |
| `MANTLE_API_KEY` | Your Mantle gateway API key |
| `MANTLE_BASE_URL` | `https://bedrock-mantle.us-east-1.api.aws/v1` |
| `MANTLE_MODEL` | `deepseek.v3.2` |

### 3. Provision AWS resources

```bash
# Create all 6 DynamoDB tables
npx tsx src/server/schema/dynamodb.ts
```

The S3 bucket and Bedrock Knowledge Base must be created manually in the AWS console. The KB data source should point at the S3 bucket with prefix `memories/`.

### 4. Seed demo data

```bash
# Creates Frank Henderson — 24 memories, 8 entity nodes, 28 days of conversation logs
npx tsx scripts/seed-frank.ts
```

Use `person_id: frank-henderson-001` in all demo tool calls.

### 5. Start the server

```bash
npm run serve
```

Server starts at `http://localhost:3001/mcp`.

For development with hot reload:

```bash
npm run dev
```

### 6. Run smoke test

```bash
npx tsx scripts/smoke-test.ts
```

13 steps: direct DB operations, memory graph, hybrid retrieval, all three agents, and live queries against Frank's seeded data. All steps should pass before connecting to Alexa+.

### 7. Connect to Alexa+ (demo)

Register the MCP server URL with Alexa+. The server exposes two tools:

- `converse` — used for every parent and family utterance
- `morning_memory` — triggered by EventBridge each morning (can be called manually for demo)

### Test locally with MCP Inspector

```bash
# Terminal 1 — build and serve
npm run build && npm run serve

# Terminal 2 — MCP basic host
SERVERS='["http://localhost:3001/mcp"]' npx @modelcontextprotocol/basic-host
```

Open `http://localhost:8080`, call `converse` with:

```json
{
  "personId": "frank-henderson-001",
  "utterance": "I can't remember my grandson's name",
  "initiatedBy": "parent"
}
```

---

## Scope & Constraints

| Constraint | Detail |
|---|---|
| **Single session, stateless** | Each agent invocation is stateless. Conversation continuity is provided by the memory store, not session history. |
| **Graph at demo scale** | The memory graph runs on DynamoDB — adequate for 100–200 memories and 2–3 hop traversal. Neptune is the right production path for native graph queries. |
| **English only** | Prompts and memory content are English. |
| **HTTP-only inference** | All LLM calls go through Mantle. Direct `bedrock:InvokeModel` is out of scope. |
| **KB as augmentation** | Bedrock KB indexing is asynchronous. DynamoDB keyword retrieval always covers freshness — the KB adds semantic distance on top, not instead. |

---

## License

MIT
