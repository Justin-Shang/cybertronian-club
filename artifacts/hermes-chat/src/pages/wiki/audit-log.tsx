import { useState } from "react";
import { WikiLayout } from "@/components/wiki/layout";
import { useListAuditLogs } from "@workspace/api-client-react";
import { Shield, Filter, ChevronDown } from "lucide-react";

const ACTION_COLORS: Record<string, string> = {
  CREATE: "bg-green-100 text-green-800",
  UPDATE: "bg-blue-100 text-blue-800",
  DELETE: "bg-red-100 text-red-800",
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function WikiAuditLog() {
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");

  const { data: logs = [], isLoading } = useListAuditLogs(
    {
      ...(actor ? { actor } : {}),
      ...(action ? { action: action as "CREATE" | "UPDATE" | "DELETE" } : {}),
      limit: 200,
    },
    { query: { refetchInterval: 15_000, queryKey: ["audit", actor, action] } },
  );

  return (
    <WikiLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
            <p className="text-sm text-muted-foreground mt-0.5">All write operations by every user and agent</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <div className="relative">
            <select
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              className="appearance-none pl-3 pr-8 py-1.5 text-sm border border-border rounded bg-background text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All actors</option>
              <option value="Admin">Admin</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          </div>
          <div className="relative">
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="appearance-none pl-3 pr-8 py-1.5 text-sm border border-border rounded bg-background text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All actions</option>
              <option value="CREATE">Create</option>
              <option value="UPDATE">Update</option>
              <option value="DELETE">Delete</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          </div>
          <span className="ml-auto text-xs text-muted-foreground">
            {isLoading ? "Loading…" : `${logs.length} entries`}
          </span>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground py-12 text-center">Loading audit log…</div>
        ) : logs.length === 0 ? (
          <div className="text-sm text-muted-foreground py-12 text-center border border-dashed border-border rounded-lg">
            No audit entries yet.
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Time</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Actor</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Action</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Page</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap font-mono text-xs">
                      {formatDate(log.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-medium">{log.actor}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${ACTION_COLORS[log.action] ?? "bg-muted text-foreground"}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {log.pageTitle ? (
                        <span>
                          {log.pageTitle}
                          {log.pageId && log.action !== "DELETE" && (
                            <a href={`/wiki/pages/${log.pageId}`} className="ml-1 text-primary hover:underline text-xs">
                              #{log.pageId}
                            </a>
                          )}
                          {log.action === "DELETE" && (
                            <span className="ml-1 text-xs text-muted-foreground">#{log.pageId}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </WikiLayout>
  );
}
