import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { memories, decisions, activity, cloudMemories } from "@db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { hybridSearch } from "./edge/search";
import { embedForStorage, governNewMemory, isOnline, setOnline } from "./edge/governor";
import { runSync, resolveConflict, simulateCloudEdit } from "./edge/sync";
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { listModels, classifyAiError } from "./edge/ai-client";

const systemRouter = createRouter({
  status: publicQuery.query(async () => {
    const db = getDb();
    const online = await isOnline();
    const all = await db.select().from(memories);
    const queue = all.filter((m) => m.syncStatus === "pending").length;
    const synced = all.filter((m) => m.syncStatus === "synced").length;
    const conflicts = all.filter((m) => m.syncStatus === "conflict").length;
    const cloudCount = (await db.select({ c: sql<number>`count(*)` }).from(cloudMemories))[0]?.c ?? 0;

    const dist = { keep_local: 0, sync: 0, compress: 0, defer: 0, discard: 0 } as Record<string, number>;
    for (const m of all) dist[m.decisionAction] = (dist[m.decisionAction] ?? 0) + 1;

    const decs = await db.select().from(decisions).orderBy(desc(decisions.createdAt)).limit(8);
    const avgLatency =
      decs.length > 0 ? decs.reduce((s, d) => s + (d.latencyMs ?? 0), 0) / decs.length : 0;
    const jevCount = all.filter((m) => m.decisionEngine === "jev").length;

    return {
      online,
      total: all.length,
      queue,
      synced,
      conflicts,
      cloudCount: Number(cloudCount),
      distribution: dist,
      recentDecisions: decs,
      avgDecisionLatencyMs: Math.round(avgLatency),
      jevShare: all.length > 0 ? jevCount / all.length : 0,
      health: Math.max(80, Math.min(100, 100 - conflicts * 4)),
    };
  }),
  setOnline: publicQuery
    .input(z.object({ online: z.boolean() }))
    .mutation(async ({ input }) => {
      await setOnline(input.online);
      let syncReport = null;
      if (input.online) syncReport = await runSync();
      return { online: input.online, syncReport };
    }),
});

const memoriesRouter = createRouter({
  list: publicQuery
    .input(
      z
        .object({
          state: z.string().optional(),
          action: z.string().optional(),
          sensitivity: z.string().optional(),
          syncStatus: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db.select().from(memories).orderBy(desc(memories.createdAt)).limit(200);
      return rows.filter(
        (m) =>
          (!input?.state || m.state === input.state) &&
          (!input?.action || m.decisionAction === input.action) &&
          (!input?.sensitivity || m.sensitivity === input.sensitivity) &&
          (!input?.syncStatus || m.syncStatus === input.syncStatus),
      );
    }),

  get: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const db = getDb();
    const memory = await db.query.memories.findFirst({ where: eq(memories.id, input.id) });
    const cloud = await db.query.cloudMemories.findFirst({
      where: eq(cloudMemories.memoryId, input.id),
    });
    const memoryDecisions = await db
      .select()
      .from(decisions)
      .where(eq(decisions.memoryId, input.id))
      .orderBy(desc(decisions.createdAt));
    return { memory, cloud, decisions: memoryDecisions };
  }),

  add: publicQuery
    .input(
      z.object({
        content: z.string().min(3).max(4000),
        memoryType: z
          .enum(["event", "note", "log", "document", "conversation", "sensor"])
          .default("note"),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const t0 = Date.now();
      const { denseVector, tokenTerms, contentHash } = embedForStorage(input.content);
      const [{ id }] = await db
        .insert(memories)
        .values({
          content: input.content,
          memoryType: input.memoryType,
          denseVector,
          tokenTerms,
          contentHash,
          syncStatus: "local_only",
        })
        .$returningId();

      await db.insert(activity).values({
        kind: "ingest",
        message: `Memory #${id} ingested and embedded locally (${denseVector.length}-dim dense + ${tokenTerms.length} sparse terms)`,
        meta: { memoryId: id, type: input.memoryType },
      });

      const verdict = await governNewMemory(id, input.content);
      const memory = await db.query.memories.findFirst({ where: eq(memories.id, id) });
      return { memory, verdict, ingestLatencyMs: Date.now() - t0 };
    }),

  update: publicQuery
    .input(z.object({ id: z.number(), content: z.string().min(3).max(4000) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.query.memories.findFirst({ where: eq(memories.id, input.id) });
      if (!existing) throw new Error("Memory not found");
      const { denseVector, tokenTerms, contentHash } = embedForStorage(input.content);
      const wasSynced = existing.syncStatus === "synced";
      await db
        .update(memories)
        .set({
          content: input.content,
          denseVector,
          tokenTerms,
          contentHash,
          version: existing.version + 1,
          syncStatus: wasSynced || existing.decisionAction === "sync" ? "pending" : existing.syncStatus,
          updatedAt: new Date(),
        })
        .where(eq(memories.id, input.id));
      await db.insert(activity).values({
        kind: "ingest",
        message: `Memory #${input.id} updated to v${existing.version + 1}${wasSynced ? " — re-queued for sync" : ""}`,
        meta: { memoryId: input.id, version: existing.version + 1 },
      });
      return db.query.memories.findFirst({ where: eq(memories.id, input.id) });
    }),

  remove: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = getDb();
    await db.delete(memories).where(eq(memories.id, input.id));
    await db.delete(cloudMemories).where(eq(cloudMemories.memoryId, input.id));
    await db.insert(activity).values({
      kind: "ingest",
      message: `Memory #${input.id} deleted (tombstone propagated)`,
      meta: { memoryId: input.id },
    });
    return { ok: true };
  }),
});

const searchRouter = createRouter({
  query: publicQuery
    .input(
      z.object({
        query: z.string().min(2).max(500),
        type: z.string().optional(),
        sensitivity: z.string().optional(),
        minImportance: z.number().min(1).max(10).optional(),
        escalate: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const online = await isOnline();
      const result = await hybridSearch(input);

      // Retrieval bookkeeping: frequently-retrieved memory gets promoted.
      for (const hit of result.hits.slice(0, 3)) {
        const m = hit.memory;
        const newCount = m.retrievalCount + 1;
        await db
          .update(memories)
          .set({
            retrievalCount: newCount,
            state: m.state === "archived" ? m.state : newCount >= 5 ? "promoted" : "active",
            freshness: Math.min(1, m.freshness + 0.05),
          })
          .where(eq(memories.id, m.id));
      }

      const top = result.hits[0];
      const sufficient = !!top && (top.denseScore > 0.25 || top.sparseScore > 0.25);
      const retrievalDecision = !top
        ? "no_local_memory"
        : sufficient
          ? "local_context_sufficient"
          : online
            ? "escalate_to_cloud"
            : "offline_limited";

      let answer: string | null = null;
      let answerSource: "local_extractive" | "cloud_llm" | "unavailable" = "unavailable";

      if (result.hits.length > 0) {
        if (input.escalate && online) {
          // LLM is a consumer of the memory platform — only on escalation.
          try {
            const { defaultModelId } = await listModels();
            const provider = createOpenAICompatible({
              name: "kimi-gw",
              baseURL: process.env.KIMI_AGENTGW_BASE_URL!,
              apiKey: process.env.KIMI_AGENTGW_API_KEY!,
              supportsStructuredOutputs: true,
            });
            const ctx = result.hits
              .map((h) => `[memory #${h.memory.id} | importance ${h.memory.importance.toFixed(1)}]\n${h.memory.content}`)
              .join("\n\n");
            const { text } = await generateText({
              model: provider(defaultModelId),
              prompt: `You are the answer layer of an offline-first edge memory system. Answer the question using ONLY the retrieved local memories below. Be concise, cite memory ids like [#12]. If the memories don't contain the answer, say what's known and what's missing.\n\nQUESTION: ${input.query}\n\nRETRIEVED MEMORIES:\n${ctx}`,
            });
            answer = text;
            answerSource = "cloud_llm";
          } catch (err) {
            classifyAiError(err);
            answer = null;
            answerSource = "unavailable";
          }
        }
        if (!answer) {
          answer = result.hits
            .slice(0, 3)
            .map((h) => `[#${h.memory.id}] ${h.memory.content.split("\n")[0].slice(0, 220)}`)
            .join("\n");
          answerSource = "local_extractive";
        }
      }

      await db.insert(decisions).values({
        engine: online ? "jev" : "local_policy",
        kind: "retrieval",
        queryText: input.query,
        action: retrievalDecision,
        confidence: top ? Math.max(top.denseScore, top.sparseScore) : 0,
        rationale: `Hybrid retrieval: ${result.trace.denseCandidates} dense + ${result.trace.sparseCandidates} sparse candidates, fused top score ${top ? Math.max(top.denseScore, top.sparseScore).toFixed(2) : "0"}. ${sufficient ? "Local context sufficient." : "Local context insufficient."}`,
        latencyMs: result.trace.latencyMs,
      });
      await db.insert(activity).values({
        kind: "search",
        message: `Hybrid search "${input.query.slice(0, 60)}" → ${result.hits.length} hits in ${result.trace.latencyMs}ms (${retrievalDecision})`,
        meta: { query: input.query, hits: result.hits.length, decision: retrievalDecision },
      });

      return { ...result, online, retrievalDecision, answer, answerSource };
    }),
});

const syncRouter = createRouter({
  run: publicQuery.mutation(async () => runSync()),
  queue: publicQuery.query(async () => {
    const db = getDb();
    const pending = await db.query.memories.findMany({ where: eq(memories.syncStatus, "pending") });
    const conflicts = await db.query.memories.findMany({
      where: eq(memories.syncStatus, "conflict"),
    });
    const cloud = await db.select().from(cloudMemories).orderBy(desc(cloudMemories.syncedAt));
    const conflictsWithCloud = await Promise.all(
      conflicts.map(async (m) => ({
        memory: m,
        cloud: await db.query.cloudMemories.findFirst({
          where: eq(cloudMemories.memoryId, Number(m.id)),
        }),
      })),
    );
    return { pending, conflicts: conflictsWithCloud, cloud };
  }),
  resolveConflict: publicQuery
    .input(z.object({ memoryId: z.number(), choice: z.enum(["device", "cloud", "both"]) }))
    .mutation(async ({ input }) => {
      await resolveConflict(input.memoryId, input.choice);
      return { ok: true };
    }),
  simulateCloudEdit: publicQuery
    .input(z.object({ memoryId: z.number() }))
    .mutation(async ({ input }) => {
      await simulateCloudEdit(input.memoryId);
      return { ok: true };
    }),
});

const decisionsRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb();
    return db.select().from(decisions).orderBy(desc(decisions.createdAt)).limit(100);
  }),
});

const activityRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb();
    return db.select().from(activity).orderBy(desc(activity.createdAt)).limit(150);
  }),
});

const seedRouter = createRouter({
  scenario: publicQuery.mutation(async () => {
    const samples: Array<{ content: string; memoryType: "event" | "note" | "log" | "document" | "sensor" }> = [
      { content: "Machine A reported overheating at 14:32. Fan replacement was performed. New fan appears stable, temperature back within normal range.", memoryType: "event" },
      { content: "Error E104 on conveyor belt controller — power supply unit showing voltage drops under load. Replacement PSU ordered.", memoryType: "log" },
      { content: "Routine temperature log: hall 2 ambient 21.4C, all machines within normal operating range.", memoryType: "sensor" },
      { content: "Hydraulic press HP-7 leaking fluid near main seal. Maintenance scheduled for tomorrow morning shift. Marked as safety priority.", memoryType: "event" },
      { content: "Technician note: Machine A has overheated three times this quarter. Root cause may be dust buildup in intake filters, not the fan itself. Recommend monthly filter inspection.", memoryType: "note" },
      { content: "Network outage in warehouse B for 40 minutes. Edge devices continued logging locally and synced after recovery.", memoryType: "event" },
      { content: "Vibration anomaly detected on CNC spindle S-12, amplitude 4.2mm/s exceeding 3.5 threshold. Bearing wear suspected, inspection requested.", memoryType: "sensor" },
      { content: "Shift handover: replaced coolant filter on lathe L-3, calibrated torque wrench set, no open incidents remaining.", memoryType: "log" },
      { content: "Password for the old PLC cabinet keypad is written on a sticker inside panel door — needs to be rotated and stored properly.", memoryType: "note" },
      { content: "Battery backup unit BBU-2 failed self-test, error E104 variant. Swapped with spare from inventory shelf 4.", memoryType: "event" },
      { content: "Weekly summary: 3 minor incidents, all resolved. Machine A fan replacement successful. Filter inspection policy adopted.", memoryType: "document" },
      { content: "Temporary sensor calibration drift on thermal probe T-9, readings off by 0.3C. Auto-corrected, low priority.", memoryType: "sensor" },
    ];
    const results = [];
    for (const s of samples) {
      const db = getDb();
      const { denseVector, tokenTerms, contentHash } = embedForStorage(s.content);
      const [{ id }] = await db
        .insert(memories)
        .values({ content: s.content, memoryType: s.memoryType, denseVector, tokenTerms, contentHash })
        .$returningId();
      const verdict = await governNewMemory(id, s.content);
      results.push({ id, action: verdict.action });
    }
    await getDb().insert(activity).values({
      kind: "ingest",
      message: `Demo scenario loaded: ${samples.length} field-maintenance memories ingested`,
      meta: { count: samples.length },
    });
    return { seeded: results.length, results };
  }),
});

export const appRouter = createRouter({
  system: systemRouter,
  memories: memoriesRouter,
  search: searchRouter,
  sync: syncRouter,
  decisions: decisionsRouter,
  activity: activityRouter,
  seed: seedRouter,
});

export type AppRouter = typeof appRouter;
