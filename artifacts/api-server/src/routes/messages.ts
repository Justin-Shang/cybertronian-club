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
import { saveInvestNote } from "../lib/invest-notes";

// Default OpenAI client (used when agent has no external API server configured)
const defaultOpenAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type AgentRow = typeof agentsTable.$inferSelect;

// ──────────────── 投研笔记自动写入（chat 通道）────────────────
// 擎天柱等投研 agent 在得出结论时，于回复末尾追加 ```invest-note {...} ``` 块。
// 后端流结束后解析该块，调用 saveInvestNote 写入，并通过 note_saved SSE 事件通知前端。

const INVEST_NOTE_PROMPT = `
When you analyze a specific A-share stock and reach an investment conclusion, append a structured note block at the END of your reply so it can be saved to the investment notebook. Use EXACTLY this format (one JSON object inside a fenced invest-note block):

\`\`\`invest-note
{"code":"600519","frameworkId":"value","title":"简短标题","conclusion":"一句话核心结论","content":"# markdown 正文\\n详细分析..."}
\`\`\`

Rules:
- "code" = 6-digit A-share code (e.g. "600519"). Required.
- "frameworkId" = optional analysis framework id (e.g. "value","growth","quality","dividend").
- "conclusion" = one-sentence core conclusion. Required.
- "content" = markdown body with the detailed reasoning. Required.
- Emit the block ONLY when there is a genuine stock-analysis conclusion worth saving. Keep your visible reply concise; put the full analysis in "content".
- Do NOT emit the block for general chat, greetings, or non-stock topics.`;

function isInvestmentAgent(agent: AgentRow): boolean {
  const text = `${agent.role} ${agent.systemPrompt}`;
  return /投研|投资|金融|股票|二级市场|portfolio|invest|equit/i.test(text);
}

interface ParsedNoteBlock {
  code: string;
  frameworkId?: string;
  title?: string;
  conclusion: string;
  content: string;
}

/**
 * 从 agent 回复中提取 invest-note JSON。
 * 擎天柱等自主 agent 常不闭合 ``` 围栏，而是切换到 DSML 标签，
 * 因此用大括号配平从 ```invest-note 标记后的首个 { 抽取完整 JSON，
 * 不依赖闭合围栏；同时兼容正常闭合的围栏与 DSML parameter 包裹。
 */
function extractInvestNotes(content: string): ParsedNoteBlock[] {
  const results: ParsedNoteBlock[] = [];
  const marker = "```invest-note";
  let searchFrom = 0;
  while (true) {
    const markerIdx = content.indexOf(marker, searchFrom);
    if (markerIdx === -1) break;
    const braceStart = content.indexOf("{", markerIdx + marker.length);
    if (braceStart === -1) {
      searchFrom = markerIdx + marker.length;
      continue;
    }
    // 大括号配平，跳过字符串内的 { } 与转义
    let depth = 0;
    let inString = false;
    let escape = false;
    let endIdx = -1;
    for (let i = braceStart; i < content.length; i++) {
      const ch = content[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { endIdx = i; break; }
      }
    }
    if (endIdx === -1) {
      searchFrom = markerIdx + marker.length;
      continue;
    }
    const jsonStr = content.slice(braceStart, endIdx + 1);
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed.code === "string" && typeof parsed.conclusion === "string" && typeof parsed.content === "string") {
        results.push({
          code: parsed.code,
          frameworkId: parsed.frameworkId ?? undefined,
          title: parsed.title ?? undefined,
          conclusion: parsed.conclusion,
          content: parsed.content,
        });
      }
    } catch {
      // malformed JSON — skip
    }
    searchFrom = endIdx + 1;
  }
  return results;
}

/**
 * 移除回复中的 invest-note 块及残留 DSML 标签，保留可见正文。
 * invest-note 块总是在回复末尾，故从标记处截断到结尾，再清理 DSML 残片。
 */
function stripInvestNoteBlocks(content: string): string {
  let result = content.replace(/```invest-note[\s\S]*$/g, "");
  // 清理残留的 DSML 标签（擎天柱自主 agent 的工具调用标记，全角｜）
  result = result.replace(/<\/?[｜|]{2}DSML[｜|]{2}[^>]*>/g, "");
  // 清理末尾空围栏与多余空白
  result = result.replace(/```\s*$/g, "").replace(/\s+$/, "").trim();
  return result || content.trim();
}

/** 解析 fullContent 中的笔记块，逐一写入并发出 note_saved 事件（在 message 事件之后调用）。 */
async function saveInvestNotesFromContent(
  fullContent: string,
  agent: AgentRow,
  roomId: number,
  sendEvent: (data: object) => void,
  log: { error: (obj: object, msg: string) => void },
): Promise<void> {
  const blocks = extractInvestNotes(fullContent);
  for (const block of blocks) {
    try {
      const note = await saveInvestNote({
        code: block.code,
        frameworkId: block.frameworkId ?? null,
        title: block.title ?? null,
        conclusion: block.conclusion,
        content: block.content,
        author: "agent",
        agentName: agent.name,
        roomId,
      });
      sendEvent({ type: "note_saved", agentId: agent.id, agentName: agent.name, note });
    } catch (err) {
      log.error({ err, code: block.code }, "Failed to save invest note from chat");
    }
  }
}

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
    (others ? `Other agents in the room: ${others}.` : "") +
    (isInvestmentAgent(agent) ? INVEST_NOTE_PROMPT : "")
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
        max_tokens: isInvestmentAgent(agent) ? 2048 : 512,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
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

    // 投研 agent 可能在回复末尾追加 invest-note 块；剥离后持久化干净正文
    const cleanContent = stripInvestNoteBlocks(fullContent);

    const [agentMsg] = await db
      .insert(messagesTable)
      .values({
        roomId: params.data.roomId,
        senderType: "agent",
        senderId: agent.id,
        senderName: agent.name,
        senderColor: agent.color,
        content: cleanContent,
      })
      .returning();

    sendEvent({ type: "message", message: agentMsg });

    // 解析 invest-note 块并写入投研笔记，发出 note_saved 事件
    await saveInvestNotesFromContent(fullContent, agent, params.data.roomId, sendEvent, req.log);
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
        const stream = await client.chat.completions.create({ model, messages: chatMessages, stream: true, max_tokens: isInvestmentAgent(agent) ? 2048 : 512 });
        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) { fullContent += delta; sendEvent({ type: "stream_chunk", agentId: agent.id, content: delta }); }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Agent failed to respond";
        sendEvent({ type: "error", agentId: agent.id, message: msg });
        continue;
      }

      const cleanContent = stripInvestNoteBlocks(fullContent);

      const [agentMsg] = await db
        .insert(messagesTable)
        .values({ roomId: params.data.roomId, senderType: "agent", senderId: agent.id, senderName: agent.name, senderColor: agent.color, content: cleanContent })
        .returning();

      sendEvent({ type: "message", message: agentMsg });

      await saveInvestNotesFromContent(fullContent, agent, params.data.roomId, sendEvent, req.log);
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
