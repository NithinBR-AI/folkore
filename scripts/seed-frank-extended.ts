/**
 * Extended seed — Frank Henderson, second pass
 *
 * Runs AFTER seed-frank.ts. Adds richer depth: Emily's branch of the family,
 * Sarah's career, Frank's childhood, neighbourhood friends, more Dorothy
 * stories, and 14 more days of conversation logs.
 *
 * Safe to re-run — PutCommand overwrites on the same key.
 * Requires seed-frank.ts to have run first (references same PERSON_ID).
 *
 * Run: npx tsx scripts/seed-frank-extended.ts
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { addMemory, addNode, addEdge } from "../src/server/db.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const PERSON_ID = "frank-henderson-001";

const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" })
);

function ago(daysAgo: number, hour = 10): string {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  d.setHours(hour, Math.floor(Math.random() * 59), 0, 0);
  return d.toISOString();
}

async function seedExtended() {
  console.log("\n=== Extended Seed — Frank Henderson (pass 2) ===\n");

  // ── New entity nodes ─────────────────────────────────────────────────────────
  const emilyNode   = await addNode(PERSON_ID, "person", "Emily",    { role: "daughter", location: "Portland" });
  const jasonNode   = await addNode(PERSON_ID, "person", "Jason",    { role: "son-in-law", spouse_of: "Emily" });
  const lilaNode    = await addNode(PERSON_ID, "person", "Lila",     { role: "granddaughter", age: 12, parent: "Emily" });
  const coleNode    = await addNode(PERSON_ID, "person", "Cole",     { role: "grandson", age: 5, parent: "Emily" });
  const haroldNode  = await addNode(PERSON_ID, "person", "Harold",   { role: "neighbour", note: "next-door friend" });
  const arthurNode  = await addNode(PERSON_ID, "person", "Arthur",   { role: "childhood friend", location: "Sacramento" });
  const sacramentoNode = await addNode(PERSON_ID, "place", "Sacramento",    { context: "Frank grew up here" });
  const gardenNode  = await addNode(PERSON_ID, "place", "Backyard garden",  { context: "Frank's vegetable patch" });
  console.log("8 new entity nodes created\n");

  // ── Emily's branch — added by Emily herself about 5 weeks ago ────────────────
  console.log("Emily adds her family...");

  const m_emily = await addMemory(PERSON_ID, "daughter Emily",
    "Emily is Frank's younger daughter. She lives in Portland with her husband Jason and their two children.",
    "Present", ["family", "daughter", "Emily", "Portland"], "Emily", "person");

  const m_jason = await addMemory(PERSON_ID, "son-in-law Jason",
    "Jason is Emily's husband. He works as a civil engineer and is handy around the house — Frank likes him for that.",
    "Present", ["family", "son-in-law", "Jason", "Emily"], "Emily", "person");

  const m_lila = await addMemory(PERSON_ID, "granddaughter Lila",
    "Lila is 12 years old and plays violin in the school orchestra. She calls Grandpa Frank every Sunday after practice.",
    "Present", ["family", "granddaughter", "Lila", "violin", "music"], "Emily", "person");

  const m_cole = await addMemory(PERSON_ID, "grandson Cole",
    "Cole is 5 years old and obsessed with fire trucks. He once told Frank he wants to drive the biggest one in the world.",
    "Present", ["family", "grandson", "Cole", "fire trucks"], "Emily", "person");

  const m_emily_visit = await addMemory(PERSON_ID, "Emily's visits from Portland",
    "Emily drives down from Portland every Thanksgiving and Christmas. The drive takes her about six hours each way.",
    "Every Thanksgiving and Christmas", ["family", "Emily", "Portland", "visits", "holidays"], "Emily", "story");

  const m_lila_violin = await addMemory(PERSON_ID, "Lila's violin recital",
    "Lila played Vivaldi at her school winter recital in December 2025. Frank watched on a video call and clapped the whole time.",
    "December 2025", ["family", "granddaughter", "Lila", "violin", "recital"], "Emily", "event");

  await addEdge(PERSON_ID, emilyNode.node_id, m_emily.memory_id,       "subject_of");
  await addEdge(PERSON_ID, jasonNode.node_id, m_jason.memory_id,       "subject_of");
  await addEdge(PERSON_ID, lilaNode.node_id,  m_lila.memory_id,        "subject_of");
  await addEdge(PERSON_ID, coleNode.node_id,  m_cole.memory_id,        "subject_of");
  await addEdge(PERSON_ID, emilyNode.node_id, m_emily_visit.memory_id, "subject_of");
  await addEdge(PERSON_ID, lilaNode.node_id,  m_lila_violin.memory_id, "subject_of");
  console.log("   ✓ 6 memories\n");

  // ── Sarah's career depth — Sarah added this after Emily's data ───────────────
  console.log("Sarah adds her own background...");

  const m_sarah_job = await addMemory(PERSON_ID, "Sarah's career as a nurse",
    "Sarah has worked as a registered nurse at UC Davis Medical Center for 14 years. Frank is very proud of her.",
    "2010-present", ["family", "Sarah", "nurse", "career", "UC Davis"], "Sarah", "person");

  const m_sarah_nursing = await addMemory(PERSON_ID, "Frank walking Sarah to nursing school",
    "Frank drove Sarah to her first day of nursing school in 2006. He cried in the car on the way home.",
    "2006", ["family", "Sarah", "nursing school", "milestone"], "Sarah", "story");

  await addEdge(PERSON_ID, emilyNode.node_id, m_sarah_job.memory_id, "subject_of");
  console.log("   ✓ 2 memories\n");

  // ── Dorothy — deeper memories added by Robert ─────────────────────────────────
  console.log("Robert adds richer Dorothy memories...");

  const m_dorothy_garden = await addMemory(PERSON_ID, "Dorothy's rose garden",
    "Dorothy kept a rose garden in the back yard for 40 years. She won the neighbourhood garden prize three times.",
    "1970s-2019", ["family", "Dorothy", "garden", "roses"], "Robert", "story");

  const m_dorothy_christmas = await addMemory(PERSON_ID, "Dorothy's Christmas ornaments",
    "Dorothy had a box of glass ornaments she'd collected since 1967. Every Christmas Eve she and Frank hung them together.",
    "Every Christmas Eve", ["family", "Dorothy", "Christmas", "tradition"], "Robert", "story");

  const m_dorothy_letters = await addMemory(PERSON_ID, "letters Dorothy wrote to Frank in the Army",
    "Dorothy wrote Frank a letter every week while he was stationed in Germany. He still has the letters in a shoebox.",
    "1968-1970", ["family", "Dorothy", "letters", "army", "love story"], "Robert", "story");

  const m_anniversary = await addMemory(PERSON_ID, "Frank and Dorothy's 50th anniversary",
    "For their 50th anniversary in 2018, the whole family surprised Frank and Dorothy with a party at the Tahoe lakehouse. Dorothy wore her wedding dress. It still fit.",
    "August 2018", ["family", "Dorothy", "anniversary", "Lake Tahoe", "milestone"], "Robert", "event");

  await addEdge(PERSON_ID, gardenNode.node_id, m_dorothy_garden.memory_id, "subject_of");
  console.log("   ✓ 4 memories\n");

  // ── Frank's childhood — Robert dug these out of old family albums ─────────────
  console.log("Robert adds childhood history...");

  const m_childhood_sacramento = await addMemory(PERSON_ID, "Frank's childhood in Sacramento",
    "Frank grew up on Maple Street in Sacramento. His father worked at the railroad and his mother was a seamstress.",
    "1948-1966", ["childhood", "Sacramento", "family history", "parents"], "Robert", "person");

  const m_arthur = await addMemory(PERSON_ID, "childhood friend Arthur",
    "Arthur was Frank's best friend from age 6. They went to the same school, played Little League together, and Arthur was the best man at Frank and Dorothy's wedding.",
    "1954 onwards", ["childhood", "friend", "Arthur", "Sacramento", "wedding"], "Robert", "story");

  const m_grandfather_plane = await addMemory(PERSON_ID, "grandfather's hand plane",
    "Frank's father gave him a hand plane the day he graduated high school in 1966. Frank still uses it in his workshop and says it cuts better than anything he's bought since.",
    "1966", ["family history", "woodworking", "tools", "father", "graduation"], "Robert", "story");

  await addEdge(PERSON_ID, sacramentoNode.node_id, m_childhood_sacramento.memory_id, "subject_of");
  await addEdge(PERSON_ID, arthurNode.node_id,     m_arthur.memory_id,               "subject_of");
  console.log("   ✓ 3 memories\n");

  // ── Neighbourhood — Sarah added these after noticing Frank mention Harold ─────
  console.log("Sarah adds neighbourhood context...");

  const m_harold = await addMemory(PERSON_ID, "neighbour Harold",
    "Harold lives next door and has known Frank for 30 years. They have coffee on Harold's porch every Tuesday morning.",
    "30 years", ["neighbour", "Harold", "friendship", "coffee"], "Sarah", "person");

  const m_harold_checkers = await addMemory(PERSON_ID, "checkers with Harold",
    "Harold and Frank play checkers after coffee. Harold claims a 6-game winning streak; Frank says Harold miscounted.",
    "Every Tuesday", ["neighbour", "Harold", "checkers", "friendship"], "Sarah", "story");

  const m_garden_tomatoes = await addMemory(PERSON_ID, "Frank's tomatoes",
    "Frank grows heirloom tomatoes — Brandywine and Cherokee Purple. He brings a bag to Harold every August and saves seeds for next year.",
    "Every August", ["hobby", "gardening", "tomatoes", "Harold", "neighbours"], "Sarah", "preference");

  await addEdge(PERSON_ID, haroldNode.node_id, m_harold.memory_id,          "subject_of");
  await addEdge(PERSON_ID, haroldNode.node_id, m_harold_checkers.memory_id, "subject_of");
  await addEdge(PERSON_ID, gardenNode.node_id, m_garden_tomatoes.memory_id, "subject_of");
  console.log("   ✓ 3 memories\n");

  // ── Frank's teaching stories — Emily added these after talking to old students ─
  console.log("Emily adds teaching stories...");

  const m_teaching_style = await addMemory(PERSON_ID, "Frank's teaching style",
    "Frank believed every child could learn if you found the right angle. He kept a jar of marbles on his desk — one for each student — and moved them when someone had a breakthrough.",
    "1975-2010", ["teaching", "Roosevelt", "children", "philosophy"], "Emily", "story");

  const m_student_letter = await addMemory(PERSON_ID, "letter from a former student",
    "In 2022 a former student named Cynthia tracked Frank down and wrote him a letter. She said his class was the reason she became a doctor. The letter is framed in the hallway.",
    "2022", ["teaching", "Roosevelt", "students", "achievement"], "Emily", "event");

  await addEdge(PERSON_ID, emilyNode.node_id, m_teaching_style.memory_id, "subject_of");
  await addEdge(PERSON_ID, emilyNode.node_id, m_student_letter.memory_id, "subject_of");
  console.log("   ✓ 2 memories\n");

  // ── Extended conversation logs — days 15-28 (earlier period) ─────────────────
  console.log("Seeding 14 additional conversation log entries (days 15-28)...");

  type LogRow = {
    daysAgo: number; hour: number;
    mood: "happy" | "calm" | "confused" | "sad" | "anxious";
    confusion_detected: boolean;
    confusion_type: "temporal" | "person" | "place" | null;
    memories: string[];
    initiated_by: "parent" | "alexa";
  };

  const logs: LogRow[] = [
    { daysAgo: 28, hour: 9,  mood: "happy",    confusion_detected: false, confusion_type: null,       memories: [m_lila.memory_id],              initiated_by: "alexa"  },
    { daysAgo: 28, hour: 18, mood: "calm",     confusion_detected: false, confusion_type: null,       memories: [m_emily.memory_id],             initiated_by: "parent" },
    { daysAgo: 27, hour: 9,  mood: "calm",     confusion_detected: false, confusion_type: null,       memories: [m_harold.memory_id],            initiated_by: "parent" },
    { daysAgo: 27, hour: 20, mood: "confused", confusion_detected: true,  confusion_type: "person",   memories: [m_arthur.memory_id],            initiated_by: "parent" },
    { daysAgo: 26, hour: 10, mood: "happy",    confusion_detected: false, confusion_type: null,       memories: [m_dorothy_christmas.memory_id], initiated_by: "alexa"  },
    { daysAgo: 26, hour: 15, mood: "sad",      confusion_detected: false, confusion_type: null,       memories: [m_dorothy_letters.memory_id],   initiated_by: "parent" },
    { daysAgo: 25, hour: 9,  mood: "calm",     confusion_detected: false, confusion_type: null,       memories: [m_harold_checkers.memory_id],   initiated_by: "alexa"  },
    { daysAgo: 25, hour: 19, mood: "confused", confusion_detected: true,  confusion_type: "temporal", memories: [],                              initiated_by: "parent" },
    { daysAgo: 24, hour: 10, mood: "happy",    confusion_detected: false, confusion_type: null,       memories: [m_anniversary.memory_id],       initiated_by: "parent" },
    { daysAgo: 24, hour: 14, mood: "calm",     confusion_detected: false, confusion_type: null,       memories: [m_teaching_style.memory_id],    initiated_by: "alexa"  },
    { daysAgo: 23, hour: 9,  mood: "anxious",  confusion_detected: false, confusion_type: null,       memories: [],                              initiated_by: "parent" },
    { daysAgo: 23, hour: 20, mood: "confused", confusion_detected: true,  confusion_type: "place",    memories: [m_childhood_sacramento.memory_id], initiated_by: "parent" },
    { daysAgo: 22, hour: 8,  mood: "happy",    confusion_detected: false, confusion_type: null,       memories: [m_cole.memory_id, m_lila.memory_id], initiated_by: "alexa" },
    { daysAgo: 21, hour: 9,  mood: "calm",     confusion_detected: false, confusion_type: null,       memories: [m_garden_tomatoes.memory_id],   initiated_by: "parent" },
  ];

  for (const row of logs) {
    await dynamo.send(new PutCommand({
      TableName: "folkore_conversation_log",
      Item: {
        person_id:           PERSON_ID,
        session_id:          randomUUID(),
        mood:                row.mood,
        confusion_detected:  row.confusion_detected,
        confusion_type:      row.confusion_type,
        memories_referenced: row.memories,
        initiated_by:        row.initiated_by,
        created_at:          ago(row.daysAgo, row.hour),
      },
    }));
  }
  console.log(`   ✓ ${logs.length} additional log entries\n`);

  // ── Emily as a family contact receiving the weekly digest ─────────────────────
  console.log("Adding Emily to family contacts...");
  await dynamo.send(new PutCommand({
    TableName: "folkore_family_contacts",
    Item: {
      person_id:     PERSON_ID,
      contact_id:    randomUUID(),
      name:          "Emily Henderson-Clark",
      email:         "emily.henderson.clark@example.com",
      relationship:  "daughter",
      weekly_digest: true,
      created_at:    ago(35),
    },
  }));
  console.log("   ✓ 1 contact (Emily, weekly digest on)\n");

  console.log("=== Extended seed complete ===");
  console.log(`   New memories : 20`);
  console.log(`   New nodes    : 8`);
  console.log(`   New edges    : 14`);
  console.log(`   New log rows : ${logs.length}`);
  console.log(`   New contacts : 1`);
  console.log(`\n   Run after: npx tsx scripts/seed-frank.ts`);
  console.log(`   Then:       npx tsx scripts/seed-frank-extended.ts\n`);
}

seedExtended().catch((e) => { console.error("FATAL:", e); process.exit(1); });
