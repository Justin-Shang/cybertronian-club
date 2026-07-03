import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { BookOpen, Plus, ChevronDown, ChevronRight, Shield } from "lucide-react";
import { useGetPagesTree, getGetPagesTreeQueryKey } from "@workspace/api-client-react";
import { PageTree } from "@/components/wiki/page-tree";
import { useRef, useState } from "react";
import AppLayout from "@/components/layout";

interface WikiLayoutProps {
  children: ReactNode;
}

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 600;
const SIDEBAR_DEFAULT_WIDTH = 224;
const SIDEBAR_WIDTH_KEY = "wiki:sidebarWidth";

export function WikiLayout({ children }: WikiLayoutProps) {
  const [location] = useLocation();
  const [treeOpen, setTreeOpen] = useState(true);

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
    const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH
      ? saved
      : SIDEBAR_DEFAULT_WIDTH;
  });
  const widthRef = useRef(sidebarWidth);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, ev.clientX - 56));
      widthRef.current = next;
      setSidebarWidth(next);
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(widthRef.current));
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const { data: tree = [] } = useGetPagesTree({
    query: { queryKey: getGetPagesTreeQueryKey() },
  });

  return (
    <AppLayout>
      <div className="h-full overflow-hidden flex w-full">
        {/* Wiki sidebar */}
        <aside
          className="border-r border-border bg-card flex flex-col shrink-0 hidden md:flex"
          style={{ width: sidebarWidth }}
        >
          <div className="px-4 py-3 border-b border-border">
            <Link
              href="/wiki"
              className="flex items-center gap-2 font-semibold text-foreground hover:text-primary transition-colors text-sm"
            >
              <BookOpen className="w-4 h-4 text-primary" />
              Transformer's Library
            </Link>
          </div>

          <nav className="flex-1 overflow-y-auto py-3 space-y-4">
            <div className="px-2 space-y-0.5">
              {[
                { href: "/wiki", label: "Dashboard" },
                { href: "/wiki/pages", label: "All Pages" },
                { href: "/wiki/audit", label: "Audit Log", icon: Shield },
              ].map((item) => {
                const active =
                  location === item.href ||
                  (item.href !== "/wiki" && location.startsWith(item.href) && location === item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors ${
                      active
                        ? "bg-secondary text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                    }`}
                  >
                    {"icon" in item && item.icon ? <item.icon className="w-3.5 h-3.5 shrink-0" /> : null}
                    {item.label}
                  </Link>
                );
              })}
            </div>

            <div>
              <button
                onClick={() => setTreeOpen((v) => !v)}
                className="flex items-center gap-1 px-4 py-1 w-full text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              >
                {treeOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                Pages
              </button>

              {treeOpen && (
                <div className="mt-1 px-1">
                  <PageTree nodes={tree} />
                </div>
              )}
            </div>
          </nav>

          <div className="p-3 border-t border-border">
            <Link
              href="/wiki/pages/new"
              className="flex items-center justify-center gap-2 w-full px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Plus className="w-4 h-4" />
              New Page
            </Link>
          </div>
        </aside>

        {/* Resize handle */}
        <div
          onMouseDown={startResize}
          onDoubleClick={() => {
            widthRef.current = SIDEBAR_DEFAULT_WIDTH;
            setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
            window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(SIDEBAR_DEFAULT_WIDTH));
          }}
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize · double-click to reset"
          className="hidden md:block w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-primary/40 active:bg-primary/60 transition-colors"
        />

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0 max-w-full overflow-hidden">
          <header className="h-12 border-b border-border bg-card flex items-center px-4 md:hidden shrink-0">
            <Link href="/wiki" className="flex items-center gap-2 font-semibold text-foreground text-sm">
              <BookOpen className="w-4 h-4 text-primary" />
              Wiki
            </Link>
            <div className="ml-auto">
              <Link href="/wiki/pages/new" className="flex items-center justify-center p-2 bg-primary text-primary-foreground rounded">
                <Plus className="w-4 h-4" />
              </Link>
            </div>
          </header>

          <div className="flex-1 overflow-auto p-4 md:p-8">
            <div className="max-w-5xl mx-auto w-full">{children}</div>
          </div>
        </main>
      </div>
    </AppLayout>
  );
}
