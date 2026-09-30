import Layout from "@/components/Layout";
import { SectionTitle, timeAgo } from "@/components/bits";
import { trpc } from "@/providers/trpc";

const KIND_COLORS: Record<string, string> = {
  ingest: "#00d9a3",
  decision: "#6c80e3",
  search: "#9ca3af",
  sync: "#f5b04c",
  conflict: "#ff5454",
  network: "#e5e5e5",
};

export default function ActivityPage() {
  const list = trpc.activity.list.useQuery(undefined, { refetchInterval: 5000 });

  return (
    <Layout>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Activity Timeline</h1>
        <p className="mt-1 font-mono2 text-xs text-muted-foreground">
          Every ingest, decision, search, sync and conflict — full system observability.
        </p>
      </div>

      <div className="surface p-4 sm:p-6">
        <SectionTitle>System event log</SectionTitle>
        <div className="relative space-y-0 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-border">
          {(list.data ?? []).map((a) => (
            <div key={a.id} className="relative flex gap-4 py-2.5 pl-6">
              <span
                className="absolute left-0 top-[18px] h-[11px] w-[11px] rounded-full border-2 border-[#0a0a0a]"
                style={{ background: KIND_COLORS[a.kind] ?? "#9ca3af" }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span
                    className="font-mono2 text-[9px] font-bold tracking-widest"
                    style={{ color: KIND_COLORS[a.kind] ?? "#9ca3af" }}
                  >
                    {a.kind.toUpperCase()}
                  </span>
                  <span className="font-mono2 text-[10px] text-muted-foreground">{timeAgo(a.createdAt)}</span>
                </div>
                <p className="mt-0.5 text-[13px] leading-relaxed text-foreground/90">{a.message}</p>
              </div>
            </div>
          ))}
          {(list.data ?? []).length === 0 && !list.isLoading && (
            <p className="py-8 text-center font-mono2 text-xs text-muted-foreground">
              No activity yet — ingest a memory to begin.
            </p>
          )}
        </div>
      </div>
    </Layout>
  );
}
