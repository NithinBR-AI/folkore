# Folkore

**Dementia patients forget names, dates, and faces. The people who love them remember everything.**

Folkore gives that knowledge to Alexa. Family members curate a living memory graph — stories, names, places, moments that matter. When a parent forgets their grandson's name, asks what year it is, or just needs grounding, Alexa answers from memory the family built — not from a generic AI. Every morning, Alexa proactively surfaces a rotating memory. Every confusion signal is logged, tracked, and surfaced back to the family as a weekly insight.

No app. No screen. Just voice, memory, and the people who matter.

Built for the **Build, Ship, Shape: Amazon Developer Hackathon 2026** — Alexa+ track.

---

## Architecture

```
Alexa+ → MCP Tool → Supervisor → Specialist Agent → Tools → Response
                                                           ↓
                                              logInteraction (system, every turn)
```

A TypeScript MCP server exposes two tools to Alexa+: `converse` and `morning_memory`. Every request goes through a Supervisor that classifies intent and routes to one of four specialist agents — each running a real agentic tool-use loop against AWS services. The LLM decides which tools to call, in which order, based on the system prompt it was given.

| Agent | Triggered by | Tools | Responsibility |
|---|---|---|---|
| Conversation | Parent speaking to Alexa | `get_memory` | Retrieves relevant memories, responds warmly. Confusion detection and logging run server-side after every turn. |
| Curation | Family adding a memory | `add_memory` | Validates completeness (who + what + when), stores, confirms |
| Insight | Family requesting a summary | `get_insight_summary`, `surface_morning_memory` | Synthesizes mood trends, confusion rates, and unvisited memories into a human narrative |
| Supervisor | Every request | — | Intent classification → routes to the right specialist |

---

## Key Design Decisions

**Prompts as first-class artifacts, not code strings.** Every agent's system prompt lives in `src/server/prompts/*.txt` — version-controlled independently, diffable in PRs, readable without touching TypeScript. A clinician reviewing what Folkore says to a dementia patient should be able to open a text file and read it. Changing a prompt never requires a code deploy.

**HARD RULES sections in every prompt.** The model sees what "unacceptable" means before it reads anything else. The Conversation Agent's #1 rule: always call `get_memory` before forming any response. Never answer from prior knowledge. The parent's real memories are the only source of truth.

**Logging is the system's responsibility, not the agent's.** `logInteraction` runs unconditionally in the server wrapper after every conversation turn — not as an LLM tool call. This decouples observability from agent behavior: logging is guaranteed even if the agent errors, hits max iterations, or produces an empty response. The agent's only job is to retrieve and speak.

**Confusion detection is deterministic, not LLM-judged.** A regex classifier on the utterance detects confusion signals before the agent runs — temporal (asked what year/day it is), person (misidentified someone), place (wrong location). The result is written to `folkore_conversation_log` with a typed `confusion_type` enum the Insight Agent reads. The LLM never decides what counts as confusion.

**Semantic retrieval via Bedrock Knowledge Base.** Memories are stored as text files in S3 and indexed by Bedrock KB. The `get_memory` tool runs a natural language query — "fishing trips with the family" returns the Lake Tahoe memory without exact keyword matching. Person-level filtering is done post-retrieval by matching the `person_id` segment in the S3 URI, since Bedrock does not propagate custom object metadata to retrieval results. Retrieved memories update `last_referenced` and `reference_count` in DynamoDB. Every `add_memory` call fires a `StartIngestionJob` on the KB after the S3 write — new memories are searchable within the KB's next sync cycle without manual intervention.

**OpenAI-compatible inference via AWS Mantle.** All LLM calls go through AWS's own Mantle gateway at `https://bedrock-mantle.us-east-1.api.aws/v1` using `deepseek.v3.2` — an OpenAI-compatible API authenticated with a Mantle API key. The loop is 80 lines of fetch, no SDK dependency.

---

## Agent Loop

Each specialist agent runs a real agentic tool-use loop — not a sequential function call chain. The LLM receives tool definitions, decides which to call, receives results, and continues until it produces a final response with no pending tool calls. Max 8 iterations per turn.

```
callLLM(messages, tools)
  → tool_calls present → execute → append tool results → loop
  → no tool_calls → return content
```

---

## Data Layer

Four DynamoDB tables:

| Table | Key | Purpose |
|---|---|---|
| `folkore_person_profile` | `person_id` | Parent profile — name, age, condition notes |
| `folkore_memory_graph` | `person_id` + `memory_id` | Memory records — who, what, when, tags, type, last referenced, reference count |
| `folkore_conversation_log` | `person_id` + `session_id` | Per-turn log — mood, confusion type, memories referenced. No raw transcript stored. |
| `folkore_family_contacts` | `person_id` + `contact_id` | Family members — name, relationship, notification preferences |

Memories are also written to S3 (`folkore-memory-kb`) as plain text files and indexed by Bedrock Knowledge Base for semantic retrieval. DynamoDB is the source of truth for structured queries; the KB is the retrieval layer for natural language search.

---

## Proactive Morning Memory

Each morning, EventBridge triggers `morning_memory` for each registered parent. The Supervisor routes system-initiated requests directly to `surfaceMorningMemory` — the least-recently-referenced memory in the graph — bypassing the classifier entirely. Alexa leads the conversation: "Good morning Frank. Marcus has a dinosaur project at school this week."

Family members receive a weekly digest via SNS with mood trends, confusion signals, and which memories have been surfaced.

---

## Project Structure

```
folkore/
├── src/
│   ├── server/
│   │   ├── agents/
│   │   │   ├── loop.ts                  # Agentic tool-use loop — the engine all agents share
│   │   │   ├── supervisor.ts            # Intent classification + routing
│   │   │   ├── conversation.ts          # Parent-facing agent — memory retrieval + server-side logging
│   │   │   ├── curation.ts              # Family-facing agent — memory intake
│   │   │   └── insight.ts               # Analytics agent — mood trends + weekly narrative
│   │   ├── prompts/
│   │   │   ├── conversation.txt         # Conversation Agent system prompt
│   │   │   ├── curation.txt             # Curation Agent system prompt
│   │   │   ├── insight.txt              # Insight Agent system prompt
│   │   │   └── supervisor-classify.txt  # Intent classifier prompt
│   │   ├── schema/
│   │   │   └── dynamodb.ts              # DynamoDB table definitions
│   │   ├── db.ts                        # Data layer — DynamoDB + S3 + Bedrock KB
│   │   ├── server.ts                    # MCP server — tool + resource registration
│   │   └── main.ts                      # Entry point — HTTP + stdio transports
│   └── client/
│       └── mcp-app.tsx                  # React MCP App — simulated Alexa+ voice UI
├── .env.sample                          # Required env vars template
├── tsconfig.json                        # Client (bundler)
├── tsconfig.server.json                 # Server (NodeNext)
└── vite.config.ts                       # MCP App bundle config
```

---

## Setup

### Prerequisites

- Node.js 18+
- AWS account with DynamoDB tables, S3 bucket, and Bedrock Knowledge Base provisioned
- Mantle API key

### Install & Run

```bash
npm install
cp .env.sample .env   # fill in your values
npm run serve
```

Server starts at `http://localhost:3001/mcp`.

### Test with MCP basic-host

```bash
# Terminal 1
npm run build && npm run serve

# Terminal 2
SERVERS='["http://localhost:3001/mcp"]' npx @modelcontextprotocol/basic-host
# Open http://localhost:8080
```

---

## Scope & Constraints

| Constraint | Detail |
|---|---|
| **Single session, stateless** | Each agent invocation is stateless. The loop runs within a single turn — there is no cross-turn memory of what was said earlier in an Alexa session. Conversation continuity is provided by the memory store, not session history. |
| **Flat memory store** | Memories are independent records linked by tags and semantic similarity. Explicit relationship edges (Marcus → grandson of → Frank) are not yet modelled — traversal across entities relies on embedding proximity in the KB. |
| **English only** | Prompts and memory content are English. |
| **HTTP-only inference** | All LLM calls go through Mantle. Direct `bedrock:InvokeModel` is out of scope. |
| **KB sync latency** | `StartIngestionJob` is triggered on every `add_memory` call but Bedrock KB indexing is asynchronous — new memories may not be immediately searchable depending on KB sync cycle time. |

---

## License

MIT
