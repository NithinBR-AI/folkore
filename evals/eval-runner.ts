import "dotenv/config";

// ── Types ──────────────────────────────────────────────────────────────────────
export interface EvalResult {
  pass: boolean;
  reason: string;
  response?: string;
}

export interface EvalCase {
  id: string;
  description: string;
  run: () => Promise<EvalResult>;
}

interface SuiteResult {
  id: string;
  description: string;
  pass: boolean;
  reason: string;
  durationMs: number;
  response?: string;
}

// ── Import suites ──────────────────────────────────────────────────────────────
import { TONE_CASES }        from "./suites/tone.js";
import { RETRIEVAL_CASES }   from "./suites/retrieval.js";
import { CONFUSION_CASES }   from "./suites/confusion.js";
import { HALLUCINATION_CASES } from "./suites/hallucination.js";
import { CURATION_CASES }    from "./suites/curation.js";

const ALL_CASES: EvalCase[] = [
  ...TONE_CASES,
  ...RETRIEVAL_CASES,
  ...CONFUSION_CASES,
  ...HALLUCINATION_CASES,
  ...CURATION_CASES,
];

// ── Runner ─────────────────────────────────────────────────────────────────────
async function runAll(): Promise<void> {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║           Folkore — Behavioral Evals                ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const results: SuiteResult[] = [];

  for (const c of ALL_CASES) {
    process.stdout.write(`  ⏳ ${c.id.padEnd(12)} ${c.description.slice(0, 60)}...`);
    const start = Date.now();
    let result: EvalResult;
    try {
      result = await c.run();
    } catch (e) {
      result = { pass: false, reason: `THREW: ${(e as Error).message}` };
    }
    const durationMs = Date.now() - start;
    results.push({ id: c.id, description: c.description, ...result, durationMs });
    const icon = result.pass ? "✓" : "✗";
    process.stdout.write(`\r  ${icon} ${c.id.padEnd(12)} ${c.description.slice(0, 60).padEnd(62)} ${durationMs}ms\n`);
  }

  // ── Summary table ────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  const total  = results.length;

  console.log("\n──────────────────────────────────────────────────────");
  console.log(`  Results: ${passed}/${total} passed\n`);

  if (failed.length > 0) {
    console.log("  FAILURES:\n");
    for (const f of failed) {
      console.log(`  ✗ ${f.id} — ${f.description}`);
      console.log(`    reason:   ${f.reason}`);
      if (f.response) {
        console.log(`    response: "${f.response.slice(0, 200)}"`);
      }
      console.log();
    }
  }

  // ── Suite breakdown ───────────────────────────────────────────────────────────
  const suites: Record<string, { pass: number; total: number }> = {};
  for (const r of results) {
    const suite = r.id.split("-")[0];
    if (!suites[suite]) suites[suite] = { pass: 0, total: 0 };
    suites[suite].total++;
    if (r.pass) suites[suite].pass++;
  }

  console.log("  Suite breakdown:");
  for (const [suite, s] of Object.entries(suites)) {
    const bar = "█".repeat(s.pass) + "░".repeat(s.total - s.pass);
    console.log(`    ${suite.padEnd(8)} ${bar}  ${s.pass}/${s.total}`);
  }

  console.log("\n──────────────────────────────────────────────────────\n");

  if (failed.length > 0) process.exit(1);
}

runAll().catch((e) => { console.error("FATAL:", e); process.exit(1); });
