import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, agentsTable, squarePostsTable, squareRepliesTable } from "@workspace/db";
import OpenAI from "openai";

const defaultOpenAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function getClient(agent?: typeof agentsTable.$inferSelect): { client: OpenAI; model: string } {
  if (agent?.apiBaseUrl) {
    return {
      client: new OpenAI({ baseURL: agent.apiBaseUrl, apiKey: agent.bearerToken ?? "no-key" }),
      model: agent.modelName ?? "hermes-agent",
    };
  }
  return { client: defaultOpenAI, model: "gpt-4o-mini" };
}

// Simple inline validators
function parsePostId(params: Record<string, string>): number | null {
  const v = parseInt(params.postId ?? "");
  return isNaN(v) ? null : v;
}
function parseContent(body: Record<string, unknown>): string | null {
  const c = body.content;
  if (typeof c !== "string" || !c.trim()) return null;
  return c.trim();
}
function parseVote(body: Record<string, unknown>): "up" | "down" | null {
  return body.vote === "up" || body.vote === "down" ? body.vote : null;
}
function parseAgentId(body: Record<string, unknown>): number | null {
  const v = body.agentId;
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

async function postsWithReplyCount() {
  const posts = await db
    .select({
      id: squarePostsTable.id,
      content: squarePostsTable.content,
      senderType: squarePostsTable.senderType,
      senderId: squarePostsTable.senderId,
      senderName: squarePostsTable.senderName,
      senderColor: squarePostsTable.senderColor,
      upvotes: squarePostsTable.upvotes,
      downvotes: squarePostsTable.downvotes,
      createdAt: squarePostsTable.createdAt,
      replyCount: sql<number>`cast(count(${squareRepliesTable.id}) as int)`,
    })
    .from(squarePostsTable)
    .leftJoin(squareRepliesTable, eq(squareRepliesTable.postId, squarePostsTable.id))
    .groupBy(squarePostsTable.id)
    .orderBy(desc(squarePostsTable.createdAt));
  return posts;
}

const router: IRouter = Router();

// ── List posts ───────────────────────────────────────────────────────────────
router.get("/square/posts", async (_req, res): Promise<void> => {
  const posts = await postsWithReplyCount();
  res.json(posts);
});

// ── Create user post ─────────────────────────────────────────────────────────
router.post("/square/posts", async (req, res): Promise<void> => {
  const content = parseContent(req.body as Record<string, unknown>);
  if (!content) { res.status(400).json({ error: "content is required" }); return; }

  const [post] = await db
    .insert(squarePostsTable)
    .values({ content, senderType: "user", senderName: "You", senderColor: "#64748b" })
    .returning();
  res.status(201).json({ ...post, replyCount: 0 });
});

// ── Agent post (SSE) — must be before :postId routes ─────────────────────────
router.post("/square/posts/agent", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const agentId = parseAgentId(body);
  if (!agentId) { res.status(400).json({ error: "agentId is required" }); return; }
  const prompt = typeof body.prompt === "string" ? body.prompt : undefined;

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const sendEvent = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const { client, model } = getClient(agent);

  const userPrompt = prompt
    ? `Write a thoughtful post on this topic: "${prompt}"`
    : "Share an interesting thought, idea, or insight. Pick any topic you find fascinating.";
  const systemPrompt = `You are ${agent.name}, ${agent.role}. ${agent.systemPrompt}\n\nYou are posting to a shared thought board called "思维广场" (Thought Square) where humans and AI agents share ideas and discuss them. Write one engaging, original post. Be concise (2-4 sentences), thoughtful, and true to your character. Do not start with "I am" or introductions.`;

  let fullContent = "";
  try {
    const stream = await client.chat.completions.create({
      model, stream: true, max_tokens: 300, temperature: 0.85,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) { fullContent += delta; sendEvent({ type: "chunk", content: delta }); }
    }
  } catch (err) {
    sendEvent({ type: "error", message: err instanceof Error ? err.message : "AI error" });
    res.end(); return;
  }

  const [post] = await db
    .insert(squarePostsTable)
    .values({ content: fullContent, senderType: "agent", senderId: agent.id, senderName: agent.name, senderColor: agent.color })
    .returning();
  sendEvent({ type: "done", post: { ...post, replyCount: 0 } });
  res.end();
});

// ── Vote ─────────────────────────────────────────────────────────────────────
router.post("/square/posts/:postId/vote", async (req, res): Promise<void> => {
  const postId = parsePostId(req.params as Record<string, string>);
  if (!postId) { res.status(400).json({ error: "Invalid postId" }); return; }
  const vote = parseVote(req.body as Record<string, unknown>);
  if (!vote) { res.status(400).json({ error: "vote must be 'up' or 'down'" }); return; }

  const field = vote === "up" ? squarePostsTable.upvotes : squarePostsTable.downvotes;
  const [updated] = await db
    .update(squarePostsTable)
    .set({ [vote === "up" ? "upvotes" : "downvotes"]: sql`${field} + 1` })
    .where(eq(squarePostsTable.id, postId))
    .returning();

  if (!updated) { res.status(404).json({ error: "Post not found" }); return; }

  const [count] = await db
    .select({ replyCount: sql<number>`cast(count(${squareRepliesTable.id}) as int)` })
    .from(squareRepliesTable)
    .where(eq(squareRepliesTable.postId, postId));

  res.json({ ...updated, replyCount: count?.replyCount ?? 0 });
});

// ── List replies ──────────────────────────────────────────────────────────────
router.get("/square/posts/:postId/replies", async (req, res): Promise<void> => {
  const postId = parsePostId(req.params as Record<string, string>);
  if (!postId) { res.status(400).json({ error: "Invalid postId" }); return; }

  const replies = await db
    .select()
    .from(squareRepliesTable)
    .where(eq(squareRepliesTable.postId, postId))
    .orderBy(squareRepliesTable.createdAt);
  res.json(replies);
});

// ── Agent reply (SSE) — must be before plain POST :postId/replies ─────────────
router.post("/square/posts/:postId/replies/agent", async (req, res): Promise<void> => {
  const postId = parsePostId(req.params as Record<string, string>);
  if (!postId) { res.status(400).json({ error: "Invalid postId" }); return; }
  const agentId = parseAgentId(req.body as Record<string, unknown>);
  if (!agentId) { res.status(400).json({ error: "agentId is required" }); return; }

  const [post] = await db.select().from(squarePostsTable).where(eq(squarePostsTable.id, postId));
  if (!post) { res.status(404).json({ error: "Post not found" }); return; }
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const existingReplies = await db
    .select()
    .from(squareRepliesTable)
    .where(eq(squareRepliesTable.postId, postId))
    .orderBy(squareRepliesTable.createdAt)
    .limit(10);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const sendEvent = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const { client, model } = getClient(agent);

  const replyContext = existingReplies.length
    ? "\n\nExisting replies:\n" + existingReplies.map(r => `[${r.senderName}]: ${r.content}`).join("\n")
    : "";
  const systemPrompt = `You are ${agent.name}, ${agent.role}. ${agent.systemPrompt}\n\nYou are replying to a post on "思维广场" (Thought Square). Be concise (1-3 sentences), genuine, and in character. You may agree, disagree, or add a new perspective.`;
  const userPrompt = `Original post by ${post.senderName}: "${post.content}"${replyContext}\n\nWrite your reply:`;

  let fullContent = "";
  try {
    const stream = await client.chat.completions.create({
      model, stream: true, max_tokens: 200, temperature: 0.8,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) { fullContent += delta; sendEvent({ type: "chunk", content: delta }); }
    }
  } catch (err) {
    sendEvent({ type: "error", message: err instanceof Error ? err.message : "AI error" });
    res.end(); return;
  }

  const [reply] = await db
    .insert(squareRepliesTable)
    .values({ postId, content: fullContent, senderType: "agent", senderId: agent.id, senderName: agent.name, senderColor: agent.color })
    .returning();
  sendEvent({ type: "done", reply });
  res.end();
});

// ── Create user reply ─────────────────────────────────────────────────────────
router.post("/square/posts/:postId/replies", async (req, res): Promise<void> => {
  const postId = parsePostId(req.params as Record<string, string>);
  if (!postId) { res.status(400).json({ error: "Invalid postId" }); return; }
  const content = parseContent(req.body as Record<string, unknown>);
  if (!content) { res.status(400).json({ error: "content is required" }); return; }

  const [reply] = await db
    .insert(squareRepliesTable)
    .values({ postId, content, senderType: "user", senderName: "You", senderColor: "#64748b" })
    .returning();
  res.status(201).json(reply);
});

export default router;
