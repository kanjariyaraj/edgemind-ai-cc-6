// Memory Governor — the decision layer ("Jev").
// Online: typed decision questions are batched into a single structured LLM
// call (choice + scores + noul), mirroring the Jev Choice/Score/Noul API.
// Offline: a deterministic threshold policy keeps the device fully
// operational — per the plan's failure/fallback architecture.

import { z } from "zod";
import { generateObject } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getDb } from "../queries/connection";
import { memories, decisions, activity, systemState } from "@db/schema";
import { desc, eq } from "drizzle-orm";
import { embed, tokenize, cosine, hashContent } from "./embeddings";
import { listModels, classifyAiError, AiUnavailable } from "./ai-client";

export type MemoryAction = "keep_local" | "sync" | "compress" | "defer" | "discard";

export interface GovernorVerdict {
  action: MemoryAction;
  importance: number; // 1..10
  futureUtility: number; // 1..10
  syncProbability: number; // 0..1
  confidence: number; // 0..1
  sensitivity: "public" | "internal" | "private";
  engine: "jev" | "local_policy";
  rationale: string;
  latencyMs: number;
}

export async function isOnline(): Promise<boolean> {
  const db = getDb();
  const row = await db.query.systemState.findFirst({
    where: eq(systemState.key, "network"),
  });
  return row ? row.value === "online" : true;
}

export async function setOnline(online: boolean) {
  const db = getDb();
  await db
    .insert(systemState)
    .values({ key: "network", value: online ? "online" : "offline" })
    .onDuplicateKeyUpdate({ set: { value: online ? "online" : "offline" } });
  await db.insert(activity).values({
    kind: "network",
    message: online
      ? "Connectivity restored — sync queue resumed"
      : "Network disabled — edge runtime operating offline",
    meta: { online },
  });
}

// ---------------------------------------------------------------------------
// Deterministic local policy (offline fallback)
// ---------------------------------------------------------------------------

const HIGH_SIGNAL = [
  "error", "failure", "failed", "overheat", "overheating", "critical", "fault",
  "replaced", "replacement", "maintenance", "repair", "inspection", "incident",
  "downtime", "breach", "alarm", "vibration", "leak", "anomaly", "bearing",
];
const LOW_SIGNAL = [
  "routine", "ok", "normal", "fine", "temp", "temporary", "test", "hello",
  "note to self", "reminder",
];
const PRIVATE_SIGNAL = [
  "password", "credential", "secret", "ssn", "personal", "salary", "medical",
];

function localPolicy(content: string, maxDuplicateSim: number): GovernorVerdict {
  const t0 = Date.now();
  const lower = content.toLowerCase();
  const terms = tokenize(content);
  const highHits = HIGH_SIGNAL.filter((s) => lower.includes(s)).length;
  const lowHits = LOW_SIGNAL.filter((s) => lower.includes(s)).length;
  const privateHits = PRIVATE_SIGNAL.filter((s) => lower.includes(s)).length;

  const sensitivity: GovernorVerdict["sensitivity"] =
    privateHits > 0 ? "private" : highHits > 0 ? "internal" : "public";

  let importance = 4 + highHits * 1.6 - lowHits * 1.2 + Math.min(terms.length, 40) / 25;
  importance = Math.max(1, Math.min(10, importance));

  const stale = lowHits > 1 && highHits === 0;
  let action: MemoryAction;
  let syncProbability: number;

  if (sensitivity === "private") {
    action = "keep_local";
    syncProbability = 0.05;
  } else if (maxDuplicateSim > 0.92) {
    action = "compress";
    syncProbability = 0.3;
  } else if (importance >= 7.5) {
    action = "sync";
    syncProbability = 0.85;
  } else if (importance >= 4.5) {
    action = "keep_local";
    syncProbability = 0.4;
  } else if (importance < 2.5 && stale) {
    action = "discard";
    syncProbability = 0.05;
  } else if (importance < 3.5) {
    action = "defer";
    syncProbability = 0.15;
  } else {
    action = "keep_local";
    syncProbability = 0.4;
  }

  return {
    action,
    importance,
    futureUtility: Math.max(1, Math.min(10, importance - 0.5 + highHits * 0.4)),
    syncProbability,
    confidence: 0.72,
    sensitivity,
    engine: "local_policy",
    rationale:
      `Deterministic threshold policy: importance ${importance.toFixed(1)} ` +
      `(${highHits} high-signal terms, ${lowHits} low-signal), ` +
      `duplicate similarity ${(maxDuplicateSim * 100).toFixed(0)}%, ` +
      `sensitivity ${sensitivity}.`,
    latencyMs: Date.now() - t0,
  };
}

// ---------------------------------------------------------------------------
// Jev — hosted decision model (batched typed questions in one call)
// ---------------------------------------------------------------------------

const jevSchema = z.object({
  action: z.enum(["keep_local", "sync", "compress", "defer", "discard"]).catch("keep_local"),
  importance: z.number().min(1).max(10).catch(5),
  syncProbability: z.number().min(0).max(1).catch(0.5),
  futureUtility: z.number().min(1).max(10).catch(5),
  sensitivity: z.enum(["public", "internal", "private"]).catch("internal"),
  confidence: z.number().min(0).max(1).catch(0.7),
  rationale: z.string().catch(""),
});

async function jevDecide(content: string, contextHint: string): Promise<GovernorVerdict> {
  const t0 = Date.now();
  const { defaultModelId } = await listModels();
  const provider = createOpenAICompatible({
    name: "kimi-gw",
    baseURL: process.env.KIMI_AGENTGW_BASE_URL!,
    apiKey: process.env.KIMI_AGENTGW_API_KEY!,
    supportsStructuredOutputs: true,
  });

  const { object } = await generateObject({
    model: provider(defaultModelId),
    schema: jevSchema,
    prompt: [
      "You are JEV, a typed decision model acting as the Memory Governor of an",
      "offline-first edge AI memory system in a field-maintenance environment.",
      "Answer these batched questions about the memory below:",
      "1. CHOICE: what memory action should be taken? The 'action' field must",
      "   be EXACTLY one of these five strings, no other value is valid:",
      "   - keep_local: useful but only relevant to this device",
      "   - sync: valuable operational knowledge other devices/teams need",
      "   - compress: redundant with existing memory, keep a summary",
      "   - defer: uncertain value, review later",
      "   - discard: noise, no future retrieval value",
      "2. SCORE importance 1 (disposable) → 10 (critical long-term memory)",
      "3. NOUL syncProbability: should this memory be synchronized to the cloud?",
      "4. SCORE futureUtility 1→10: likelihood of being useful later",
      "5. sensitivity: public / internal / private (private = must stay on device)",
      "Judge by operational value: failures, repairs, error codes and recurring",
      "faults are high value; routine readings and chatter are low value.",
      contextHint ? `\nContext: ${contextHint}` : "",
      `\nMEMORY:\n"""${content.slice(0, 1500)}"""`,
    ].join("\n"),
  });

  return {
    action: object.action,
    importance: object.importance,
    futureUtility: object.futureUtility,
    syncProbability: object.syncProbability,
    confidence: object.confidence,
    sensitivity: object.sensitivity,
    engine: "jev",
    rationale: object.rationale,
    latencyMs: Date.now() - t0,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function governNewMemory(memoryId: number, content: string): Promise<GovernorVerdict> {
  const db = getDb();
  const online = await isOnline();

  // duplicate detection against recent memory (dense similarity)
  const recent = await db
    .select()
    .from(memories)
    .orderBy(desc(memories.createdAt))
    .limit(100);
  const vec = embed(content);
  let maxSim = 0;
  for (const r of recent) {
    if (Number(r.id) === memoryId || !r.denseVector) continue;
    maxSim = Math.max(maxSim, cosine(vec, r.denseVector as number[]));
  }

  let verdict: GovernorVerdict;
  let aiError: string | null = null;
  if (online) {
    try {
      verdict = await jevDecide(
        content,
        maxSim > 0.85
          ? `A very similar memory already exists on this device (similarity ${(maxSim * 100).toFixed(0)}%).`
          : "",
      );
    } catch (err) {
      const classified = classifyAiError(err);
      aiError = classified.message;
      verdict = localPolicy(content, maxSim);
      verdict.rationale += ` [Jev unavailable: ${classified.name} — ${aiError}. Fell back to local policy.]`;
    }
  } else {
    verdict = localPolicy(content, maxSim);
    verdict.rationale += " [Offline: Jev unreachable, deterministic fallback active.]";
  }

  // Private data never leaves the device regardless of engine output.
  if (verdict.sensitivity === "private" && verdict.action === "sync") {
    verdict.action = "keep_local";
    verdict.syncProbability = Math.min(verdict.syncProbability, 0.1);
    verdict.rationale += " [Policy override: private memory is local-only.]";
  }

  await db
    .update(memories)
    .set({
      importance: verdict.importance,
      futureUtility: verdict.futureUtility,
      syncProbability: verdict.syncProbability,
      sensitivity: verdict.sensitivity,
      decisionAction: verdict.action,
      decisionConfidence: verdict.confidence,
      decisionEngine: verdict.engine,
      decisionRationale: verdict.rationale,
      syncStatus: verdict.action === "sync" ? "pending" : verdict.action === "discard" ? "local_only" : "local_only",
      state: verdict.action === "discard" ? "archived" : "active",
    })
    .where(eq(memories.id, memoryId));

  await db.insert(decisions).values({
    memoryId,
    engine: verdict.engine,
    kind: "ingest",
    action: verdict.action,
    importanceScore: verdict.importance,
    syncProbability: verdict.syncProbability,
    confidence: verdict.confidence,
    rationale: verdict.rationale,
    latencyMs: verdict.latencyMs,
  });

  await db.insert(activity).values({
    kind: "decision",
    message: `${verdict.engine === "jev" ? "Jev" : "Local policy"} decided ${verdict.action.toUpperCase()} (importance ${verdict.importance.toFixed(1)}, confidence ${(verdict.confidence * 100).toFixed(0)}%)`,
    meta: { memoryId, engine: verdict.engine, action: verdict.action, latencyMs: verdict.latencyMs },
  });

  return verdict;
}

export function embedForStorage(content: string) {
  return { denseVector: embed(content), tokenTerms: tokenize(content), contentHash: hashContent(content) };
}

export { AiUnavailable };
