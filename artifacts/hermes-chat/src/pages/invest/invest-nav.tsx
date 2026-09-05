// PIRS 投研模块二级菜单（横向 tab 导航）
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LayoutList, Star, Target, BookOpen, BookMarked, Bell, Radar } from "lucide-react";
import { API, type Overview } from "./shared";

type CountKey = "watchlist" | "candidates" | "notes" | "unreadAlerts";

const NAV_ITEMS: { href: string; label: string; icon: typeof Star; countKey?: CountKey; danger?: boolean }[] = [
  { href: "/invest", label: "总览", icon: LayoutList },
  { href: "/invest/watchlist", label: "资源池", icon: Star, countKey: "watchlist" },
  { href: "/invest/candidates", label: "候选池", icon: Target, countKey: "candidates" },
  { href: "/invest/screening", label: "初筛", icon: Radar },
  { href: "/invest/notes", label: "投研笔记", icon: BookOpen, countKey: "notes" },
  { href: "/invest/frameworks", label: "框架", icon: BookMarked },
  { href: "/invest/alerts", label: "预警", icon: Bell, countKey: "unreadAlerts", danger: true },
];

export default function InvestNav() {
  const [location] = useLocation();
  const { data } = useQuery<Overview>({
    queryKey: ["invest-overview"],
    queryFn: async () => {
      const res = await fetch(API + "/overview");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  return (
    <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-background/95 backdrop-blur shrink-0 overflow-x-auto scrollbar-thin">
      {NAV_ITEMS.map((item) => {
        // /invest 精确匹配，其余前缀匹配；/invest/stocks/:code 不高亮任何项
        const active = item.href === "/invest"
          ? location === "/invest"
          : location.startsWith(item.href);
        const count = item.countKey ? data?.[item.countKey] ?? 0 : undefined;
        const showCount = count !== undefined && count > 0;
        return (
          <Link key={item.href} href={item.href}>
            <button
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors whitespace-nowrap ${
                active
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
              {showCount && (
                <span className={`ml-0.5 text-xs px-1.5 py-0.5 rounded-full font-medium ${
                  item.danger
                    ? "bg-red-500/20 text-red-600 dark:text-red-400"
                    : active
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                }`}>
                  {count}
                </span>
              )}
            </button>
          </Link>
        );
      })}
    </div>
  );
}
