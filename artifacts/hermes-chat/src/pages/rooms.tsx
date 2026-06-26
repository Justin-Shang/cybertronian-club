import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListRooms, getListRoomsQueryKey,
  useCreateRoom, useDeleteRoom,
  useListAgents, useListRoomMembers, getListRoomMembersQueryKey,
  useAddRoomMember, useRemoveRoomMember,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import { Plus, Trash2, Hash, Users, MessageSquare, X, UserPlus } from "lucide-react";
import Layout from "@/components/layout";

function RoomMembersPanel({ roomId, onClose }: { roomId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: members } = useListRoomMembers(roomId, { query: { queryKey: getListRoomMembersQueryKey(roomId) } });
  const { data: allAgents } = useListAgents();
  const addMember = useAddRoomMember();
  const removeMember = useRemoveRoomMember();
  const inv = () => qc.invalidateQueries({ queryKey: getListRoomMembersQueryKey(roomId) });

  const memberIds = new Set(members?.map(m => m.id) ?? []);
  const nonMembers = allAgents?.filter(a => !memberIds.has(a.id)) ?? [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl w-96 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Users className="w-4 h-4 text-primary" />Manage Members</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {members?.length ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Current members ({members.length})</p>
              <div className="space-y-1.5">
                {members.map(agent => (
                  <div key={agent.id} className="flex items-center justify-between p-2.5 bg-muted rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: agent.color }}>{agent.name[0]}</div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{agent.name}</p>
                        <p className="text-xs text-muted-foreground">{agent.role}</p>
                      </div>
                    </div>
                    <button data-testid={`button-remove-member-${agent.id}`} onClick={() => removeMember.mutate({ roomId, agentId: agent.id }, { onSuccess: () => { toast.success("Removed"); inv(); }, onError: () => toast.error("Failed") })} className="text-muted-foreground hover:text-destructive transition-colors"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            </div>
          ) : <p className="text-sm text-muted-foreground text-center py-4">No agents in this room yet.</p>}

          {nonMembers.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1"><UserPlus className="w-3 h-3" />Add agents</p>
              <div className="space-y-1.5">
                {nonMembers.map(agent => (
                  <button key={agent.id} data-testid={`button-add-member-${agent.id}`} onClick={() => addMember.mutate({ roomId, data: { agentId: agent.id } }, { onSuccess: () => { toast.success(`Added ${agent.name}`); inv(); }, onError: () => toast.error("Failed") })} className="w-full flex items-center gap-2 p-2.5 bg-muted hover:bg-accent rounded-lg transition-colors text-left">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: agent.color }}>{agent.name[0]}</div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{agent.name}</p>
                      <p className="text-xs text-muted-foreground">{agent.role}</p>
                    </div>
                    <Plus className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RoomsPage() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { data: rooms, isLoading } = useListRooms();
  const createRoom = useCreateRoom();
  const deleteRoom = useDeleteRoom();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [managingRoomId, setManagingRoomId] = useState<number | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: getListRoomsQueryKey() });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createRoom.mutate({ data: { name: name.trim(), description: description.trim() } }, {
      onSuccess: room => { toast.success("Room created"); setShowCreate(false); setName(""); setDescription(""); inv(); setLocation(`/room/${room.id}`); },
      onError: () => toast.error("Failed to create room"),
    });
  };

  return (
    <Layout>
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Rooms</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Group chat rooms for agent discussions</p>
          </div>
          <button data-testid="button-new-room" onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
            <Plus className="w-4 h-4" />New Room
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          {showCreate && (
            <form onSubmit={handleCreate} className="mb-6 p-5 bg-card border border-border rounded-xl space-y-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Hash className="w-4 h-4 text-primary" />New Room</h3>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
                <input data-testid="input-room-name" className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="e.g. Strategy Session" value={name} onChange={e => setName(e.target.value)} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
                <input data-testid="input-room-description" className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="What is this room for?" value={description} onChange={e => setDescription(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={createRoom.isPending} data-testid="button-save-room" className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
                  <Hash className="w-4 h-4" />{createRoom.isPending ? "Creating..." : "Create Room"}
                </button>
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-accent transition-colors">Cancel</button>
              </div>
            </form>
          )}

          {isLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-card border border-border rounded-xl animate-pulse" />)}</div>
          ) : !rooms?.length ? (
            <div className="text-center py-16">
              <Hash className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">No rooms yet.</p>
              <button onClick={() => setShowCreate(true)} className="mt-3 text-primary text-sm hover:underline">Create your first room</button>
            </div>
          ) : (
            <div className="space-y-2">
              {rooms.map(room => (
                <div key={room.id} data-testid={`card-room-${room.id}`} className="p-4 bg-card border border-border rounded-xl group hover:border-primary/30 transition-colors flex items-center justify-between">
                  <button className="flex items-center gap-3 text-left flex-1 min-w-0" onClick={() => setLocation(`/room/${room.id}`)}>
                    <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Hash className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{room.name}</p>
                      {room.description && <p className="text-xs text-muted-foreground truncate">{room.description}</p>}
                    </div>
                  </button>
                  <div className="flex items-center gap-3 ml-4 shrink-0">
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{room.memberCount ?? 0}</span>
                      <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" />{room.messageCount ?? 0}</span>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button data-testid={`button-manage-room-${room.id}`} onClick={() => setManagingRoomId(room.id)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"><Users className="w-3.5 h-3.5" /></button>
                      <button data-testid={`button-delete-room-${room.id}`} onClick={() => { if (confirm(`Delete room "${room.name}"?`)) deleteRoom.mutate({ roomId: room.id }, { onSuccess: () => { toast.success("Deleted"); inv(); }, onError: () => toast.error("Failed") }); }} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {managingRoomId !== null && <RoomMembersPanel roomId={managingRoomId} onClose={() => setManagingRoomId(null)} />}
    </Layout>
  );
}
