import { cn } from "@/lib/utils";

export const ACTION_COLORS: Record<string, string> = {
  keep_local: "#00d9a3",
  sync: "#6c80e3",
  compress: "#f5b04c",
  defer: "#9ca3af",
  discard: "#ff5454",
};

export const STATE_COLORS: Record<string, string> = {
  active: "#00d9a3",
  promoted: "#6c80e3",
  dormant: "#9ca3af",
  archived: "#5b5b5b",
  conflicted: "#ff5454",
};

export function ActionBadge({ action, className }: { action: string; className?: string }) {
  const c = ACTION_COLORS[action] ?? "#9ca3af";
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-mono2 text-[10px] font-semibold tracking-wider", className)}
      style={{ color: c, background: c + "18", border: `1px solid ${c}44` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {action.replace("_", " ").toUpperCase()}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    synced: "#00d9a3",
    pending: "#f5b04c",
    syncing: "#6c80e3",
    conflict: "#ff5454",
    local_only: "#9ca3af",
  };
  const labels: Record<string, string> = {
    synced: "SYNCED",
    pending: "PENDING",
    syncing: "SYNCING",
    conflict: "CONFLICT",
    local_only: "LOCAL",
  };
  const c = colors[status] ?? "#9ca3af";
  return (
    <span className="inline-flex items-center gap-1.5 font-mono2 text-[10px] font-semibold tracking-wider" style={{ color: c }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {labels[status] ?? status.toUpperCase()}
    </span>
  );
}

export function ScoreBar({ value, max = 10, color = "#00d9a3" }: { value: number; max?: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#242424]">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function StatCard({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: string }) {
  return (
    <div className="surface p-4 sm:p-5">
      <div className="label-caps">{label}</div>
      <div className="font-display mt-2 text-3xl font-bold tracking-tight sm:text-4xl" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {sub && <div className="mt-1 font-mono2 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <h2 className="label-caps" style={{ fontSize: "0.75rem" }}>{children}</h2>
      {right}
    </div>
  );
}

export function timeAgo(d: Date | string): string {
  const t = typeof d === "string" ? new Date(d) : d;
  const s = Math.max(0, (Date.now() - t.getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
