import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";
import {
  BedrockAgentClient,
  StartIngestionJobCommand,
  ListIngestionJobsCommand,
} from "@aws-sdk/client-bedrock-agent";
import { randomUUID } from "node:crypto";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
const bedrockAgentRuntime = new BedrockAgentRuntimeClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const bedrockAgent = new BedrockAgentClient({ region: process.env.AWS_REGION ?? "us-east-1" });

const KB_DATA_SOURCE_ID = process.env.FOLKORE_KB_DATA_SOURCE_ID ?? "";

const KB_ID     = process.env.FOLKORE_KB_ID     ?? "8TRTP9TPP2";
const KB_BUCKET = process.env.FOLKORE_KB_BUCKET ?? "folkore-memory-kb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const db = DynamoDBDocumentClient.from(client);

const TABLES = {
  person_profile:    "folkore_person_profile",
  memory_graph:      "folkore_memory_graph",
  conversation_log:  "folkore_conversation_log",
  family_contacts:   "folkore_family_contacts",
  memory_nodes:      "folkore_memory_nodes",
  memory_edges:      "folkore_memory_edges",
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Memory {
  person_id:        string;
  memory_id:        string;
  type:             "person" | "place" | "event" | "preference" | "story";
  who:              string;
  what:             string;
  when:             string;
  tags:             string[];
  added_by:         string;
  last_referenced:  string;
  reference_count:  number;
  created_at:       string;
}

export interface Interaction {
  person_id:           string;
  session_id:          string;
  mood:                "happy" | "calm" | "confused" | "sad" | "anxious";
  confusion_detected:  boolean;
  confusion_type:      "temporal" | "person" | "place" | null;
  memories_referenced: string[];
  initiated_by:        "parent" | "alexa";
  created_at:          string;
}

export interface MemoryNode {
  person_id:   string;
  node_id:     string;
  type:        "person" | "place" | "event";
  name:        string;
  attributes:  Record<string, unknown>;
  created_at:  string;
}

export interface MemoryEdge {
  person_id:    string;
  edge_id:      string;
  from_id:      string;
  to_id:        string;
  relationship: string;
  created_at:   string;
}

export interface InsightSummary {
  total_memories:       number;
  total_interactions:   number;
  mood_counts:          Record<string, number>;
  top_tags:             Record<string, number>;
  confusion_rate:       number;
}

// ── add_memory ────────────────────────────────────────────────────────────────

export async function addMemory(
  person_id: string,
  who: string,
  what: string,
  when: string,
  tags: string[],
  added_by: string = "family",
  type: Memory["type"] = "story",
): Promise<Memory> {
  const memory: Memory = {
    person_id,
    memory_id:       randomUUID(),
    type,
    who,
    what,
    when,
    tags,
    added_by,
    last_referenced: new Date(0).toISOString(),
    reference_count: 0,
    created_at:      new Date().toISOString(),
  };

  await db.send(new PutCommand({ TableName: TABLES.memory_graph, Item: memory }));

  // Write to S3 and trigger KB re-ingestion so the memory is immediately searchable
  const doc = `who: ${who}\nwhat: ${what}\nwhen: ${when}\ntags: ${tags.join(", ")}`;
  await s3.send(new PutObjectCommand({
    Bucket: KB_BUCKET,
    Key: `memories/${person_id}/${memory.memory_id}.txt`,
    Body: doc,
    ContentType: "text/plain",
    Metadata: { person_id, memory_id: memory.memory_id, type },
  }));

  // Trigger KB re-ingestion only if no job is already running.
  // ConflictException on StartIngestionJob is swallowed — a concurrent job will
  // pick up the new S3 file on its current incremental pass.
  if (KB_DATA_SOURCE_ID) {
    bedrockAgent.send(new ListIngestionJobsCommand({
      knowledgeBaseId: KB_ID,
      dataSourceId: KB_DATA_SOURCE_ID,
      filters: [{ attribute: "STATUS", operator: "EQ", values: ["STARTING", "IN_PROGRESS"] }],
    })).then((jobs) => {
      if ((jobs.ingestionJobSummaries ?? []).length === 0) {
        return bedrockAgent.send(new StartIngestionJobCommand({
          knowledgeBaseId: KB_ID,
          dataSourceId: KB_DATA_SOURCE_ID,
        }));
      }
    }).catch((err: unknown) => {
      const code = (err as { name?: string }).name;
      if (code !== "ConflictException") {
        console.error("KB sync failed:", (err as Error).message);
      }
    });
  }

  return memory;
}

// ── get_memory ────────────────────────────────────────────────────────────────

/**
 * Hybrid memory retrieval — three-layer pipeline:
 *
 * 1. Graph traversal  — match named entities in query against memory_nodes,
 *                       follow edges one hop to collect related memory_ids.
 *                       Always instant; no async dependency.
 *
 * 2. DynamoDB keyword — fetch all memories for person_id, score each by
 *                       keyword overlap between query and who/what/when/tags.
 *                       Always fresh — catches memories added seconds ago.
 *
 * 3. KB semantic      — best-effort augmentation via Bedrock KB vector search.
 *                       May lag by up to one sync cycle; failures are silently
 *                       swallowed so KB outages never break retrieval.
 *
 * Results from all three layers are merged and deduplicated by memory_id.
 * last_referenced and reference_count are updated for every surfaced memory.
 */
export async function getMemory(
  person_id: string,
  memory_id?: string,
  tag?: string,
  query?: string,
): Promise<Memory[]> {
  // ── Exact lookup by ID ────────────────────────────────────────────────────
  if (memory_id) {
    const result = await db.send(new GetCommand({
      TableName: TABLES.memory_graph,
      Key: { person_id, memory_id },
    }));
    return result.Item ? [result.Item as Memory] : [];
  }

  // ── Tag or full scan (no query) ───────────────────────────────────────────
  if (!query) {
    const result = await db.send(new QueryCommand({
      TableName: TABLES.memory_graph,
      KeyConditionExpression: "person_id = :pid",
      ExpressionAttributeValues: { ":pid": person_id },
    }));
    const items = (result.Items ?? []) as Memory[];
    if (tag) return items.filter((m) => m.tags.includes(tag));
    return items;
  }

  // ── Hybrid query retrieval ────────────────────────────────────────────────

  const lower = query.toLowerCase();
  const collectedIds = new Set<string>();

  // Layer 1: Graph traversal — find memory_ids reachable from named entities
  const graphIds = await traverseGraph(person_id, query).catch(() => []);
  graphIds.forEach((id) => collectedIds.add(id));

  // Layer 2: DynamoDB keyword score — fetch all, score by field overlap
  const allResult = await db.send(new QueryCommand({
    TableName: TABLES.memory_graph,
    KeyConditionExpression: "person_id = :pid",
    ExpressionAttributeValues: { ":pid": person_id },
  }));
  const allMemories = (allResult.Items ?? []) as Memory[];

  // Score each memory: count how many query words appear in who/what/when/tags
  const scored = allMemories
    .map((m) => {
      const haystack = `${m.who} ${m.what} ${m.when} ${m.tags.join(" ")}`.toLowerCase();
      const words = lower.split(/\s+/).filter((w) => w.length > 2);
      const score = words.filter((w) => haystack.includes(w)).length;
      return { m, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ m }) => m);

  scored.forEach((m) => collectedIds.add(m.memory_id));

  // Layer 3: KB semantic search — augment with vector similarity, best-effort
  // KB may lag behind by up to one sync cycle; DynamoDB layers above always cover freshness.
  // URI format: s3://folkore-memory-kb/memories/{person_id}/{memory_id}.txt
  if (KB_ID) {
    await bedrockAgentRuntime.send(new RetrieveCommand({
      knowledgeBaseId: KB_ID,
      retrievalQuery: { text: query },
      retrievalConfiguration: { vectorSearchConfiguration: { numberOfResults: 10 } },
    })).then((kbResult) => {
      (kbResult.retrievalResults ?? []).forEach((r) => {
        const uri = r.location?.s3Location?.uri ?? "";
        const match = uri.match(/\/memories\/([^/]+)\/([^/]+)\.txt$/);
        if (match && match[1] === person_id) collectedIds.add(match[2]);
      });
    }).catch(() => {
      // KB failure is non-fatal — DynamoDB layers have already returned results
    });
  }

  // Fetch full memory records for all collected IDs (deduplicated)
  const fetched = await Promise.all(
    [...collectedIds].map((id) =>
      db.send(new GetCommand({ TableName: TABLES.memory_graph, Key: { person_id, memory_id: id } }))
        .then((r) => r.Item as Memory | undefined)
    )
  );
  const found = fetched.filter((m): m is Memory => !!m);

  // Update last_referenced + reference_count for all surfaced memories
  await Promise.all(found.map((m) =>
    db.send(new PutCommand({
      TableName: TABLES.memory_graph,
      Item: { ...m, last_referenced: new Date().toISOString(), reference_count: m.reference_count + 1 },
    }))
  ));

  return found;
}

// ── log_interaction ───────────────────────────────────────────────────────────

export async function logInteraction(
  person_id: string,
  mood: Interaction["mood"],
  confusion_detected: boolean,
  confusion_type: Interaction["confusion_type"],
  memories_referenced: string[],
  initiated_by: Interaction["initiated_by"] = "parent",
): Promise<Interaction> {
  const interaction: Interaction = {
    person_id,
    session_id:          randomUUID(),
    mood,
    confusion_detected,
    confusion_type,
    memories_referenced,
    initiated_by,
    created_at:          new Date().toISOString(),
  };

  await db.send(new PutCommand({ TableName: TABLES.conversation_log, Item: interaction }));
  return interaction;
}

// ── get_insight_summary ───────────────────────────────────────────────────────

export async function getInsightSummary(person_id: string): Promise<InsightSummary> {
  const [memoriesResult, interactionsResult] = await Promise.all([
    db.send(new QueryCommand({
      TableName: TABLES.memory_graph,
      KeyConditionExpression: "person_id = :pid",
      ExpressionAttributeValues: { ":pid": person_id },
    })),
    db.send(new QueryCommand({
      TableName: TABLES.conversation_log,
      KeyConditionExpression: "person_id = :pid",
      ExpressionAttributeValues: { ":pid": person_id },
    })),
  ]);

  const memories     = (memoriesResult.Items ?? []) as Memory[];
  const interactions = (interactionsResult.Items ?? []) as Interaction[];

  const mood_counts: Record<string, number> = {};
  let confusion_count = 0;
  for (const i of interactions) {
    mood_counts[i.mood] = (mood_counts[i.mood] ?? 0) + 1;
    if (i.confusion_detected) confusion_count++;
  }

  const top_tags: Record<string, number> = {};
  for (const m of memories) {
    for (const t of m.tags) {
      top_tags[t] = (top_tags[t] ?? 0) + 1;
    }
  }

  return {
    total_memories:     memories.length,
    total_interactions: interactions.length,
    mood_counts,
    top_tags,
    confusion_rate: interactions.length > 0
      ? Math.round((confusion_count / interactions.length) * 100)
      : 0,
  };
}

// ── surface_morning_memory ────────────────────────────────────────────────────

export async function surfaceMorningMemory(person_id: string): Promise<Memory | null> {
  const result = await db.send(new QueryCommand({
    TableName: TABLES.memory_graph,
    KeyConditionExpression: "person_id = :pid",
    ExpressionAttributeValues: { ":pid": person_id },
  }));

  const memories = (result.Items ?? []) as Memory[];
  if (memories.length === 0) return null;

  // Surface the least-recently-referenced memory
  memories.sort((a, b) =>
    new Date(a.last_referenced).getTime() - new Date(b.last_referenced).getTime()
  );

  const memory = memories[0];

  // Update last_referenced + reference_count
  await db.send(new PutCommand({
    TableName: TABLES.memory_graph,
    Item: {
      ...memory,
      last_referenced: new Date().toISOString(),
      reference_count: memory.reference_count + 1,
    },
  }));

  return memory;
}

// ── add_node ──────────────────────────────────────────────────────────────────

export async function addNode(
  person_id: string,
  type: MemoryNode["type"],
  name: string,
  attributes: Record<string, unknown> = {},
): Promise<MemoryNode> {
  const node: MemoryNode = {
    person_id,
    node_id:    randomUUID(),
    type,
    name,
    attributes,
    created_at: new Date().toISOString(),
  };
  await db.send(new PutCommand({ TableName: TABLES.memory_nodes, Item: node }));
  return node;
}

// ── add_edge ──────────────────────────────────────────────────────────────────

export async function addEdge(
  person_id: string,
  from_id: string,
  to_id: string,
  relationship: string,
): Promise<MemoryEdge> {
  const edge: MemoryEdge = {
    person_id,
    edge_id:      randomUUID(),
    from_id,
    to_id,
    relationship,
    created_at:   new Date().toISOString(),
  };
  await db.send(new PutCommand({ TableName: TABLES.memory_edges, Item: edge }));
  return edge;
}

// ── traverse_graph ────────────────────────────────────────────────────────────
// Given a query, find matching nodes by name, follow edges one hop,
// and return all memory_ids reachable from those nodes.

export async function traverseGraph(person_id: string, query: string): Promise<string[]> {
  const lower = query.toLowerCase();

  const nodesResult = await db.send(new QueryCommand({
    TableName: TABLES.memory_nodes,
    KeyConditionExpression: "person_id = :pid",
    ExpressionAttributeValues: { ":pid": person_id },
  }));
  const nodes = (nodesResult.Items ?? []) as MemoryNode[];

  const matchedNodeIds = nodes
    .filter((n) => lower.includes(n.name.toLowerCase()))
    .map((n) => n.node_id);

  if (matchedNodeIds.length === 0) return [];

  const edgesResult = await db.send(new QueryCommand({
    TableName: TABLES.memory_edges,
    KeyConditionExpression: "person_id = :pid",
    ExpressionAttributeValues: { ":pid": person_id },
  }));
  const edges = (edgesResult.Items ?? []) as MemoryEdge[];

  const memoryIds = new Set<string>();
  for (const edge of edges) {
    if (matchedNodeIds.includes(edge.from_id) || matchedNodeIds.includes(edge.to_id)) {
      const other = matchedNodeIds.includes(edge.from_id) ? edge.to_id : edge.from_id;
      memoryIds.add(other);
    }
  }

  return [...memoryIds];
}
