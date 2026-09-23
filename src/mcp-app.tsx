import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./mcp-app.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Memory {
  id: string;
  who: string;
  what: string;
  when: string;
  tags: string[];
  createdAt: string;
}

interface InsightSummary {
  total: number;
  totalInteractions: number;
  moodCounts: Record<string, number>;
  topTags: Record<string, number>;
}

type ActiveTool =
  | "home"
  | "add_memory"
  | "get_memory"
  | "log_interaction"
  | "get_insight_summary"
  | "surface_morning_memory";

type MoodOption = "happy" | "calm" | "confused" | "sad" | "anxious";

// ─── Helper ───────────────────────────────────────────────────────────────────

function extractMeta(result: CallToolResult): Record<string, unknown> | null {
  const meta = (result as unknown as { _meta?: { folkore?: Record<string, unknown> } })._meta;
  return meta?.folkore ?? null;
}

function extractText(result: CallToolResult): string {
  return result.content?.find((c) => c.type === "text")?.text ?? "";
}

// ─── Root shell ───────────────────────────────────────────────────────────────

function FolkloreApp() {
  const [toolResult, setToolResult] = useState<CallToolResult | null>(null);
  const [activeTool, setActiveTool] = useState<ActiveTool>("home");
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "Folklore", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (a: App) => {
      a.ontoolinput = async (input) => {
        const args = input as unknown as { params?: { name?: string } };
        const name = args.params?.name as ActiveTool | undefined;
        if (name && name !== "home") setActiveTool(name);
      };
      a.ontoolresult = async (result) => setToolResult(result);
      a.ontoolcancelled = () => {};
      a.onerror = console.error;
      a.onhostcontextchanged = (ctx) => setHostContext((prev) => ({ ...prev, ...ctx }));
      a.onteardown = async () => ({});
    },
  });

  useEffect(() => {
    if (app) setHostContext(app.getHostContext());
  }, [app]);

  if (error) return <div className={styles.errorState}><strong>Error:</strong> {error.message}</div>;
  if (!app) return <div className={styles.loadingState}>Connecting to Folklore…</div>;

  return (
    <FolkloreShell
      app={app}
      activeTool={activeTool}
      setActiveTool={setActiveTool}
      toolResult={toolResult}
      hostContext={hostContext}
    />
  );
}

// ─── Shell with nav ───────────────────────────────────────────────────────────

interface ShellProps {
  app: App;
  activeTool: ActiveTool;
  setActiveTool: (t: ActiveTool) => void;
  toolResult: CallToolResult | null;
  hostContext?: McpUiHostContext;
}

function FolkloreShell({ app, activeTool, setActiveTool, toolResult, hostContext }: ShellProps) {
  const insets = hostContext?.safeAreaInsets;

  return (
    <div
      className={styles.shell}
      style={{
        paddingTop: insets?.top,
        paddingRight: insets?.right,
        paddingBottom: insets?.bottom,
        paddingLeft: insets?.left,
      }}
    >
      <header className={styles.header}>
        <div className={styles.headerBrand}>
          <span className={styles.logo}>◉</span>
          <span className={styles.brandName}>Folklore</span>
        </div>
        <span className={styles.tagline}>Memory companion</span>
      </header>

      <nav className={styles.nav}>
        {(
          [
            { id: "home", label: "Home" },
            { id: "surface_morning_memory", label: "Morning" },
            { id: "add_memory", label: "Add" },
            { id: "get_memory", label: "Memories" },
            { id: "log_interaction", label: "Log" },
            { id: "get_insight_summary", label: "Insights" },
          ] as { id: ActiveTool; label: string }[]
        ).map((tab) => (
          <button
            key={tab.id}
            className={`${styles.navTab} ${activeTool === tab.id ? styles.navTabActive : ""}`}
            onClick={() => setActiveTool(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className={styles.content}>
        {activeTool === "home" && <HomeView app={app} setActiveTool={setActiveTool} />}
        {activeTool === "surface_morning_memory" && (
          <MorningMemoryView app={app} toolResult={toolResult} />
        )}
        {activeTool === "add_memory" && <AddMemoryView app={app} />}
        {activeTool === "get_memory" && <GetMemoryView app={app} toolResult={toolResult} />}
        {activeTool === "log_interaction" && <LogInteractionView app={app} />}
        {activeTool === "get_insight_summary" && (
          <InsightSummaryView app={app} toolResult={toolResult} />
        )}
      </main>
    </div>
  );
}

// ─── Home ─────────────────────────────────────────────────────────────────────

function HomeView({ app, setActiveTool }: { app: App; setActiveTool: (t: ActiveTool) => void }) {
  const [pulsing, setPulsing] = useState(false);

  const triggerMorning = useCallback(async () => {
    setPulsing(true);
    try {
      await app.callServerTool({ name: "surface_morning_memory", arguments: {} });
      setActiveTool("surface_morning_memory");
    } finally {
      setTimeout(() => setPulsing(false), 1200);
    }
  }, [app, setActiveTool]);

  return (
    <div className={styles.homeView}>
      <div className={`${styles.alexaRing} ${pulsing ? styles.alexaRingPulsing : ""}`} onClick={triggerMorning}>
        <span className={styles.alexaIcon}>◉</span>
        <span className={styles.alexaLabel}>Tap for today's memory</span>
      </div>

      <div className={styles.quickActions}>
        <QuickCard icon="＋" label="Add Memory" onClick={() => setActiveTool("add_memory")} />
        <QuickCard icon="◎" label="Log Session" onClick={() => setActiveTool("log_interaction")} />
        <QuickCard icon="⚡" label="Insights" onClick={() => setActiveTool("get_insight_summary")} />
        <QuickCard icon="☰" label="All Memories" onClick={() => setActiveTool("get_memory")} />
      </div>
    </div>
  );
}

function QuickCard({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button className={styles.quickCard} onClick={onClick}>
      <span className={styles.quickCardIcon}>{icon}</span>
      <span className={styles.quickCardLabel}>{label}</span>
    </button>
  );
}

// ─── Morning Memory ───────────────────────────────────────────────────────────

function MorningMemoryView({ app, toolResult }: { app: App; toolResult: CallToolResult | null }) {
  const [memory, setMemory] = useState<Memory | null>(null);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const result = await app.callServerTool({ name: "surface_morning_memory", arguments: {} });
      const meta = extractMeta(result);
      if (meta?.memory) {
        setMemory(meta.memory as Memory);
        setEmpty(false);
      } else {
        setMemory(null);
        setEmpty(true);
      }
    } finally {
      setLoading(false);
    }
  }, [app]);

  useEffect(() => {
    if (toolResult) {
      const meta = extractMeta(toolResult);
      if (meta?.action === "surface_morning_memory") {
        setMemory(meta.memory as Memory | null);
        setEmpty(!meta.memory);
      }
    }
  }, [toolResult]);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <div className={styles.view}>
      <h2 className={styles.viewTitle}>Good morning ☀</h2>
      <p className={styles.viewSubtitle}>Today's memory to share</p>

      {loading && <div className={styles.spinner} />}

      {!loading && empty && (
        <div className={styles.emptyState}>
          No memories yet. Add some so Folklore can surface them each morning!
        </div>
      )}

      {!loading && memory && (
        <div className={styles.memoryCard}>
          <div className={styles.memoryMeta}>
            <span className={styles.memoryWho}>{memory.who}</span>
            <span className={styles.memoryWhen}>{memory.when}</span>
          </div>
          <p className={styles.memoryWhat}>{memory.what}</p>
          {memory.tags.length > 0 && (
            <div className={styles.tagList}>
              {memory.tags.map((t) => <span key={t} className={styles.tag}>{t}</span>)}
            </div>
          )}
        </div>
      )}

      <button className={styles.primaryBtn} onClick={fetch} disabled={loading}>
        Surface another memory
      </button>
    </div>
  );
}

// ─── Add Memory ───────────────────────────────────────────────────────────────

function AddMemoryView({ app }: { app: App }) {
  const [who, setWho] = useState("");
  const [what, setWhat] = useState("");
  const [when, setWhen] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const save = useCallback(async () => {
    if (!who.trim() || !what.trim()) return;
    setStatus("saving");
    try {
      const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
      await app.callServerTool({
        name: "add_memory",
        arguments: { who: who.trim(), what: what.trim(), when: when.trim() || "Unknown", tags },
      });
      setStatus("saved");
      setWho(""); setWhat(""); setWhen(""); setTagsRaw("");
      setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2500);
    }
  }, [app, who, what, when, tagsRaw]);

  return (
    <div className={styles.view}>
      <h2 className={styles.viewTitle}>Add a Memory</h2>
      <p className={styles.viewSubtitle}>Capture a moment to share with your loved one</p>

      <div className={styles.formGroup}>
        <label className={styles.label}>Who is this about?</label>
        <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="e.g. Mom, Dad" />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label}>What happened?</label>
        <textarea value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Describe the memory…" />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label}>When was this?</label>
        <input value={when} onChange={(e) => setWhen(e.target.value)} placeholder="e.g. Summer 1982, last Christmas" />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label}>Tags (comma separated)</label>
        <input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="e.g. childhood, vacation, family" />
      </div>

      <button
        className={styles.primaryBtn}
        onClick={save}
        disabled={status === "saving" || !who.trim() || !what.trim()}
      >
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved!" : "Save Memory"}
      </button>

      {status === "error" && <p className={styles.errorMsg}>Something went wrong. Try again.</p>}
    </div>
  );
}

// ─── Get Memory ───────────────────────────────────────────────────────────────

function GetMemoryView({ app, toolResult }: { app: App; toolResult: CallToolResult | null }) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [tag, setTag] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchMemories = useCallback(async (filterTag?: string) => {
    setLoading(true);
    try {
      const result = await app.callServerTool({
        name: "get_memory",
        arguments: filterTag ? { tag: filterTag } : {},
      });
      const meta = extractMeta(result);
      if (meta?.memories) setMemories(meta.memories as Memory[]);
    } finally {
      setLoading(false);
    }
  }, [app]);

  useEffect(() => {
    if (toolResult) {
      const meta = extractMeta(toolResult);
      if (meta?.action === "get_memory") setMemories(meta.memories as Memory[]);
    }
  }, [toolResult]);

  useEffect(() => { fetchMemories(); }, [fetchMemories]);

  return (
    <div className={styles.view}>
      <h2 className={styles.viewTitle}>Memory Library</h2>

      <div className={styles.filterRow}>
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder="Filter by tag…"
          onKeyDown={(e) => e.key === "Enter" && fetchMemories(tag.trim() || undefined)}
        />
        <button className={styles.secondaryBtn} onClick={() => fetchMemories(tag.trim() || undefined)}>
          Filter
        </button>
        <button className={styles.ghostBtn} onClick={() => { setTag(""); fetchMemories(); }}>
          Clear
        </button>
      </div>

      {loading && <div className={styles.spinner} />}

      {!loading && memories.length === 0 && (
        <div className={styles.emptyState}>No memories found. Add one to get started!</div>
      )}

      <div className={styles.memoryList}>
        {memories.map((m) => (
          <div key={m.id} className={styles.memoryCard}>
            <div className={styles.memoryMeta}>
              <span className={styles.memoryWho}>{m.who}</span>
              <span className={styles.memoryWhen}>{m.when}</span>
            </div>
            <p className={styles.memoryWhat}>{m.what}</p>
            {m.tags.length > 0 && (
              <div className={styles.tagList}>
                {m.tags.map((t) => <span key={t} className={styles.tag}>{t}</span>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Log Interaction ──────────────────────────────────────────────────────────

const MOODS: MoodOption[] = ["happy", "calm", "confused", "sad", "anxious"];
const MOOD_EMOJI: Record<MoodOption, string> = {
  happy: "😊", calm: "😌", confused: "😕", sad: "😢", anxious: "😰",
};

function LogInteractionView({ app }: { app: App }) {
  const [transcript, setTranscript] = useState("");
  const [mood, setMood] = useState<MoodOption>("calm");
  const [memoryId, setMemoryId] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const save = useCallback(async () => {
    if (!transcript.trim()) return;
    setStatus("saving");
    try {
      await app.callServerTool({
        name: "log_interaction",
        arguments: {
          transcript: transcript.trim(),
          mood,
          memoryId: memoryId.trim() || null,
        },
      });
      setStatus("saved");
      setTranscript(""); setMemoryId("");
      setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2500);
    }
  }, [app, transcript, mood, memoryId]);

  return (
    <div className={styles.view}>
      <h2 className={styles.viewTitle}>Log a Session</h2>
      <p className={styles.viewSubtitle}>Record what was said and how they felt</p>

      <div className={styles.formGroup}>
        <label className={styles.label}>Session transcript</label>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="What was said during this Alexa session…"
        />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label}>Mood</label>
        <div className={styles.moodPicker}>
          {MOODS.map((m) => (
            <button
              key={m}
              className={`${styles.moodBtn} ${mood === m ? styles.moodBtnActive : ""}`}
              style={{ "--mood-color": `var(--mood-${m})` } as React.CSSProperties}
              onClick={() => setMood(m)}
            >
              <span>{MOOD_EMOJI[m]}</span>
              <span>{m}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label}>Related memory ID (optional)</label>
        <input value={memoryId} onChange={(e) => setMemoryId(e.target.value)} placeholder="mem_1" />
      </div>

      <button
        className={styles.primaryBtn}
        onClick={save}
        disabled={status === "saving" || !transcript.trim()}
      >
        {status === "saving" ? "Logging…" : status === "saved" ? "Logged!" : "Log Session"}
      </button>

      {status === "error" && <p className={styles.errorMsg}>Something went wrong. Try again.</p>}
    </div>
  );
}

// ─── Insight Summary ──────────────────────────────────────────────────────────

function InsightSummaryView({ app, toolResult }: { app: App; toolResult: CallToolResult | null }) {
  const [summary, setSummary] = useState<InsightSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const result = await app.callServerTool({ name: "get_insight_summary", arguments: {} });
      const meta = extractMeta(result);
      if (meta?.summary) setSummary(meta.summary as InsightSummary);
      else {
        // fallback parse from text
        try { setSummary(JSON.parse(extractText(result)) as InsightSummary); } catch { /* ignore */ }
      }
    } finally {
      setLoading(false);
    }
  }, [app]);

  useEffect(() => {
    if (toolResult) {
      const meta = extractMeta(toolResult);
      if (meta?.action === "get_insight_summary") setSummary(meta.summary as InsightSummary);
    }
  }, [toolResult]);

  useEffect(() => { fetch(); }, [fetch]);

  const topMood = summary
    ? Object.entries(summary.moodCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
    : null;

  const topTagsList = summary
    ? Object.entries(summary.topTags).sort((a, b) => b[1] - a[1]).slice(0, 5)
    : [];

  return (
    <div className={styles.view}>
      <h2 className={styles.viewTitle}>Insights</h2>
      <p className={styles.viewSubtitle}>How your loved one is doing</p>

      {loading && <div className={styles.spinner} />}

      {!loading && summary && (
        <>
          <div className={styles.statGrid}>
            <div className={styles.statCard}>
              <span className={styles.statValue}>{summary.total}</span>
              <span className={styles.statLabel}>Memories</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statValue}>{summary.totalInteractions}</span>
              <span className={styles.statLabel}>Sessions</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statValue}>
                {topMood ? MOOD_EMOJI[topMood as MoodOption] ?? topMood : "—"}
              </span>
              <span className={styles.statLabel}>Top mood</span>
            </div>
          </div>

          {Object.keys(summary.moodCounts).length > 0 && (
            <div className={styles.insightSection}>
              <h3 className={styles.insightSectionTitle}>Mood breakdown</h3>
              <div className={styles.moodBreakdown}>
                {Object.entries(summary.moodCounts).map(([m, count]) => (
                  <div key={m} className={styles.moodRow}>
                    <span className={styles.moodRowLabel}>
                      {MOOD_EMOJI[m as MoodOption] ?? ""} {m}
                    </span>
                    <div className={styles.moodBar}>
                      <div
                        className={styles.moodBarFill}
                        style={{
                          width: `${(count / summary.totalInteractions) * 100}%`,
                          background: `var(--mood-${m})`,
                        }}
                      />
                    </div>
                    <span className={styles.moodRowCount}>{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {topTagsList.length > 0 && (
            <div className={styles.insightSection}>
              <h3 className={styles.insightSectionTitle}>Top memory themes</h3>
              <div className={styles.tagList}>
                {topTagsList.map(([t, n]) => (
                  <span key={t} className={styles.tag}>{t} ({n})</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!loading && !summary && (
        <div className={styles.emptyState}>No data yet. Add memories and log sessions first.</div>
      )}

      <button className={styles.primaryBtn} onClick={fetch} disabled={loading}>
        Refresh
      </button>
    </div>
  );
}

// ─── Entry ────────────────────────────────────────────────────────────────────

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FolkloreApp />
  </StrictMode>,
);
