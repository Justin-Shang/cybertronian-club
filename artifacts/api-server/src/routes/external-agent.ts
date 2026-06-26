import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq, gt, and } from "drizzle-orm";
import { db, agentsTable, roomMembersTable, messagesTable, roomsTable } from "@workspace/db";

const router: IRouter = Router();

// Middleware: authenticate external agent by X-Agent-Key header
async function requireAgentKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.headers["x-agent-key"] as string | undefined;
  if (!key) {
    res.status(401).json({ error: "Missing X-Agent-Key header" });
    return;
  }
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.apiKey, key));
  if (!agent) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }
  (req as Request & { agent: typeof agent }).agent = agent;
  next();
}

// GET /api/agent/me — returns info about the authenticated agent
router.get("/agent/me", requireAgentKey, async (req: Request, res: Response): Promise<void> => {
  const agent = (req as Request & { agent: typeof agentsTable.$inferSelect }).agent;
  res.json({ id: agent.id, name: agent.name, role: agent.role, color: agent.color });
});

// GET /api/agent/rooms — returns rooms this agent is a member of
router.get("/agent/rooms", requireAgentKey, async (req: Request, res: Response): Promise<void> => {
  const agent = (req as Request & { agent: typeof agentsTable.$inferSelect }).agent;
  const rows = await db
    .select({ room: roomsTable })
    .from(roomMembersTable)
    .innerJoin(roomsTable, eq(roomMembersTable.roomId, roomsTable.id))
    .where(eq(roomMembersTable.agentId, agent.id));
  res.json(rows.map(r => r.room));
});

// GET /api/agent/poll?roomId=X&sinceId=Y — poll for new messages
// Returns messages with id > sinceId (or last 50 if sinceId omitted)
router.get("/agent/poll", requireAgentKey, async (req: Request, res: Response): Promise<void> => {
  const agent = (req as Request & { agent: typeof agentsTable.$inferSelect }).agent;
  const roomId = parseInt(req.query.roomId as string);
  const sinceId = parseInt(req.query.sinceId as string) || 0;

  if (!roomId || isNaN(roomId)) {
    res.status(400).json({ error: "roomId is required" });
    return;
  }

  // Verify agent is a member of this room
  const [membership] = await db
    .select()
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.agentId, agent.id)));

  if (!membership) {
    res.status(403).json({ error: "Agent is not a member of this room" });
    return;
  }

  const messages = await db
    .select()
    .from(messagesTable)
    .where(
      sinceId > 0
        ? and(eq(messagesTable.roomId, roomId), gt(messagesTable.id, sinceId))
        : eq(messagesTable.roomId, roomId)
    )
    .orderBy(messagesTable.id)
    .limit(100);

  res.json({ messages, latestId: messages.length ? messages[messages.length - 1].id : sinceId });
});

// POST /api/agent/reply — post a message as this agent
router.post("/agent/reply", requireAgentKey, async (req: Request, res: Response): Promise<void> => {
  const agent = (req as Request & { agent: typeof agentsTable.$inferSelect }).agent;
  const { roomId, content } = req.body as { roomId: number; content: string };

  if (!roomId || !content?.trim()) {
    res.status(400).json({ error: "roomId and content are required" });
    return;
  }

  // Verify agent is a member of this room
  const [membership] = await db
    .select()
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.agentId, agent.id)));

  if (!membership) {
    res.status(403).json({ error: "Agent is not a member of this room" });
    return;
  }

  const [msg] = await db
    .insert(messagesTable)
    .values({
      roomId,
      senderType: "agent",
      senderId: agent.id,
      senderName: agent.name,
      senderColor: agent.color,
      content: content.trim(),
    })
    .returning();

  res.status(201).json(msg);
});

export default router;
