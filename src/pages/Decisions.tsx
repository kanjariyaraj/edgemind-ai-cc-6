import Layout from "@/components/Layout";
import { SectionTitle, ACTION_COLORS, timeAgo } from "@/components/bits";
import { trpc } from "@/providers/trpc";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

const ACTIONS = ["keep_local", "sync", "compress", "defer", "discard"];

export default function Decisions() {
  const list = trpc.decisions.list.useQuery(undefined, { refetchInterval: 6000 });
  const status = trpc.system.status.useQuery();
  const [open, setOpen] = useState<number | null>(null);

  const ingest = (list.data ?? []).filter((d) => d.kind === "ingest");
  const total = ingest.length || 1;
  const byAction = Object.fromEntries(
    ACTIONS.map((a) => [a, ingest.filter((d) => d.action === a).length]),
  );
  const online = status.data?.online ?? true;
  const jevCount = ingest.filter((d) => d.engine === "jev").length;

  return (
    <Layout>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Decision Observatory</h1>
        <p className="mt-1 font-mono2 text-xs text-muted-foreground">
          The Memory Governor's decision graph — explainable without generated explanations.
        </p>
      </div>

      {/* Flow visualization */}
      <div className="surface overflow-x-auto p-5 sm:p-6">
        <div className="mx-auto min-w-[560px] max-w-2xl">
          <div className="flex flex-col items-center">
            <div className="rounded-md border border-border bg-[#0d0d0d] px-6 py-3 font-mono2 text-xs font-semibold tracking-wider">
              NEW MEMORY
            </div>
            <div className="h-6 w-px bg-border" />
            <div
              className="rounded-md px-6 py-3 font-mono2 text-xs font-bold tracking-wider text-black"
              style={{ background: online ? "#00d9a3" : "#f5b04c" }}
            >
              {online ? "JEV · DECISION MODEL" : "LOCAL POLICY · OFFLINE FALLBACK"}
            </div>
            <div className="h-6 w-px bg-border" />
            <svg viewBox="0 0 560 30" className="w-full" aria-hidden>
              {ACTIONS.map((_, i) => {
                const x = 56 + i * 112;
                return (
                  <line key={i} x1="280" y1="0" x2={x} y2="30" stroke="#242424" strokeWidth="1.5" />
                );
              })}
            </svg>
            <div className="grid w-full grid-cols-5 gap-2">
              {ACTIONS.map((a) => {
                const n = byAction[a] ?? 0;
                const pct = Math.round((n / total) * 100);
                return (
                  <div
                    key={a}
                    className="rounded-md border p-2.5 text-center"
                    style={{ borderColor: ACTION_COLORS[a] + "44", background: ACTION_COLORS[a] + "0d" }}
                  >
                    <div className="font-mono2 text-[9px] font-semibold tracking-wider" style={{ color: ACTION_COLORS[a] }}>
                      {a.replace("_", " ").toUpperCase()}
                    </div>
                    <div className="font-display mt-1 text-xl font-bold">{pct}%</div>
                    <div className="font-mono2 text-[9px] text-muted-foreground">{n} memories</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="surface p-4">
          <div className="label-caps">Decision engine</div>
          <div className="font-display mt-2 text-2xl font-bold" style={{ color: online ? "#00d9a3" : "#f5b04c" }}>
            {online ? "JEV" : "LOCAL POLICY"}
          </div>
          <div className="mt-1 font-mono2 text-[10px] text-muted-foreground">
            {online ? "hosted decision model, batched typed questions" : "deterministic thresholds, fully offline"}
          </div>
        </div>
        <div className="surface p-4">
          <div className="label-caps">Jev coverage</div>
          <div className="font-display mt-2 text-2xl font-bold">
            {ingest.length > 0 ? Math.round((jevCount / ingest.length) * 100) : 0}%
          </div>
          <div className="mt-1 font-mono2 text-[10px] text-muted-foreground">
            {jevCount} of {ingest.length} ingest decisions by Jev
          </div>
        </div>
        <div className="surface p-4">
          <div className="label-caps">Avg decision latency</div>
          <div className="font-display mt-2 text-2xl font-bold">{status.data?.avgDecisionLatencyMs ?? 0}ms</div>
          <div className="mt-1 font-mono2 text-[10px] text-muted-foreground">governor per-memory cost</div>
        </div>
      </div>

      {/* Decision log */}
      <div className="mt-6">
        <SectionTitle>Decision log</SectionTitle>
        <div className="space-y-2">
          {(list.data ?? []).map((d) => {
            const expanded = open === d.id;
            return (
              <button
                key={d.id}
                onClick={() => setOpen(expanded ? null : d.id)}
                className="surface w-full p-4 text-left transition-colors hover:border-[#00d9a3]/40 min-h-[44px]"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span
                    className="rounded px-1.5 py-0.5 font-mono2 text-[9px] font-bold tracking-wider"
                    style={{
                      color: d.engine === "jev" ? "#00d9a3" : "#f5b04c",
                      background: (d.engine === "jev" ? "#00d9a3" : "#f5b04c") + "18",
                    }}
                  >
                    {d.engine === "jev" ? "JEV" : "LOCAL"}
                  </span>
                  <span className="font-mono2 text-[11px] font-semibold tracking-wider" style={{ color: ACTION_COLORS[d.action] ?? "#e5e5e5" }}>
                    {d.action.replace(/_/g, " ").toUpperCase()}
                  </span>
                  <span className="font-mono2 text-[10px] text-muted-foreground">
                    {d.kind.toUpperCase()}
                    {d.memoryId ? ` · MEM #${d.memoryId}` : ""}
                    {d.latencyMs ? ` · ${d.latencyMs}ms` : ""}
                  </span>
                  <span className="ml-auto flex items-center gap-2 font-mono2 text-[10px] text-muted-foreground">
                    {timeAgo(d.createdAt)}
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </span>
                </div>
                {d.queryText && <p className="mt-1.5 font-mono2 text-[11px] text-muted-foreground">“{d.queryText}”</p>}
                {expanded && (
                  <div className="mt-3 space-y-2 border-t border-border pt-3">
                    <div className="grid grid-cols-3 gap-2 font-mono2 text-[10px]">
                      <div className="rounded border border-border bg-[#0d0d0d] p-2">
                        <div className="text-muted-foreground">IMPORTANCE</div>
                        <div className="mt-0.5 text-sm font-bold">{d.importanceScore?.toFixed(1) ?? "—"}</div>
                      </div>
                      <div className="rounded border border-border bg-[#0d0d0d] p-2">
                        <div className="text-muted-foreground">SYNC PROB</div>
                        <div className="mt-0.5 text-sm font-bold">
                          {d.syncProbability !== null && d.syncProbability !== undefined
                            ? `${(d.syncProbability * 100).toFixed(0)}%`
                            : "—"}
                        </div>
                      </div>
                      <div className="rounded border border-border bg-[#0d0d0d] p-2">
                        <div className="text-muted-foreground">CONFIDENCE</div>
                        <div className="mt-0.5 text-sm font-bold">
                          {d.confidence !== null && d.confidence !== undefined ? `${(d.confidence * 100).toFixed(0)}%` : "—"}
                        </div>
                      </div>
                    </div>
                    <div className="rounded border border-border bg-[#0d0d0d] p-3">
                      <div className="label-caps mb-1.5">Decision trace</div>
                      <ol className="space-y-1 font-mono2 text-[10px] text-muted-foreground">
                        <li>1. INPUT — memory content + context state</li>
                        <li>2. TYPED QUESTIONS — choice + score + noul (batched)</li>
                        <li>3. PROBABILITIES — action / importance / sync / confidence</li>
                        <li>4. THRESHOLD POLICY — deterministic guardrails applied</li>
                        <li>5. ACTION — application executes {d.action.replace(/_/g, " ").toUpperCase()}</li>
                      </ol>
                    </div>
                    {d.rationale && <p className="text-[12px] leading-relaxed text-muted-foreground">{d.rationale}</p>}
                  </div>
                )}
              </button>
            );
          })}
          {(list.data ?? []).length === 0 && !list.isLoading && (
            <div className="surface p-10 text-center font-mono2 text-xs text-muted-foreground">
              No decisions recorded yet.
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
