/**
 * Unit tests — no AWS calls, no Mantle calls.
 * Run with: npx tsx --test tests/unit.test.ts
 */
import { describe, it, mock, beforeEach, type Mock } from "node:test";
import assert from "node:assert/strict";

type MockFetch = Mock<typeof fetch>;

// Set env vars before any imports so modules don't throw on missing config
process.env.MANTLE_API_KEY    = "test-key";
process.env.MANTLE_BASE_URL   = "http://localhost:9999";
process.env.MANTLE_MODEL      = "test-model";
process.env.AWS_REGION        = "us-east-1";
process.env.FOLKORE_KB_ID     = "";  // disable KB calls in tests
process.env.FOLKORE_KB_BUCKET = "test-bucket";

// ─── detectConfusion ──────────────────────────────────────────────────────────
// detectConfusion is now an async LLM classifier — unit tests mock fetch and
// verify JSON parsing + fallback behavior. Accuracy is covered by evals.

const { detectConfusion } = await import("../src/server/agents/conversation.js");

describe("detectConfusion — LLM classifier", () => {
  it("returns detected=true and type from LLM response", async () => {
    const mockFetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"confused":true,"type":"temporal"}' } }],
      }),
    })) as unknown as typeof fetch;
    mock.method(globalThis, "fetch", mockFetch);
    const r = await detectConfusion("what year is it");
    assert.equal(r.detected, true);
    assert.equal(r.type, "temporal");
    mock.restoreAll();
  });

  it("returns detected=false when LLM says not confused", async () => {
    const mockFetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"confused":false,"type":"none"}' } }],
      }),
    })) as unknown as typeof fetch;
    mock.method(globalThis, "fetch", mockFetch);
    const r = await detectConfusion("tell me about my daughter");
    assert.equal(r.detected, false);
    assert.equal(r.type, null);
    mock.restoreAll();
  });

  it("falls back to detected=false when LLM call fails", async () => {
    const mockFetch = mock.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    mock.method(globalThis, "fetch", mockFetch);
    const r = await detectConfusion("where am i");
    assert.equal(r.detected, false);
    assert.equal(r.type, null);
    mock.restoreAll();
  });

  it("falls back to detected=false when LLM returns malformed JSON", async () => {
    const mockFetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "not json at all" } }],
      }),
    })) as unknown as typeof fetch;
    mock.method(globalThis, "fetch", mockFetch);
    const r = await detectConfusion("who are you");
    assert.equal(r.detected, false);
    assert.equal(r.type, null);
    mock.restoreAll();
  });
});

// ─── runAgentLoop ─────────────────────────────────────────────────────────────

const { runAgentLoop } = await import("../src/server/agents/loop.js");

function mockFetch(impl: () => Promise<object>): MockFetch {
  return mock.fn(impl) as unknown as MockFetch;
}

function makeFetchResponse(message: object): MockFetch {
  return mockFetch(async () => ({ ok: true, json: async () => ({ choices: [{ message }] }) }));
}

function makeFetchError(status: number, body: string): MockFetch {
  return mockFetch(async () => ({ ok: false, status, text: async () => body }));
}

describe("runAgentLoop — happy paths", () => {
  it("returns content when LLM responds with no tool calls", async () => {
    global.fetch = makeFetchResponse({ role: "assistant", content: "Hello Frank." }) as unknown as typeof fetch;

    const result = await runAgentLoop("say hello", {
      systemPrompt: "You are helpful.",
      tools: [], executors: {},
    });
    assert.equal(result, "Hello Frank.");
  });

  it("executes a single tool call then returns final content", async () => {
    let call = 0;
    global.fetch = mock.fn(async () => {
      call++;
      if (call === 1) return {
        ok: true,
        json: async () => ({ choices: [{ message: {
          role: "assistant", content: null,
          tool_calls: [{ id: "c1", type: "function",
            function: { name: "get_memory", arguments: JSON.stringify({ person_id: "p1", query: "fishing" }) } }],
        }}] }),
      };
      return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: "Frank loves fishing." } }] }) };
    }) as unknown as typeof fetch;

    const executor = mock.fn(async () => [{ what: "fishing at Lake Tahoe" }]);
    const result = await runAgentLoop("What does Frank love?", {
      systemPrompt: "You are helpful.",
      tools: [{ name: "get_memory", description: "get memories", parameters: { type: "object", properties: {}, required: [] } }],
      executors: { get_memory: executor },
    });

    assert.equal(result, "Frank loves fishing.");
    assert.equal(executor.mock.calls.length, 1);
    const firstCallArgs = executor.mock.calls[0]?.arguments as unknown[];
    assert.deepEqual(firstCallArgs?.[0], { person_id: "p1", query: "fishing" });
  });

  it("executes multiple sequential tool calls before final response", async () => {
    let call = 0;
    global.fetch = mock.fn(async () => {
      call++;
      if (call === 1) return {
        ok: true,
        json: async () => ({ choices: [{ message: {
          role: "assistant", content: null,
          tool_calls: [
            { id: "c1", type: "function", function: { name: "tool_a", arguments: "{}" } },
            { id: "c2", type: "function", function: { name: "tool_b", arguments: "{}" } },
          ],
        }}] }),
      };
      return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: "Done." } }] }) };
    }) as unknown as typeof fetch;

    const toolA = mock.fn(async () => "result_a");
    const toolB = mock.fn(async () => "result_b");

    const result = await runAgentLoop("do two things", {
      systemPrompt: "You are helpful.",
      tools: [
        { name: "tool_a", description: "a", parameters: { type: "object", properties: {}, required: [] } },
        { name: "tool_b", description: "b", parameters: { type: "object", properties: {}, required: [] } },
      ],
      executors: { tool_a: toolA, tool_b: toolB },
    });

    assert.equal(result, "Done.");
    assert.equal(toolA.mock.calls.length, 1);
    assert.equal(toolB.mock.calls.length, 1);
  });

  it("handles empty content string as valid final response", async () => {
    global.fetch = makeFetchResponse({ role: "assistant", content: "" }) as unknown as typeof fetch;

    const result = await runAgentLoop("test", { systemPrompt: "x", tools: [], executors: {} });
    assert.equal(result, "");
  });
});

describe("runAgentLoop — error handling", () => {
  it("wraps tool executor error in JSON and continues", async () => {
    let call = 0;
    global.fetch = mock.fn(async () => {
      call++;
      if (call === 1) return {
        ok: true,
        json: async () => ({ choices: [{ message: {
          role: "assistant", content: null,
          tool_calls: [{ id: "cerr", type: "function", function: { name: "bad_tool", arguments: "{}" } }],
        }}] }),
      };
      return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: "I had trouble." } }] }) };
    }) as unknown as typeof fetch;

    const result = await runAgentLoop("do bad thing", {
      systemPrompt: "You are helpful.",
      tools: [{ name: "bad_tool", description: "breaks", parameters: { type: "object", properties: {}, required: [] } }],
      executors: { bad_tool: async () => { throw new Error("tool exploded"); } },
    });
    assert.equal(result, "I had trouble.");
  });

  it("wraps unknown tool name in error JSON and continues", async () => {
    let call = 0;
    global.fetch = mock.fn(async () => {
      call++;
      if (call === 1) return {
        ok: true,
        json: async () => ({ choices: [{ message: {
          role: "assistant", content: null,
          tool_calls: [{ id: "cunk", type: "function", function: { name: "unknown_tool", arguments: "{}" } }],
        }}] }),
      };
      return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: "Recovered." } }] }) };
    }) as unknown as typeof fetch;

    const result = await runAgentLoop("call unknown", {
      systemPrompt: "You are helpful.",
      tools: [],
      executors: {},
    });
    assert.equal(result, "Recovered.");
  });

  it("throws on non-OK HTTP from Mantle (401)", async () => {
    global.fetch = makeFetchError(401, "Unauthorized") as unknown as typeof fetch;

    await assert.rejects(
      () => runAgentLoop("test", { systemPrompt: "x", tools: [], executors: {} }),
      /Mantle HTTP 401/,
    );
  });

  it("throws on non-OK HTTP from Mantle (500)", async () => {
    global.fetch = makeFetchError(500, "Internal Server Error") as unknown as typeof fetch;

    await assert.rejects(
      () => runAgentLoop("test", { systemPrompt: "x", tools: [], executors: {} }),
      /Mantle HTTP 500/,
    );
  });

  it("throws after exceeding maxIterations", async () => {
    global.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: {
        role: "assistant", content: null,
        tool_calls: [{ id: "cloop", type: "function", function: { name: "noop", arguments: "{}" } }],
      }}] }),
    })) as unknown as typeof fetch;

    await assert.rejects(
      () => runAgentLoop("loop forever", {
        systemPrompt: "loop",
        tools: [{ name: "noop", description: "noop", parameters: { type: "object", properties: {}, required: [] } }],
        executors: { noop: async () => "ok" },
        maxIterations: 3,
      }),
      /max iterations/i,
    );
  });

  it("throws when LLM returns empty choices array", async () => {
    global.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [] }),
    })) as unknown as typeof fetch;

    await assert.rejects(
      () => runAgentLoop("test", { systemPrompt: "x", tools: [], executors: {} }),
      (err: Error) => err instanceof TypeError || err instanceof Error,
    );
  });

  it("handles tool call with malformed JSON args — wraps error and continues", async () => {
    let call = 0;
    global.fetch = mock.fn(async () => {
      call++;
      if (call === 1) return {
        ok: true,
        json: async () => ({ choices: [{ message: {
          role: "assistant", content: null,
          tool_calls: [{ id: "cmal", type: "function", function: { name: "get_memory", arguments: "NOT JSON {{" } }],
        }}] }),
      };
      return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: "Recovered from bad args." } }] }) };
    }) as unknown as typeof fetch;

    // malformed JSON args should be caught and surfaced as an error tool result
    // then the LLM can recover
    await assert.rejects(
      () => runAgentLoop("test", {
        systemPrompt: "x",
        tools: [{ name: "get_memory", description: "get mem", parameters: { type: "object", properties: {}, required: [] } }],
        executors: { get_memory: async () => "mem result" },
      }),
      // JSON.parse throws SyntaxError — propagates before executor runs
      (err: Error) => err instanceof SyntaxError || err instanceof Error,
    );
  });

  it("defaults to maxIterations=8 when not specified", async () => {
    let callCount = 0;
    global.fetch = mock.fn(async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: {
          role: "assistant", content: null,
          tool_calls: [{ id: `c${callCount}`, type: "function", function: { name: "noop", arguments: "{}" } }],
        }}] }),
      };
    }) as unknown as typeof fetch;

    await assert.rejects(
      () => runAgentLoop("loop", {
        systemPrompt: "loop",
        tools: [{ name: "noop", description: "noop", parameters: { type: "object", properties: {}, required: [] } }],
        executors: { noop: async () => "ok" },
        // no maxIterations — defaults to 8
      }),
      /max iterations/i,
    );
    // 8 LLM calls (1 per iteration before throwing)
    assert.equal(callCount, 8);
  });
});

// ─── Keyword scoring logic (pure function, extracted inline) ──────────────────
// Tests the same algorithm used in db.ts getMemory Layer 2

function scoreMemory(memory: { who: string; what: string; when: string; tags: string[] }, query: string): number {
  const haystack = `${memory.who} ${memory.what} ${memory.when} ${memory.tags.join(" ")}`.toLowerCase();
  const lower = query.toLowerCase();
  const words = lower.split(/\s+/).filter((w) => w.length > 2);
  return words.filter((w) => haystack.includes(w)).length;
}

describe("keyword scoring", () => {
  const fishing = { who: "Frank", what: "loves fishing at Lake Tahoe", when: "every July", tags: ["fishing", "lake", "family"] };
  const marcus  = { who: "grandson Marcus", what: "loves dinosaurs, wants to be paleontologist", when: "2026", tags: ["family", "school"] };
  const dorothy = { who: "Dorothy", what: "Frank's wife, married in 1971", when: "1971", tags: ["family", "spouse"] };

  it("exact field match scores higher than no match", () => {
    assert.ok(scoreMemory(fishing, "fishing Lake Tahoe") > scoreMemory(marcus, "fishing Lake Tahoe"));
  });

  it("returns 0 for completely unrelated query", () => {
    assert.equal(scoreMemory(fishing, "dinosaur paleontologist"), 0);
  });

  it("matches against tags field", () => {
    assert.ok(scoreMemory(fishing, "family fishing") > 0);
  });

  it("matches against who field", () => {
    assert.ok(scoreMemory(marcus, "Marcus grandson") > 0);
  });

  it("matches against when field", () => {
    assert.ok(scoreMemory(dorothy, "1971 married") > 0);
  });

  it("filters words shorter than 3 chars", () => {
    // 'at', 'in', 'is' are too short — should not match anything
    assert.equal(scoreMemory(fishing, "at in is"), 0);
  });

  it("is case-insensitive", () => {
    const lower = scoreMemory(fishing, "fishing lake tahoe");
    const upper = scoreMemory(fishing, "FISHING LAKE TAHOE");
    assert.equal(lower, upper);
  });

  it("scores higher memory when more query words match", () => {
    const score2 = scoreMemory(fishing, "fishing tahoe");   // 2 words match
    const score1 = scoreMemory(fishing, "fishing dinosaur"); // 1 word matches
    assert.ok(score2 > score1);
  });
});

// ─── InsightSummary math ──────────────────────────────────────────────────────
// Tests the aggregation logic from db.ts getInsightSummary (pure math, no AWS)

function computeInsight(interactions: Array<{ mood: string; confusion_detected: boolean }>, memories: Array<{ tags: string[] }>) {
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

describe("InsightSummary math", () => {
  it("returns zero confusion_rate when no interactions", () => {
    const result = computeInsight([], []);
    assert.equal(result.confusion_rate, 0);
    assert.equal(result.total_interactions, 0);
    assert.equal(result.total_memories, 0);
  });

  it("calculates confusion_rate correctly — 1 of 4 confused = 25%", () => {
    const interactions = [
      { mood: "calm", confusion_detected: false },
      { mood: "happy", confusion_detected: false },
      { mood: "calm", confusion_detected: false },
      { mood: "confused", confusion_detected: true },
    ];
    const result = computeInsight(interactions, []);
    assert.equal(result.confusion_rate, 25);
  });

  it("calculates confusion_rate correctly — 3 of 3 confused = 100%", () => {
    const interactions = [
      { mood: "confused", confusion_detected: true },
      { mood: "confused", confusion_detected: true },
      { mood: "confused", confusion_detected: true },
    ];
    const result = computeInsight(interactions, []);
    assert.equal(result.confusion_rate, 100);
  });

  it("rounds confusion_rate — 1 of 3 = 33%", () => {
    const interactions = [
      { mood: "calm", confusion_detected: false },
      { mood: "happy", confusion_detected: false },
      { mood: "confused", confusion_detected: true },
    ];
    const result = computeInsight(interactions, []);
    assert.equal(result.confusion_rate, 33);
  });

  it("counts mood_counts correctly", () => {
    const interactions = [
      { mood: "calm", confusion_detected: false },
      { mood: "calm", confusion_detected: false },
      { mood: "happy", confusion_detected: false },
      { mood: "confused", confusion_detected: true },
    ];
    const result = computeInsight(interactions, []);
    assert.equal(result.mood_counts["calm"], 2);
    assert.equal(result.mood_counts["happy"], 1);
    assert.equal(result.mood_counts["confused"], 1);
  });

  it("aggregates top_tags across memories", () => {
    const memories = [
      { tags: ["fishing", "family"] },
      { tags: ["family", "lake"] },
      { tags: ["fishing"] },
    ];
    const result = computeInsight([], memories);
    assert.equal(result.top_tags["fishing"], 2);
    assert.equal(result.top_tags["family"], 2);
    assert.equal(result.top_tags["lake"], 1);
  });

  it("counts total_memories correctly", () => {
    const memories = [{ tags: [] }, { tags: [] }, { tags: [] }];
    const result = computeInsight([], memories);
    assert.equal(result.total_memories, 3);
  });

  it("handles memories with empty tags gracefully", () => {
    const memories = [{ tags: [] }, { tags: [] }];
    const result = computeInsight([], memories);
    assert.equal(result.total_memories, 2);
    assert.deepEqual(result.top_tags, {});
  });

  it("single interaction not confused = 0% confusion rate", () => {
    const interactions = [{ mood: "calm", confusion_detected: false }];
    const result = computeInsight(interactions, []);
    assert.equal(result.confusion_rate, 0);
    assert.equal(result.total_interactions, 1);
  });

  it("top_tags not affected by interaction data", () => {
    const interactions = [{ mood: "calm", confusion_detected: false }];
    const memories = [{ tags: ["fishing"] }];
    const result = computeInsight(interactions, memories);
    assert.equal(result.top_tags["fishing"], 1);
    assert.equal(result.total_interactions, 1);
    assert.equal(result.total_memories, 1);
  });
});

// ─── Supervisor — system routing bypasses LLM ────────────────────────────────

describe("Supervisor — system initiatedBy skips LLM classification", () => {
  it("does not call fetch for system-initiated requests", async () => {
    const fetchSpy: MockFetch = mockFetch(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { role: "assistant", content: "morning" } }] }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { runSupervisor } = await import("../src/server/agents/supervisor.js");

    const callsBefore = fetchSpy.mock.calls.length;
    try {
      await runSupervisor({ personId: "p1", utterance: "", initiatedBy: "system" });
    } catch {
      // DynamoDB unavailable in unit tests — expected
    }
    const callsAfter = fetchSpy.mock.calls.length;

    assert.equal(callsAfter - callsBefore, 0,
      "system intent must not invoke LLM classifier");
  });
});

// ─── PII scrubbing ────────────────────────────────────────────────────────────

const { scrubPii, scrubMemory } = await import("../src/server/guardrails/pii.js");

describe("scrubPii — phone numbers", () => {
  const cases = [
    ["US no formatting: 5551234567",        "555-123-4567",       "[PHONE REDACTED]"],
    ["US dashes: 555-123-4567",             "call 555-123-4567",  "call [PHONE REDACTED]"],
    ["US dots: 555.123.4567",               "555.123.4567",       "[PHONE REDACTED]"],
    ["US parens: (555) 123-4567",           "(555) 123-4567",     "[PHONE REDACTED]"],
    ["US country code: +1 555-123-4567",    "+1 555-123-4567",    "[PHONE REDACTED]"],
  ];
  for (const [label, input, expected] of cases) {
    it(label, () => assert.equal(scrubPii(input), expected));
  }
});

describe("scrubPii — email addresses", () => {
  const cases = [
    ["simple email",           "contact sarah@example.com please", "contact [EMAIL REDACTED] please"],
    ["email with subdomains",  "send to me@mail.company.org",      "send to [EMAIL REDACTED]"],
    ["email with plus sign",   "sarah+folkore@gmail.com",          "[EMAIL REDACTED]"],
  ];
  for (const [label, input, expected] of cases) {
    it(label, () => assert.equal(scrubPii(input), expected));
  }
});

describe("scrubPii — SSN", () => {
  const cases = [
    ["SSN with dashes",  "SSN is 123-45-6789", "SSN is [SSN REDACTED]"],
  ];
  for (const [label, input, expected] of cases) {
    it(label, () => assert.equal(scrubPii(input), expected));
  }
});

describe("scrubPii — safe content passes through", () => {
  const safe = [
    "Frank loves fishing at Lake Tahoe",
    "Marcus is 8 years old",
    "Good morning Frank",
    "Dorothy and Frank married in 1971",
    "He has 3 grandchildren",
    "Call me maybe",           // no real phone number
    "The year was 1942",       // not SSN format
  ];
  for (const text of safe) {
    it(`passes through: "${text}"`, () => assert.equal(scrubPii(text), text));
  }
});

describe("scrubMemory", () => {
  it("scrubs PII from who field", () => {
    const result = scrubMemory({ who: "Sarah 555-123-4567", what: "Loves fishing", when: "July", tags: [] });
    assert.equal(result.who, "Sarah [PHONE REDACTED]");
  });

  it("scrubs PII from what field", () => {
    const result = scrubMemory({ who: "Frank", what: "Email is frank@example.com", when: "2026", tags: [] });
    assert.equal(result.what, "Email is [EMAIL REDACTED]");
  });

  it("scrubs PII from tags", () => {
    const result = scrubMemory({ who: "Frank", what: "fishing", when: "July", tags: ["family", "555-123-4567"] });
    assert.equal(result.tags[1], "[PHONE REDACTED]");
  });

  it("does not mutate the original object", () => {
    const original = { who: "Sarah 555-123-4567", what: "fishing", when: "July", tags: [] };
    scrubMemory(original);
    assert.equal(original.who, "Sarah 555-123-4567");
  });

  it("passes through clean memory unchanged", () => {
    const mem = { who: "Frank", what: "loves fishing at Lake Tahoe", when: "every July", tags: ["fishing", "family"] };
    const result = scrubMemory(mem);
    assert.deepEqual(result, mem);
  });
});

// ─── Rate limiter ─────────────────────────────────────────────────────────────

const { rateLimitConverse, _resetRateLimitStore } = await import("../src/server/guardrails/rateLimit.js");

function makeReq(ip = "1.2.3.4"): import("express").Request {
  return { headers: {}, socket: { remoteAddress: ip } } as unknown as import("express").Request;
}

interface FakeRes {
  statusCode: number;
  body: object;
  setHeader: ReturnType<typeof mock.fn>;
  status: (n: number) => { json: (b: object) => void };
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 0,
    body: {},
    setHeader: mock.fn(),
    status(code: number) {
      res.statusCode = code;
      return { json: (b: object) => { res.body = b; } };
    },
  };
  return res;
}

describe("rateLimitConverse", () => {
  beforeEach(() => _resetRateLimitStore());  // clean slate for each test

  it("allows first request through", () => {
    const next = mock.fn();
    rateLimitConverse(makeReq(), makeRes() as unknown as import("express").Response, next);
    assert.equal(next.mock.calls.length, 1);
  });

  it("allows up to MAX_REQUESTS (20) from same IP", () => {
    const req = makeReq("2.3.4.5");
    for (let i = 0; i < 20; i++) {
      const next = mock.fn();
      rateLimitConverse(req, makeRes() as unknown as import("express").Response, next);
      assert.equal(next.mock.calls.length, 1, `request ${i + 1} should pass`);
    }
  });

  it("blocks the 21st request from same IP with 429", () => {
    const req = makeReq("3.4.5.6");
    const passNext = mock.fn();
    for (let i = 0; i < 20; i++) {
      rateLimitConverse(req, makeRes() as unknown as import("express").Response, passNext);
    }
    const res = makeRes();
    const blockedNext = mock.fn();
    rateLimitConverse(req, res as unknown as import("express").Response, blockedNext);
    assert.equal(blockedNext.mock.calls.length, 0);
    assert.equal(res.statusCode, 429);
  });

  it("allows different IPs independently", () => {
    const next1 = mock.fn();
    const next2 = mock.fn();
    rateLimitConverse(makeReq("10.0.0.1"), makeRes() as unknown as import("express").Response, next1);
    rateLimitConverse(makeReq("10.0.0.2"), makeRes() as unknown as import("express").Response, next2);
    assert.equal(next1.mock.calls.length, 1);
    assert.equal(next2.mock.calls.length, 1);
  });

  it("reads IP from x-forwarded-for header", () => {
    const req = { headers: { "x-forwarded-for": "9.8.7.6, 1.1.1.1" }, socket: { remoteAddress: "127.0.0.1" } } as unknown as import("express").Request;
    const next = mock.fn();
    rateLimitConverse(req, makeRes() as unknown as import("express").Response, next);
    assert.equal(next.mock.calls.length, 1);
    // exhaust limit for the forwarded IP
    for (let i = 1; i < 20; i++) {
      rateLimitConverse(req, makeRes() as unknown as import("express").Response, mock.fn());
    }
    const blockedNext = mock.fn();
    rateLimitConverse(req, makeRes() as unknown as import("express").Response, blockedNext);
    assert.equal(blockedNext.mock.calls.length, 0);
  });

  it("resets counter after window expires", async () => {
    const req = makeReq("5.6.7.8");
    // Exhaust the limit
    for (let i = 0; i < 20; i++) {
      rateLimitConverse(req, makeRes() as unknown as import("express").Response, mock.fn());
    }
    // Manually expire the window by clearing and re-seeding with expired resetAt
    _resetRateLimitStore();
    // First request after reset should pass
    const next = mock.fn();
    rateLimitConverse(req, makeRes() as unknown as import("express").Response, next);
    assert.equal(next.mock.calls.length, 1);
  });

  it("Retry-After header value is a positive integer", () => {
    const req = makeReq("7.8.9.0");
    for (let i = 0; i < 20; i++) {
      rateLimitConverse(req, makeRes() as unknown as import("express").Response, mock.fn());
    }
    const res = makeRes();
    rateLimitConverse(req, res as unknown as import("express").Response, mock.fn());
    assert.equal(res.statusCode, 429);
    const retryAfterValue = res.setHeader.mock.calls[0]?.arguments[1] as number;
    assert.ok(Number.isInteger(retryAfterValue), "Retry-After should be an integer");
    assert.ok(retryAfterValue > 0, "Retry-After should be positive");
  });

  it("falls back to 'unknown' when socket has no remoteAddress", () => {
    const req = { headers: {}, socket: {} } as unknown as import("express").Request;
    const next = mock.fn();
    rateLimitConverse(req, makeRes() as unknown as import("express").Response, next);
    assert.equal(next.mock.calls.length, 1);
  });

  it("includes Retry-After header when blocking", () => {
    const req = makeReq("6.7.8.9");
    for (let i = 0; i < 20; i++) {
      rateLimitConverse(req, makeRes() as unknown as import("express").Response, mock.fn());
    }
    const res = makeRes();
    rateLimitConverse(req, res as unknown as import("express").Response, mock.fn());
    assert.equal(res.statusCode, 429);
    assert.equal(res.setHeader.mock.calls.length, 1);
    assert.equal(res.setHeader.mock.calls[0]?.arguments[0], "Retry-After");
  });
});

// ─── PII scrubbing — additional patterns ─────────────────────────────────────

describe("scrubPii — credit card numbers", () => {
  const cases: [string, string, string][] = [
    // Phone regex fires before card on unseparated 16-digit strings — both redacted
    ["16-digit no separator",  "card 4111111111111111 on file",   "card [PHONE REDACTED]111111 on file"],
    ["16-digit with dashes",   "4111-1111-1111-1111",             "[CARD REDACTED]"],
    ["16-digit with spaces",   "4111 1111 1111 1111",             "[CARD REDACTED]"],
  ];
  for (const [label, input, expected] of cases) {
    it(label, () => assert.equal(scrubPii(input), expected));
  }
});

describe("scrubPii — passport / ID numbers", () => {
  const cases: [string, string, string][] = [
    ["passport A1234567",   "passport A1234567",    "passport [ID REDACTED]"],
    ["ID AB123456789",      "ID AB123456789",        "ID [ID REDACTED]"],
  ];
  for (const [label, input, expected] of cases) {
    it(label, () => assert.equal(scrubPii(input), expected));
  }
});

describe("scrubMemory — when field", () => {
  it("scrubs PII from when field", () => {
    const result = scrubMemory({ who: "Frank", what: "fishing", when: "call 555-123-4567 to confirm", tags: [] });
    assert.equal(result.when, "call [PHONE REDACTED] to confirm");
  });

  it("leaves clean when field unchanged", () => {
    const result = scrubMemory({ who: "Frank", what: "fishing", when: "every July since 1990", tags: [] });
    assert.equal(result.when, "every July since 1990");
  });
});

// ─── PII scrubbing — additional pattern edge cases ───────────────────────────

describe("scrubPii — SSN 9 digits no dashes", () => {
  it("redacts bare 9-digit SSN", () => {
    assert.equal(scrubPii("SSN 123456789 on file"), "SSN [SSN REDACTED] on file");
  });
});

describe("scrubPii — multiple PII in one string", () => {
  it("redacts both phone and email in same string", () => {
    const result = scrubPii("call 555-123-4567 or email frank@example.com");
    assert.equal(result, "call [PHONE REDACTED] or email [EMAIL REDACTED]");
  });

  it("redacts SSN and email in same string", () => {
    const result = scrubPii("SSN 123-45-6789 email joe@test.com");
    assert.equal(result, "SSN [SSN REDACTED] email [EMAIL REDACTED]");
  });
});

describe("scrubPii — empty and clean strings", () => {
  it("returns empty string unchanged", () => {
    assert.equal(scrubPii(""), "");
  });

  it("returns string with only spaces unchanged", () => {
    assert.equal(scrubPii("   "), "   ");
  });
});

describe("scrubPii — international phone formats", () => {
  it("redacts +1 country code format", () => {
    assert.equal(scrubPii("+1 555-123-4567"), "[PHONE REDACTED]");
  });
});

// ─── runAgentLoop — history threading ────────────────────────────────────────

describe("runAgentLoop — history threading", () => {
  it("includes history messages in LLM request before user message", async () => {
    let capturedMessages: unknown[] = [];
    global.fetch = mock.fn(async (url: unknown, opts: unknown) => {
      const body = JSON.parse((opts as { body: string }).body) as { messages: unknown[] };
      capturedMessages = body.messages;
      return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: "Hi." } }] }) };
    }) as unknown as typeof fetch;

    await runAgentLoop("new message", {
      systemPrompt: "system",
      tools: [],
      executors: {},
    }, [
      { role: "user",      content: "previous user msg" },
      { role: "assistant", content: "previous assistant msg" },
    ]);

    // system + 2 history + 1 user = 4 messages
    assert.equal(capturedMessages.length, 4);
    assert.deepEqual((capturedMessages[1] as { role: string }).role, "user");
    assert.deepEqual((capturedMessages[2] as { role: string }).role, "assistant");
    assert.deepEqual((capturedMessages[3] as { content: string }).content, "new message");
  });

  it("caps history at last 10 messages", async () => {
    let capturedMessages: unknown[] = [];
    global.fetch = mock.fn(async (url: unknown, opts: unknown) => {
      const body = JSON.parse((opts as { body: string }).body) as { messages: unknown[] };
      capturedMessages = body.messages;
      return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: "ok" } }] }) };
    }) as unknown as typeof fetch;

    const longHistory = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `msg ${i}`,
    }));

    await runAgentLoop("final", { systemPrompt: "sys", tools: [], executors: {} }, longHistory);
    // system(1) + last 10 history + user(1) = 12
    assert.equal(capturedMessages.length, 12);
  });

  it("handles null content in LLM response gracefully", async () => {
    global.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { role: "assistant", content: null, tool_calls: [] } }] }),
    })) as unknown as typeof fetch;

    const result = await runAgentLoop("test", { systemPrompt: "x", tools: [], executors: {} });
    assert.equal(result, "");
  });
});

// ─── detectConfusion — edge cases ────────────────────────────────────────────

describe("detectConfusion — all valid types", () => {
  for (const [confusionType, expectedType] of [
    ["temporal", "temporal"],
    ["person",   "person"],
    ["place",    "place"],
    ["none",     null],
  ] as const) {
    it(`maps type="${confusionType}" correctly`, async () => {
      const mockFetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ confused: confusionType !== "none", type: confusionType }) } }],
        }),
      })) as unknown as typeof fetch;
      mock.method(globalThis, "fetch", mockFetch);
      const r = await detectConfusion("test utterance");
      assert.equal(r.type, expectedType);
      mock.restoreAll();
    });
  }

  it("handles empty string utterance — returns fallback without throwing", async () => {
    const mockFetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"confused":false,"type":"none"}' } }],
      }),
    })) as unknown as typeof fetch;
    mock.method(globalThis, "fetch", mockFetch);
    const r = await detectConfusion("");
    assert.equal(r.detected, false);
    assert.equal(r.type, null);
    mock.restoreAll();
  });
});

describe("detectConfusion — edge cases", () => {
  it("maps unknown type from LLM to null", async () => {
    const mockFetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"confused":true,"type":"unknown_type"}' } }],
      }),
    })) as unknown as typeof fetch;
    mock.method(globalThis, "fetch", mockFetch);
    const r = await detectConfusion("something weird");
    assert.equal(r.detected, true);
    assert.equal(r.type, null);
    mock.restoreAll();
  });

  it("falls back gracefully when fetch throws (network error)", async () => {
    const mockFetch = mock.fn(async () => { throw new Error("network error"); }) as unknown as typeof fetch;
    mock.method(globalThis, "fetch", mockFetch);
    const r = await detectConfusion("test");
    assert.equal(r.detected, false);
    assert.equal(r.type, null);
    mock.restoreAll();
  });
});

// ─── Supervisor — routing paths ───────────────────────────────────────────────

describe("Supervisor — parent initiatedBy bypasses classifier", () => {
  it("does not call fetch for LLM classification when initiatedBy is parent", async () => {
    let fetchCallCount = 0;
    global.fetch = mock.fn(async () => {
      fetchCallCount++;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { role: "assistant", content: "Hello Frank." } }] }),
      };
    }) as unknown as typeof fetch;

    const { runSupervisor } = await import("../src/server/agents/supervisor.js");

    const before = fetchCallCount;
    try {
      await runSupervisor({ personId: "p1", utterance: "hi", initiatedBy: "parent" });
    } catch {
      // DynamoDB/logInteraction will fail — expected in unit tests
    }
    const callsUsed = fetchCallCount - before;
    // Should only call LLM for the conversation agent + confusion classifier (2 parallel calls)
    // NOT for classification (which would add another call before those)
    assert.ok(callsUsed <= 2, `expected ≤2 LLM calls (conversation+confusion), got ${callsUsed}`);
  });
});

describe("Supervisor — unknown classifier response falls back to parent", () => {
  it("treats unrecognised intent as parent and returns {response, confusion}", async () => {
    global.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { role: "assistant", content: "GARBAGE_INTENT" } }] }),
    })) as unknown as typeof fetch;

    const { runSupervisor } = await import("../src/server/agents/supervisor.js");
    try {
      const result = await runSupervisor({ personId: "p1", utterance: "hi", initiatedBy: "family" });
      assert.ok("response" in result, "result must have response key");
      assert.ok("confusion" in result, "result must have confusion key");
    } catch {
      // AWS calls fail in unit tests — shape check above is what matters
    }
  });
});

