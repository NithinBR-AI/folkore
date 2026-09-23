/**
 * In-memory store for Folklore memories and interactions.
 * Replace with DynamoDB / persistent store for production.
 */

export interface Memory {
  id: string;
  who: string;
  what: string;
  when: string;
  tags: string[];
  createdAt: string;
}

export interface Interaction {
  id: string;
  memoryId: string | null;
  transcript: string;
  mood: string;
  createdAt: string;
}

const memories: Memory[] = [];
const interactions: Interaction[] = [];
let seq = 1;

export function addMemory(who: string, what: string, when: string, tags: string[]): Memory {
  const m: Memory = {
    id: `mem_${seq++}`,
    who,
    what,
    when,
    tags,
    createdAt: new Date().toISOString(),
  };
  memories.push(m);
  return m;
}

export function getMemory(id?: string, tag?: string): Memory[] {
  if (id) return memories.filter((m) => m.id === id);
  if (tag) return memories.filter((m) => m.tags.includes(tag));
  return [...memories];
}

export function logInteraction(transcript: string, mood: string, memoryId: string | null): Interaction {
  const i: Interaction = {
    id: `int_${seq++}`,
    memoryId,
    transcript,
    mood,
    createdAt: new Date().toISOString(),
  };
  interactions.push(i);
  return i;
}

export function getInsightSummary(): object {
  const total = memories.length;
  const totalInteractions = interactions.length;
  const moodCounts: Record<string, number> = {};
  for (const i of interactions) {
    moodCounts[i.mood] = (moodCounts[i.mood] ?? 0) + 1;
  }
  const topTags: Record<string, number> = {};
  for (const m of memories) {
    for (const t of m.tags) {
      topTags[t] = (topTags[t] ?? 0) + 1;
    }
  }
  return { total, totalInteractions, moodCounts, topTags };
}

export function surfaceMorningMemory(): Memory | null {
  if (memories.length === 0) return null;
  // Simple: rotate by day-of-year so a different memory surfaces each day
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000,
  );
  return memories[dayOfYear % memories.length];
}
