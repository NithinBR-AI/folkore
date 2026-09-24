import "dotenv/config";
import { addMemory, getMemory, logInteraction, getInsightSummary, surfaceMorningMemory, addNode, addEdge, traverseGraph } from "../src/server/db.js";
import { runSupervisor } from "../src/server/agents/supervisor.js";

const PERSON_ID = "smoke-test-person-001";

async function run() {
  console.log("\n=== Folkore Smoke Test ===\n");

  // 1. addMemory (via Curation Agent)
  console.log("1. addMemory (direct db)...");
  const m1 = await addMemory(PERSON_ID, "grandson Marcus", "Marcus is 8 and loves dinosaurs, wants to be a paleontologist", "Summer 2026", ["family", "grandson"], "family", "person");
  const m2 = await addMemory(PERSON_ID, "Lake Tahoe", "Dad took the family fishing at Lake Tahoe every July for 20 years", "1970s-1990s", ["place", "fishing", "family"], "family", "place");
  console.log(`   ✓ m1=${m1.memory_id.slice(0,8)} m2=${m2.memory_id.slice(0,8)}\n`);

  // 2. getMemory by ID
  console.log("2. getMemory by ID...");
  const byId = await getMemory(PERSON_ID, m1.memory_id);
  console.log(`   ✓ found: ${byId[0]?.who}\n`);

  // 3. getMemory by tag
  console.log("3. getMemory by tag (fishing)...");
  const byTag = await getMemory(PERSON_ID, undefined, "fishing");
  console.log(`   ✓ found ${byTag.length} memories with tag=fishing\n`);

  // 4. logInteraction
  console.log("4. logInteraction...");
  const i = await logInteraction(PERSON_ID, "happy", false, null, [m1.memory_id], "parent");
  console.log(`   ✓ session=${i.session_id.slice(0,8)}\n`);

  // 5. getInsightSummary
  console.log("5. getInsightSummary...");
  const summary = await getInsightSummary(PERSON_ID);
  console.log(`   ✓ memories=${summary.total_memories} interactions=${summary.total_interactions}\n`);

  // 6. surfaceMorningMemory
  console.log("6. surfaceMorningMemory...");
  const morning = await surfaceMorningMemory(PERSON_ID);
  console.log(`   ✓ surfaced: "${morning?.what?.slice(0, 60)}"\n`);

  // 7. Memory graph — addNode + addEdge + traverseGraph
  console.log("7. Memory graph — addNode + addEdge + traverseGraph...");
  const marcusNode = await addNode(PERSON_ID, "person", "Marcus", { age: 8, role: "grandson" });
  const lakeNode   = await addNode(PERSON_ID, "place",  "Lake Tahoe", {});
  await addEdge(PERSON_ID, marcusNode.node_id, m1.memory_id, "subject_of");
  await addEdge(PERSON_ID, lakeNode.node_id,   m2.memory_id, "subject_of");
  const graphIds = await traverseGraph(PERSON_ID, "tell me about Marcus");
  const lakeIds  = await traverseGraph(PERSON_ID, "Lake Tahoe fishing");
  const noMatch  = await traverseGraph(PERSON_ID, "something completely unrelated");
  console.log(`   ✓ Marcus traversal: ${graphIds.length} memory_id(s) found`);
  console.log(`   ✓ Lake Tahoe traversal: ${lakeIds.length} memory_id(s) found`);
  console.log(`   ✓ no-match traversal: ${noMatch.length} memory_ids (expected 0)\n`);

  // 8. getMemory hybrid — query should hit DynamoDB keyword + graph
  console.log("8. getMemory hybrid query...");
  const hybrid = await getMemory(PERSON_ID, undefined, undefined, "grandson Marcus dinosaurs");
  console.log(`   ✓ hybrid query returned ${hybrid.length} memories\n`);

  // 9. Conversation Agent (parent asks about grandson)
  console.log("9. Conversation Agent — parent utterance...");
  try {
    const reply = await runSupervisor({ personId: PERSON_ID, utterance: "I can't remember my grandson's name", initiatedBy: "parent" });
    console.log(`   ✓ response: "${reply.slice(0, 150)}"\n`);
  } catch (e) {
    const err = e as Error;
    console.log(`   ✗ FAILED: ${err.message}\n   cause: ${JSON.stringify((err as NodeJS.ErrnoException).cause)}\n`);
  }

  // 10. Curation Agent (family adds a memory)
  console.log("10. Curation Agent — family adds memory...");
  try {
    const reply = await runSupervisor({ personId: PERSON_ID, utterance: "Dad loves apple pie, his wife used to make it every Sunday", initiatedBy: "family", addedBy: "daughter Sarah" });
    console.log(`   ✓ response: "${reply.slice(0, 150)}"\n`);
  } catch (e) {
    console.log(`   ✗ FAILED: ${(e as Error).message}\n`);
  }

  // 11. Insight Agent
  console.log("11. Insight Agent — family checks on dad...");
  try {
    const reply = await runSupervisor({ personId: PERSON_ID, utterance: "How has dad been doing this week?", initiatedBy: "family" });
    console.log(`   ✓ response: "${reply.slice(0, 150)}"\n`);
  } catch (e) {
    console.log(`   ✗ FAILED: ${(e as Error).message}\n`);
  }

  // 12. Morning memory (system trigger)
  console.log("12. Morning memory — system trigger...");
  try {
    const reply = await runSupervisor({ personId: PERSON_ID, utterance: "", initiatedBy: "system" });
    console.log(`   ✓ response: "${reply.slice(0, 150)}"\n`);
  } catch (e) {
    console.log(`   ✗ FAILED: ${(e as Error).message}\n`);
  }

  // 13. Frank's seeded data — verify hybrid retrieval works against real seed
  console.log("13. Frank seed data — verify hybrid retrieval...");
  try {
    const frankMarcus = await getMemory("frank-henderson-001", undefined, undefined, "grandson Marcus dinosaurs");
    const frankTahoe  = await getMemory("frank-henderson-001", undefined, undefined, "Lake Tahoe fishing");
    const frankInsight = await getInsightSummary("frank-henderson-001");
    console.log(`   ✓ Marcus query: ${frankMarcus.length} memories`);
    console.log(`   ✓ Tahoe query : ${frankTahoe.length} memories`);
    console.log(`   ✓ Insight     : ${frankInsight.total_memories} memories, ${frankInsight.total_interactions} interactions, confusion_rate=${frankInsight.confusion_rate}%\n`);
  } catch (e) {
    console.log(`   ✗ FAILED: ${(e as Error).message}\n`);
  }

  console.log("=== Done ===\n");
}

run().catch((e) => { console.error("FATAL:", e); process.exit(1); });
