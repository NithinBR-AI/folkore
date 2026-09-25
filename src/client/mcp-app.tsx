import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./global.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const API = "http://localhost:3001";
const FRANK_ID = "frank-henderson-001";

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = "frank" | "family";
type RingState = "idle" | "listening" | "responding";

interface Bubble {
  id: string;
  speaker: "frank" | "alexa" | "family";
  text: string;
  confusion?: boolean;
  time: string;
}

interface InsightData {
  total_memories: number;
  total_interactions: number;
  confusion_rate: number;
  mood_counts: Record<string, number>;
  top_tags: Record<string, number>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2); }

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function bubble(speaker: Bubble["speaker"], text: string, confusion = false): Bubble {
  return { id: uid(), speaker, text, confusion, time: nowTime() };
}

async function apiFetch(path: string, body: object) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json() as Promise<{ response?: string; error?: string }>;
}

// ─── Root ─────────────────────────────────────────────────────────────────────

function App() {
  const [role, setRole] = useState<Role>("frank");

  return (
    <div className="shell">
      <header className="header">
        <div className="brand">
          <span className="brand-dot" />
          <span className="brand-name">Folkore</span>
          <span className="brand-tag">memory companion</span>
        </div>
        <div className="role-toggle">
          <button
            className={`role-btn${role === "frank" ? " active" : ""}`}
            onClick={() => setRole("frank")}
          >
            Frank
          </button>
          <button
            className={`role-btn${role === "family" ? " active" : ""}`}
            onClick={() => setRole("family")}
          >
            Family
          </button>
        </div>
      </header>

      {role === "frank"  && <FrankView />}
      {role === "family" && <FamilyView />}
    </div>
  );
}

// ─── Frank's View ─────────────────────────────────────────────────────────────

function FrankView() {
  const [bubbles, setBubbles]     = useState<Bubble[]>([]);
  const [ring, setRing]           = useState<RingState>("idle");
  const [input, setInput]         = useState("");
  const [confusion, setConfusion] = useState(false);
  const [booted, setBooted]       = useState(false);
  const bottomRef                 = useRef<HTMLDivElement>(null);

  const push = useCallback((b: Bubble) => setBubbles(p => [...p, b]), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [bubbles]);

  // Morning memory on first load
  useEffect(() => {
    if (booted) return;
    setBooted(true);
    doMorning();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-dismiss confusion note after 5 s
  useEffect(() => {
    if (!confusion) return;
    const t = setTimeout(() => setConfusion(false), 5000);
    return () => clearTimeout(t);
  }, [confusion]);

  const doMorning = useCallback(async () => {
    setRing("responding");
    try {
      const data = await apiFetch("/api/morning", { person_id: FRANK_ID });
      push(bubble("alexa", data.response ?? "Good morning, Frank."));
    } catch {
      push(bubble("alexa", "Good morning, Frank. It's a lovely day."));
    } finally {
      setRing("idle");
    }
  }, [push]);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || ring === "responding") return;
    push(bubble("frank", text.trim()));
    setInput("");
    setRing("responding");

    const isConfusion = /forget|forgot|don't know|what year|what day|who (is|are|was)/i.test(text);

    try {
      const data = await apiFetch("/api/converse", {
        person_id: FRANK_ID,
        utterance: text.trim(),
        initiated_by: "parent",
      });
      if (isConfusion) setConfusion(true);
      push(bubble("alexa", data.response ?? "I'm here with you, Frank.", isConfusion));
    } catch {
      push(bubble("alexa", "I'm sorry, I didn't catch that. Can you say it again?"));
    } finally {
      setRing("idle");
    }
  }, [push, ring]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); send(input); }
  };

  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="frank-view">

      {/* Ring hero */}
      <div className="ring-section">
        <span className="greeting-line">{greeting}, Frank</span>
        <div
          className={[
            "alexa-ring",
            `ring-${ring}`,
            confusion ? "ring-confusion" : "",
          ].join(" ")}
          onClick={() => ring === "idle" && setRing("listening")}
        >
          <svg className="ring-icon" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.3" />
            <circle cx="24" cy="24" r="10" fill="currentColor" opacity="0.9" />
          </svg>
          <span className="ring-label">
            {ring === "idle"       ? "Alexa"      : ""}
            {ring === "listening"  ? "Listening…" : ""}
            {ring === "responding" ? "Thinking…"  : ""}
          </span>
        </div>

        {confusion && (
          <div className="confusion-note">Confusion logged · Family notified</div>
        )}

        <button className="morning-btn" onClick={doMorning} disabled={ring !== "idle"}>
          Morning memory
        </button>
      </div>

      {/* Bubbles */}
      <div className="bubbles">
        {bubbles.length === 0 && (
          <p className="bubbles-empty">Tap "Morning memory" to start the day,<br />or type something below.</p>
        )}
        {bubbles.map(b => (
          <div key={b.id} className={`bubble bubble-${b.speaker}${b.confusion ? " bubble-confusion" : ""}`}>
            <div className="bubble-meta">
              <span className="bubble-who">{b.speaker === "frank" ? "Frank" : "Alexa"}</span>
              <span className="bubble-time">{b.time}</span>
            </div>
            <p className="bubble-text">{b.text}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="input-row">
        <input
          className="utterance-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          onFocus={() => ring === "idle" && setRing("listening")}
          onBlur={() => ring === "listening" && setRing("idle")}
          placeholder="What's on your mind, Frank?"
          disabled={ring === "responding"}
        />
        <button
          className="send-btn"
          onClick={() => send(input)}
          disabled={!input.trim() || ring === "responding"}
        >
          Send
        </button>
      </div>
    </div>
  );
}

// ─── Family View ──────────────────────────────────────────────────────────────

function FamilyView() {
  const [tab, setTab] = useState<"curate" | "insight">("curate");

  return (
    <div className="family-view">
      <div className="family-tabs">
        <button className={`family-tab${tab === "curate" ? " active" : ""}`} onClick={() => setTab("curate")}>
          Add Memory
        </button>
        <button className={`family-tab${tab === "insight" ? " active" : ""}`} onClick={() => setTab("insight")}>
          Frank's Week
        </button>
      </div>
      {tab === "curate"  && <CuratePanel />}
      {tab === "insight" && <InsightPanel />}
    </div>
  );
}

// ─── Curate Panel ─────────────────────────────────────────────────────────────

function CuratePanel() {
  const [bubbles, setBubbles] = useState<Bubble[]>([
    bubble("alexa", "Hi Sarah. Tell me something about Frank — a memory, a name, a place he loves. I'll keep it safe for him."),
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy]   = useState(false);
  const bottomRef         = useRef<HTMLDivElement>(null);

  const push = useCallback((b: Bubble) => setBubbles(p => [...p, b]), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [bubbles]);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || busy) return;
    push(bubble("family", text.trim()));
    setInput("");
    setBusy(true);
    try {
      const data = await apiFetch("/api/converse", {
        person_id: FRANK_ID,
        utterance: text.trim(),
        initiated_by: "family",
        added_by: "daughter Sarah",
      });
      push(bubble("alexa", data.response ?? "Got it, I'll remember that for Frank."));
    } catch {
      push(bubble("alexa", "Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }, [push, busy]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); send(input); }
  };

  return (
    <div className="curate-panel">
      <div className="bubbles">
        {bubbles.map(b => (
          <div key={b.id} className={`bubble bubble-${b.speaker}`}>
            <div className="bubble-meta">
              <span className="bubble-who">{b.speaker === "family" ? "Sarah" : "Folkore"}</span>
              <span className="bubble-time">{b.time}</span>
            </div>
            <p className="bubble-text">{b.text}</p>
          </div>
        ))}
        {busy && (
          <div className="bubble bubble-alexa">
            <div className="bubble-meta"><span className="bubble-who">Folkore</span></div>
            <p className="bubble-text typing"><span /><span /><span /></p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="input-row">
        <input
          className="utterance-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Share a memory about Frank…"
          disabled={busy}
        />
        <button className="send-btn" onClick={() => send(input)} disabled={!input.trim() || busy}>
          Remember this
        </button>
      </div>
    </div>
  );
}

// ─── Insight Panel ────────────────────────────────────────────────────────────

const MOOD_COLOR: Record<string, string> = {
  happy: "#6dbf82", calm: "#60a5fa", confused: "#e8a94d", sad: "#a78bfa", anxious: "#e07070",
};
const MOOD_EMOJI: Record<string, string> = {
  happy: "😊", calm: "😌", confused: "😕", sad: "😢", anxious: "😰",
};

function InsightPanel() {
  const [data, setData]           = useState<InsightData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [narrative, setNarrative] = useState("");
  const [loadingNarr, setLoadingNarr] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/insight/${FRANK_ID}`)
      .then(r => r.json())
      .then(d => { setData(d as InsightData); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const askInsight = useCallback(async () => {
    setNarrative("");
    setLoadingNarr(true);
    try {
      const d = await apiFetch("/api/converse", {
        person_id: FRANK_ID,
        utterance: "How has dad been doing this week?",
        initiated_by: "family",
        added_by: "daughter Sarah",
      });
      setNarrative(d.response ?? "");
    } finally {
      setLoadingNarr(false);
    }
  }, []);

  if (loading) return <div className="insight-loading">Loading Frank's week…</div>;
  if (!data)   return <div className="insight-loading">No data yet.</div>;

  const totalMoods = Object.values(data.mood_counts).reduce((a, b) => a + b, 0) || 1;
  const topTags = Object.entries(data.top_tags).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div className="insight-panel">

      {/* Stats */}
      <div className="stat-row">
        <div className="stat-card">
          <span className="stat-value">{data.total_memories}</span>
          <span className="stat-label">Memories</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{data.total_interactions}</span>
          <span className="stat-label">Conversations</span>
        </div>
        <div className="stat-card stat-confusion">
          <span className="stat-value">{data.confusion_rate}%</span>
          <span className="stat-label">Confusion rate</span>
        </div>
      </div>

      {/* Mood */}
      {Object.keys(data.mood_counts).length > 0 && (
        <div className="insight-section">
          <h3 className="insight-title">Mood this week</h3>
          <div className="mood-bars">
            {Object.entries(data.mood_counts).map(([mood, count]) => (
              <div key={mood} className="mood-row">
                <span className="mood-label">{MOOD_EMOJI[mood] ?? ""} {mood}</span>
                <div className="mood-track">
                  <div
                    className="mood-fill"
                    style={{ width: `${(count / totalMoods) * 100}%`, background: MOOD_COLOR[mood] ?? "#d4845a" }}
                  />
                </div>
                <span className="mood-count">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tags */}
      {topTags.length > 0 && (
        <div className="insight-section">
          <h3 className="insight-title">What's on Frank's mind</h3>
          <div className="tag-cloud">
            {topTags.map(([tag, n]) => (
              <span key={tag} className="tag">{tag} <em>{n}</em></span>
            ))}
          </div>
        </div>
      )}

      {/* Narrative */}
      <div className="insight-section">
        <h3 className="insight-title">Ask Folkore</h3>
        {narrative ? (
          <>
            <div className="narrative-box">{narrative}</div>
            <button className="ask-again-btn" onClick={askInsight} disabled={loadingNarr}>
              Ask again
            </button>
          </>
        ) : (
          <button className="ask-btn" onClick={askInsight} disabled={loadingNarr}>
            {loadingNarr ? "Asking Folkore…" : "How has dad been this week?"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Entry ────────────────────────────────────────────────────────────────────

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>
);
