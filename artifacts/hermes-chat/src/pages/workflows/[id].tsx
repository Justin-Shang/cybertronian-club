import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { ArrowLeft, Save, Play, Trash2, Loader2, Clock, CheckCircle, XCircle, RefreshCw } from "lucide-react";
import Layout from "@/components/layout";

interface Workflow {
  id: number;
  name: string;
  description: string;
  definition: { nodes: unknown[]; edges: unknown[] };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Execution {
  id: number;
  workflowId: number;
  status: string;
  trigger: unknown;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  nodes?: ExecutionNode[];
}

interface ExecutionNode {
  id: number;
  executionId: number;
  nodeId: string;
  status: string;
  type: string;
  input: unknown;
  output: unknown;
  error: string | null;
  retryCount: number;
  startedAt: string | null;
  completedAt: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "text-yellow-500",
  running: "text-blue-500",
  completed: "text-green-500",
  failed: "text-red-500",
  skipped: "text-gray-400",
};

const STATUS_ICONS: Record<string, typeof Loader2> = {
  pending: Clock,
  running: Loader2,
  completed: CheckCircle,
  failed: XCircle,
  skipped: Clock,
};

function StatusBadge({ status }: { status: string }) {
  const Icon = STATUS_ICONS[status] || Clock;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${STATUS_COLORS[status] || "text-gray-500"}`}>
      <Icon className={`w-3 h-3 ${status === "running" ? "animate-spin" : ""}`} />
      {status}
    </span>
  );
}

export default function WorkflowDetail() {
  const [, params] = useRoute("/workflows/:id");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const id = params?.id ? parseInt(params.id, 10) : null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [definition, setDefinition] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  const { data: workflow, isLoading: wfLoading } = useQuery<Workflow>({
    queryKey: ["workflow", id],
    queryFn: async () => {
      const res = await fetch(`/api/workflows/${id}`);
      if (!res.ok) throw new Error("Workflow not found");
      return res.json();
    },
    enabled: !!id,
    onSuccess: (data) => {
      if (!editing) {
        setName(data.name);
        setDescription(data.description);
        setDefinition(JSON.stringify(data.definition, null, 2));
      }
    },
  });

  const { data: executions = [] } = useQuery<Execution[]>({
    queryKey: ["workflow-executions", id],
    queryFn: async () => {
      const res = await fetch(`/api/workflows/${id}/executions`);
      if (!res.ok) throw new Error("Failed to fetch executions");
      return res.json();
    },
    enabled: !!id,
    refetchInterval: 5000,
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      let parsed;
      try {
        parsed = JSON.parse(definition);
      } catch {
        throw new Error("Invalid JSON definition");
      }
      const res = await fetch(`/api/workflows/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, definition: parsed }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow", id] });
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      setEditing(false);
      setError("");
    },
    onError: (err: Error) => setError(err.message),
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workflows/${id}/execute`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to execute");
      return res.json();
    },
    onSuccess: (data) => {
      setLocation(`/workflows/execution/${data.id}`);
    },
  });

  if (wfLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  if (!workflow) {
    return (
      <Layout>
        <div className="p-6 text-center text-muted-foreground">Workflow not found</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setLocation("/workflows")} className="p-2 hover:bg-accent rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            {editing ? (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-2xl font-bold bg-transparent border-b border-border focus:outline-none focus:border-primary"
              />
            ) : (
              <h1 className="text-2xl font-bold">{workflow.name}</h1>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => executeMutation.mutate()}
              disabled={executeMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary rounded-md text-sm hover:bg-primary/20 transition-colors disabled:opacity-50"
            >
              {executeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Run
            </button>
            {editing ? (
              <>
                <button
                  onClick={() => updateMutation.mutate()}
                  disabled={updateMutation.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90 transition-colors disabled:opacity-50"
                >
                  {updateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </button>
                <button
                  onClick={() => {
                    setEditing(false);
                    setName(workflow.name);
                    setDescription(workflow.description);
                    setDefinition(JSON.stringify(workflow.definition, null, 2));
                  }}
                  className="px-3 py-1.5 border border-border rounded-md text-sm hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1.5 border border-border rounded-md text-sm hover:bg-accent transition-colors"
              >
                Edit
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Definition */}
          <div className="lg:col-span-2 space-y-4">
            <div className="border border-border rounded-lg p-4 bg-card">
              <h2 className="font-semibold mb-2">Description</h2>
              {editing ? (
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              ) : (
                <p className="text-sm text-muted-foreground">{workflow.description || "No description"}</p>
              )}
            </div>

            <div className="border border-border rounded-lg p-4 bg-card">
              <h2 className="font-semibold mb-2">Definition</h2>
              {editing ? (
                <textarea
                  value={definition}
                  onChange={(e) => setDefinition(e.target.value)}
                  rows={20}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              ) : (
                <pre className="text-xs font-mono text-muted-foreground overflow-auto max-h-96">
                  {JSON.stringify(workflow.definition, null, 2)}
                </pre>
              )}
            </div>
          </div>

          {/* Right: Executions */}
          <div className="space-y-4">
            <div className="border border-border rounded-lg p-4 bg-card">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Executions
              </h2>
              {executions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No executions yet</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {executions.map((exec) => (
                    <Link key={exec.id} href={`/workflows/execution/${exec.id}`}>
                      <div className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-accent cursor-pointer transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          <StatusBadge status={exec.status} />
                          <span className="text-xs text-muted-foreground truncate">
                            #{exec.id}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {new Date(exec.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}