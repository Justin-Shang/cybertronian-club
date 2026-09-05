import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import Layout from "@/components/layout";

const DEFAULT_DEFINITION = JSON.stringify({
  nodes: [
    {
      id: "step-1",
      type: "agent_task",
      agentId: 1,
      prompt: "分析以下需求：{{trigger.input}}",
      outputKey: "analysis",
      retry: 3,
      timeout: 120,
    },
    {
      id: "step-2",
      type: "condition",
      expression: "{{nodes.step-1.output.confidence}} >= 0.7",
      trueNext: "step-3",
      falseNext: "step-4",
    },
    {
      id: "step-3",
      type: "agent_task",
      agentId: 2,
      prompt: "基于分析结果设计方案：{{nodes.step-1.output}}",
      outputKey: "design",
    },
    {
      id: "step-4",
      type: "agent_task",
      agentId: 3,
      prompt: "评审并优化以下内容：{{nodes.step-1.output}}",
      outputKey: "review",
    },
  ],
  edges: [
    { from: "step-1", to: "step-2" },
    { from: "step-2", to: "step-3", label: "confidence >= 0.7" },
    { from: "step-2", to: "step-4", label: "confidence < 0.7" },
  ],
}, null, 2);

export default function NewWorkflow() {
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [definition, setDefinition] = useState(DEFAULT_DEFINITION);
  const [error, setError] = useState("");

  // 创建工作流
  const createMutation = useMutation({
    mutationFn: async () => {
      let parsed;
      try {
        parsed = JSON.parse(definition);
      } catch {
        throw new Error("Invalid JSON definition");
      }
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, definition: parsed }),
      });
      if (!res.ok) throw new Error("Failed to create workflow");
      return res.json();
    },
    onSuccess: (data) => {
      setLocation(`/workflows/${data.id}`);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setLocation("/workflows")} className="p-2 hover:bg-accent rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold">New Workflow</h1>
            <p className="text-sm text-muted-foreground">手动定义工作流节点与边</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Software Design Pipeline"
              className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this workflow do?"
              className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Definition (JSON)
              <span className="text-xs text-muted-foreground ml-2">nodes + edges</span>
            </label>
            <textarea
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              rows={24}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => createMutation.mutate()}
              disabled={!name || createMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {createMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Create Workflow
            </button>
            <button
              onClick={() => setLocation("/workflows")}
              className="px-4 py-2 border border-border rounded-lg hover:bg-accent transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
