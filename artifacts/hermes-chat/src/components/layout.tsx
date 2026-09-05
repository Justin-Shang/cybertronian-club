import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Bot, BarChart3, LogOut, PanelLeft, ChevronLeft } from "lucide-react";
import { useGetStats } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { findModuleByPath } from "@/modules/registry";
import { usePinnedModules } from "@/hooks/use-pinned-modules";
import { Launcher } from "@/components/launcher";

const DRAWER_OPEN_KEY = "cybertron:drawerOpen";

/** Drawer 开关：localStorage 持久化 + Ctrl/Cmd+B 快捷键。 */
function useDrawerOpen() {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(DRAWER_OPEN_KEY) !== "false";
  });
  useEffect(() => {
    window.localStorage.setItem(DRAWER_OPEN_KEY, String(open));
  }, [open]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return [open, setOpen] as const;
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  if (!user) return null;
  const initial = user.displayName[0]?.toUpperCase() ?? "?";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title={user.displayName}
          className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold transition-opacity hover:opacity-90"
        >
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-48">
        <DropdownMenuLabel className="text-xs font-normal">
          <div className="font-medium text-foreground">{user.displayName}</div>
          <div className="text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await logout();
            setLocation("/sign-in");
          }}
        >
          <LogOut className="w-3.5 h-3.5 mr-2" />
          登出
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: stats } = useGetStats();
  const [drawerOpen, setDrawerOpen] = useDrawerOpen();
  const { pinnedOrdered, pinnedIds, togglePin, isPinned } = usePinnedModules();
  const currentModule = findModuleByPath(location);

  // 仅当模块有子导航（nav）时才显示 Drawer；customSidebar 模块自带侧边栏，跳过
  const hasNav =
    !!currentModule &&
    !currentModule.customSidebar &&
    (currentModule.nav?.length ?? 0) > 0;
  const showDrawer = drawerOpen && hasNav;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* ===== Activity Bar (48px, 常驻) ===== */}
      <nav className="w-12 flex flex-col items-center py-3 gap-1 bg-sidebar border-r border-sidebar-border shrink-0">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center mb-3 shrink-0">
          <Bot className="w-4 h-4 text-primary-foreground" />
        </div>

        {pinnedOrdered.map(({ id, path, icon: Icon, label }) => {
          const active = currentModule?.id === id;
          return (
            <Link key={id} href={path}>
              <button
                data-testid={`nav-${label.toLowerCase()}`}
                title={label}
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
                  active
                    ? "bg-primary/20 text-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon className="w-5 h-5" />
              </button>
            </Link>
          );
        })}

        <div className="mt-auto flex flex-col items-center gap-2">
          {/* More · 九宫格 Launcher */}
          <Launcher
            pinnedIds={pinnedIds}
            onTogglePin={togglePin}
            isPinned={isPinned}
          />

          {/* 展开侧栏：仅有子导航的模块（Invest/Finance）且已收起时显示 */}
          {hasNav && !drawerOpen && (
            <button
              title="展开侧栏 (Ctrl+B)"
              onClick={() => setDrawerOpen(true)}
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-all text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <PanelLeft className="w-5 h-5" />
            </button>
          )}

          {stats && (
            <div
              title={`${stats.totalMessages} messages · ${stats.totalAgents} agents`}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground"
            >
              <BarChart3 className="w-4 h-4" />
            </div>
          )}
          <UserMenu />
        </div>
      </nav>

      {/* ===== Drawer (220px, 按需) ===== */}
      {showDrawer && currentModule && (
        <aside className="w-56 flex flex-col bg-sidebar/40 border-r border-sidebar-border shrink-0">
          <div className="px-4 py-3 border-b border-sidebar-border">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-foreground flex items-center gap-2">
                <currentModule.icon className="w-4 h-4 text-primary" />
                {currentModule.label}
              </div>
              <button
                title="收起侧栏 (Ctrl+B)"
                onClick={() => setDrawerOpen(false)}
                className="w-7 h-7 -mr-1 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
            {currentModule.description && (
              <div className="text-xs text-muted-foreground mt-0.5">
                {currentModule.description}
              </div>
            )}
          </div>
          <nav className="flex-1 overflow-y-auto py-2">
            {currentModule.nav && currentModule.nav.length > 0 ? (
              currentModule.nav.map((item) => {
                const active =
                  item.path === currentModule.path
                    ? location === item.path
                    : location.startsWith(item.path);
                return (
                  <Link key={item.path} href={item.path}>
                    <button
                      className={`w-full text-left flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                        active
                          ? "bg-primary/15 text-primary font-medium border-l-2 border-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent border-l-2 border-transparent"
                      }`}
                    >
                      {item.icon && <item.icon className="w-4 h-4" />}
                      {item.label}
                    </button>
                  </Link>
                );
              })
            ) : (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                此模块无子页面
              </div>
            )}
          </nav>
        </aside>
      )}

      {/* ===== Main ===== */}
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
