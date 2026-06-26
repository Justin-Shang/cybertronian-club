import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAgents, getListAgentsQueryKey,
  useCreateAgent, useUpdateAgent, useDeleteAgent,
} from "@workspace/api-client-react";
import type { Agent } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Bot, Check, Copy, Eye, EyeOff, Link, Zap } from "lucide-react";
import Layout from "@/components/layout";

const PRESET_COLORS = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#14b8a6"];

interface FormData {
  name: string; role: string; systemPrompt: string; color: string;
  apiBaseUrl: string; bearerToken: string; modelName: string;
}

function AgentForm({ initial, onSave, onCancel, loading }: {
  initial?: Partial<Agent>; onSave: (d: FormData) => void; onCancel: () => void; loading?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? "");
  const [color, setColor] = useState(initial?.color ?? PRESET_COLORS[0]);
  const [apiBaseUrl, setApiBaseUrl] = useState(initial?.apiBaseUrl ?? "");
  const [bearerToken, setBearerToken] = useState(initial?.bearerToken ?? "");
  const [modelName, setModelName] = useState(initial?.modelName ?? "");
  const [showToken, setShowToken] = useState(false);
  const [tab, setTab] = useState<"profile" | "connection">("profile");

  const isExternal = !!apiBaseUrl.trim();

  return (
    <form onSubmit={e => {
      e.preventDefault();
      if (!name.trim() || !role.trim()) return;
      // systemPrompt optional if external API
      if (!isExternal && !systemPrompt.trim()) return;
      onSave({ name: name.trim(), role: role.trim(), systemPrompt: systemPrompt.trim(), color, apiBaseUrl: apiBaseUrl.trim(), bearerToken: bearerToken.trim(), modelName: modelName.trim() });
    }} className="space-y-4">

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
        {(["profile", "connection"] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-1 rounded text-xs font-medium transition-colors ${tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t === "profile" ? "角色配置" : "外部 API 接入"}
          </button>
        ))}
      </div>

      {tab === "profile" ? (
        <>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
            <input data-testid="input-agent-name" className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="e.g. 擎天柱" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Role</label>
            <input data-testid="input-agent-role" className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="e.g. 战略指挥官" value={role} onChange={e => setRole(e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              System Prompt {isExternal && <span className="text-muted-foreground/50 ml-1">(可选，已有外部 API)</span>}
            </label>
            <textarea data-testid="input-agent-system-prompt" className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" rows={4} placeholder={isExternal ? "留空则完全由外部 Agent 自己决定行为..." : "Define this agent's personality, expertise and behavior..."} value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} required={!isExternal} />
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
        </>
      ) : (
        <>
          <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg text-xs text-muted-foreground leading-relaxed">
            <p className="font-medium text-foreground mb-1 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-primary" />连接你的 Hermes API Server</p>
            <p>填写 API Base URL 后，消息会直接发给你自己的 Agent，而不是内置 OpenAI。兼容所有 OpenAI Chat Completions 格式的服务。</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">API Base URL</label>
            <input data-testid="input-agent-api-base-url" className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="http://127.0.0.1:8642/v1" value={apiBaseUrl} onChange={e => setApiBaseUrl(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Bearer Token</label>
            <div className="relative">
              <input data-testid="input-agent-bearer-token" type={showToken ? "text" : "password"} className="w-full px-3 py-2 pr-9 bg-muted border border-border rounded-lg text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="tc-shared-key-2026" value={bearerToken} onChange={e => setBearerToken(e.target.value)} />
              <button type="button" onClick={() => setShowToken(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Model Name <span className="text-muted-foreground/50">(传给 API 的 model 参数)</span></label>
            <input data-testid="input-agent-model-name" className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="hermes-agent" value={modelName} onChange={e => setModelName(e.target.value)} />
          </div>
        </>
      )}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={loading} data-testid="button-save-agent" className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
          <Check className="w-4 h-4" />{loading ? "Saving..." : "Save Agent"}
        </button>
        <button type="button" onClick={onCancel} data-testid="button-cancel-agent" className="px-4 py-2 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-accent transition-colors">Cancel</button>
      </div>
    </form>
  );
}

function ApiKeyBadge({ apiKey }: { apiKey: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="mt-3 pt-3 border-t border-border/40">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Polling API Key</span>
        <div className="flex gap-1">
          <button onClick={() => setVisible(v => !v)} className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground">
            {visible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          </button>
          <button onClick={() => { navigator.clipboard.writeText(apiKey); toast.success("Key copied"); }} className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground">
            <Copy className="w-3 h-3" />
          </button>
        </div>
      </div>
      <code className="block text-[11px] font-mono text-muted-foreground bg-muted/50 px-2 py-1 rounded truncate">
        {visible ? apiKey : apiKey.slice(0, 8) + "••••••••••••••••••••••••••••"}
      </code>
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

  const save = (data: FormData) => ({
    name: data.name, role: data.role,
    systemPrompt: data.systemPrompt || `You are ${data.name}, role: ${data.role}.`,
    color: data.color,
    apiBaseUrl: data.apiBaseUrl || null,
    bearerToken: data.bearerToken || null,
    modelName: data.modelName || null,
  });

  return (
    <Layout>
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Agents</h1>
            <p className="text-xs text-muted-foreground mt-0.5">可接入内置 AI 或你自己的 Hermes API Server</p>
          </div>
          <button data-testid="button-new-agent" onClick={() => { setShowCreate(true); setEditingId(null); }} className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
            <Plus className="w-4 h-4" />New Agent
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          {showCreate && (
            <div className="mb-6 p-5 bg-card border border-border rounded-xl">
              <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2"><Bot className="w-4 h-4 text-primary" />New Agent</h3>
              <AgentForm
                onSave={d => createAgent.mutate({ data: save(d) }, { onSuccess: () => { toast.success("Agent created"); setShowCreate(false); inv(); }, onError: () => toast.error("Failed") })}
                onCancel={() => setShowCreate(false)}
                loading={createAgent.isPending}
              />
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
                    <AgentForm
                      initial={agent}
                      onSave={d => updateAgent.mutate({ agentId: agent.id, data: save(d) }, { onSuccess: () => { toast.success("Updated"); setEditingId(null); inv(); }, onError: () => toast.error("Failed") })}
                      onCancel={() => setEditingId(null)}
                      loading={updateAgent.isPending}
                    />
                  ) : (
                    <>
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0" style={{ backgroundColor: agent.color }}>{agent.name[0].toUpperCase()}</div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-semibold text-foreground" data-testid={`text-agent-name-${agent.id}`}>{agent.name}</p>
                              {agent.apiBaseUrl && (
                                <span title={`External: ${agent.apiBaseUrl}`} className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-full font-medium">
                                  <Link className="w-2.5 h-2.5" />外部
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">{agent.role}</p>
                          </div>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button data-testid={`button-edit-agent-${agent.id}`} onClick={() => setEditingId(agent.id)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                          <button data-testid={`button-delete-agent-${agent.id}`} onClick={() => { if (confirm(`Delete "${agent.name}"?`)) deleteAgent.mutate({ agentId: agent.id }, { onSuccess: () => { toast.success("Deleted"); inv(); }, onError: () => toast.error("Failed") }); }} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>

                      {agent.apiBaseUrl ? (
                        <div className="text-xs space-y-1">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Zap className="w-3 h-3 text-emerald-400" />
                            <code className="font-mono truncate">{agent.apiBaseUrl}</code>
                          </div>
                          {agent.modelName && <p className="text-muted-foreground/70 font-mono">model: {agent.modelName}</p>}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{agent.systemPrompt}</p>
                      )}

                      <ApiKeyBadge apiKey={agent.apiKey} />
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
