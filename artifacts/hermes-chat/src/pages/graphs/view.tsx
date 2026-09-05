import { useEffect, useRef, useState, useMemo } from "react";
import Layout from "@/components/layout";
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
  Edit3,
  ZoomIn,
  ZoomOut,
  Target,
  Search,
  Network,
  Route,
  Sparkles,
  ExternalLink,
  Filter,
  Maximize,
  Minimize,
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
  pageId: number | null;
  sourceDate: string | null;
  externalGraphId: number | null;
  externalNodeId: number | null;
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
  edgeType: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface GraphDetail {
  id: number;
  name: string;
  description: string;
  type: string;
  ownerAgent: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const NODE_TYPE_CONFIG: Record<string, { color: string; label: string }> = {
  concept: { color: "#6366f1", label: "Concept" },
  method: { color: "#8b5cf6", label: "Method" },
  entity: { color: "#f59e0b", label: "Entity" },
  person: { color: "#10b981", label: "Person" },
  company: { color: "#06b6d4", label: "Company" },
  paper: { color: "#ef4444", label: "Paper" },
  tool: { color: "#0ea5e9", label: "Tool" },
  idea: { color: "#ec4899", label: "Idea" },
  question: { color: "#f97316", label: "Question" },
  hub: { color: "#eab308", label: "Hub" },
  document: { color: "#64748b", label: "Document" },
};

// P2-1: edge type color config
const EDGE_TYPE_CONFIG: Record<string, { color: string; label: string }> = {
  属于: { color: "#94a3b8", label: "属于" },
  先修: { color: "#3b82f6", label: "先修" },
  矛盾: { color: "#ef4444", label: "矛盾" },
  替代: { color: "#f97316", label: "替代" },
  应用于: { color: "#06b6d4", label: "应用于" },
  信号来源: { color: "#a855f7", label: "信号来源" },
  配合: { color: "#10b981", label: "配合" },
  其他: { color: "#64748b", label: "其他" },
};

const NEIGHBORHOOD_THRESHOLD = 25;

function getNodeColor(node: GraphNode): string {
  return node.color || NODE_TYPE_CONFIG[node.type]?.color || "#6366f1";
}

function getEdgeColor(edge: GraphEdge): string {
  if (edge.color) return edge.color;
  const t = edge.edgeType || "其他";
  return EDGE_TYPE_CONFIG[t]?.color || "#64748b";
}

interface VisNode {
  id: number;
  label: string;
  title: string;
  color: { background: string; border: string; highlight: { background: string; border: string } };
  shape: string;
  font: Record<string, unknown>;
  borderWidth: number;
  size?: number;
  shapeProperties: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

interface VisEdge {
  id: number;
  from: number;
  to: number;
  label: string;
  color: { color: string; highlight: string };
  width: number;
  smooth: Record<string, unknown>;
  font: Record<string, unknown>;
  dashes: boolean | number[];
}

function nodeToVis(node: GraphNode, opts: { isHub?: boolean; dimmed?: boolean; highlighted?: boolean } = {}): VisNode {
  const baseColor = getNodeColor(node);
  const bg = opts.dimmed ? "#475569" : baseColor;
  const border = opts.highlighted ? "#fbbf24" : opts.isHub ? "#fbbf24" : "#1e293b";
  return {
    id: node.id,
    label: opts.isHub ? `★ ${node.label}` : node.label,
    title: `<b>${node.label}</b><br/><small>${NODE_TYPE_CONFIG[node.type]?.label || node.type}</small>` +
      (node.sourceDate ? `<br/><small>来源: ${node.sourceDate}</small>` : "") +
      (node.pageId ? `<br/><small>📖 可查看原文</small>` : ""),
    color: { background: bg, border, highlight: { background: baseColor, border: "#fff" } },
    shape: "box",
    font: { color: "#fff", size: opts.isHub ? 16 : 14, face: "Inter, system-ui, sans-serif" },
    borderWidth: opts.isHub ? 4 : 2,
    size: opts.isHub ? 35 : 25,
    shapeProperties: { borderRadius: 6 },
    metadata: node.metadata,
  };
}

function edgeToVis(edge: GraphEdge, opts: { dimmed?: boolean; highlighted?: boolean } = {}): VisEdge {
  const color = getEdgeColor(edge);
  const finalColor = opts.dimmed ? "rgba(100,116,139,0.2)" : opts.highlighted ? "#fbbf24" : color;
  return {
    id: edge.id,
    from: edge.sourceNodeId,
    to: edge.targetNodeId,
    label: edge.edgeType || edge.label || "",
    color: { color: finalColor, highlight: "#fbbf24" },
    width: opts.highlighted ? 4 : 2,
    smooth: { type: "continuous" },
    font: { size: 11, color: "#94a3b8", strokeWidth: 0 },
    dashes: edge.style === "dashed" || edge.edgeType === "其他",
  };
}

export default function GraphView() {
  const { id } = useParams();
  const graphId = parseInt(id || "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<{ destroy: () => void; fit: () => void; moveTo: (o: { scale: number; position?: { x: number; y: number } }) => void; focus: (id: number, o?: Record<string, unknown>) => void; getPositions: (ids?: number[]) => Record<number, { x: number; y: number }> } | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editDialog, setEditDialog] = useState<{ open: boolean; type: "node" | "edge" | "graph"; data: Record<string, string> }>({ open: false, type: "node", data: {} });

  // P0-2 QA
  const [qaQuery, setQaQuery] = useState("");
  const [qaResult, setQaResult] = useState<{ answer: string; citedNodes: { id: number; label: string; pageId: number | null }[]; sources?: { title: string; url: string }[] } | null>(null);
  const [qaLoading, setQaLoading] = useState(false);

  // P1-3 centrality
  const [showHubs, setShowHubs] = useState(false);
  const [hubIds, setHubIds] = useState<Set<number>>(new Set());

  // P1-2 path
  const [pathDialog, setPathDialog] = useState(false);
  const [pathFrom, setPathFrom] = useState("");
  const [pathTo, setPathTo] = useState("");
  const [pathHighlight, setPathHighlight] = useState<{ nodes: Set<number>; edges: Set<number> } | null>(null);

  // P1-4 neighborhood expansion
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<number> | null>(null);

  // P2-1 edge type filter
  const [edgeTypeFilter, setEdgeTypeFilter] = useState<Set<string>>(new Set());

  // P2-3 time filter
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");

  // Fullscreen
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Sync fullscreen state with browser Fullscreen API
  useEffect(() => {
    const handler = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = async () => {
    if (isFullscreen) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  };

  // Re-fit graph when fullscreen toggles
  useEffect(() => {
    if (!networkRef.current) return;
    const timer = setTimeout(() => networkRef.current?.fit(), 300);
    return () => clearTimeout(timer);
  }, [isFullscreen]);

  // coverage for selected concept node
  const [coverage, setCoverage] = useState<{ nodeId: number; covered: string[]; missing: string[]; coverageRatio: number; expected: string[] } | null>(null);

  const { data: graph, isLoading } = useQuery({
    queryKey: ["knowledge-graph", graphId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/graphs/${graphId}`);
      if (!res.ok) throw new Error("Failed to fetch graph");
      return res.json() as Promise<GraphDetail>;
    },
    enabled: !!graphId,
    refetchInterval: 5000,
  });

  const addNodeMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
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
    mutationFn: async (data: Record<string, unknown>) => {
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

  // Compute which nodes to render (neighborhood expansion when graph is large)
  const { renderedNodes, renderedEdges, isLargeGraph } = useMemo(() => {
    if (!graph) return { renderedNodes: [], renderedEdges: [], isLargeGraph: false };
    const large = graph.nodes.length > NEIGHBORHOOD_THRESHOLD;
    if (!large || !expandedNodeIds) {
      return { renderedNodes: graph.nodes, renderedEdges: graph.edges, isLargeGraph: large };
    }
    const nodeIds = new Set(expandedNodeIds);
    const nodes = graph.nodes.filter((n) => nodeIds.has(n.id));
    const edges = graph.edges.filter((e) => nodeIds.has(e.sourceNodeId) && nodeIds.has(e.targetNodeId));
    return { renderedNodes: nodes, renderedEdges: edges, isLargeGraph: large };
  }, [graph, expandedNodeIds]);

  // Initialize neighborhood for large graphs: pick highest-degree node's 1-hop
  useEffect(() => {
    if (graph && graph.nodes.length > NEIGHBORHOOD_THRESHOLD && !expandedNodeIds) {
      const deg = new Map<number, number>();
      for (const n of graph.nodes) deg.set(n.id, 0);
      for (const e of graph.edges) {
        deg.set(e.sourceNodeId, (deg.get(e.sourceNodeId) ?? 0) + 1);
        deg.set(e.targetNodeId, (deg.get(e.targetNodeId) ?? 0) + 1);
      }
      let topId = graph.nodes[0]?.id;
      let topDeg = -1;
      for (const [nid, d] of deg) {
        if (d > topDeg) { topDeg = d; topId = nid; }
      }
      if (topId != null) {
        const ids = new Set<number>([topId]);
        for (const e of graph.edges) {
          if (e.sourceNodeId === topId) ids.add(e.targetNodeId);
          if (e.targetNodeId === topId) ids.add(e.sourceNodeId);
        }
        setExpandedNodeIds(ids);
      }
    }
  }, [graph, expandedNodeIds]);

  // P1-3 fetch centrality when toggled
  useEffect(() => {
    if (!showHubs || !graph) { setHubIds(new Set()); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/graphs/${graphId}/analysis/centrality`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setHubIds(new Set(data.nodes.filter((n: { isHub: boolean; nodeId: number }) => n.isHub).map((n: { nodeId: number }) => n.nodeId)));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [showHubs, graph, graphId]);

  // P1-1 fetch coverage when selecting a concept node
  useEffect(() => {
    if (!selectedNode || (selectedNode.type !== "concept" && selectedNode.type !== "hub")) { setCoverage(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/graphs/${graphId}/analysis/coverage`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const c = data.concepts.find((x: { nodeId: number }) => x.nodeId === selectedNode.id);
        if (c) setCoverage(c);
        else setCoverage(null);
      } catch { setCoverage(null); }
    })();
    return () => { cancelled = true; };
  }, [selectedNode, graphId]);

  // Initialize vis-network
  useEffect(() => {
    if (!graph || !containerRef.current || networkRef.current) return;
    let destroyed = false;

    const initNetwork = async () => {
      const vis = await import("vis-network");
      const { DataSet } = await import("vis-data");
      if (destroyed) return;

      const nodes = new DataSet(renderedNodes.map((n) => nodeToVis(n, { isHub: hubIds.has(n.id) })));
      const edges = new DataSet(renderedEdges.map((e) => edgeToVis(e)));

      const options = {
        nodes: { shape: "ellipse", font: { size: 14, color: "#fff", face: "Inter, system-ui, sans-serif" }, borderWidth: 2, shadow: { enabled: true, size: 4 } },
        edges: { width: 2, smooth: { type: "continuous" }, font: { size: 11, color: "#94a3b8", strokeWidth: 0 }, arrows: { to: { enabled: true, scaleFactor: 0.5 } } },
        physics: { solver: "forceAtlas2Based", forceAtlas2Based: { gravitationalConstant: -40, centralGravity: 0.005, springLength: 200, springConstant: 0.02, damping: 0.4 }, stabilization: { iterations: 200 } },
        interaction: { dragNodes: true, dragView: true, zoomView: true, hover: true, multiselect: false, navigationButtons: true, keyboard: true },
        layout: { improvedLayout: true },
      };

      const network = new vis.Network(containerRef.current!, { nodes, edges }, options);
      networkRef.current = network as never;

      network.on("click", (params: { nodes: number[] }) => {
        if (params.nodes.length > 0) {
          const nodeId = params.nodes[0];
          const nodeData = graph.nodes.find((n) => n.id === nodeId);
          if (nodeData) setSelectedNode(nodeData);
          // P1-4 expand neighborhood on click for large graphs
          if (isLargeGraph) {
            setExpandedNodeIds((prev) => {
              const next = new Set(prev ?? []);
              next.add(nodeId);
              for (const e of graph.edges) {
                if (e.sourceNodeId === nodeId) next.add(e.targetNodeId);
                if (e.targetNodeId === nodeId) next.add(e.sourceNodeId);
              }
              return next;
            });
          }
        } else {
          setSelectedNode(null);
        }
      });

      network.on("doubleClick", (params: { nodes: number[] }) => {
        if (params.nodes.length > 0 && editMode) {
          const nodeId = params.nodes[0];
          const nodeData = graph.nodes.find((n) => n.id === nodeId);
          if (nodeData) {
            const meta = (nodeData.metadata ?? {}) as Record<string, unknown>;
            const expected = Array.isArray(meta.expectedSubtopics) ? (meta.expectedSubtopics as string[]).join(", ") : "";
            setEditDialog({
              open: true, type: "node",
              data: {
                label: nodeData.label, type: nodeData.type, content: nodeData.content,
                pageId: String(nodeData.pageId ?? ""),
                sourceDate: nodeData.sourceDate ?? "",
                externalGraphId: String(nodeData.externalGraphId ?? ""),
                externalNodeId: String(nodeData.externalNodeId ?? ""),
                expectedSubtopics: expected,
              },
            });
          }
        }
      });
    };

    initNetwork();

    return () => {
      destroyed = true;
      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, graphId, isLargeGraph]);

  // Apply hub highlighting / path highlight / edge filter / time filter via re-render of DataSet
  useEffect(() => {
    const network = networkRef.current as unknown as { body: { data: { nodes: { update: (n: VisNode) => void; get: (id: number) => VisNode }; edges: { update: (e: VisEdge) => void; get: (id: number) => VisEdge } } } } | null;
    if (!network || !graph) return;

    const pathNodes = pathHighlight?.nodes ?? new Set<number>();
    const pathEdges = pathHighlight?.edges ?? new Set<number>();
    const hasHighlight = pathHighlight !== null;
    const hasEdgeFilter = edgeTypeFilter.size > 0;
    const hasTimeFilter = timeFrom || timeTo;

    for (const n of renderedNodes) {
      const isHub = showHubs && hubIds.has(n.id);
      const inPath = pathNodes.has(n.id);
      const dimmed = hasHighlight && !inPath;
      // time filter: node outside range is dimmed
      let timeDimmed = false;
      if (hasTimeFilter && n.sourceDate) {
        const d = n.sourceDate;
        if ((timeFrom && d < timeFrom) || (timeTo && d > timeTo)) timeDimmed = true;
      }
      network.body.data.nodes.update(nodeToVis(n, { isHub, dimmed: dimmed || timeDimmed, highlighted: inPath }));
    }
    for (const e of renderedEdges) {
      const inPath = pathEdges.has(e.id);
      const edgeTypeOk = !hasEdgeFilter || edgeTypeFilter.has(e.edgeType || "其他");
      const dimmed = (hasHighlight && !inPath) || !edgeTypeOk;
      network.body.data.edges.update(edgeToVis(e, { dimmed, highlighted: inPath }));
    }
  }, [showHubs, hubIds, pathHighlight, edgeTypeFilter, timeFrom, timeTo, renderedNodes, renderedEdges, graph]);

  // P0-2 QA
  const runQA = async () => {
    if (!qaQuery.trim()) return;
    setQaLoading(true);
    setQaResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/graphs/${graphId}/qa?q=${encodeURIComponent(qaQuery)}`);
      const data = await res.json();
      setQaResult(data);
    } catch {
      setQaResult({ answer: "问答请求失败", citedNodes: [] });
    } finally {
      setQaLoading(false);
    }
  };

  const selectAndFocusNode = (nodeId: number) => {
    const n = graph?.nodes.find((x) => x.id === nodeId);
    if (n) {
      setSelectedNode(n);
      networkRef.current?.focus(nodeId, { scale: 1.3, animation: { duration: 400, easingFunction: "easeInOutQuad" } });
    }
  };

  // P1-2 path
  const runPath = async () => {
    const from = parseInt(pathFrom, 10);
    const to = parseInt(pathTo, 10);
    if (isNaN(from) || isNaN(to)) { toast({ title: "请选择起点和终点", variant: "destructive" }); return; }
    try {
      const res = await fetch(`${API_BASE}/api/graphs/${graphId}/path?from=${from}&to=${to}`);
      const data = await res.json();
      if (!data.path || data.path.length === 0) {
        toast({ title: "两节点间不存在路径" });
        setPathHighlight(null);
      } else {
        setPathHighlight({ nodes: new Set(data.path as number[]), edges: new Set(data.edges as number[]) });
        toast({ title: `找到路径，共 ${data.path.length} 个节点` });
      }
      setPathDialog(false);
    } catch {
      toast({ title: "路径查询失败", variant: "destructive" });
    }
  };

  const handleAddNode = () => {
    setEditDialog({ open: true, type: "node", data: { label: "", type: "concept", content: "", pageId: "", sourceDate: "", externalGraphId: "", externalNodeId: "", expectedSubtopics: "" } });
  };

  const handleSaveNode = () => {
    const d = editDialog.data;
    if (!d.label.trim()) return;
    const data: Record<string, unknown> = {
      label: d.label, type: d.type, content: d.content,
      pageId: d.pageId ? parseInt(d.pageId, 10) : null,
      sourceDate: d.sourceDate || null,
      externalGraphId: d.externalGraphId ? parseInt(d.externalGraphId, 10) : null,
      externalNodeId: d.externalNodeId ? parseInt(d.externalNodeId, 10) : null,
    };
    if (d.type === "concept" && d.expectedSubtopics) {
      data.metadata = { expectedSubtopics: d.expectedSubtopics.split(",").map((s) => s.trim()).filter(Boolean) };
    }
    if (selectedNode && editDialog.data.label !== undefined) {
      updateNodeMutation.mutate({ nodeId: selectedNode.id, data });
    } else {
      addNodeMutation.mutate(data);
    }
    setEditDialog({ open: false, type: "node", data: {} });
  };

  const handleAddEdge = () => {
    setEditDialog({ open: true, type: "edge", data: { sourceNodeId: "", targetNodeId: "", label: "", edgeType: "属于" } });
  };

  const handleSaveEdge = () => {
    const { sourceNodeId, targetNodeId, label, edgeType } = editDialog.data;
    const src = parseInt(sourceNodeId, 10);
    const tgt = parseInt(targetNodeId, 10);
    if (isNaN(src) || isNaN(tgt)) return;
    addEdgeMutation.mutate({ sourceNodeId: src, targetNodeId: tgt, label: label || edgeType, edgeType });
    setEditDialog({ open: false, type: "edge", data: {} });
  };

  const handleZoomIn = () => networkRef.current?.moveTo({ scale: 1.2 });
  const handleZoomOut = () => networkRef.current?.moveTo({ scale: 0.8 });
  const handleFit = () => networkRef.current?.fit();

  const resetView = () => {
    setPathHighlight(null);
    setShowHubs(false);
    setEdgeTypeFilter(new Set());
    setTimeFrom("");
    setTimeTo("");
    setExpandedNodeIds(null);
    networkRef.current?.fit();
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="p-6 animate-pulse space-y-4">
          <div className="h-8 bg-muted w-1/4 rounded" />
          <div className="h-[600px] bg-muted rounded-lg" />
        </div>
      </Layout>
    );
  }

  if (!graph) {
    return (
      <Layout>
        <div className="p-6 text-center py-20">
          <h2 className="text-xl font-bold mb-2">Graph not found</h2>
          <Link href="/graphs" className="text-primary hover:underline">Return to graphs</Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={`${isFullscreen ? "fixed inset-0 z-50 bg-background" : "p-6 h-full flex flex-col overflow-hidden"}`}>
        {/* Header */}
        {!isFullscreen && (
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/graphs" className="text-muted-foreground hover:text-foreground shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight truncate">{graph.name}</h1>
              {graph.description && <p className="text-sm text-muted-foreground mt-0.5 truncate">{graph.description}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <span className="text-xs text-muted-foreground mr-1">
              {graph.nodes.length} nodes · {graph.edges.length} edges{graph.ownerAgent ? ` · ${graph.ownerAgent}` : ""}
            </span>
            <Button variant="outline" size="sm" onClick={handleZoomIn} title="放大"><ZoomIn className="w-4 h-4" /></Button>
            <Button variant="outline" size="sm" onClick={handleZoomOut} title="缩小"><ZoomOut className="w-4 h-4" /></Button>
            <Button variant="outline" size="sm" onClick={handleFit} title="适应"><Target className="w-4 h-4" /></Button>
            <Button variant={showHubs ? "default" : "outline"} size="sm" onClick={() => setShowHubs(!showHubs)} title="枢纽" className="gap-1"><Network className="w-4 h-4" />枢纽</Button>
            <Button variant="outline" size="sm" onClick={() => setPathDialog(true)} className="gap-1"><Route className="w-4 h-4" />路径</Button>
            <Button variant="outline" size="sm" onClick={resetView} title="重置"><Filter className="w-4 h-4" /></Button>
            <Button variant={editMode ? "default" : "outline"} size="sm" onClick={() => setEditMode(!editMode)} className="gap-1"><Edit3 className="w-4 h-4" />{editMode ? "完成" : "编辑"}</Button>
            <Button variant="outline" size="sm" onClick={toggleFullscreen} title={isFullscreen ? "退出全屏" : "全屏"} className="gap-1">
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </Button>
          </div>
        </div>
        )}

        {/* P0-2 QA box */}
        {!isFullscreen && (
        <div className="mb-3 shrink-0">
          <div className="flex gap-2">
            <Input value={qaQuery} placeholder="向图谱提问...（如：Kano 模型和 PMF 有什么关系？）"
              onChange={(e) => setQaQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runQA()}
              className="flex-1"
            />
            <Button onClick={runQA} disabled={qaLoading} className="gap-1">
              <Sparkles className="w-4 h-4" />{qaLoading ? "问答中..." : "问答"}
            </Button>
          </div>
          {qaResult && (
            <div className="mt-2 p-3 bg-card border border-border rounded-lg text-sm">
              <p className="whitespace-pre-wrap">{qaResult.answer}</p>
              {qaResult.citedNodes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-border">
                  <span className="text-xs text-muted-foreground">依据节点：</span>
                  {qaResult.citedNodes.map((n) => (
                    <button key={n.id} onClick={() => selectAndFocusNode(n.id)}
                      className="px-2 py-0.5 text-xs rounded-full bg-primary/15 text-primary hover:bg-primary/25 border border-primary/30">
                      [{n.id}] {n.label}{n.pageId ? " 📖" : ""}
                    </button>
                  ))}
                </div>
              )}
              {qaResult.sources && qaResult.sources.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-border">
                  <span className="text-xs text-muted-foreground">🌐 外部搜索来源：</span>
                  {qaResult.sources.map((s, i) => (
                    <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                      className="px-2 py-0.5 text-xs rounded-full bg-sky-500/15 text-sky-600 hover:bg-sky-500/25 border border-sky-500/30 truncate max-w-xs"
                      title={s.url}>
                      {s.title || s.url}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        )}

        {/* Main content */}
        <div className={`flex-1 flex gap-4 min-h-0 ${isFullscreen ? "p-2" : ""}`}>
          {/* Graph canvas */}
          <div className="flex-1 relative bg-card border border-border rounded-lg overflow-hidden">
            <div ref={containerRef} className="w-full h-full" />

            {/* Legend */}
            <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 bg-background/90 border border-border rounded-lg px-3 py-2 shadow-lg text-xs max-w-xs">
              <div className="flex items-center gap-1.5 flex-wrap">
                {Object.entries(NODE_TYPE_CONFIG).filter(([t]) => graph.nodes.some((n) => n.type === t)).map(([type, cfg]) => (
                  <div key={type} className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: cfg.color }} />
                    <span className="text-muted-foreground whitespace-nowrap">{cfg.label}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-border">
                {Object.entries(EDGE_TYPE_CONFIG).map(([t, cfg]) => (
                  <label key={t} className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={!edgeTypeFilter.size || edgeTypeFilter.has(t)}
                      onChange={() => {
                        setEdgeTypeFilter((prev) => {
                          const next = new Set(prev.size ? prev : Object.keys(EDGE_TYPE_CONFIG));
                          if (next.has(t)) next.delete(t); else next.add(t);
                          return next;
                        });
                      }}
                      className="w-3 h-3"
                    />
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cfg.color }} />
                    <span className="text-muted-foreground whitespace-nowrap">{cfg.label}</span>
                  </label>
                ))}
              </div>
              {isLargeGraph && (
                <div className="pt-1 border-t border-border text-muted-foreground">大图模式：点击节点展开邻域</div>
              )}
            </div>

            {/* Time filter */}
            <div className="absolute top-3 right-3 flex items-center gap-1 bg-background/90 border border-border rounded-lg px-2 py-1 shadow-lg text-xs">
              <span className="text-muted-foreground">时间:</span>
              <input type="date" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} className="bg-transparent border-0 text-xs w-28" />
              <span>-</span>
              <input type="date" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} className="bg-transparent border-0 text-xs w-28" />
              {(timeFrom || timeTo) && (
                <button onClick={() => { setTimeFrom(""); setTimeTo(""); }} className="text-muted-foreground hover:text-foreground">✕</button>
              )}
            </div>

            {/* Edit toolbar */}
            {editMode && (
              <div className="absolute top-3 left-3 flex items-center gap-2 bg-background/90 border border-border rounded-lg p-2 shadow-lg">
                <Button variant="ghost" size="sm" onClick={handleAddNode} className="gap-1"><Plus className="w-3.5 h-3.5" />节点</Button>
                <Button variant="ghost" size="sm" onClick={handleAddEdge} className="gap-1"><Link2 className="w-3.5 h-3.5" />边</Button>
                {selectedNode && <Button variant="ghost" size="sm" onClick={() => deleteNodeMutation.mutate(selectedNode.id)} className="gap-1 text-destructive"><Trash2 className="w-3.5 h-3.5" />删除</Button>}
              </div>
            )}

            {/* Fullscreen exit button */}
            {isFullscreen && (
              <div className="absolute top-3 right-3">
                <Button variant="outline" size="sm" onClick={toggleFullscreen} className="gap-1 bg-background/90 shadow-lg">
                  <Minimize className="w-4 h-4" />退出全屏
                </Button>
              </div>
            )}
          </div>

          {/* Node details panel */}
          {selectedNode && (
            <div className={`${isFullscreen
              ? "absolute top-3 right-16 w-72 bg-card/95 border border-border rounded-lg p-4 shadow-xl overflow-y-auto max-h-[80vh] z-10"
              : "w-72 bg-card border border-border rounded-lg p-4 shrink-0 overflow-y-auto"
            }`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">节点详情</h3>
                {editMode && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => {
                        const meta = (selectedNode.metadata ?? {}) as Record<string, unknown>;
                        const expected = Array.isArray(meta.expectedSubtopics) ? (meta.expectedSubtopics as string[]).join(", ") : "";
                        setEditDialog({ open: true, type: "node", data: { label: selectedNode.label, type: selectedNode.type, content: selectedNode.content, pageId: String(selectedNode.pageId ?? ""), sourceDate: selectedNode.sourceDate ?? "", externalGraphId: String(selectedNode.externalGraphId ?? ""), externalNodeId: String(selectedNode.externalNodeId ?? ""), expectedSubtopics: expected } });
                      }}>
                      <Edit3 className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteNodeMutation.mutate(selectedNode.id)}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="space-y-3 text-sm">
                <div><span className="text-muted-foreground text-xs">标签</span><p className="font-medium">{selectedNode.label}</p></div>
                <div><span className="text-muted-foreground text-xs">类型</span><p className="capitalize">{NODE_TYPE_CONFIG[selectedNode.type]?.label || selectedNode.type}</p></div>
                {selectedNode.sourceDate && <div><span className="text-muted-foreground text-xs">来源日期</span><p>{selectedNode.sourceDate}</p></div>}
                {selectedNode.content && <div><span className="text-muted-foreground text-xs">内容</span><p className="text-xs mt-1 whitespace-pre-wrap line-clamp-10">{selectedNode.content}</p></div>}

                {/* P0-1 view original */}
                {selectedNode.pageId && (
                  <Button variant="outline" size="sm" className="w-full gap-1" onClick={() => setLocation(`/wiki/pages/${selectedNode.pageId}`)}>
                    <ExternalLink className="w-3.5 h-3.5" />查看原文 (page {selectedNode.pageId})
                  </Button>
                )}

                {/* P2-2 cross-graph link */}
                {selectedNode.externalGraphId && (
                  <Button variant="outline" size="sm" className="w-full gap-1" onClick={() => setLocation(`/graphs/${selectedNode.externalGraphId}`)}>
                    <Link2 className="w-3.5 h-3.5" />跨图引用 → 图谱 {selectedNode.externalGraphId}
                  </Button>
                )}

                {/* P1-1 coverage */}
                {coverage && (
                  <div className="pt-2 border-t border-border">
                    <span className="text-muted-foreground text-xs">覆盖度 {coverage.covered.length}/{coverage.expected.length}</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {coverage.covered.map((c) => (
                        <span key={c} className="px-1.5 py-0.5 text-xs rounded bg-emerald-500/15 text-emerald-600">{c}</span>
                      ))}
                      {coverage.missing.map((m) => (
                        <span key={m} className="px-1.5 py-0.5 text-xs rounded bg-red-500/15 text-red-600">{m}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t border-border">
                  <span className="text-muted-foreground text-xs">连接的边</span>
                  {graph.edges.filter((e) => e.sourceNodeId === selectedNode.id || e.targetNodeId === selectedNode.id).map((e) => {
                    const other = e.sourceNodeId === selectedNode.id ? graph.nodes.find((n) => n.id === e.targetNodeId) : graph.nodes.find((n) => n.id === e.sourceNodeId);
                    return (
                      <div key={e.id} className="flex items-center gap-2 mt-1 text-xs">
                        <span className="text-muted-foreground">→</span>
                        <button className="hover:text-primary hover:underline" onClick={() => other && selectAndFocusNode(other.id)}>{other?.label || "?"}</button>
                        <span className="text-muted-foreground">({e.edgeType || e.label})</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Path dialog */}
      <Dialog open={pathDialog} onOpenChange={(o) => !o && setPathDialog(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>最短路径发现</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">起点节点</label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={pathFrom} onChange={(e) => setPathFrom(e.target.value)}>
                <option value="">选择起点...</option>
                {graph.nodes.map((n) => <option key={n.id} value={n.id}>[{n.id}] {n.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">终点节点</label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={pathTo} onChange={(e) => setPathTo(e.target.value)}>
                <option value="">选择终点...</option>
                {graph.nodes.map((n) => <option key={n.id} value={n.id}>[{n.id}] {n.label}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPathDialog(false)}>取消</Button>
            <Button onClick={runPath} className="gap-1"><Search className="w-4 h-4" />查找路径</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Node/Edge edit dialog */}
      <Dialog open={editDialog.open} onOpenChange={(o) => !o && setEditDialog({ ...editDialog, open: false })}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editDialog.type === "node" ? (selectedNode ? "编辑节点" : "添加节点") : "添加边"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {editDialog.type === "node" ? (
              <>
                <div>
                  <label className="text-sm font-medium mb-1 block">标签</label>
                  <Input value={editDialog.data.label} onChange={(e) => setEditDialog({ ...editDialog, data: { ...editDialog.data, label: e.target.value } })} placeholder="节点标签" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">类型</label>
                  <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={editDialog.data.type} onChange={(e) => setEditDialog({ ...editDialog, data: { ...editDialog.data, type: e.target.value } })}>
                    {Object.entries(NODE_TYPE_CONFIG).map(([t, c]) => <option key={t} value={t}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">内容 (Markdown)</label>
                  <Textarea value={editDialog.data.content} onChange={(e) => setEditDialog({ ...editDialog, data: { ...editDialog.data, content: e.target.value } })} placeholder="描述或笔记..." className="min-h-[80px]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium mb-1 block">关联 Wiki 页面 ID</label>
                    <Input value={editDialog.data.pageId} onChange={(e) => setEditDialog({ ...editDialog, data: { ...editDialog.data, pageId: e.target.value } })} placeholder="page id" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">来源日期</label>
                    <input type="date" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={editDialog.data.sourceDate} onChange={(e) => setEditDialog({ ...editDialog, data: { ...editDialog.data, sourceDate: e.target.value } })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium mb-1 block">跨图图谱 ID</label>
                    <Input value={editDialog.data.externalGraphId} onChange={(e) => setEditDialog({ ...editDialog, data: { ...editDialog.data, externalGraphId: e.target.value } })} placeholder="graph id" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">跨图节点 ID</label>
                    <Input value={editDialog.data.externalNodeId} onChange={(e) => setEditDialog({ ...editDialog, data: { ...editDialog.data, externalNodeId: e.target.value } })} placeholder="node id" />
                  </div>
                </div>
                {editDialog.data.type === "concept" && (
                  <div>
                    <label className="text-sm font-medium mb-1 block">预期子领域 (逗号分隔，用于覆盖度检测)</label>
                    <Input value={editDialog.data.expectedSubtopics} onChange={(e) => setEditDialog({ ...editDialog, data: { ...editDialog.data, expectedSubtopics: e.target.value } })} placeholder="如: JTBD, Kano, 用户故事" />
                  </div>
                )}
              </>
            ) : (
              <>
                <div>
                  <label className="text-sm font-medium mb-1 block">起点节点</label>
                  <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={editDialog.data.sourceNodeId} onChange={(e) => setEditDialog({ ...editDialog, data: { ...editDialog.data, sourceNodeId: e.target.value } })}>
                    <option value="">选择...</option>
                    {graph.nodes.map((n) => <option key={n.id} value={n.id}>[{n.id}] {n.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">终点节点</label>
                  <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={editDialog.data.targetNodeId} onChange={(e) => setEditDialog({ ...editDialog, data: { ...editDialog.data, targetNodeId: e.target.value } })}>
                    <option value="">选择...</option>
                    {graph.nodes.map((n) => <option key={n.id} value={n.id}>[{n.id}] {n.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">边类型</label>
                  <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={editDialog.data.edgeType} onChange={(e) => setEditDialog({ ...editDialog, data: { ...editDialog.data, edgeType: e.target.value } })}>
                    {Object.entries(EDGE_TYPE_CONFIG).map(([t, c]) => <option key={t} value={t}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">自定义标签 (可选，留空用类型)</label>
                  <Input value={editDialog.data.label} onChange={(e) => setEditDialog({ ...editDialog, data: { ...editDialog.data, label: e.target.value } })} placeholder="自定义关系描述" />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog({ ...editDialog, open: false })}>取消</Button>
            <Button onClick={editDialog.type === "node" ? handleSaveNode : handleSaveEdge}>{editDialog.type === "node" && selectedNode ? "保存" : "添加"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
