import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const db = DynamoDBDocumentClient.from(client);

const TABLES = {
  person_profile:    "folkore_person_profile",
  memory_graph:      "folkore_memory_graph",
  conversation_log:  "folkore_conversation_log",
  family_contacts:   "folkore_family_contacts",
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
  return memory;
}

// ── get_memory ────────────────────────────────────────────────────────────────

export async function getMemory(person_id: string, memory_id?: string, tag?: string): Promise<Memory[]> {
  if (memory_id) {
    const result = await db.send(new GetCommand({
      TableName: TABLES.memory_graph,
      Key: { person_id, memory_id },
    }));
    return result.Item ? [result.Item as Memory] : [];
  }

  const result = await db.send(new QueryCommand({
    TableName: TABLES.memory_graph,
    KeyConditionExpression: "person_id = :pid",
    ExpressionAttributeValues: { ":pid": person_id },
  }));

  const items = (result.Items ?? []) as Memory[];
  if (tag) return items.filter((m) => m.tags.includes(tag));
  return items;
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
