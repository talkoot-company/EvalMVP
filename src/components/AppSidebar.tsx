import { NavLink as RouterNavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  ListChecks,
  Layers,
  Play,
  Sparkles,
  GitFork,
  Database,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";

const activeItems = [
  { to: "/criteria",    icon: ListChecks, label: "Criteria" },
  { to: "/generations", icon: Sparkles,   label: "Generations" },
  { to: "/mapping",     icon: GitFork,    label: "Mapping" },
  { to: "/data",        icon: Database,   label: "Data" },
];

const inactiveItems = [
  { to: "/suites",   icon: Layers, label: "Suites" },
  { to: "/evaluate", icon: Play,   label: "Evaluate" },
];

function NavItem({ to, icon: Icon, label, collapsed }: {
  to: string; icon: React.ElementType; label: string; collapsed: boolean;
}) {
  const location = useLocation();
  const isActive = location.pathname === to || location.pathname.startsWith(to + "/");
  return (
    <RouterNavLink
      to={to}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        isActive
          ? "bg-sidebar-accent text-sidebar-primary"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span>{label}</span>}
    </RouterNavLink>
  );
}

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={cn(
      "flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200",
      collapsed ? "w-16" : "w-60",
    )}>
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        {collapsed ? (
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sidebar-primary mx-auto">
            <ListChecks className="h-4 w-4 text-sidebar-primary-foreground" />
          </div>
        ) : (
          <div className="flex items-center gap-2 animate-fade-in">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sidebar-primary">
              <ListChecks className="h-4 w-4 text-sidebar-primary-foreground" />
            </div>
            <span className="text-sm font-semibold text-sidebar-foreground tracking-tight">CopyEval</span>
          </div>
        )}
      </div>

      {/* Primary nav */}
      <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
        {activeItems.map((item) => (
          <NavItem key={item.to} {...item} collapsed={collapsed} />
        ))}

        {/* Divider + inactive label */}
        <div className="pt-3 pb-1">
          <div className="border-t border-sidebar-border" />
          {!collapsed && (
            <p className="mt-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
              Inactive
            </p>
          )}
        </div>

        {inactiveItems.map((item) => (
          <NavItem key={item.to} {...item} collapsed={collapsed} />
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center border-t border-sidebar-border p-3 text-sidebar-muted hover:text-sidebar-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}
