import { Link, useLocation } from "react-router";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Database,
  Search,
  GitBranch,
  RefreshCw,
  Activity,
  Wifi,
  WifiOff,
  Cpu,
} from "lucide-react";
import { toast } from "sonner";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/memory", label: "Memory", icon: Database },
  { to: "/search", label: "Search", icon: Search },
  { to: "/decisions", label: "Decisions", icon: GitBranch },
  { to: "/sync", label: "Sync", icon: RefreshCw },
  { to: "/activity", label: "Activity", icon: Activity },
];

export function NetworkToggle({ compact }: { compact?: boolean }) {
  const utils = trpc.useUtils();
  const status = trpc.system.status.useQuery(undefined, { refetchInterval: 5000 });
  const toggle = trpc.system.setOnline.useMutation({
    onSuccess: (r) => {
      utils.invalidate();
      if (r.online && r.syncReport) {
        toast.success(
          `Back online — ${r.syncReport.synced} synced, ${r.syncReport.conflicts} conflict${r.syncReport.conflicts === 1 ? "" : "s"}`,
        );
      } else if (!r.online) {
        toast.warning("Network disabled — operating fully offline");
      }
    },
  });
  const online = status.data?.online ?? true;

  return (
    <button
      onClick={() => toggle.mutate({ online: !online })}
      disabled={toggle.isPending}
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 font-mono2 text-xs font-semibold tracking-wider transition-colors min-h-[44px]",
        compact ? "py-1.5 min-h-0" : "py-2",
        online
          ? "border-mint/40 bg-mint/10 text-mint hover:bg-mint/20"
          : "border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20",
      )}
      style={{ ["--tw-border-opacity" as never]: 1, borderColor: online ? "#00d9a366" : "#ef444466", color: online ? "#00d9a3" : "#f87171", background: online ? "#00d9a314" : "#ef444414" }}
    >
      {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
      {toggle.isPending ? "…" : online ? "ONLINE" : "OFFLINE"}
    </button>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const status = trpc.system.status.useQuery(undefined, { refetchInterval: 8000 });

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-[#0d0d0d] lg:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-mint" style={{ background: "#00d9a3" }}>
            <Cpu className="h-5 w-5 text-black" />
          </div>
          <div>
            <div className="font-display text-lg font-bold leading-none tracking-tight">EDGEMIND</div>
            <div className="label-caps mt-1" style={{ fontSize: "0.5625rem" }}>
              edge memory OS
            </div>
          </div>
        </div>
        <nav className="mt-2 flex flex-col gap-0.5 px-3">
          {NAV.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors min-h-[44px]",
                  active
                    ? "bg-[#00d9a314] font-semibold text-[#00d9a3]"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
                {item.to === "/sync" && (status.data?.queue ?? 0) > 0 && (
                  <span className="ml-auto rounded-full bg-amber-500/20 px-2 py-0.5 font-mono2 text-[10px] font-semibold text-amber-400">
                    {status.data?.queue}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-3 px-5 pb-5">
          <div className="label-caps">Device · edge-01</div>
          <NetworkToggle />
          <div className="flex justify-between font-mono2 text-[10px] text-muted-foreground">
            <span>QDRANT EDGE</span>
            <span className="text-[#00d9a3]">● LOCAL</span>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-border bg-[#0d0d0d]/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md" style={{ background: "#00d9a3" }}>
            <Cpu className="h-4 w-4 text-black" />
          </div>
          <span className="font-display text-base font-bold tracking-tight">EDGEMIND</span>
        </div>
        <NetworkToggle compact />
      </header>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-border bg-[#0d0d0d]/95 backdrop-blur lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {NAV.map((item) => {
          const active = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex min-h-[52px] flex-col items-center justify-center gap-1 text-[9px]",
                active ? "text-[#00d9a3]" : "text-muted-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <main className="min-w-0 flex-1 px-4 pb-24 pt-[68px] sm:px-6 lg:ml-60 lg:px-8 lg:pb-10 lg:pt-6">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
