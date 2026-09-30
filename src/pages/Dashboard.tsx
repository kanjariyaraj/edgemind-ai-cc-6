import Layout from "@/components/Layout";
import { StatCard, SectionTitle, ScoreBar, ACTION_COLORS, timeAgo } from "@/components/bits";
import { trpc } from "@/providers/trpc";
import { Link } from "react-router";
import { ArrowRight, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const ACTIONS = ["keep_local", "sync", "compress", "defer", "discard"] as const;

export default function Dashboard() {
  const utils = trpc.useUtils();
  const status = trpc.system.status.useQuery(undefined, { refetchInterval: 5000 });
  const [draft, setDraft] = useState("");
  const [type, setType] = useState<"event" | "note" | "log" | "sensor">("event");
  const add = trpc.memories.add.useMutation({
    onSuccess: (r) => {
      utils.invalidate();
      setDraft("");
      toast.success(
        `Memory #${r.memory?.id} ingested — ${r.verdict.engine === "jev" ? "Jev" : "local policy"}: ${r.verdict.action.replace("_", " ").toUpperCase()}`,
      );
    },
    onError: (e) => toast.error(e.message),
  });
  const seed = trpc.seed.scenario.useMutation({
    onSuccess: (r) => {
      utils.invalidate();
      toast.success(`Demo scenario loaded: ${r.seeded} memories ingested through the Memory Governor`);
    },
    onError: (e) => toast.error(e.message),
  });

  const s = status.data;
  const total = s?.total ?? 0;
  const dist = s?.distribution ?? {};

  return (
    <Layout>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Local Memory, Intelligent Decisions</h1>
          <p className="mt-1 font-mono2 text-xs text-muted-foreground">
            Qdrant Edge · hybrid retrieval · Jev decision layer · offline-first sync
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => seed.mutate()}
            disabled={seed.isPending}
            className="rounded-md border border-border px-3 py-2 font-mono2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground min-h-[44px]"
          >
            {seed.isPending ? "INGESTING…" : "LOAD DEMO SCENARIO"}
          </button>
          <Link
            to="/memory"
            className="rounded-md px-3 py-2 font-mono2 text-xs font-semibold text-black transition-opacity hover:opacity-90 min-h-[44px] flex items-center"
            style={{ background: "#00d9a3" }}
          >
            EXPLORER <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Local Memory" value={total} sub="Qdrant Edge shards" />
        <StatCard label="Sync Queue" value={s?.queue ?? 0} sub="pending operations" accent={(s?.queue ?? 0) > 0 ? "#f5b04c" : undefined} />
        <StatCard label="Cloud Memory" value={s?.cloudCount ?? 0} sub={`${s?.synced ?? 0} synced · ${s?.conflicts ?? 0} conflicts`} accent={(s?.conflicts ?? 0) > 0 ? "#ff5454" : undefined} />
        <StatCard label="System Health" value={`${s?.health ?? 100}%`} sub={`avg decision ${s?.avgDecisionLatencyMs ?? 0}ms`} />
      </div>

      {/* Ingest */}
      <div className="surface mt-6 p-4 sm:p-5">
        <SectionTitle>Ingest new memory</SectionTitle>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Drop a maintenance log, sensor event, or technician note… e.g. “Machine A reported overheating at 14:32. Fan replacement was performed.”"
          className="min-h-[84px] w-full resize-y rounded-md border border-input bg-[#0d0d0d] p-3 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-[#00d9a3]"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(["event", "note", "log", "sensor"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`rounded border px-3 py-2 font-mono2 text-[11px] font-semibold tracking-wider min-h-[40px] transition-colors ${
                type === t ? "border-[#00d9a3] text-[#00d9a3]" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
          <button
            onClick={() => draft.trim().length >= 3 && add.mutate({ content: draft.trim(), memoryType: type })}
            disabled={add.isPending || draft.trim().length < 3}
            className="ml-auto flex items-center gap-1.5 rounded-md px-4 py-2 font-mono2 text-xs font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40 min-h-[44px]"
            style={{ background: "#00d9a3" }}
          >
            <Plus className="h-3.5 w-3.5" />
            {add.isPending ? "GOVERNING…" : s?.online ? "INGEST · JEV DECIDES" : "INGEST · LOCAL POLICY"}
          </button>
        </div>
        <p className="mt-2 font-mono2 text-[10px] text-muted-foreground">
          {s?.online
            ? "Online — Jev decision model will classify this memory (batched Choice + Score + Noul in one call)."
            : "Offline — deterministic local policy fallback keeps the device fully operational."}
        </p>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Memory intelligence distribution */}
        <div className="surface p-4 sm:p-5">
          <SectionTitle>Memory intelligence</SectionTitle>
          <div className="space-y-3.5">
            {ACTIONS.map((a) => {
              const n = dist[a] ?? 0;
              const pct = total > 0 ? (n / total) * 100 : 0;
              return (
                <div key={a}>
                  <div className="mb-1.5 flex items-center justify-between font-mono2 text-[11px]">
                    <span className="tracking-wider text-foreground/90">{a.replace("_", " ").toUpperCase()}</span>
                    <span className="text-muted-foreground">
                      {n} · {pct.toFixed(0)}%
                    </span>
                  </div>
                  <ScoreBar value={pct} max={100} color={ACTION_COLORS[a]} />
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex justify-between border-t border-border pt-3 font-mono2 text-[10px] text-muted-foreground">
            <span>JEV DECISION SHARE</span>
            <span className="text-[#00d9a3]">{((s?.jevShare ?? 0) * 100).toFixed(0)}%</span>
          </div>
        </div>

        {/* Recent decisions */}
        <div className="surface p-4 sm:p-5">
          <SectionTitle
            right={
              <Link to="/decisions" className="font-mono2 text-[11px] text-[#00d9a3] hover:underline">
                OBSERVATORY →
              </Link>
            }
          >
            Recent decisions
          </SectionTitle>
          <div className="space-y-2">
            {(s?.recentDecisions ?? []).length === 0 && (
              <p className="py-6 text-center font-mono2 text-xs text-muted-foreground">
                No decisions yet — ingest a memory or load the demo scenario.
              </p>
            )}
            {(s?.recentDecisions ?? []).map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-md border border-border bg-[#0d0d0d] px-3 py-2.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: d.engine === "jev" ? "#00d9a3" : "#f5b04c" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono2 text-[11px] font-semibold tracking-wider">
                    {d.action.replace("_", " ").toUpperCase()}
                    {d.memoryId ? <span className="text-muted-foreground"> · MEM #{d.memoryId}</span> : null}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">{d.rationale ?? d.queryText ?? ""}</div>
                </div>
                <div className="shrink-0 text-right font-mono2 text-[10px] text-muted-foreground">
                  <div style={{ color: d.engine === "jev" ? "#00d9a3" : "#f5b04c" }}>
                    {d.engine === "jev" ? "JEV" : "LOCAL"}
                  </div>
                  <div>{timeAgo(d.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}
