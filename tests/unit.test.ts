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

const { detectConfusion } = await import("../src/server/agents/conversation.js");

describe("detectConfusion — temporal", () => {
  const cases = [
    "what year is it",
    "what month is this",
    "what day is today",
    "what date is it",
    "what time is it",
    "how long ago was that",
    "WHAT YEAR IS IT",
    "What Year Is It",
    "I forget what year it is",
  ];
  for (const phrase of cases) {
    it(`detects temporal: "${phrase}"`, () => {
      const r = detectConfusion(phrase);
      assert.equal(r.detected, true);
      assert.equal(r.type, "temporal");
    });
  }
});

describe("detectConfusion — person", () => {
  const cases = [
    "who is Marcus",
    "who was that man",
    "who are they",
    "who were those people",
    "i don't know who she is",
    "i don't remember who he is",
    "i dont remember her",
    "i dont know him",
    "i don't know them",
  ];
  for (const phrase of cases) {
    it(`detects person: "${phrase}"`, () => {
      const r = detectConfusion(phrase);
      assert.equal(r.detected, true);
      assert.equal(r.type, "person");
    });
  }
});

describe("detectConfusion — place", () => {
  const cases = [
    "where am i",
    "where is this",
    "where are we",
    "i don't know where I am",
    "i don't remember this place",
    "i dont know where this is",
  ];
  for (const phrase of cases) {
    it(`detects place: "${phrase}"`, () => {
      const r = detectConfusion(phrase);
      assert.equal(r.detected, true);
      assert.equal(r.type, "place");
    });
  }
});

describe("detectConfusion — no confusion", () => {
  const cases = [
    "good morning",
    "I love fishing at Lake Tahoe",
    "tell me about Marcus",
    "what did I have for breakfast",
    "my grandson visited last week",
    "how are you doing today",
    "I remember Dorothy",
    "Dorothy and I went to Lake Tahoe",
    "Marcus is 8 years old",
    "tell me a story about the old days",
    "I'd like some music",
    "what's the weather like",
    "remind me to call Sarah",
    "",
    "   ",
  ];
  for (const phrase of cases) {
    it(`no confusion: "${phrase || "(empty)"}"`, () => {
      const r = detectConfusion(phrase);
      assert.equal(r.detected, false);
      assert.equal(r.type, null);
    });
  }
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
});

