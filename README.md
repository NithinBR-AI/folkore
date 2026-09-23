# Folkore

> Loved ones add stories, names, and moments. When an aging parent forgets, Alexa remembers — because family taught it. No app, no screen. Just voice, memory, and the people who matter.

## What It Does

Folkore is an MCP server that turns Alexa+ into a memory companion for aging parents and dementia patients. Family members curate a living memory graph — stories, names, places, moments. Alexa uses that graph to hold personal, grounding conversations with the parent, proactively surfacing memories and responding to confusion with warmth.

**Two modes:**
- **Reactive** — parent asks, Alexa answers from memory ("I can't remember my grandson's name" → Alexa knows)
- **Proactive** — Alexa initiates each morning with a rotating memory ("Good morning Frank. Marcus has a dinosaur project at school this week.")

## MCP Tools

| Tool | Description |
|---|---|
| `add_memory` | Family adds a story, person, place, or moment |
| `get_memory` | Retrieve memories by ID or tag |
| `log_interaction` | Record an Alexa conversation session |
| `get_insight_summary` | Mood trends, memory counts, top tags |
| `surface_morning_memory` | Today's proactive memory prompt |

## Tech Stack

- **Voice:** Alexa+ MCP Server (Streamable HTTP, spec 2025-11-25)
- **Agent Framework:** AWS Bedrock AgentCore / Strands SDK
- **Storage:** AWS DynamoDB
- **Alerts:** AWS SNS
- **Scheduling:** AWS EventBridge
- **AI/LLM:** AWS Bedrock Claude
- **UI:** MCP App (React) — simulated Alexa+ experience

## Getting Started

### Prerequisites
- Node.js 20+
- AWS account (for DynamoDB, Bedrock, SNS, EventBridge)

### Install & Run

```bash
npm install
npm run dev
```

Server starts at `http://localhost:3001/mcp`

### Build

```bash
npm run build
npm run serve
```

### Test with basic-host

```bash
# Terminal 1
npm run build && npm run serve

# Terminal 2
SERVERS='["http://localhost:3001/mcp"]' npx @modelcontextprotocol/basic-host
# Open http://localhost:8080
```

## Project Structure

```
folkore/
├── main.ts          # Entry point — HTTP + stdio transports
├── server.ts        # MCP server — tool + resource registration
├── db.ts            # Data layer (in-memory → DynamoDB)
├── src/             # React MCP App UI
├── dist/            # Built UI (mcp-app.html)
└── schema/          # DynamoDB table definitions
```

## Hackathon

Built for the **Build, Ship, Shape: Amazon Developer Hackathon 2026** — Alexa+ track + AWS Builder mini challenge.

## License

MIT
