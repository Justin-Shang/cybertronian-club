import { Router, type IRouter } from "express";
import { eq, desc, count } from "drizzle-orm";
import { db, messagesTable, agentsTable, roomMembersTable, roomsTable } from "@workspace/db";
import {
  GetRoomMessagesParams,
  SendMessageParams,
  SendMessageBody,
  TriggerAgentRepliesParams,
  TriggerAgentRepliesBody,
} from "@workspace/api-zod";
import OpenAI from "openai";

// Default OpenAI client (used when agent has no external API server configured)
const defaultOpenAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type AgentRow = typeof agentsTable.$inferSelect;

/**
 * Get an OpenAI client for an agent.
 * If the agent has apiBaseUrl configured, it points to the external Hermes API Server.
 * Otherwise falls back to our own OpenAI account.
 */
function getClientForAgent(agent: AgentRow): { client: OpenAI; model: string } {
  if (agent.apiBaseUrl) {
    return {
      client: new OpenAI({
        baseURL: agent.apiBaseUrl,
        apiKey: agent.bearerToken ?? "no-key",
      }),
      model: agent.modelName ?? "hermes-agent",
    };
  }
  return { client: defaultOpenAI, model: "gpt-4o-mini" };
}

function buildSystemPrompt(agent: AgentRow, allAgents: AgentRow[]): string {
  const others = allAgents
    .filter((a) => a.id !== agent.id)
    .map((a) => `${a.name} (${a.role})`)
    .join(", ");
  return (
    `You are ${agent.name}, a Hermes agent with the role: ${agent.role}.\n\n` +
    `${agent.systemPrompt}\n\n` +
    `You are in a group chat room. Respond in character. Be concise (1-3 sentences unless detail is needed). ` +
    (others ? `Other agents in the room: ${others}.` : "")
  );
}

const router: IRouter = Router();

router.get("/rooms/:roomId/messages", async (req, res): Promise<void> => {
  const params = GetRoomMessagesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const msgs = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.roomId, params.data.roomId))
    .orderBy(messagesTable.createdAt)
    .limit(100);
  res.json(msgs);
});

router.post("/rooms/:roomId/messages", async (req, res): Promise<void> => {
  const params = SendMessageParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Save user message
  const [userMsg] = await db
    .insert(messagesTable)
    .values({
      roomId: params.data.roomId,
      senderType: "user",
      content: parsed.data.content,
      mentionedAgentId: parsed.data.mentionedAgentId ?? null,
      senderName: "You",
      senderColor: "#64748b",
    })
    .returning();

  sendEvent({ type: "message", message: userMsg });

  // Get room members (agents)
  const members = await db
    .select({ agent: agentsTable })
    .from(roomMembersTable)
    .innerJoin(agentsTable, eq(roomMembersTable.agentId, agentsTable.id))
    .where(eq(roomMembersTable.roomId, params.data.roomId));

  const agents = members.map((m) => m.agent);
  if (!agents.length) { sendEvent({ type: "done" }); res.end(); return; }

  const respondingAgents = parsed.data.mentionedAgentId
    ? agents.filter((a) => a.id === parsed.data.mentionedAgentId)
    : agents;

  // Get recent message history
  const history = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.roomId, params.data.roomId))
    .orderBy(desc(messagesTable.createdAt))
    .limit(20);
  const chronological = history.reverse();

  for (const agent of respondingAgents) {
    sendEvent({ type: "agent_thinking", agentId: agent.id, agentName: agent.name });

    const { client, model } = getClientForAgent(agent);
    const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: buildSystemPrompt(agent, agents) },
      ...chronological.map((m) => ({
        role: (m.senderType === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.senderName ? `[${m.senderName}]: ${m.content}` : m.content,
      })),
    ];

    let fullContent = "";
    try {
      const stream = await client.chat.completions.create({
        model,
        messages: chatMessages,
        stream: true,
        max_tokens: 512,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          sendEvent({ type: "stream_chunk", agentId: agent.id, content: delta });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Agent failed to respond";
      sendEvent({ type: "error", agentId: agent.id, message: msg });
      continue;
    }

    const [agentMsg] = await db
      .insert(messagesTable)
      .values({
        roomId: params.data.roomId,
        senderType: "agent",
        senderId: agent.id,
        senderName: agent.name,
        senderColor: agent.color,
        content: fullContent,
      })
      .returning();

    sendEvent({ type: "message", message: agentMsg });
  }

  sendEvent({ type: "done" });
  res.end();
});

router.post("/rooms/:roomId/trigger-agents", async (req, res): Promise<void> => {
  const params = TriggerAgentRepliesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = TriggerAgentRepliesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const members = await db
    .select({ agent: agentsTable })
    .from(roomMembersTable)
    .innerJoin(agentsTable, eq(roomMembersTable.agentId, agentsTable.id))
    .where(eq(roomMembersTable.roomId, params.data.roomId));

  const allAgents = members.map((m) => m.agent);
  const rounds = parsed.data.rounds ?? 1;
  const targetAgents = parsed.data.targetAgentId
    ? allAgents.filter((a) => a.id === parsed.data.targetAgentId)
    : allAgents;

  for (let round = 0; round < rounds; round++) {
    for (const agent of targetAgents) {
      sendEvent({ type: "agent_thinking", agentId: agent.id, agentName: agent.name });

      const history = await db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.roomId, params.data.roomId))
        .orderBy(desc(messagesTable.createdAt))
        .limit(20);
      const chronological = history.reverse();

      const { client, model } = getClientForAgent(agent);
      const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: buildSystemPrompt(agent, allAgents) + "\nYou are in an agent-to-agent discussion. React and engage with the recent conversation." },
        ...chronological.map((m) => ({
          role: (m.senderType === "user" ? "user" : "assistant") as "user" | "assistant",
          content: m.senderName ? `[${m.senderName}]: ${m.content}` : m.content,
        })),
      ];

      let fullContent = "";
      try {
        const stream = await client.chat.completions.create({ model, messages: chatMessages, stream: true, max_tokens: 512 });
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) { fullContent += delta; sendEvent({ type: "stream_chunk", agentId: agent.id, content: delta }); }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Agent failed to respond";
        sendEvent({ type: "error", agentId: agent.id, message: msg });
        continue;
      }

      const [agentMsg] = await db
        .insert(messagesTable)
        .values({ roomId: params.data.roomId, senderType: "agent", senderId: agent.id, senderName: agent.name, senderColor: agent.color, content: fullContent })
        .returning();

      sendEvent({ type: "message", message: agentMsg });
    }
  }

  sendEvent({ type: "done" });
  res.end();
});

router.get("/stats", async (_req, res): Promise<void> => {
  const [rooms] = await db.select({ count: count() }).from(roomsTable);
  const [agents] = await db.select({ count: count() }).from(agentsTable);
  const [msgs] = await db.select({ count: count() }).from(messagesTable);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await db.select().from(messagesTable);
  const last24h = recent.filter((m) => new Date(m.createdAt) > since24h).length;
  res.json({
    totalRooms: rooms?.count ?? 0,
    totalAgents: agents?.count ?? 0,
    totalMessages: msgs?.count ?? 0,
    messagesLast24h: last24h,
  });
});

export default router;
