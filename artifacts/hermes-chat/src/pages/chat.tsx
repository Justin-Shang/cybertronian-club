import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListRooms, getListRoomsQueryKey,
  useGetRoom,
  useGetRoomMessages, getGetRoomMessagesQueryKey,
  useListAgents,
  useCreateRoom,
} from "@workspace/api-client-react";
import type { Message, Agent } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Hash, Send, Plus, Bot, Users, Zap, MessageSquare, ChevronDown } from "lucide-react";
import Layout from "@/components/layout";

// Parse SSE stream into events
async function* sseStream(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try { yield JSON.parse(line.slice(6)); } catch { /* skip */ }
      }
    }
  }
}

function AgentAvatar({ agent, size = "sm" }: { agent: Agent; size?: "sm" | "md" }) {
  const sz = size === "sm" ? "w-7 h-7 text-xs" : "w-9 h-9 text-sm";
  return (
    <div className={`${sz} rounded-full flex items-center justify-center font-bold text-white shrink-0`} style={{ backgroundColor: agent.color }}>
      {agent.name[0].toUpperCase()}
    </div>
  );
}

interface StreamingMsg { agentId: number; agentName: string; content: string; color: string; }

function MessageBubble({ msg, agents }: { msg: Message; agents: Agent[] }) {
  const isUser = msg.senderType === "user";
  const agent = msg.senderId ? agents.find(a => a.id === msg.senderId) : null;

  if (isUser) {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[70%]">
          <div className="px-4 py-2.5 bg-primary text-primary-foreground rounded-2xl rounded-br-sm text-sm leading-relaxed">
            {msg.content}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 text-right">You</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5 mb-4 group">
      {agent ? <AgentAvatar agent={agent} /> : (
        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0"><Bot className="w-3.5 h-3.5 text-muted-foreground" /></div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold" style={{ color: msg.senderColor ?? "#6366f1" }}>{msg.senderName}</span>
          {agent && <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{agent.role}</span>}
        </div>
        <div className="px-4 py-2.5 bg-card border rounded-2xl rounded-tl-sm text-sm leading-relaxed text-foreground" style={{ borderColor: (msg.senderColor ?? "#6366f1") + "40" }}>
          {msg.content}
        </div>
      </div>
    </div>
  );
}

function StreamingBubble({ msg }: { msg: StreamingMsg }) {
  return (
    <div className="flex gap-2.5 mb-4">
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 animate-pulse" style={{ backgroundColor: msg.color }}>
        {msg.agentName[0].toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold" style={{ color: msg.color }}>{msg.agentName}</span>
          <span className="text-[10px] text-muted-foreground">thinking...</span>
        </div>
        <div className="px-4 py-2.5 bg-card border rounded-2xl rounded-tl-sm text-sm leading-relaxed text-foreground" style={{ borderColor: msg.color + "40" }}>
          {msg.content || <span className="flex gap-1"><span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" /><span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:0.15s]" /><span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:0.3s]" /></span>}
        </div>
      </div>
    </div>
  );
}

function RoomSidebar({ currentRoomId }: { currentRoomId?: number }) {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { data: rooms } = useListRooms();
  const createRoom = useCreateRoom();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    createRoom.mutate({ data: { name: newName.trim(), description: "" } }, {
      onSuccess: room => { qc.invalidateQueries({ queryKey: getListRoomsQueryKey() }); setLocation(`/room/${room.id}`); setCreating(false); setNewName(""); },
      onError: () => toast.error("Failed to create room"),
    });
  };

  return (
    <div className="w-56 border-r border-sidebar-border bg-sidebar flex flex-col shrink-0">
      <div className="px-3 py-3 flex items-center justify-between border-b border-sidebar-border">
        <span className="text-xs font-semibold text-sidebar-foreground uppercase tracking-wider">Rooms</span>
        <button data-testid="button-sidebar-new-room" onClick={() => setCreating(v => !v)} className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"><Plus className="w-3.5 h-3.5" /></button>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="px-3 py-2 border-b border-sidebar-border">
          <input autoFocus data-testid="input-quick-room-name" className="w-full px-2 py-1.5 bg-muted border border-border rounded text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" placeholder="Room name..." value={newName} onChange={e => setNewName(e.target.value)} />
          <div className="flex gap-1 mt-1.5">
            <button type="submit" className="flex-1 px-2 py-1 bg-primary text-primary-foreground rounded text-xs hover:opacity-90">Create</button>
            <button type="button" onClick={() => setCreating(false)} className="px-2 py-1 bg-muted text-muted-foreground rounded text-xs hover:bg-accent">Cancel</button>
          </div>
        </form>
      )}

      <div className="flex-1 overflow-y-auto py-1 scrollbar-thin">
        {rooms?.map(room => (
          <button key={room.id} data-testid={`button-room-${room.id}`} onClick={() => setLocation(`/room/${room.id}`)} className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${room.id === currentRoomId ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/50"}`}>
            <Hash className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            <span className="text-sm truncate">{room.name}</span>
            {room.messageCount ? <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{room.messageCount}</span> : null}
          </button>
        ))}
        {!rooms?.length && <p className="px-3 py-4 text-xs text-muted-foreground">No rooms yet.</p>}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const params = useParams<{ roomId?: string }>();
  const roomId = params.roomId ? parseInt(params.roomId) : undefined;
  const qc = useQueryClient();

  const { data: room } = useGetRoom(roomId!, { query: { enabled: !!roomId, queryKey: roomId ? ["/rooms", roomId] : [] } });
  const { data: messages, isLoading: msgsLoading } = useGetRoomMessages(roomId!, { query: { enabled: !!roomId, queryKey: roomId ? getGetRoomMessagesQueryKey(roomId) : [] } });
  const { data: allAgents } = useListAgents();

  const [input, setInput] = useState("");
  const [mentionedAgentId, setMentionedAgentId] = useState<number | null>(null);
  const [streaming, setStreaming] = useState<StreamingMsg[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [showMention, setShowMention] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, streaming, scrollToBottom]);

  const members = (room as { members?: Agent[] })?.members ?? [];

  const processSSE = useCallback(async (response: Response, onDone: () => void) => {
    const agentBuffers = new Map<number, string>();
    for await (const event of sseStream(response)) {
      if (event.type === "agent_thinking") {
        const agent = allAgents?.find(a => a.id === event.agentId) ?? members.find(a => a.id === event.agentId);
        agentBuffers.set(event.agentId, "");
        setStreaming(prev => [...prev, { agentId: event.agentId, agentName: event.agentName, content: "", color: agent?.color ?? "#6366f1" }]);
      } else if (event.type === "stream_chunk") {
        const current = (agentBuffers.get(event.agentId) ?? "") + event.content;
        agentBuffers.set(event.agentId, current);
        setStreaming(prev => prev.map(s => s.agentId === event.agentId ? { ...s, content: current } : s));
      } else if (event.type === "message") {
        setStreaming(prev => prev.filter(s => s.agentId !== event.message.senderId));
        qc.invalidateQueries({ queryKey: roomId ? getGetRoomMessagesQueryKey(roomId) : [] });
      } else if (event.type === "done") {
        setStreaming([]);
        onDone();
      }
    }
    onDone();
  }, [allAgents, members, qc, roomId]);

  const handleSend = async () => {
    if (!input.trim() || !roomId || isSending) return;
    const content = input.trim();
    setInput("");
    setMentionedAgentId(null);
    setIsSending(true);

    try {
      const res = await fetch(`/api/rooms/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, mentionedAgentId }),
      });
      if (!res.ok) throw new Error("Failed");
      await processSSE(res, () => setIsSending(false));
    } catch {
      toast.error("Failed to send message");
      setIsSending(false);
    }
  };

  const handleTrigger = async (rounds = 1) => {
    if (!roomId || isTriggering) return;
    setIsTriggering(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/trigger-agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rounds }),
      });
      if (!res.ok) throw new Error("Failed");
      await processSSE(res, () => setIsTriggering(false));
    } catch {
      toast.error("Failed to trigger agents");
      setIsTriggering(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const agentsForDisplay = allAgents ?? [];

  return (
    <Layout>
      <div className="flex h-full">
        <RoomSidebar currentRoomId={roomId} />

        {!roomId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
              <p className="text-muted-foreground text-sm">Select a room to start chatting</p>
              <p className="text-xs text-muted-foreground/60 mt-1">or create one from the Rooms page</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-w-0">
            {/* Room header */}
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <Hash className="w-4 h-4 text-muted-foreground shrink-0" />
                <h2 className="text-sm font-semibold text-foreground truncate">{room?.name ?? "..."}</h2>
                {room?.description && <span className="text-xs text-muted-foreground truncate hidden sm:block">— {(room as { description: string }).description}</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Member avatars */}
                {members.length > 0 && (
                  <div className="flex -space-x-1.5">
                    {members.slice(0, 5).map(m => (
                      <div key={m.id} title={m.name} className="w-6 h-6 rounded-full border-2 border-background flex items-center justify-center text-[10px] font-bold text-white" style={{ backgroundColor: m.color }}>
                        {m.name[0]}
                      </div>
                    ))}
                    {members.length > 5 && <div className="w-6 h-6 rounded-full border-2 border-background bg-muted flex items-center justify-center text-[10px] text-muted-foreground">+{members.length - 5}</div>}
                  </div>
                )}
                <button data-testid="button-trigger-agents" onClick={() => handleTrigger(1)} disabled={isTriggering || members.length === 0} title="Trigger agent-to-agent discussion" className="flex items-center gap-1.5 px-2.5 py-1.5 bg-muted hover:bg-accent text-xs text-muted-foreground hover:text-foreground rounded-lg transition-colors disabled:opacity-50">
                  <Zap className={`w-3.5 h-3.5 ${isTriggering ? "animate-pulse text-yellow-500" : ""}`} />
                  {isTriggering ? "Running..." : "Trigger"}
                </button>
              </div>
            </div>

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
              {msgsLoading ? (
                <div className="space-y-4">
                  {[1,2,3].map(i => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}
                </div>
              ) : !messages?.length && !streaming.length ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <Bot className="w-10 h-10 text-muted-foreground/20 mb-3" />
                  <p className="text-sm text-muted-foreground">No messages yet.</p>
                  {members.length === 0 ? (
                    <p className="text-xs text-muted-foreground/60 mt-1">Add agents to this room from the Rooms page first.</p>
                  ) : (
                    <p className="text-xs text-muted-foreground/60 mt-1">Send a message to start the conversation.</p>
                  )}
                </div>
              ) : (
                <>
                  {messages?.map(msg => <MessageBubble key={msg.id} msg={msg} agents={agentsForDisplay} />)}
                  {streaming.map(s => <StreamingBubble key={s.agentId} msg={s} />)}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="px-5 py-4 border-t border-border shrink-0">
              {/* Mention selector */}
              {members.length > 0 && (
                <div className="flex gap-1.5 mb-3 flex-wrap">
                  <button onClick={() => setMentionedAgentId(null)} className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors ${mentionedAgentId === null ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground hover:bg-accent"}`}>
                    <Users className="w-3 h-3" />All
                  </button>
                  {members.map(agent => (
                    <button key={agent.id} data-testid={`button-mention-agent-${agent.id}`} onClick={() => setMentionedAgentId(mentionedAgentId === agent.id ? null : agent.id)} className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors ${mentionedAgentId === agent.id ? "text-white" : "bg-muted text-muted-foreground hover:bg-accent"}`} style={mentionedAgentId === agent.id ? { backgroundColor: agent.color } : {}}>
                      <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: agent.color }} />
                      {agent.name}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex gap-2 items-end">
                <textarea
                  ref={inputRef}
                  data-testid="input-message"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={members.length === 0 ? "Add agents to this room first..." : mentionedAgentId ? `Message ${members.find(m => m.id === mentionedAgentId)?.name}...` : "Message the group... (Enter to send, Shift+Enter for newline)"}
                  disabled={isSending || members.length === 0}
                  rows={1}
                  className="flex-1 px-4 py-2.5 bg-muted border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none scrollbar-thin disabled:opacity-50"
                  style={{ minHeight: "42px", maxHeight: "120px" }}
                  onInput={e => {
                    const t = e.target as HTMLTextAreaElement;
                    t.style.height = "auto";
                    t.style.height = Math.min(t.scrollHeight, 120) + "px";
                  }}
                />
                <button
                  data-testid="button-send-message"
                  onClick={handleSend}
                  disabled={!input.trim() || isSending || members.length === 0}
                  className="w-10 h-10 flex items-center justify-center bg-primary text-primary-foreground rounded-xl hover:opacity-90 disabled:opacity-40 transition-opacity shrink-0"
                >
                  <Send className={`w-4 h-4 ${isSending ? "animate-pulse" : ""}`} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
