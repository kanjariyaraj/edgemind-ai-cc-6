import Layout from "@/components/Layout";
import { SectionTitle, StatusPill, timeAgo } from "@/components/bits";
import { trpc } from "@/providers/trpc";
import { RefreshCw, Zap } from "lucide-react";
import { toast } from "sonner";

const STAGES = ["local_only", "pending", "syncing", "synced"] as const;

export default function SyncPage() {
  const utils = trpc.useUtils();
  const status = trpc.system.status.useQuery(undefined, { refetchInterval: 5000 });
  const queue = trpc.sync.queue.useQuery(undefined, { refetchInterval: 5000 });
  const run = trpc.sync.run.useMutation({
    onSuccess: (r) => {
      utils.invalidate();
      if (r.skippedOffline) toast.warning("Offline — queue retained, sync will retry when connectivity returns");
      else toast.success(`Sync pass: ${r.synced} synced, ${r.conflicts} conflicts`);
    },
  });
  const resolve = trpc.sync.resolveConflict.useMutation({
    onSuccess: () => {
      utils.invalidate();
      toast.success("Conflict resolved");
    },
  });
  const cloudEdit = trpc.sync.simulateCloudEdit.useMutation({
    onSuccess: () => {
      utils.invalidate();
      toast.info("Remote device edited this memory — next sync will surface a conflict");
    },
    onError: (e) => toast.error(e.message),
  });

  const online = status.data?.online ?? true;
  const pending = queue.data?.pending ?? [];
  const conflicts = queue.data?.conflicts ?? [];
  const cloud = queue.data?.cloud ?? [];

  return (
    <Layout>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Synchronization</h1>
          <p className="mt-1 font-mono2 text-xs text-muted-foreground">
            Offline queue → Qdrant Server, with version & hash conflict detection.
          </p>
        </div>
        <button
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="flex items-center gap-2 rounded-md px-4 py-2.5 font-mono2 text-xs font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40 min-h-[44px]"
          style={{ background: "#00d9a3" }}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${run.isPending ? "animate-spin" : ""}`} />
          RUN SYNC PASS
        </button>
      </div>

      {/* State machine */}
      <div className="surface p-4 sm:p-5">
        <SectionTitle>Sync state machine</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          {STAGES.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className="rounded-md border border-border bg-[#0d0d0d] px-3 py-2 font-mono2 text-[10px] font-semibold tracking-wider">
                {s.replace("_", " ").toUpperCase()}
              </div>
              {i < STAGES.length - 1 && <span className="text-muted-foreground">→</span>}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">⇢</span>
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 font-mono2 text-[10px] font-semibold tracking-wider text-red-400">
              CONFLICT → RESOLVED
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Queue */}
        <div className="surface p-4 sm:p-5">
          <SectionTitle
            right={
              <span className="font-mono2 text-[10px]" style={{ color: online ? "#00d9a3" : "#f5b04c" }}>
                {online ? "● ONLINE" : "● OFFLINE — QUEUEING"}
              </span>
            }
          >
            Sync queue · {pending.length} pending
          </SectionTitle>
          <div className="space-y-2">
            {pending.map((m) => (
              <div key={m.id} className="rounded-md border border-amber-500/30 bg-[#0d0d0d] p-3">
                <div className="flex items-center justify-between font-mono2 text-[10px]">
                  <span className="font-semibold">#{m.id} · v{m.version}</span>
                  <StatusPill status={m.syncStatus} />
                </div>
                <p className="mt-1.5 line-clamp-2 text-[12px] text-muted-foreground">{m.content}</p>
              </div>
            ))}
            {pending.length === 0 && (
              <p className="py-6 text-center font-mono2 text-xs text-muted-foreground">
                Queue empty — nothing waiting to sync.
              </p>
            )}
          </div>
        </div>

        {/* Cloud */}
        <div className="surface p-4 sm:p-5">
          <SectionTitle>Qdrant Server · {cloud.length} memories</SectionTitle>
          <div className="max-h-[380px] space-y-2 overflow-y-auto pr-1">
            {cloud.map((c) => (
              <div key={c.id} className="rounded-md border border-border bg-[#0d0d0d] p-3">
                <div className="flex items-center justify-between font-mono2 text-[10px]">
                  <span className="font-semibold">#{c.memoryId} · cloud v{c.cloudVersion}</span>
                  <span className="text-muted-foreground">{timeAgo(c.syncedAt)}</span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[12px] text-muted-foreground">{c.content}</p>
                <button
                  onClick={() => cloudEdit.mutate({ memoryId: Number(c.memoryId) })}
                  className="mt-2 flex items-center gap-1 rounded border border-border px-2 py-1.5 font-mono2 text-[9px] text-muted-foreground transition-colors hover:border-amber-500/50 hover:text-amber-400 min-h-[32px]"
                >
                  <Zap className="h-3 w-3" /> SIMULATE REMOTE EDIT
                </button>
              </div>
            ))}
            {cloud.length === 0 && (
              <p className="py-6 text-center font-mono2 text-xs text-muted-foreground">
                Cloud memory empty — sync memories with SYNC decisions.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Conflicts */}
      {conflicts.length > 0 && (
        <div className="mt-4">
          <SectionTitle>Conflicts · {conflicts.length}</SectionTitle>
          <div className="space-y-3">
            {conflicts.map(({ memory: m, cloud: c }) => (
              <div key={m.id} className="rounded-md border border-red-500/40 bg-red-500/5 p-4 sm:p-5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-mono2 text-xs font-bold text-red-400">CONFLICT · MEMORY #{m.id}</span>
                  <span className="font-mono2 text-[10px] text-muted-foreground">
                    device v{m.version} vs cloud v{c?.cloudVersion}
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-border bg-[#0d0d0d] p-3">
                    <div className="label-caps mb-1.5">Device · v{m.version}</div>
                    <p className="text-[12px] leading-relaxed">{m.content}</p>
                  </div>
                  <div className="rounded-md border border-border bg-[#0d0d0d] p-3">
                    <div className="label-caps mb-1.5">Cloud · v{c?.cloudVersion}</div>
                    <p className="text-[12px] leading-relaxed">{c?.content}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(["device", "cloud", "both"] as const).map((choice) => (
                    <button
                      key={choice}
                      onClick={() => resolve.mutate({ memoryId: Number(m.id), choice })}
                      disabled={resolve.isPending}
                      className="rounded-md border border-border px-4 py-2 font-mono2 text-[11px] font-semibold transition-colors hover:border-[#00d9a3] hover:text-[#00d9a3] min-h-[44px]"
                    >
                      {choice === "device" ? "KEEP DEVICE" : choice === "cloud" ? "KEEP CLOUD" : "PRESERVE BOTH"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Layout>
  );
}
