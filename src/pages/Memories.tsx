import Layout from "@/components/Layout";
import { ActionBadge, StatusPill, ScoreBar, SectionTitle, timeAgo, STATE_COLORS } from "@/components/bits";
import { trpc } from "@/providers/trpc";
import { useState } from "react";
import { X, Pencil, Trash2, Check } from "lucide-react";
import { toast } from "sonner";

const ACTION_FILTERS = ["all", "keep_local", "sync", "compress", "defer", "discard"];

export default function Memories() {
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<number | null>(null);
  const list = trpc.memories.list.useQuery(
    filter === "all" ? {} : { action: filter },
    { refetchInterval: 6000 },
  );
  const detail = trpc.memories.get.useQuery({ id: selected! }, { enabled: selected !== null });
  const remove = trpc.memories.remove.useMutation({
    onSuccess: () => {
      utils.invalidate();
      setSelected(null);
      toast.success("Memory deleted");
    },
  });
  const update = trpc.memories.update.useMutation({
    onSuccess: () => {
      utils.invalidate();
      setEditing(false);
      toast.success("Memory updated — version bumped, re-queued for sync");
    },
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const m = detail.data?.memory;

  return (
    <Layout>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Memory Explorer</h1>
        <p className="mt-1 font-mono2 text-xs text-muted-foreground">
          Every memory carries its governor scores, decision and sync state.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {ACTION_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded border px-3 py-2 font-mono2 text-[10px] font-semibold tracking-wider min-h-[40px] transition-colors ${
              filter === f ? "border-[#00d9a3] text-[#00d9a3]" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.replace("_", " ").toUpperCase()}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(list.data ?? []).map((mem) => (
          <button
            key={mem.id}
            onClick={() => {
              setSelected(Number(mem.id));
              setEditing(false);
            }}
            className="surface p-4 text-left transition-colors hover:border-[#00d9a3]/50 min-h-[44px]"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-mono2 text-[11px] font-semibold text-muted-foreground">#{mem.id}</span>
              <StatusPill status={mem.syncStatus} />
            </div>
            <p className="line-clamp-3 text-[13px] leading-relaxed text-foreground/90">{mem.content}</p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <ActionBadge action={mem.decisionAction} />
              <span
                className="font-mono2 text-[10px] font-semibold tracking-wider"
                style={{ color: STATE_COLORS[mem.state] ?? "#9ca3af" }}
              >
                {mem.state.toUpperCase()}
              </span>
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <ScoreBar value={mem.importance} color="#00d9a3" />
              <span className="font-mono2 text-[10px] text-muted-foreground">{mem.importance.toFixed(1)}</span>
            </div>
          </button>
        ))}
        {(list.data ?? []).length === 0 && !list.isLoading && (
          <div className="surface col-span-full p-10 text-center font-mono2 text-xs text-muted-foreground">
            No memories match — ingest one from the dashboard or load the demo scenario.
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selected !== null && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={() => setSelected(null)}>
          <div
            className="h-full w-full max-w-lg overflow-y-auto border-l border-border bg-[#0d0d0d] p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {detail.isLoading || !m ? (
              <p className="font-mono2 text-xs text-muted-foreground">Loading…</p>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-display text-xl font-bold">Memory #{m.id}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditing(!editing);
                        setDraft(m.content);
                      }}
                      className="rounded-md border border-border p-2.5 text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => remove.mutate({ id: Number(m.id) })}
                      className="rounded-md border border-border p-2.5 text-muted-foreground hover:text-red-400 min-h-[44px] min-w-[44px] flex items-center justify-center"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setSelected(null)}
                      className="rounded-md border border-border p-2.5 text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <ActionBadge action={m.decisionAction} />
                  <StatusPill status={m.syncStatus} />
                  <span className="font-mono2 text-[10px] text-muted-foreground">
                    v{m.version} · {m.deviceId} · {m.memoryType}
                  </span>
                </div>

                {editing ? (
                  <div>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      className="min-h-[120px] w-full rounded-md border border-input bg-[#141414] p-3 text-sm outline-none focus:border-[#00d9a3]"
                    />
                    <button
                      onClick={() => update.mutate({ id: Number(m.id), content: draft })}
                      disabled={update.isPending}
                      className="mt-2 flex items-center gap-1.5 rounded-md px-4 py-2 font-mono2 text-xs font-semibold text-black min-h-[44px]"
                      style={{ background: "#00d9a3" }}
                    >
                      <Check className="h-3.5 w-3.5" /> SAVE v{m.version + 1}
                    </button>
                  </div>
                ) : (
                  <p className="rounded-md border border-border bg-[#141414] p-4 text-sm leading-relaxed">{m.content}</p>
                )}

                <div className="mt-5 space-y-4">
                  <div>
                    <div className="mb-1 flex justify-between font-mono2 text-[10px] text-muted-foreground">
                      <span>IMPORTANCE</span>
                      <span>{m.importance.toFixed(1)}/10</span>
                    </div>
                    <ScoreBar value={m.importance} color="#00d9a3" />
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between font-mono2 text-[10px] text-muted-foreground">
                      <span>FUTURE UTILITY</span>
                      <span>{m.futureUtility.toFixed(1)}/10</span>
                    </div>
                    <ScoreBar value={m.futureUtility} color="#6c80e3" />
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between font-mono2 text-[10px] text-muted-foreground">
                      <span>SYNC PROBABILITY</span>
                      <span>{(m.syncProbability * 100).toFixed(0)}%</span>
                    </div>
                    <ScoreBar value={m.syncProbability} max={1} color="#f5b04c" />
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2 font-mono2 text-[11px]">
                  <div className="surface p-3">
                    <div className="label-caps">Sensitivity</div>
                    <div className="mt-1 font-semibold" style={{ color: m.sensitivity === "private" ? "#ff5454" : m.sensitivity === "internal" ? "#f5b04c" : "#00d9a3" }}>
                      {m.sensitivity.toUpperCase()}
                    </div>
                  </div>
                  <div className="surface p-3">
                    <div className="label-caps">Retrievals</div>
                    <div className="mt-1 font-semibold">{m.retrievalCount}× · {m.state.toUpperCase()}</div>
                  </div>
                </div>

                {/* Decision */}
                <div className="mt-5">
                  <SectionTitle>Decision</SectionTitle>
                  <div className="surface p-4">
                    <div className="flex items-center justify-between font-mono2 text-[11px]">
                      <span style={{ color: m.decisionEngine === "jev" ? "#00d9a3" : "#f5b04c" }} className="font-semibold">
                        {m.decisionEngine === "jev" ? "JEV DECISION MODEL" : "LOCAL POLICY FALLBACK"}
                      </span>
                      <span className="text-muted-foreground">confidence {(m.decisionConfidence * 100).toFixed(0)}%</span>
                    </div>
                    {m.decisionRationale && (
                      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{m.decisionRationale}</p>
                    )}
                  </div>
                </div>

                {/* Cloud state */}
                <div className="mt-5">
                  <SectionTitle>Cloud state</SectionTitle>
                  <div className="surface p-4 font-mono2 text-[11px]">
                    {detail.data?.cloud ? (
                      <>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">QDRANT SERVER</span>
                          <span className="text-[#00d9a3]">v{detail.data.cloud.cloudVersion} · synced {timeAgo(detail.data.cloud.syncedAt)}</span>
                        </div>
                        {detail.data.cloud.contentHash !== m.contentHash && (
                          <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-red-400">
                            HASH MISMATCH — cloud and device have diverged
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">Not present in cloud memory.</span>
                    )}
                  </div>
                </div>

                {/* Decision history */}
                {(detail.data?.decisions ?? []).length > 0 && (
                  <div className="mt-5">
                    <SectionTitle>Decision history</SectionTitle>
                    <div className="space-y-2">
                      {detail.data!.decisions.map((d) => (
                        <div key={d.id} className="rounded-md border border-border bg-[#141414] p-3">
                          <div className="flex justify-between font-mono2 text-[10px]">
                            <span className="font-semibold">{d.action.replace("_", " ").toUpperCase()}</span>
                            <span className="text-muted-foreground">{timeAgo(d.createdAt)}</span>
                          </div>
                          {d.rationale && <p className="mt-1 text-[11px] text-muted-foreground">{d.rationale}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
