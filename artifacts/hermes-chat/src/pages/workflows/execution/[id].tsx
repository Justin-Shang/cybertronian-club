import { useEffect, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, Loader2, CheckCircle, XCircle, Clock, Play, Terminal } from "lucide-react";
import Layout from "@/components/layout";

interface Execution {
  id: number;
  workflowId: number;
  status: string;
  trigger: unknown;
  context: { nodes?: Record<string, { status: string; output: unknown; error?: string }> };
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

const NODE_TYPE_LABELS: Record<string, string> = {
  agent_task: "Agent Task",
  condition: "Condition",
  merge: "Merge",
  human_review: "Human Review",
  output: "Output",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "border-yellow-500/30 bg-yellow-500/5",
  running: "border-blue-500/50 bg-blue-500/10",
  completed: "border-green-500/30 bg-green-500/5",
  failed: "border-red-500/30 bg-red-500/10",
  skipped: "border-gray-500/20 bg-gray-500/5",
};

const STATUS_ICONS: Record<string, typeof Loader2> = {
  pending: Clock,
  running: Loader2,
  completed: CheckCircle,
  failed: XCircle,
  skipped: Clock,
};

function NodeCard({ node, agentStream }: { node: ExecutionNode; agentStream: string }) {
  const Icon = STATUS_ICONS[node.status] || Clock;
  const isRunning = node.status === "running";

  return (
    <div className={`border rounded-lg p-4 transition-all ${STATUS_COLORS[node.status] || ""}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${isRunning ? "animate-spin text-blue-500" : ""}`} />
        <span className="font-medium text-sm">{node.nodeId}</span>
        <span className="text-xs text-muted-foreground ml-auto">{NODE_TYPE_LABELS[node.type] || node.type}</span>
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        {node.startedAt && <p>Started: {new Date(node.startedAt).toLocaleTimeString()}</p>}
        {node.completedAt && <p>Completed: {new Date(node.completedAt).toLocaleTimeString()}</p>}
        {node.retryCount > 0 && <p className="text-yellow-500">Retries: {node.retryCount}</p>}
        {node.error && <p className="text-red-500">Error: {node.error}</p>}
      </div>

      {(isRunning || agentStream) && (
        <div className="mt-2 p-2 bg-black/5 rounded text-xs font-mono max-h-24 overflow-y-auto">
          <pre className="whitespace-pre-wrap break-all">{agentStream || "Waiting for response..."}</pre>
        </div>
      )}

      {node.status === "completed" && node.output && (
        <div className="mt-2">
          <details>
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">Output</summary>
            <pre className="mt-1 p-2 bg-black/5 rounded text-xs font-mono max-h-32 overflow-y-auto whitespace-pre-wrap break-all">
              {typeof node.output === "string" ? node.output : JSON.stringify(node.output, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

export default function ExecutionMonitor() {
  const [, params] = useRoute("/workflows/execution/:id");
  const [, setLocation] = useLocation();
  const execId = params?.id ? parseInt(params.id, 10) : null;
  const [nodeStreams, setNodeStreams] = useState<Record<string, string>>({});
  const [execStatus, setExecStatus] = useState<string>("pending");
  const [liveNodes, setLiveNodes] = useState<ExecutionNode[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const { data: execution, isLoading } = useQuery<Execution>({
    queryKey: ["execution", execId],
    queryFn: async () => {
      const res = await fetch(`/api/workflows/${0}/executions/${execId}`);
      if (!res.ok) throw new Error("Execution not found");
      return res.json();
    },
    enabled: !!execId,
  });

  // SSE connection for real-time updates
  useEffect(() => {
    if (!execId) return;

    const es = new EventSource(`/api/workflows/${execution?.workflowId || 0}/executions/${execId}/stream`);
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case "execution_status":
            setExecStatus(data.status);
            break;
          case "node_status":
            setLiveNodes((prev) => {
              const existing = prev.findIndex((n) => n.nodeId === data.nodeId);
              if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = { ...updated[existing], status: data.status };
                return updated;
              }
              return [...prev, { nodeId: data.nodeId, status: data.status, type: "", id: 0, executionId: execId, input: null, output: null, error: null, retryCount: 0, startedAt: null, completedAt: null } as ExecutionNode];
            });
            break;
          case "agent_stream":
            setNodeStreams((prev) => ({
              ...prev,
              [data.nodeId]: (prev[data.nodeId] || "") + data.content,
            }));
            break;
          case "agent_done":
            // Stream complete
            break;
          case "error":
            console.error("Workflow error:", data.message);
            break;
          case "done":
            es.close();
            break;
        }
      } catch {}
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [execId, execution?.workflowId]);

  // Merge SSE nodes with query nodes
  const nodes = execution?.nodes || [];
  const mergedNodes = nodes.map((n) => {
    const live = liveNodes.find((ln) => ln.nodeId === n.nodeId);
    return live ? { ...n, status: live.status } : n;
  });

  // Add SSE-only nodes
  for (const ln of liveNodes) {
    if (!mergedNodes.find((n) => n.nodeId === ln.nodeId)) {
      mergedNodes.push(ln);
    }
  }

  const status = execStatus || execution?.status || "pending";

  return (
    <Layout>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setLocation("/workflows")} className="p-2 hover:bg-accent rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold">Execution #{execId}</h1>
            <p className="text-sm text-muted-foreground">
              Status: {status}
            </p>
          </div>
          <div className="ml-auto">
            <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
              status === "completed" ? "bg-green-500/10 text-green-500" :
              status === "running" ? "bg-blue-500/10 text-blue-500" :
              status === "failed" ? "bg-red-500/10 text-red-500" :
              "bg-gray-500/10 text-gray-500"
            }`}>
              {status === "running" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {status === "completed" && <CheckCircle className="w-3.5 h-3.5" />}
              {status === "failed" && <XCircle className="w-3.5 h-3.5" />}
              {status}
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Execution info */}
            <div className="border border-border rounded-lg p-4 bg-card mb-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Created</span>
                  <p>{execution ? new Date(execution.createdAt).toLocaleString() : "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Updated</span>
                  <p>{execution ? new Date(execution.updatedAt).toLocaleString() : "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Nodes</span>
                  <p>{mergedNodes.length}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Error</span>
                  <p className="text-red-500 truncate">{execution?.error || "None"}</p>
                </div>
              </div>
            </div>

            {/* DAG Visualization */}
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <Terminal className="w-4 h-4" />
              Pipeline Flow
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {mergedNodes.map((node) => (
                <NodeCard
                  key={node.nodeId}
                  node={node}
                  agentStream={nodeStreams[node.nodeId] || ""}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}