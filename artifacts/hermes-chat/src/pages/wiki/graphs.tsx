import { useState } from "react";
import { WikiLayout } from "@/components/wiki/layout";
import { Link, useLocation } from "wouter";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Share2, Plus, Trash2, ExternalLink } from "lucide-react";

const API_BASE = "";

interface Graph {
  id: number;
  name: string;
  description: string;
  type: string;
  createdAt: string;
  updatedAt: string;
}

function GraphCard({ graph, onDelete }: { graph: Graph; onDelete: (id: number) => void }) {
  const [, setLocation] = useLocation();
  const nodeCount = 0; // will be fetched on detail page

  return (
    <div
      className="bg-card border border-border p-5 rounded-lg hover:border-primary/50 transition-colors cursor-pointer group"
      onClick={() => setLocation(`/wiki/graphs/${graph.id}`)}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Share2 className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">{graph.name}</h3>
            <span className="text-xs text-muted-foreground capitalize">{graph.type}</span>
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 h-8 w-8">
              <Trash2 className="w-4 h-4 text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete graph?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete "{graph.name}" and all its nodes and edges.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground"
                onClick={(e) => { e.stopPropagation(); onDelete(graph.id); }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {graph.description && (
        <p className="text-sm text-muted-foreground line-clamp-2">{graph.description}</p>
      )}
      <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
        <span>Updated {new Date(graph.updatedAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

export default function KnowledgeGraphs() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [graphType, setGraphType] = useState("knowledge");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: graphs = [], isLoading } = useQuery({
    queryKey: ["knowledge-graphs"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/graphs`);
      if (!res.ok) throw new Error("Failed to fetch graphs");
      return res.json() as Promise<Graph[]>;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; type: string }) => {
      const res = await fetch(`${API_BASE}/api/graphs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create graph");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-graphs"] });
      setOpen(false);
      setName("");
      setDescription("");
      setGraphType("knowledge");
      toast({ title: "Graph created" });
    },
    onError: () => toast({ title: "Failed to create graph", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${API_BASE}/api/graphs/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete graph");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-graphs"] });
      toast({ title: "Graph deleted" });
    },
    onError: () => toast({ title: "Failed to delete graph", variant: "destructive" }),
  });

  return (
    <WikiLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-1">Knowledge Graphs</h1>
            <p className="text-muted-foreground">
              Visualize connections between concepts and entities.
            </p>
          </div>
          <Button onClick={() => setOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            New Graph
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-32 bg-muted animate-pulse rounded-lg border border-border" />
            ))}
          </div>
        ) : graphs.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {graphs.map((g) => (
              <GraphCard key={g.id} graph={g} onDelete={(id) => deleteMutation.mutate(id)} />
            ))}
          </div>
        ) : (
          <div className="py-16 text-center border border-dashed border-border rounded-lg">
            <Share2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-lg font-medium text-foreground mb-1">No graphs yet</p>
            <p className="text-muted-foreground mb-4">
              Create a knowledge graph to visualize connections between concepts.
            </p>
            <Button onClick={() => setOpen(true)} variant="outline" className="gap-2">
              <Plus className="w-4 h-4" />
              Create your first graph
            </Button>
          </div>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Knowledge Graph</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Name</label>
                <Input
                  placeholder="e.g. AI/ML Concepts"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Type</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={graphType}
                  onChange={(e) => setGraphType(e.target.value)}
                >
                  <option value="knowledge">Knowledge</option>
                  <option value="concept">Concept Map</option>
                  <option value="mindmap">Mind Map</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Description</label>
                <Textarea
                  placeholder="What is this graph about?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => createMutation.mutate({ name, description, type: graphType })} disabled={!name.trim()}>
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </WikiLayout>
  );
}
