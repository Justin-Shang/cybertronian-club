import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAgents, getListAgentsQueryKey,
  useCreateAgent, useUpdateAgent, useDeleteAgent,
} from "@workspace/api-client-react";
import type { Agent } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Bot, Check, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import Layout from "@/components/layout";

const PRESET_COLORS = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#14b8a6"];

interface FormData { name: string; role: string; systemPrompt: string; color: string; }

function AgentForm({ initial, onSave, onCancel, loading }: {
  initial?: Partial<Agent>; onSave: (d: FormData) => void; onCancel: () => void; loading?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? "");
  const [color, setColor] = useState(initial?.color ?? PRESET_COLORS[0]);

  return (
    <form onSubmit={e => { e.preventDefault(); if (name.trim() && role.trim() && systemPrompt.trim()) onSave({ name: name.trim(), role: role.trim(), systemPrompt: systemPrompt.trim(), color }); }} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
        <input data-testid="input-agent-name" className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="e.g. Athena" value={name} onChange={e => setName(e.target.value)} required />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">Role</label>
        <input data-testid="input-agent-role" className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="e.g. Strategic Planner" value={role} onChange={e => setRole(e.target.value)} required />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">System Prompt</label>
        <textarea data-testid="input-agent-system-prompt" className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" rows={5} placeholder="Define this agent's personality, expertise and behavior..." value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} required />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-2">Color</label>
        <div className="flex gap-2 flex-wrap items-center">
          {PRESET_COLORS.map(c => (
            <button key={c} type="button" onClick={() => setColor(c)} className={`w-7 h-7 rounded-full transition-all ${color === c ? "ring-2 ring-offset-2 ring-offset-card ring-white scale-110" : "hover:scale-105"}`} style={{ backgroundColor: c }} />
          ))}
          <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-7 h-7 rounded-full cursor-pointer border-0 p-0 bg-transparent" />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={loading} data-testid="button-save-agent" className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
          <Check className="w-4 h-4" />{loading ? "Saving..." : "Save Agent"}
        </button>
        <button type="button" onClick={onCancel} data-testid="button-cancel-agent" className="px-4 py-2 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-accent transition-colors">Cancel</button>
      </div>
    </form>
  );
}

function ApiKeyDisplay({ apiKey, agentName }: { apiKey: string; agentName: string }) {
  const [visible, setVisible] = useState(false);
  const masked = apiKey.slice(0, 8) + "••••••••••••••••••••••••••••";

  const copy = () => {
    navigator.clipboard.writeText(apiKey);
    toast.success(`Copied API key for ${agentName}`);
  };

  return (
    <div className="mt-3 pt-3 border-t border-border/50">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">API Key</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setVisible(v => !v)} title={visible ? "Hide key" : "Show key"} className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
            {visible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          </button>
          <button onClick={copy} data-testid={`button-copy-key-${apiKey.slice(0,8)}`} title="Copy key" className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
            <Copy className="w-3 h-3" />
          </button>
        </div>
      </div>
      <code className="block text-[11px] font-mono text-muted-foreground bg-muted/50 px-2 py-1.5 rounded truncate">
        {visible ? apiKey : masked}
      </code>
    </div>
  );
}

function ConnectInstructions({ agentId, apiKey }: { agentId: number; apiKey: string }) {
  const [open, setOpen] = useState(false);
  const baseUrl = window.location.origin;

  const snippet = `# 1. 验证身份
GET ${baseUrl}/api/agent/me
X-Agent-Key: ${apiKey}

# 2. 获取所在房间
GET ${baseUrl}/api/agent/rooms
X-Agent-Key: ${apiKey}

# 3. 轮询新消息 (每隔几秒调用一次)
GET ${baseUrl}/api/agent/poll?roomId=1&sinceId=0
X-Agent-Key: ${apiKey}

# 4. 发送回复
POST ${baseUrl}/api/agent/reply
X-Agent-Key: ${apiKey}
Content-Type: application/json

{ "roomId": 1, "content": "你好！" }`;

  return (
    <div className="mt-2">
      <button onClick={() => setOpen(v => !v)} className="text-[10px] text-primary hover:underline flex items-center gap-1">
        <RefreshCw className="w-2.5 h-2.5" />{open ? "收起接入说明" : "查看接入说明"}
      </button>
      {open && (
        <div className="mt-2 relative">
          <pre className="text-[10px] font-mono text-muted-foreground bg-muted rounded-lg p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">{snippet}</pre>
          <button onClick={() => { navigator.clipboard.writeText(snippet); toast.success("Copied!"); }} className="absolute top-2 right-2 text-[10px] px-2 py-0.5 bg-accent text-muted-foreground rounded hover:text-foreground transition-colors">Copy</button>
        </div>
      )}
    </div>
  );
}

export default function AgentsPage() {
  const qc = useQueryClient();
  const { data: agents, isLoading } = useListAgents();
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: getListAgentsQueryKey() });

  return (
    <Layout>
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Agents</h1>
            <p className="text-xs text-muted-foreground mt-0.5">每个 Agent 都有唯一 API Key，可用于外部接入</p>
          </div>
          <button data-testid="button-new-agent" onClick={() => { setShowCreate(true); setEditingId(null); }} className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
            <Plus className="w-4 h-4" />New Agent
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          {showCreate && (
            <div className="mb-6 p-5 bg-card border border-border rounded-xl">
              <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2"><Bot className="w-4 h-4 text-primary" />New Agent</h3>
              <AgentForm onSave={d => createAgent.mutate({ data: d }, { onSuccess: () => { toast.success("Agent created"); setShowCreate(false); inv(); }, onError: () => toast.error("Failed") })} onCancel={() => setShowCreate(false)} loading={createAgent.isPending} />
            </div>
          )}
          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[1,2,3].map(i => <div key={i} className="h-48 bg-card border border-border rounded-xl animate-pulse" />)}</div>
          ) : !agents?.length ? (
            <div className="text-center py-16">
              <Bot className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">No agents yet.</p>
              <button onClick={() => setShowCreate(true)} className="mt-3 text-primary text-sm hover:underline">Create your first agent</button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {agents.map(agent => (
                <div key={agent.id} data-testid={`card-agent-${agent.id}`} className="p-4 bg-card border border-border rounded-xl group hover:border-primary/20 transition-colors" style={{ borderLeft: `3px solid ${agent.color}` }}>
                  {editingId === agent.id ? (
                    <AgentForm initial={agent} onSave={d => updateAgent.mutate({ agentId: agent.id, data: d }, { onSuccess: () => { toast.success("Updated"); setEditingId(null); inv(); }, onError: () => toast.error("Failed") })} onCancel={() => setEditingId(null)} loading={updateAgent.isPending} />
                  ) : (
                    <>
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0" style={{ backgroundColor: agent.color }}>{agent.name[0].toUpperCase()}</div>
                          <div>
                            <p className="text-sm font-semibold text-foreground" data-testid={`text-agent-name-${agent.id}`}>{agent.name}</p>
                            <p className="text-xs text-muted-foreground">{agent.role}</p>
                          </div>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button data-testid={`button-edit-agent-${agent.id}`} onClick={() => setEditingId(agent.id)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                          <button data-testid={`button-delete-agent-${agent.id}`} onClick={() => { if (confirm(`Delete "${agent.name}"?`)) deleteAgent.mutate({ agentId: agent.id }, { onSuccess: () => { toast.success("Deleted"); inv(); }, onError: () => toast.error("Failed") }); }} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{agent.systemPrompt}</p>
                      <ApiKeyDisplay apiKey={agent.apiKey} agentName={agent.name} />
                      <ConnectInstructions agentId={agent.id} apiKey={agent.apiKey} />
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
