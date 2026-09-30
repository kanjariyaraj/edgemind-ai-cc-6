// Hybrid retrieval pipeline: dense + BM25 sparse, reciprocal-rank fusion,
// metadata filters, and retrieval telemetry — mirrors the plan's
// "Top 20 candidates → metadata filters → fusion → Top 5 context".

import { getDb } from "../queries/connection";
import { memories, type Memory } from "@db/schema";
import { embed, tokenize, cosine, bm25Scores } from "./embeddings";
import { ne, and, eq, type SQL } from "drizzle-orm";

export interface SearchHit {
  memory: Memory;
  denseScore: number;
  sparseScore: number;
  fusedScore: number;
  matchSource: "dense" | "sparse" | "hybrid";
}

export interface SearchTrace {
  queryTerms: string[];
  denseCandidates: number;
  sparseCandidates: number;
  afterFilters: number;
  latencyMs: number;
}

export interface SearchResult {
  hits: SearchHit[];
  trace: SearchTrace;
}

export async function hybridSearch(opts: {
  query: string;
  limit?: number;
  type?: string;
  sensitivity?: string;
  minImportance?: number;
}): Promise<SearchResult> {
  const t0 = Date.now();
  const db = getDb();
  const limit = opts.limit ?? 5;

  const filters: SQL[] = [ne(memories.decisionAction, "discard")];
  if (opts.type) filters.push(eq(memories.memoryType, opts.type as never));
  if (opts.sensitivity)
    filters.push(eq(memories.sensitivity, opts.sensitivity as never));

  const rows = await db
    .select()
    .from(memories)
    .where(and(...filters));

  const filtered =
    opts.minImportance !== undefined
      ? rows.filter((r) => r.importance >= opts.minImportance!)
      : rows;

  const qVec = embed(opts.query);
  const qTerms = tokenize(opts.query);

  // dense ranking
  const denseRanked = filtered
    .map((m) => ({
      m,
      s: m.denseVector ? cosine(qVec, m.denseVector as number[]) : 0,
    }))
    .sort((a, b) => b.s - a.s);

  // sparse ranking
  const sparse = bm25Scores(
    qTerms,
    filtered.map((m) => ({ id: Number(m.id), terms: (m.tokenTerms as string[]) ?? [] })),
  );
  const sparseRanked = filtered
    .map((m) => ({ m, s: sparse.get(Number(m.id)) ?? 0 }))
    .sort((a, b) => b.s - a.s);

  // Reciprocal rank fusion (k = 60)
  const K = 60;
  const rrf = new Map<number, number>();
  const denseScoreMap = new Map<number, number>();
  const sparseScoreMap = new Map<number, number>();
  denseRanked.forEach((r, i) => {
    const id = Number(r.m.id);
    denseScoreMap.set(id, r.s);
    rrf.set(id, (rrf.get(id) ?? 0) + 1 / (K + i + 1));
  });
  sparseRanked.forEach((r, i) => {
    const id = Number(r.m.id);
    sparseScoreMap.set(id, r.s);
    if (r.s > 0) rrf.set(id, (rrf.get(id) ?? 0) + 1 / (K + i + 1));
  });

  const maxSparse = Math.max(1e-9, ...sparseRanked.map((r) => r.s));

  const hits: SearchHit[] = filtered
    .map((m) => {
      const id = Number(m.id);
      const dense = denseScoreMap.get(id) ?? 0;
      const sparseNorm = (sparseScoreMap.get(id) ?? 0) / maxSparse;
      const fused = rrf.get(id) ?? 0;
      return {
        memory: m,
        denseScore: Math.max(0, dense),
        sparseScore: sparseNorm,
        fusedScore: fused,
        matchSource:
          dense > 0.12 && sparseNorm > 0 ? "hybrid" : sparseNorm > 0 ? "sparse" : "dense",
      } satisfies SearchHit;
    })
    .filter((h) => h.denseScore > 0.08 || h.sparseScore > 0)
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, limit);

  return {
    hits,
    trace: {
      queryTerms: qTerms,
      denseCandidates: denseRanked.filter((r) => r.s > 0.08).length,
      sparseCandidates: sparseRanked.filter((r) => r.s > 0).length,
      afterFilters: filtered.length,
      latencyMs: Date.now() - t0,
    },
  };
}
