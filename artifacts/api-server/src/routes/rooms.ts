import { Router, type IRouter } from "express";
import { eq, count, and } from "drizzle-orm";
import { db, roomsTable, roomMembersTable, agentsTable, messagesTable } from "@workspace/db";
import {
  CreateRoomBody,
  UpdateRoomBody,
  GetRoomParams,
  UpdateRoomParams,
  DeleteRoomParams,
  ListRoomMembersParams,
  AddRoomMemberBody,
  AddRoomMemberParams,
  RemoveRoomMemberParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/rooms", async (_req, res): Promise<void> => {
  const rooms = await db.select().from(roomsTable).orderBy(roomsTable.createdAt);

  const result = await Promise.all(
    rooms.map(async (room) => {
      const [mc] = await db
        .select({ count: count() })
        .from(messagesTable)
        .where(eq(messagesTable.roomId, room.id));
      const [mem] = await db
        .select({ count: count() })
        .from(roomMembersTable)
        .where(eq(roomMembersTable.roomId, room.id));
      return {
        ...room,
        messageCount: mc?.count ?? 0,
        memberCount: mem?.count ?? 0,
      };
    })
  );
  res.json(result);
});

router.post("/rooms", async (req, res): Promise<void> => {
  const parsed = CreateRoomBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [room] = await db.insert(roomsTable).values(parsed.data).returning();
  res.status(201).json({ ...room, messageCount: 0, memberCount: 0 });
});

router.get("/rooms/:roomId", async (req, res): Promise<void> => {
  const params = GetRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [room] = await db.select().from(roomsTable).where(eq(roomsTable.id, params.data.roomId));
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  const members = await db
    .select({ agent: agentsTable })
    .from(roomMembersTable)
    .innerJoin(agentsTable, eq(roomMembersTable.agentId, agentsTable.id))
    .where(eq(roomMembersTable.roomId, room.id));

  res.json({ ...room, members: members.map((m) => m.agent) });
});

router.patch("/rooms/:roomId", async (req, res): Promise<void> => {
  const params = UpdateRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateRoomBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [room] = await db
    .update(roomsTable)
    .set(parsed.data)
    .where(eq(roomsTable.id, params.data.roomId))
    .returning();
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  res.json(room);
});

router.delete("/rooms/:roomId", async (req, res): Promise<void> => {
  const params = DeleteRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(roomsTable).where(eq(roomsTable.id, params.data.roomId));
  res.sendStatus(204);
});

router.get("/rooms/:roomId/members", async (req, res): Promise<void> => {
  const params = ListRoomMembersParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const members = await db
    .select({ agent: agentsTable })
    .from(roomMembersTable)
    .innerJoin(agentsTable, eq(roomMembersTable.agentId, agentsTable.id))
    .where(eq(roomMembersTable.roomId, params.data.roomId));
  res.json(members.map((m) => m.agent));
});

router.post("/rooms/:roomId/members", async (req, res): Promise<void> => {
  const params = AddRoomMemberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = AddRoomMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await db
    .select()
    .from(roomMembersTable)
    .where(
      and(
        eq(roomMembersTable.roomId, params.data.roomId),
        eq(roomMembersTable.agentId, parsed.data.agentId)
      )
    );
  if (existing.length === 0) {
    await db.insert(roomMembersTable).values({
      roomId: params.data.roomId,
      agentId: parsed.data.agentId,
    });
  }
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, parsed.data.agentId));
  res.status(201).json(agent);
});

router.delete("/rooms/:roomId/members/:agentId", async (req, res): Promise<void> => {
  const params = RemoveRoomMemberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db
    .delete(roomMembersTable)
    .where(
      and(
        eq(roomMembersTable.roomId, params.data.roomId),
        eq(roomMembersTable.agentId, params.data.agentId)
      )
    );
  res.sendStatus(204);
});

export default router;
