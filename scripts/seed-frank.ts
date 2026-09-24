/**
 * Seed script — Frank Henderson persona
 *
 * Simulates a family naturally adding memories over 6 weeks, not a bulk dump.
 * Batches are separated by realistic time gaps — Sarah adds family first,
 * Robert calls and adds his angle, Marcus visits, preferences trickle in last.
 *
 * Run once: npx tsx scripts/seed-frank.ts
 * Safe to re-run — PutCommand overwrites on same person_id.
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

// Returns an ISO timestamp N days ago at a given hour — makes logs look organic
function ago(daysAgo: number, hour = 10): string {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  d.setHours(hour, Math.floor(Math.random() * 59), 0, 0);
  return d.toISOString();
}

async function seed() {
  console.log("\n=== Seeding Frank Henderson ===\n");

  // ── Person profile (day 42 — Sarah set this up 6 weeks ago) ───────────────
  await dynamo.send(new PutCommand({
    TableName: "folkore_person_profile",
    Item: {
      person_id:       PERSON_ID,
      name:            "Frank Henderson",
      age:             78,
      baseline_year:   1985,
      condition_notes: "Mild-to-moderate memory loss, progressing over 2 years. Lucid in mornings, more confused in evenings.",
      family_group_id: "henderson-family-001",
      created_at:      ago(42),
    },
  }));
  console.log("Profile created (6 weeks ago)\n");

  // ── Entity nodes — created up front so edges can reference them ───────────
  const marcusNode    = await addNode(PERSON_ID, "person", "Marcus",    { age: 8, role: "grandson", hobby: "dinosaurs" });
  const margaretNode  = await addNode(PERSON_ID, "person", "Margaret",  { role: "sister", location: "Portland" });
  const dorothyNode   = await addNode(PERSON_ID, "person", "Dorothy",   { role: "wife", status: "passed 2019" });
  const sarahNode     = await addNode(PERSON_ID, "person", "Sarah",     { role: "daughter", location: "Sacramento" });
  const robertNode    = await addNode(PERSON_ID, "person", "Robert",    { role: "son", location: "Chicago" });
  const tahoeNode     = await addNode(PERSON_ID, "place",  "Lake Tahoe",      { activity: "fishing" });
  const germanyNode   = await addNode(PERSON_ID, "place",  "Germany",         { context: "Army 1968-1970" });
  const rooseveltNode = await addNode(PERSON_ID, "place",  "Roosevelt Elementary", { context: "Taught 4th grade 35 yrs" });
  console.log("8 entity nodes created\n");

  // ── WEEK 6 AGO — Sarah sets up Folkore, adds immediate family first ────────
  console.log("Week 6: Sarah adds immediate family...");

  const m_sarah = await addMemory(PERSON_ID, "daughter Sarah",
    "Sarah is Frank's daughter. She lives nearby in Sacramento and checks in every week.",
    "Present", ["family", "daughter", "Sarah", "Sacramento"], "Sarah", "person");

  const m_marcus1 = await addMemory(PERSON_ID, "grandson Marcus",
    "Marcus is 8 years old and absolutely loves dinosaurs. He wants to be a paleontologist when he grows up.",
    "Summer 2026", ["family", "grandson", "dinosaurs"], "Sarah", "person");

  const m_dorothy1 = await addMemory(PERSON_ID, "wife Dorothy",
    "Dorothy was Frank's wife of 52 years. She passed away in March 2019 from heart failure.",
    "March 2019", ["family", "wife", "Dorothy"], "Sarah", "person");

  const m_dorothy2 = await addMemory(PERSON_ID, "wife Dorothy",
    "Dorothy made apple pie every Sunday. It was Frank's favorite. The whole house smelled like cinnamon.",
    "Every Sunday for 50 years", ["family", "wife", "Dorothy", "apple pie", "Sunday"], "Sarah", "story");

  await addEdge(PERSON_ID, sarahNode.node_id,   m_sarah.memory_id,    "subject_of");
  await addEdge(PERSON_ID, marcusNode.node_id,  m_marcus1.memory_id,  "subject_of");
  await addEdge(PERSON_ID, dorothyNode.node_id, m_dorothy1.memory_id, "subject_of");
  await addEdge(PERSON_ID, dorothyNode.node_id, m_dorothy2.memory_id, "subject_of");
  console.log("   ✓ 4 memories\n");

  // ── WEEK 5 AGO — Robert calls Sunday, adds memories from his angle ─────────
  console.log("Week 5: Robert adds memories from Chicago...");

  const m_robert = await addMemory(PERSON_ID, "son Robert",
    "Robert is Frank's son. He lives in Chicago and calls every Sunday night.",
    "Present", ["family", "son", "Robert", "Chicago"], "Robert", "person");

  const m_army1 = await addMemory(PERSON_ID, "Army service in Germany",
    "Frank served in the US Army from 1968 to 1970, stationed in Frankfurt, Germany. He was a supply clerk.",
    "1968-1970", ["army", "Germany", "service", "Frankfurt"], "Robert", "event");

  const m_army2 = await addMemory(PERSON_ID, "Army buddy Eddie",
    "Frank made his best friend Eddie in the Army. They stayed close for 40 years until Eddie passed in 2012.",
    "1968 onwards", ["army", "Germany", "friendship", "Eddie"], "Robert", "story");

  const m_littleleague = await addMemory(PERSON_ID, "coaching Robert's Little League",
    "Frank coached Robert's Little League team for 6 years. Robert was the pitcher. They won the city championship in 1991.",
    "1985-1991", ["family", "Robert", "baseball", "Little League", "championship"], "Robert", "story");

  await addEdge(PERSON_ID, robertNode.node_id, m_robert.memory_id,      "subject_of");
  await addEdge(PERSON_ID, germanyNode.node_id, m_army1.memory_id,      "subject_of");
  await addEdge(PERSON_ID, germanyNode.node_id, m_army2.memory_id,      "subject_of");
  await addEdge(PERSON_ID, robertNode.node_id,  m_littleleague.memory_id, "subject_of");
  console.log("   ✓ 4 memories\n");

  // ── WEEK 4 AGO — Sarah visits Frank in person, hears stories, types them in ─
  console.log("Week 4: Sarah visits, adds what Frank told her...");

  const m_tahoe1 = await addMemory(PERSON_ID, "Lake Tahoe fishing trips",
    "Frank took the family fishing at Lake Tahoe every July for 20 years. He called it his happy place.",
    "1970s-1990s", ["place", "fishing", "family", "Lake Tahoe", "summer"], "Sarah", "place");

  const m_tahoe2 = await addMemory(PERSON_ID, "12-pound trout at Lake Tahoe",
    "Frank caught a 12-pound trout at Lake Tahoe in 1983. He still talks about it like it happened last week.",
    "Summer 1983", ["place", "fishing", "Lake Tahoe", "trout"], "Sarah", "event");

  const m_woodwork1 = await addMemory(PERSON_ID, "woodworking — the dining table",
    "Frank built the family dining table in his garage in 1982. The family still uses it for every holiday.",
    "1982", ["hobby", "woodworking", "dining table", "garage"], "Sarah", "preference");

  const m_school1 = await addMemory(PERSON_ID, "Roosevelt Elementary",
    "Frank taught 4th grade at Roosevelt Elementary for 35 years and retired in 2010.",
    "1975-2010", ["teaching", "Roosevelt", "school", "career"], "Sarah", "place");

  await addEdge(PERSON_ID, tahoeNode.node_id,     m_tahoe1.memory_id,  "subject_of");
  await addEdge(PERSON_ID, tahoeNode.node_id,     m_tahoe2.memory_id,  "subject_of");
  await addEdge(PERSON_ID, rooseveltNode.node_id, m_school1.memory_id, "subject_of");
  console.log("   ✓ 4 memories\n");

  // ── WEEK 3 AGO — Marcus visits on a weekend, Sarah adds it after ───────────
  console.log("Week 3: Marcus visits, Sarah adds memories...");

  const m_marcus2 = await addMemory(PERSON_ID, "grandson Marcus visits",
    "Marcus visits every other weekend. He always brings a new dinosaur fact to share with Grandpa Frank.",
    "2025-2026", ["family", "grandson", "visits", "dinosaurs"], "Sarah", "story");

  const m_marcus3 = await addMemory(PERSON_ID, "Marcus's dinosaur school project",
    "Marcus has a big dinosaur school project due in October 2026. He wants to tell Grandpa all about it.",
    "October 2026", ["family", "grandson", "school", "dinosaurs", "project"], "Sarah", "event");

  const m_dorothy3 = await addMemory(PERSON_ID, "Dorothy and Frank dancing",
    "Dorothy taught Frank to dance in the living room. They danced at every family wedding.",
    "1970s onwards", ["family", "wife", "Dorothy", "dancing"], "Sarah", "story");

  await addEdge(PERSON_ID, marcusNode.node_id,  m_marcus2.memory_id,  "subject_of");
  await addEdge(PERSON_ID, marcusNode.node_id,  m_marcus3.memory_id,  "subject_of");
  await addEdge(PERSON_ID, dorothyNode.node_id, m_dorothy3.memory_id, "subject_of");
  console.log("   ✓ 3 memories\n");

  // ── WEEK 2 AGO — Robert calls again, shares family history he remembers ────
  console.log("Week 2: Robert adds deeper history...");

  const m_margaret1 = await addMemory(PERSON_ID, "sister Margaret",
    "Margaret is Frank's younger sister. They grew up together in Sacramento and were very close.",
    "Childhood", ["family", "sister", "Margaret", "Sacramento"], "Robert", "person");

  const m_margaret2 = await addMemory(PERSON_ID, "Margaret in Portland",
    "Margaret moved to Portland in 1978 when she married Bill. Frank and she used to call every Sunday.",
    "1978 onwards", ["family", "sister", "Margaret", "Portland"], "Robert", "story");

  const m_school2 = await addMemory(PERSON_ID, "Teacher of the Year award",
    "Frank won Teacher of the Year three times at Roosevelt Elementary — 1985, 1994, and 2003. The plaques are in his study.",
    "1985, 1994, 2003", ["teaching", "Roosevelt", "award", "achievement"], "Robert", "event");

  const m_proposal = await addMemory(PERSON_ID, "how Frank proposed to Dorothy",
    "Frank proposed to Dorothy at the Sacramento State Fair in 1966 on the Ferris wheel. She said yes before it stopped.",
    "1966", ["family", "Dorothy", "proposal", "Sacramento", "love story"], "Robert", "story");

  await addEdge(PERSON_ID, margaretNode.node_id,  m_margaret1.memory_id, "subject_of");
  await addEdge(PERSON_ID, margaretNode.node_id,  m_margaret2.memory_id, "subject_of");
  await addEdge(PERSON_ID, rooseveltNode.node_id, m_school2.memory_id,   "subject_of");
  await addEdge(PERSON_ID, dorothyNode.node_id,   m_proposal.memory_id,  "subject_of");
  console.log("   ✓ 4 memories\n");

  // ── WEEK 1 AGO — Sarah adds softer everyday detail after a quiet Sunday ────
  console.log("Week 1: Sarah adds preferences and small details...");

  const m_woodwork2 = await addMemory(PERSON_ID, "woodworking tools",
    "Frank has a workshop in the garage with all his tools. His favorite is an old hand plane his father gave him.",
    "Lifelong", ["hobby", "woodworking", "tools", "garage"], "Sarah", "preference");

  const m_baseball = await addMemory(PERSON_ID, "San Francisco Giants",
    "Frank has followed the San Francisco Giants since 1962. They always watched the World Series together as a family.",
    "Since 1962", ["hobby", "baseball", "Giants", "sports"], "Sarah", "preference");

  const m_music = await addMemory(PERSON_ID, "big band music — Frank Sinatra",
    "Frank loves big band music from the 1940s and 50s. Frank Sinatra is his absolute favorite.",
    "Lifelong", ["hobby", "music", "Sinatra", "big band"], "Sarah", "preference");

  const m_garden = await addMemory(PERSON_ID, "vegetable garden",
    "Frank tends a vegetable garden every spring — tomatoes, zucchini, and peppers. It calms him down.",
    "Every spring", ["hobby", "gardening", "tomatoes", "vegetables"], "Sarah", "preference");

  const m_retirement = await addMemory(PERSON_ID, "Frank's retirement scrapbook",
    "When Frank retired in 2010, his students gave him a scrapbook with letters from every class he ever taught. He keeps it by his chair.",
    "2010", ["teaching", "retirement", "Roosevelt", "students"], "Sarah", "story");

  await addEdge(PERSON_ID, rooseveltNode.node_id, m_retirement.memory_id, "subject_of");
  console.log("   ✓ 5 memories\n");

  // ── Conversation logs — 14 days, 2 per day, morning + evening pattern ──────
  // Mornings: Alexa proactive trigger, usually calm/happy
  // Evenings: family-initiated, more confusion episodes (sundowning pattern)
  console.log("Seeding 14 days of conversation logs...");

  type LogRow = {
    daysAgo: number; hour: number;
    mood: "happy" | "calm" | "confused" | "sad" | "anxious";
    confusion_detected: boolean;
    confusion_type: "temporal" | "person" | "place" | null;
    memories: string[];
    initiated_by: "parent" | "alexa";
  };

  const logs: LogRow[] = [
    { daysAgo: 14, hour: 9,  mood: "happy",    confusion_detected: false, confusion_type: null,       memories: [m_tahoe1.memory_id],          initiated_by: "alexa"  },
    { daysAgo: 14, hour: 19, mood: "calm",     confusion_detected: false, confusion_type: null,       memories: [m_marcus1.memory_id],         initiated_by: "parent" },
    { daysAgo: 13, hour: 8,  mood: "calm",     confusion_detected: false, confusion_type: null,       memories: [m_dorothy2.memory_id],        initiated_by: "alexa"  },
    { daysAgo: 13, hour: 20, mood: "confused", confusion_detected: true,  confusion_type: "temporal", memories: [],                            initiated_by: "parent" },
    { daysAgo: 12, hour: 9,  mood: "happy",    confusion_detected: false, confusion_type: null,       memories: [m_baseball.memory_id],        initiated_by: "parent" },
    { daysAgo: 12, hour: 18, mood: "confused", confusion_detected: true,  confusion_type: "person",   memories: [m_margaret1.memory_id],       initiated_by: "parent" },
    { daysAgo: 11, hour: 10, mood: "calm",     confusion_detected: false, confusion_type: null,       memories: [m_school1.memory_id],         initiated_by: "alexa"  },
    { daysAgo: 11, hour: 15, mood: "happy",    confusion_detected: false, confusion_type: null,       memories: [m_marcus2.memory_id],         initiated_by: "parent" },
    { daysAgo: 10, hour: 9,  mood: "sad",      confusion_detected: false, confusion_type: null,       memories: [m_dorothy1.memory_id],        initiated_by: "parent" },
    { daysAgo: 10, hour: 21, mood: "confused", confusion_detected: true,  confusion_type: "temporal", memories: [],                            initiated_by: "parent" },
    { daysAgo: 9,  hour: 10, mood: "calm",     confusion_detected: false, confusion_type: null,       memories: [m_army1.memory_id],           initiated_by: "alexa"  },
    { daysAgo: 9,  hour: 14, mood: "happy",    confusion_detected: false, confusion_type: null,       memories: [m_music.memory_id],           initiated_by: "parent" },
    { daysAgo: 8,  hour: 9,  mood: "calm",     confusion_detected: false, confusion_type: null,       memories: [m_tahoe2.memory_id],          initiated_by: "alexa"  },
    { daysAgo: 8,  hour: 19, mood: "confused", confusion_detected: true,  confusion_type: "person",   memories: [m_margaret1.memory_id],       initiated_by: "parent" },
    { daysAgo: 7,  hour: 8,  mood: "happy",    confusion_detected: false, confusion_type: null,       memories: [m_marcus3.memory_id],         initiated_by: "alexa"  },
    { daysAgo: 7,  hour: 16, mood: "calm",     confusion_detected: false, confusion_type: null,       memories: [m_littleleague.memory_id],    initiated_by: "parent" },
    { daysAgo: 6,  hour: 9,  mood: "anxious",  confusion_detected: false, confusion_type: null,       memories: [],                            initiated_by: "parent" },
    { daysAgo: 6,  hour: 20, mood: "confused", confusion_detected: true,  confusion_type: "temporal", memories: [],                            initiated_by: "parent" },
    { daysAgo: 5,  hour: 10, mood: "calm",     confusion_detected: false, confusion_type: null,       memories: [m_dorothy3.memory_id],        initiated_by: "alexa"  },
    { daysAgo: 5,  hour: 14, mood: "happy",    confusion_detected: false, confusion_type: null,       memories: [m_proposal.memory_id],        initiated_by: "parent" },
    { daysAgo: 4,  hour: 9,  mood: "calm",     confusion_detected: false, confusion_type: null,       memories: [m_garden.memory_id],          initiated_by: "parent" },
    { daysAgo: 4,  hour: 18, mood: "confused", confusion_detected: true,  confusion_type: "person",   memories: [m_margaret2.memory_id],       initiated_by: "parent" },
    { daysAgo: 3,  hour: 9,  mood: "happy",    confusion_detected: false, confusion_type: null,       memories: [m_marcus1.memory_id, m_marcus3.memory_id], initiated_by: "parent" },
    { daysAgo: 3,  hour: 15, mood: "calm",     confusion_detected: false, confusion_type: null,       memories: [m_school2.memory_id],         initiated_by: "alexa"  },
    { daysAgo: 2,  hour: 9,  mood: "calm",     confusion_detected: false, confusion_type: null,       memories: [m_retirement.memory_id],      initiated_by: "alexa"  },
    { daysAgo: 2,  hour: 20, mood: "confused", confusion_detected: true,  confusion_type: "temporal", memories: [],                            initiated_by: "parent" },
    { daysAgo: 1,  hour: 8,  mood: "happy",    confusion_detected: false, confusion_type: null,       memories: [m_tahoe1.memory_id, m_army1.memory_id], initiated_by: "alexa" },
    { daysAgo: 0,  hour: 9,  mood: "calm",     confusion_detected: false, confusion_type: null,       memories: [m_marcus2.memory_id],         initiated_by: "parent" },
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
  console.log(`   ✓ ${logs.length} log entries\n`);

  console.log("=== Seed complete ===");
  console.log(`   person_id  : ${PERSON_ID}`);
  console.log(`   Memories   : 24`);
  console.log(`   Nodes      : 8`);
  console.log(`   Edges      : 20`);
  console.log(`   Log entries: ${logs.length}`);
  console.log(`\n   Demo person_id: ${PERSON_ID}\n`);
}

seed().catch((e) => { console.error("FATAL:", e); process.exit(1); });
