import { useEffect, useRef, useState, useCallback } from "react";
import { WikiLayout } from "@/components/wiki/layout";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Link2,
  Save,
  Edit3,
  Move,
  Target,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import "vis-network/styles/vis-network.css";

const API_BASE = "";

interface GraphNode {
  id: number;
  graphId: number;
  label: string;
  type: string;
  content: string;
  color: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface GraphEdge {
  id: number;
  graphId: number;
  sourceNodeId: number;
  targetNodeId: number;
  label: string;
  color: string | null;
  style: string;
  createdAt: string;
}

interface GraphDetail {
  id: number;
  name: string;
  description: string;
  type: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const NODE_TYPE_CONFIG: Record<string, { color: string; label: string }> = {
  concept: { color: "#6366f1", label: "Concept" },
  entity: { color: "#f59e0b", label: "Entity" },
  person: { color: "#10b981", label: "Person" },
  company: { color: "#06b6d4", label: "Company" },
  paper: { color: "#ef4444", label: "Paper" },
  tool: { color: "#8b5cf6", label: "Tool" },
  idea: { color: "#ec4899", label: "Idea" },
  question: { color: "#f97316", label: "Question" },
};

function getNodeColor(node: GraphNode): string {
  return node.color || NODE_TYPE_CONFIG[node.type]?.color || "#6366f1";
}

function nodeToVis(node: GraphNode) {
  return {
    id: node.id,
    label: node.label,
    title: `<b>${node.label}</b><br/><small>${NODE_TYPE_CONFIG[node.type]?.label || node.type}</small>`,
    color: { background: getNodeColor(node), border: "#1e293b", highlight: { background: getNodeColor(node), border: "#fff" } },
    shape: "box",
    font: { color: "#fff", size: 14, face: "Inter, system-ui, sans-serif" },
    borderWidth: 2,
    size: 25,
    shapeProperties: { borderRadius: 6 },
    metadata: node.metadata,
  };
}

function edgeToVis(edge: GraphEdge) {
  return {
    id: edge.id,
    from: edge.sourceNodeId,
    to: edge.targetNodeId,
    label: edge.label,
    color: { color: edge.color || "#64748b", highlight: "#94a3b8" },
    width: 2,
    smooth: { type: "continuous" },
    font: { size: 12, color: "#94a3b8", strokeWidth: 0 },
    dashes: edge.style === "dashed",
  };
}

export default function GraphView() {
  const { id } = useParams();
  const graphId = parseInt(id || "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Record<string, unknown> | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editDialog, setEditDialog] = useState<{ open: boolean; type: "node" | "edge" | "graph"; data: Record<string, string> }>({ open: false, type: "node", data: {} });
  const [networkReady, setNetworkReady] = useState(false);

  // Fetch graph data
  const { data: graph, isLoading, refetch } = useQuery({
    queryKey: ["knowledge-graph", graphId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/graphs/${graphId}`);
      if (!res.ok) throw new Error("Failed to fetch graph");
      return res.json() as Promise<GraphDetail>;
    },
    enabled: !!graphId,
  });

  // Mutations
  const addNodeMutation = useMutation({
    mutationFn: async (data: { label: string; type: string; content: string }) => {
      const res = await fetch(`${API_BASE}/api/graphs/${graphId}/nodes`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to add node");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["knowledge-graph", graphId] }); toast({ title: "Node added" }); },
    onError: () => toast({ title: "Failed to add node", variant: "destructive" }),
  });

  const updateNodeMutation = useMutation({
    mutationFn: async ({ nodeId, data }: { nodeId: number; data: Record<string, unknown> }) => {
      const res = await fetch(`${API_BASE}/api/graphs/${graphId}/nodes/${nodeId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update node");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["knowledge-graph", graphId] }); toast({ title: "Node updated" }); },
    onError: () => toast({ title: "Failed to update node", variant: "destructive" }),
  });

  const deleteNodeMutation = useMutation({
    mutationFn: async (nodeId: number) => {
      const res = await fetch(`${API_BASE}/api/graphs/${graphId}/nodes/${nodeId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete node");
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["knowledge-graph", graphId] }); setSelectedNode(null); toast({ title: "Node deleted" }); },
    onError: () => toast({ title: "Failed to delete node", variant: "destructive" }),
  });

  const addEdgeMutation = useMutation({
    mutationFn: async (data: { sourceNodeId: number; targetNodeId: number; label: string }) => {
      const res = await fetch(`${API_BASE}/api/graphs/${graphId}/edges`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to add edge");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["knowledge-graph", graphId] }); toast({ title: "Edge added" }); },
    onError: () => toast({ title: "Failed to add edge", variant: "destructive" }),
  });

  const deleteEdgeMutation = useMutation({
    mutationFn: async (edgeId: number) => {
      const res = await fetch(`${API_BASE}/api/graphs/${graphId}/edges/${edgeId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete edge");
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["knowledge-graph", graphId] }); toast({ title: "Edge deleted" }); },
    onError: () => toast({ title: "Failed to delete edge", variant: "destructive" }),
  });

  // Initialize vis-network
  useEffect(() => {
    if (!graph || !containerRef.current || networkRef.current) return;

    const initNetwork = async () => {
      const vis = await import("vis-network");

      const nodes = new vis.DataSet(graph.nodes.map(nodeToVis));
      const edges = new vis.DataSet(graph.edges.map(edgeToVis));

      const options = {
        nodes: {
          shape: "ellipse",
          font: { size: 14, color: "#fff", face: "Inter, system-ui, sans-serif" },
          borderWidth: 2,
          shadow: { enabled: true, size: 4 },
        },
        edges: {
          width: 2,
          smooth: { type: "continuous" },
          font: { size: 12, color: "#94a3b8", strokeWidth: 0 },
          arrows: { to: { enabled: true, scaleFactor: 0.5 } },
        },
        physics: {
          solver: "forceAtlas2Based",
          forceAtlas2Based: {
            gravitationalConstant: -40,
            centralGravity: 0.005,
            springLength: 200,
            springConstant: 0.02,
            damping: 0.4,
          },
          stabilization: { iterations: 200 },
        },
        interaction: {
          dragNodes: true,
          dragView: true,
          zoomView: true,
          hover: true,
          multiselect: false,
          navigationButtons: true,
          keyboard: true,
        },
        manipulation: {
          enabled: editMode,
          addNode: false,
          addEdge: false,
          editNode: false,
          editEdge: false,
          deleteNode: false,
          deleteEdge: false,
        },
        layout: {
          improvedLayout: true,
        },
      };

      const network = new vis.Network(containerRef.current!, { nodes, edges }, options);
      networkRef.current = network;
      setNetworkReady(true);

      // Click event: select node
      network.on("click", (params: { nodes: number[]; edges: number[] }) => {
        if (params.nodes.length > 0) {
          const nodeId = params.nodes[0];
          const nodeData = graph.nodes.find((n) => n.id === nodeId);
          if (nodeData) setSelectedNode(nodeData);
        } else {
          setSelectedNode(null);
        }
      });

      // Double-click: edit node
      network.on("doubleClick", (params: { nodes: number[] }) => {
        if (params.nodes.length > 0) {
          const nodeId = params.nodes[0];
          const nodeData = graph.nodes.find((n) => n.id === nodeId);
          if (nodeData && editMode) {
            setEditDialog({ open: true, type: "node", data: { label: nodeData.label, type: nodeData.type, content: nodeData.content } });
          }
        }
      });

      // Drag end: save positions
      network.on("dragEnd", () => {
        // positions are kept in-memory by vis-network
      });

      return () => {
        network.destroy();
        networkRef.current = null;
      };
    };

    initNetwork();

    return () => {
      if (networkRef.current) {
        (networkRef.current as { destroy: () => void }).destroy();
        networkRef.current = null;
      }
    };
  }, [graph, graphId, editMode]);

  const handleAddNode = () => {
    setEditDialog({ open: true, type: "node", data: { label: "", type: "concept", content: "" } });
  };

  const handleSaveNode = () => {
    const { label, type, content } = editDialog.data;
    if (!label.trim()) return;
    if (selectedNode) {
      updateNodeMutation.mutate({ nodeId: selectedNode.id, data: { label, type, content } });
    } else {
      addNodeMutation.mutate({ label, type, content });
    }
    setEditDialog({ open: false, type: "node", data: {} });
  };

  const handleDeleteSelected = () => {
    if (selectedNode) {
      deleteNodeMutation.mutate(selectedNode.id);
    }
  };

  const handleAddEdge = () => {
    setEditDialog({ open: true, type: "edge", data: { sourceNodeId: "", targetNodeId: "", label: "" } });
  };

  const handleSaveEdge = () => {
    const { sourceNodeId, targetNodeId, label } = editDialog.data;
    const src = parseInt(sourceNodeId, 10);
    const tgt = parseInt(targetNodeId, 10);
    if (isNaN(src) || isNaN(tgt)) return;
    addEdgeMutation.mutate({ sourceNodeId: src, targetNodeId: tgt, label });
    setEditDialog({ open: false, type: "edge", data: {} });
  };

  const handleZoomIn = () => {
    if (networkRef.current) {
      (networkRef.current as { moveTo: (opts: { scale: number }) => void }).moveTo({ scale: 1.2 });
    }
  };

  const handleZoomOut = () => {
    if (networkRef.current) {
      (networkRef.current as { moveTo: (opts: { scale: number }) => void }).moveTo({ scale: 0.8 });
    }
  };

  const handleFit = () => {
    if (networkRef.current) {
      (networkRef.current as { fit: () => void }).fit();
    }
  };

  if (isLoading) {
    return (
      <WikiLayout>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted w-1/4 rounded" />
          <div className="h-[600px] bg-muted rounded-lg" />
        </div>
      </WikiLayout>
    );
  }

  if (!graph) {
    return (
      <WikiLayout>
        <div className="text-center py-20">
          <h2 className="text-xl font-bold mb-2">Graph not found</h2>
          <Link href="/wiki/graphs" className="text-primary hover:underline">Return to graphs</Link>
        </div>
      </WikiLayout>
    );
  }

  return (
    <WikiLayout>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div className="flex items-center gap-3">
            <Link href="/wiki/graphs" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl font-bold tracking-tight">{graph.name}</h1>
              {graph.description && (
                <p className="text-sm text-muted-foreground">{graph.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground mr-2">
              {graph.nodes.length} nodes · {graph.edges.length} edges
            </span>
            <Button variant="outline" size="sm" onClick={handleZoomIn} title="Zoom in">
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleZoomOut} title="Zoom out">
              <ZoomOut className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleFit} title="Fit view">
              <Target className="w-4 h-4" />
            </Button>
            <div className="w-px h-6 bg-border mx-1" />
            <Button
              variant={editMode ? "default" : "outline"}
              size="sm"
              onClick={() => setEditMode(!editMode)}
              className="gap-2"
            >
              <Edit3 className="w-4 h-4" />
              {editMode ? "Done" : "Edit"}
            </Button>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex gap-4 min-h-0">
          {/* Graph canvas */}
          <div className="flex-1 relative bg-card border border-border rounded-lg overflow-hidden">
            <div ref={containerRef} className="w-full h-full min-h-[500px]" />

            {/* Legend */}
            <div className="absolute bottom-3 left-3 flex items-center gap-3 bg-background/90 border border-border rounded-lg px-3 py-2 shadow-lg text-xs">
              {Object.entries(NODE_TYPE_CONFIG).map(([type, cfg]) => (
                <div key={type} className="flex items-center gap-1.5">
                  <span
                    className="w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: cfg.color }}
                  />
                  <span className="text-muted-foreground whitespace-nowrap">{cfg.label}</span>
                </div>
              ))}
            </div>

            {/* Edit mode toolbar overlay */}
            {editMode && (
              <div className="absolute top-3 left-3 flex items-center gap-2 bg-background/90 border border-border rounded-lg p-2 shadow-lg">
                <Button variant="ghost" size="sm" onClick={handleAddNode} className="gap-1">
                  <Plus className="w-3.5 h-3.5" /> Node
                </Button>
                <Button variant="ghost" size="sm" onClick={handleAddEdge} className="gap-1">
                  <Link2 className="w-3.5 h-3.5" /> Edge
                </Button>
                {selectedNode && (
                  <Button variant="ghost" size="sm" onClick={handleDeleteSelected} className="gap-1 text-destructive">
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Node details panel */}
          {selectedNode && (
            <div className="w-72 bg-card border border-border rounded-lg p-4 shrink-0 overflow-y-auto">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">Node Details</h3>
                <div className="flex gap-1">
                  {editMode && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setEditDialog({ open: true, type: "node", data: { label: selectedNode.label, type: selectedNode.type, content: selectedNode.content } })}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDeleteSelected}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">Label</span>
                  <p className="font-medium">{selectedNode.label}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Type</span>
                  <p className="capitalize">{selectedNode.type}</p>
                </div>
                {selectedNode.content && (
                  <div>
                    <span className="text-muted-foreground text-xs">Content</span>
                    <p className="text-xs mt-1 whitespace-pre-wrap line-clamp-10">{selectedNode.content}</p>
                  </div>
                )}
                <div className="pt-2 border-t border-border">
                  <span className="text-muted-foreground text-xs">Connected edges</span>
                  {graph.edges
                    .filter((e) => e.sourceNodeId === selectedNode.id || e.targetNodeId === selectedNode.id)
                    .map((e) => {
                      const other = e.sourceNodeId === selectedNode.id
                        ? graph.nodes.find((n) => n.id === e.targetNodeId)
                        : graph.nodes.find((n) => n.id === e.sourceNodeId);
                      return (
                        <div key={e.id} className="flex items-center gap-2 mt-1 text-xs">
                          <span className="text-muted-foreground">→</span>
                          <span>{other?.label || "?"}</span>
                          {e.label && <span className="text-muted-foreground">({e.label})</span>}
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Node/Edge edit dialog */}
      <Dialog open={editDialog.open} onOpenChange={(o) => !o && setEditDialog({ ...editDialog, open: false })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editDialog.type === "node"
                ? selectedNode ? "Edit Node" : "Add Node"
                : "Add Edge"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {editDialog.type === "node" ? (
              <>
                <div>
                  <label className="text-sm font-medium mb-1 block">Label</label>
                  <Input
                    value={editDialog.data.label}
                    onChange={(e) => setEditDialog({ ...editDialog, data: { ...editDialog.data, label: e.target.value } })}
                    placeholder="Node label"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Type</label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={editDialog.data.type}
                    onChange={(e) => setEditDialog({ ...editDialog, data: { ...editDialog.data, type: e.target.value } })}
                  >
                    <option value="concept">Concept</option>
                    <option value="entity">Entity</option>
                    <option value="person">Person</option>
                    <option value="company">Company</option>
                    <option value="paper">Paper</option>
                    <option value="tool">Tool</option>
                    <option value="idea">Idea</option>
                    <option value="question">Question</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Content (Markdown)</label>
                  <Textarea
                    value={editDialog.data.content}
                    onChange={(e) => setEditDialog({ ...editDialog, data: { ...editDialog.data, content: e.target.value } })}
                    placeholder="Description or notes..."
                    className="min-h-[100px]"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="text-sm font-medium mb-1 block">Source Node ID</label>
                  <Input
                    value={editDialog.data.sourceNodeId}
                    onChange={(e) => setEditDialog({ ...editDialog, data: { ...editDialog.data, sourceNodeId: e.target.value } })}
                    placeholder="Node ID"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Available nodes: {graph.nodes.map((n) => `${n.id}:${n.label}`).join(", ")}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Target Node ID</label>
                  <Input
                    value={editDialog.data.targetNodeId}
                    onChange={(e) => setEditDialog({ ...editDialog, data: { ...editDialog.data, targetNodeId: e.target.value } })}
                    placeholder="Node ID"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Label</label>
                  <Input
                    value={editDialog.data.label}
                    onChange={(e) => setEditDialog({ ...editDialog, data: { ...editDialog.data, label: e.target.value } })}
                    placeholder="e.g. relates to, depends on"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog({ ...editDialog, open: false })}>Cancel</Button>
            <Button onClick={editDialog.type === "node" ? handleSaveNode : handleSaveEdge}>
              {editDialog.type === "node" && selectedNode ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WikiLayout>
  );
}
