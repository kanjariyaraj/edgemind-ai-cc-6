import Layout from "@/components/Layout";
import { ScoreBar, StatusPill, SectionTitle } from "@/components/bits";
import { trpc } from "@/providers/trpc";
import { useState } from "react";
import { Search as SearchIcon, Sparkles, WifiOff } from "lucide-react";

const SUGGESTIONS = [
  "Why did Machine A overheat?",
  "battery error E104",
  "hydraulic leak safety",
  "recurring spindle vibration",
];

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [escalate, setEscalate] = useState(false);
  const [minImportance, setMinImportance] = useState(0);
  const search = trpc.search.query.useMutation();
  const status = trpc.system.status.useQuery();
  const online = status.data?.online ?? true;

  const run = (query: string) => {
    setQ(query);
    search.mutate({ query, escalate, minImportance: minImportance > 0 ? minImportance : undefined });
  };

  const r = search.data;

  return (
    <Layout>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Hybrid Retrieval</h1>
        <p className="mt-1 font-mono2 text-xs text-muted-foreground">
          Dense semantic + BM25 sparse, reciprocal-rank fused — works with the network off.
        </p>
      </div>

      <div className="surface p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && q.trim().length >= 2 && run(q.trim())}
              placeholder="Search local memory…"
              className="min-h-[48px] w-full rounded-md border border-input bg-[#0d0d0d] py-2.5 pl-10 pr-3 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-[#00d9a3]"
            />
          </div>
          <button
            onClick={() => q.trim().length >= 2 && run(q.trim())}
            disabled={search.isPending}
            className="rounded-md px-5 py-2.5 font-mono2 text-xs font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40 min-h-[48px]"
            style={{ background: "#00d9a3" }}
          >
            {search.isPending ? "SEARCHING…" : "SEARCH"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex cursor-pointer items-center gap-2 font-mono2 text-[11px] text-muted-foreground min-h-[44px]">
            <input
              type="checkbox"
              checked={escalate}
              onChange={(e) => setEscalate(e.target.checked)}
              className="h-4 w-4 accent-[#00d9a3]"
            />
            <Sparkles className="h-3.5 w-3.5" /> ESCALATE TO LLM WHEN ONLINE
          </label>
          <label className="flex items-center gap-2 font-mono2 text-[11px] text-muted-foreground min-h-[44px]">
            MIN IMPORTANCE
            <input
              type="range"
              min={0}
              max={10}
              value={minImportance}
              onChange={(e) => setMinImportance(Number(e.target.value))}
              className="w-24 accent-[#00d9a3]"
            />
            <span className="text-foreground">{minImportance > 0 ? minImportance : "—"}</span>
          </label>
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          {SUGGESTIONS.map((sug) => (
            <button
              key={sug}
              onClick={() => run(sug)}
              className="rounded-full border border-border px-3 py-1.5 font-mono2 text-[10px] text-muted-foreground transition-colors hover:border-[#00d9a3]/50 hover:text-foreground min-h-[36px]"
            >
              {sug}
            </button>
          ))}
        </div>
      </div>

      {/* Retrieval trace */}
      {r && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-[#0d0d0d] px-4 py-2.5 font-mono2 text-[10px] text-muted-foreground">
            <span>
              QUERY TERMS: <span className="text-foreground">{r.trace.queryTerms.slice(0, 8).join(" · ")}</span>
            </span>
            <span>
              DENSE <span className="text-[#00d9a3]">{r.trace.denseCandidates}</span>
            </span>
            <span>
              SPARSE <span className="text-[#6c80e3]">{r.trace.sparseCandidates}</span>
            </span>
            <span>
              LATENCY <span className="text-foreground">{r.trace.latencyMs}ms</span>
            </span>
            <span className="ml-auto font-semibold" style={{ color: r.retrievalDecision === "local_context_sufficient" ? "#00d9a3" : "#f5b04c" }}>
              {r.retrievalDecision.replace(/_/g, " ").toUpperCase()}
            </span>
          </div>

          {/* Answer */}
          {r.answer && (
            <div className="surface mt-3 p-4 sm:p-5">
              <div className="mb-2 flex items-center gap-2 font-mono2 text-[10px] font-semibold tracking-wider">
                {r.answerSource === "cloud_llm" ? (
                  <span className="text-[#6c80e3]">CLOUD LLM ANSWER</span>
                ) : (
                  <span className="text-[#00d9a3]">LOCAL ANSWER — RETRIEVAL ONLY, NO NETWORK</span>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{r.answer}</p>
            </div>
          )}

          {!online && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 font-mono2 text-[11px] text-amber-400">
              <WifiOff className="h-3.5 w-3.5" /> OFFLINE — results served entirely from Qdrant Edge local memory.
            </div>
          )}

          {/* Hits */}
          <div className="mt-3 space-y-2.5">
            {r.hits.map((h, i) => (
              <div key={h.memory.id} className="surface p-4">
                <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono2 text-[11px] font-bold text-muted-foreground">R{i + 1}</span>
                  <span className="font-mono2 text-[11px] font-semibold">#{h.memory.id}</span>
                  <span
                    className="rounded px-1.5 py-0.5 font-mono2 text-[9px] font-semibold tracking-wider"
                    style={{
                      color: h.matchSource === "hybrid" ? "#00d9a3" : h.matchSource === "sparse" ? "#6c80e3" : "#9ca3af",
                      background: (h.matchSource === "hybrid" ? "#00d9a3" : h.matchSource === "sparse" ? "#6c80e3" : "#9ca3af") + "18",
                    }}
                  >
                    {h.matchSource.toUpperCase()} MATCH
                  </span>
                  <StatusPill status={h.memory.syncStatus} />
                  <span className="ml-auto font-mono2 text-[10px] text-muted-foreground">
                    importance {h.memory.importance.toFixed(1)}
                  </span>
                </div>
                <p className="text-[13px] leading-relaxed text-foreground/90">{h.memory.content}</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <div className="mb-1 flex justify-between font-mono2 text-[9px] text-muted-foreground">
                      <span>DENSE (semantic)</span>
                      <span>{h.denseScore.toFixed(2)}</span>
                    </div>
                    <ScoreBar value={h.denseScore} max={1} color="#00d9a3" />
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between font-mono2 text-[9px] text-muted-foreground">
                      <span>SPARSE (BM25)</span>
                      <span>{h.sparseScore.toFixed(2)}</span>
                    </div>
                    <ScoreBar value={h.sparseScore} max={1} color="#6c80e3" />
                  </div>
                </div>
              </div>
            ))}
            {r.hits.length === 0 && (
              <div className="surface p-8 text-center font-mono2 text-xs text-muted-foreground">
                No local memory matched. {online ? "Jev would escalate this query to cloud retrieval." : "Reconnect to broaden retrieval to the cloud."}
              </div>
            )}
          </div>
        </div>
      )}

      {!r && (
        <div className="mt-4">
          <SectionTitle>How a query flows</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["01", "Dense + BM25 retrieval", "semantic meaning and exact terms fail in different ways — both run locally"],
              ["02", "RRF fusion + filters", "reciprocal rank fusion, then metadata filters on importance, type, sensitivity"],
              ["03", "Sufficiency decision", "is local context enough? escalate only when it isn't"],
              ["04", "LLM last resort", "generation is a consumer of memory, not the product"],
            ].map(([n, t, d]) => (
              <div key={n} className="surface p-4">
                <div className="font-mono2 text-[10px] text-[#00d9a3]">{n}</div>
                <div className="mt-1.5 font-display text-sm font-semibold">{t}</div>
                <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{d}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Layout>
  );
}
