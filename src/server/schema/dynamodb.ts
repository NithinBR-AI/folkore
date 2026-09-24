/**
 * Folkore DynamoDB table definitions.
 * Use with AWS CDK or the AWS CLI to provision tables before deploying.
 */

export const tables = {

  /**
   * person_profile
   * One record per elderly parent being monitored.
   */
  person_profile: {
    TableName: "folkore_person_profile",
    BillingMode: "PAY_PER_REQUEST",
    KeySchema: [
      { AttributeName: "person_id", KeyType: "HASH" },
    ],
    AttributeDefinitions: [
      { AttributeName: "person_id", AttributeType: "S" },
    ],
    // Fields stored per item (not declared in KeySchema):
    // - name: string
    // - age: number
    // - baseline_year: number  (what year they typically think it is — for confusion detection)
    // - family_group_id: string
    // - created_at: string (ISO8601)
  },

  /**
   * memory_graph
   * Family-curated memories for a parent. One record per memory entry.
   */
  memory_graph: {
    TableName: "folkore_memory_graph",
    BillingMode: "PAY_PER_REQUEST",
    KeySchema: [
      { AttributeName: "person_id", KeyType: "HASH" },
      { AttributeName: "memory_id", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "person_id", AttributeType: "S" },
      { AttributeName: "memory_id", AttributeType: "S" },
    ],
    // Fields stored per item:
    // - type: "person" | "place" | "event" | "preference" | "story"
    // - who: string              (person or subject of the memory)
    // - what: string             (the memory content)
    // - when: string             (freeform timeframe, e.g. "Summer 1985")
    // - tags: string[]           (e.g. ["family", "fishing"])
    // - added_by: string         (family member name)
    // - last_referenced: string  (ISO8601 — used by surface_morning_memory rotation)
    // - reference_count: number
    // - created_at: string
  },

  /**
   * conversation_log
   * Structured signals extracted from each Alexa interaction session.
   * Raw transcripts are NOT stored — only extracted metadata.
   */
  conversation_log: {
    TableName: "folkore_conversation_log",
    BillingMode: "PAY_PER_REQUEST",
    KeySchema: [
      { AttributeName: "person_id", KeyType: "HASH" },
      { AttributeName: "session_id", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "person_id", AttributeType: "S" },
      { AttributeName: "session_id", AttributeType: "S" },
    ],
    // Fields stored per item:
    // - mood: "happy" | "calm" | "confused" | "sad" | "anxious"
    // - confusion_detected: boolean
    // - confusion_type: "temporal" | "person" | "place" | null
    // - memories_referenced: string[]  (memory_ids surfaced in this session)
    // - initiated_by: "parent" | "alexa"
    // - session_duration_seconds: number
    // - created_at: string
    // NOTE: No raw transcript stored — privacy by design.
  },

  /**
   * family_contacts
   * Family members who receive insight digests and alerts via SNS.
   */
  family_contacts: {
    TableName: "folkore_family_contacts",
    BillingMode: "PAY_PER_REQUEST",
    KeySchema: [
      { AttributeName: "person_id", KeyType: "HASH" },
      { AttributeName: "contact_id", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "person_id", AttributeType: "S" },
      { AttributeName: "contact_id", AttributeType: "S" },
    ],
    // Fields stored per item:
    // - name: string
    // - relationship: string  (e.g. "daughter", "son")
    // - phone: string         (for SNS SMS)
    // - email: string         (for SNS email)
    // - notify_on: ("weekly_digest" | "confusion_alert" | "silence_alert")[]
    // - created_at: string
  },

  /**
   * memory_nodes
   * Named entities in the parent's world — people, places, events.
   * Nodes are the vertices of the memory graph.
   */
  memory_nodes: {
    TableName: "folkore_memory_nodes",
    BillingMode: "PAY_PER_REQUEST",
    KeySchema: [
      { AttributeName: "person_id", KeyType: "HASH" },
      { AttributeName: "node_id",   KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "person_id", AttributeType: "S" },
      { AttributeName: "node_id",   AttributeType: "S" },
    ],
    // Fields stored per item:
    // - type: "person" | "place" | "event"
    // - name: string              (e.g. "Marcus", "Lake Tahoe")
    // - attributes: object        (e.g. { age: 8, role: "grandson" })
    // - created_at: string
  },

  /**
   * memory_edges
   * Typed relationships between nodes and/or memories.
   * Edges are the connections that make the graph traversable.
   */
  memory_edges: {
    TableName: "folkore_memory_edges",
    BillingMode: "PAY_PER_REQUEST",
    KeySchema: [
      { AttributeName: "person_id", KeyType: "HASH" },
      { AttributeName: "edge_id",   KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "person_id", AttributeType: "S" },
      { AttributeName: "edge_id",   AttributeType: "S" },
    ],
    // Fields stored per item:
    // - from_id: string           (node_id or memory_id)
    // - to_id: string             (node_id or memory_id)
    // - relationship: string      (e.g. "grandson_of", "spouse_of", "attended", "lives_at", "loves")
    // - created_at: string
  },

} as const;
