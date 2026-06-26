import { Link, useLocation } from "wouter";
import { MessageSquare, Bot, Hash, BarChart3 } from "lucide-react";
import { useGetStats } from "@workspace/api-client-react";

const navItems = [
  { href: "/", icon: MessageSquare, label: "Chat" },
  { href: "/rooms", icon: Hash, label: "Rooms" },
  { href: "/agents", icon: Bot, label: "Agents" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: stats } = useGetStats();

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Left nav rail */}
      <nav className="w-14 flex flex-col items-center py-4 gap-1 bg-sidebar border-r border-sidebar-border shrink-0">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center mb-4 shrink-0">
          <Bot className="w-4 h-4 text-primary-foreground" />
        </div>
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = href === "/" ? location === "/" || location.startsWith("/room/") : location === href;
          return (
            <Link key={href} href={href}>
              <button
                data-testid={`nav-${label.toLowerCase()}`}
                title={label}
                className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all ${
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

        <div className="mt-auto flex flex-col items-center gap-1">
          {stats && (
            <div title={`${stats.totalMessages} messages total`} className="w-10 h-10 rounded-lg flex items-center justify-center text-muted-foreground">
              <BarChart3 className="w-4 h-4" />
            </div>
          )}
        </div>
      </nav>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
