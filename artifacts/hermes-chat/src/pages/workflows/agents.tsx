import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, Plus, Trash2, Save, Loader2, Bot, Key, Link2 } from "lucide-react";
import Layout from "@/components/layout";

interface Agent {
  id: number;
  name: string;
  role: string;
  systemPrompt: string;
  apiBaseUrl: string | null;
  bearerToken: string | null;
  modelName: string | null;
  hasToken: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function AgentsPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: "",
    role: "",
    systemPrompt: "",
    apiBaseUrl: "",
    bearerToken: "",
    modelName: "",
  });

  const { data: agents = [], isLoading } = useQuery<Agent[]>({
    queryKey: ["wf-agents"],
    queryFn: async () => {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error("Failed to fetch agents");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create agent");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wf-agents"] });
      setShowForm(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof form }) => {
      const res = await fetch(`/api/agents/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update agent");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wf-agents"] });
      setShowForm(false);
      setEditingId(null);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/agents/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wf-agents"] });
    },
  });

  function resetForm() {
    setForm({ name: "", role: "", systemPrompt: "", apiBaseUrl: "", bearerToken: "", modelName: "" });
  }

  function handleEdit(agent: Agent) {
    setEditingId(agent.id);
    setForm({
      name: agent.name,
      role: agent.role,
      systemPrompt: agent.systemPrompt,
      apiBaseUrl: agent.apiBaseUrl || "",
      bearerToken: "", // 不回显 token
      modelName: agent.modelName || "",
    });
    setShowForm(true);
  }

  function handleSubmit() {
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: form });
    } else {
      createMutation.mutate(form);
    }
  }

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setLocation("/workflows")} className="p-2 hover:bg-accent rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bot className="w-6 h-6 text-primary" />
              Agents
            </h1>
            <p className="text-sm text-muted-foreground">注册你的 Hermes Agent，工作流引擎通过这些配置调用 Agent</p>
          </div>
          {!showForm && (
            <button
              onClick={() => { resetForm(); setEditingId(null); setShowForm(true); }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
            >
              <Plus className="w-4 h-4" />
              Register Agent
            </button>
          )}
        </div>

        {showForm && (
          <div className="mb-6 p-5 border border-border rounded-lg bg-card space-y-4">
            <h2 className="font-semibold">{editingId ? "Edit Agent" : "Register New Agent"}</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g., 需求分析师"
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Role</label>
                <input
                  type="text"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  placeholder="e.g, 负责需求分析和文档编写"
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 flex items-center gap-1">
                <Link2 className="w-3 h-3" />
                API Base URL
              </label>
              <input
                type="text"
                value={form.apiBaseUrl}
                onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })}
                placeholder="e.g., https://your-hermes-server.com/v1"
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 flex items-center gap-1">
                  <Key className="w-3 h-3" />
                  Bearer Token
                  {editingId && <span className="text-xs text-muted-foreground ml-1">(留空则不修改)</span>}
                </label>
                <input
                  type="password"
                  value={form.bearerToken}
                  onChange={(e) => setForm({ ...form, bearerToken: e.target.value })}
                  placeholder="API key / token"
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Model Name</label>
                <input
                  type="text"
                  value={form.modelName}
                  onChange={(e) => setForm({ ...form, modelName: e.target.value })}
                  placeholder="e.g., hermes-agent, deepseek-chat"
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">System Prompt</label>
              <textarea
                value={form.systemPrompt}
                onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                rows={4}
                placeholder="Agent 的系统提示词，定义其行为和专业领域"
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSubmit}
                disabled={!form.name || createMutation.isPending || updateMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {(createMutation.isPending || updateMutation.isPending) ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {editingId ? "Update" : "Register"}
              </button>
              <button
                onClick={() => { setShowForm(false); setEditingId(null); resetForm(); }}
                className="px-4 py-2 border border-border rounded-lg hover:bg-accent transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : agents.length === 0 && !showForm ? (
          <div className="text-center py-20 text-muted-foreground">
            <Bot className="w-16 h-16 mx-auto mb-4 opacity-30" />
            <p className="text-lg mb-2">No agents registered</p>
            <p className="text-sm mb-6">注册你的 Hermes Agent，工作流引擎才能调用它们</p>
          </div>
        ) : (
          <div className="space-y-3">
            {agents.map((agent) => (
              <div key={agent.id} className="border border-border rounded-lg p-4 bg-card hover:border-primary/30 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">{agent.name}</span>
                      <span className="text-xs text-muted-foreground">#{agent.id}</span>
                      {agent.hasToken ? (
                        <span className="text-xs text-green-500 flex items-center gap-0.5">
                          <Key className="w-3 h-3" /> 已配置
                        </span>
                      ) : (
                        <span className="text-xs text-yellow-500">未配置 Token</span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{agent.role || "No role"}</p>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {agent.apiBaseUrl && (
                        <span className="flex items-center gap-1 font-mono truncate max-w-xs">
                          <Link2 className="w-3 h-3" />
                          {agent.apiBaseUrl}
                        </span>
                      )}
                      {agent.modelName && (
                        <span className="font-mono">{agent.modelName}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleEdit(agent)}
                      className="px-3 py-1.5 border border-border rounded-md text-sm hover:bg-accent transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(agent.id)}
                      className="px-3 py-1.5 border border-border rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}