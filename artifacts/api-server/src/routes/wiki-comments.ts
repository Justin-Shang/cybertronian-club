import { Router } from "express";
import { db } from "@workspace/db";
import { wikiCommentsTable, pagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const AGENT_CONFIG: Record<string, { port: number; key: string; name: string }> = {
  arcee:       { port: 8645, key: process.env.HERMES_ARCEE_KEY || "",       name: "阿尔茜" },
  optimus:     { port: 8643, key: process.env.HERMES_OPTIMUS_KEY || "",     name: "擎天柱" },
  tongtianxiao:{ port: 8642, key: process.env.HERMES_TONGTIANXIAO_KEY || "",name: "通天晓" },
  hotrod:      { port: 8644, key: process.env.HERMES_HOTROD_KEY || "",      name: "补天士" },
  bumblebee:   { port: 8646, key: process.env.HERMES_BUMBLEBEE_KEY || "",   name: "大黄蜂" },
};

// POST /pages/:id/comments — create comment + async dispatch to Hermes agent
router.post("/pages/:id/comments", async (req, res) => {
  try {
    const pageId = parseInt(req.params.id, 10);
    if (isNaN(pageId) || pageId <= 0) return res.status(400).json({ error: "Invalid page ID" });

    const { selectedText, comment, mentionedAgent } = req.body ?? {};
    if (!selectedText || !comment || !mentionedAgent)
      return res.status(400).json({ error: "Missing required fields: selectedText, comment, mentionedAgent" });

    const agent = AGENT_CONFIG[mentionedAgent];
    if (!agent) return res.status(400).json({ error: `Unknown agent: ${mentionedAgent}` });

    const [page] = await db.select().from(pagesTable).where(eq(pagesTable.id, pageId)).limit(1);
    if (!page) return res.status(404).json({ error: "Page not found" });

    const [newComment] = await db.insert(wikiCommentsTable).values({
      pageId, selectedText, comment, mentionedAgent, status: "pending",
    }).returning();

    // Async: call agent → replace selected text → update page
    setImmediate(async () => {
      const log = req.log;
      try {
        await db.update(wikiCommentsTable).set({ status: "processing" })
          .where(eq(wikiCommentsTable.id, newComment.id));

        const systemPrompt =
          "你是 wiki 页面编辑助手。用户会给你一段选中的文本和一条评论。" +
          "请根据评论要求修改选中文本，只返回修改后的文本。" +
          "不要任何解释、前后缀、引号或 markdown 代码块标记。";

        const userMessage =
          `页面标题：${page.title}\n\n` +
          `选中的文本：\n"""\n${selectedText}\n"""\n\n` +
          `用户评论：${comment}\n\n` +
          `请根据评论要求修改选中的文本，只返回修改后的文本。`;

        const resp = await fetch(`http://127.0.0.1:${agent.port}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${agent.key}` },
          body: JSON.stringify({
            model: "auto",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage },
            ],
            temperature: 0.3,
          }),
        });

        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`Agent API ${resp.status}: ${errText.slice(0, 200)}`);
        }

        const data = await resp.json();
        let modifiedText: string = data.choices?.[0]?.message?.content?.trim() || "";
        // strip markdown code fences
        modifiedText = modifiedText.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();
        if (!modifiedText) throw new Error("Agent returned empty response");

        // Replace first occurrence of selected text
        const newContent = page.content.replace(selectedText, modifiedText);
        if (newContent === page.content)
          throw new Error("Selected text not found in page content (may have been modified)");

        await db.update(pagesTable).set({ content: newContent, updatedAt: new Date() })
          .where(eq(pagesTable.id, pageId));

        await db.update(wikiCommentsTable).set({
          status: "done", result: modifiedText, resolvedAt: new Date(),
        }).where(eq(wikiCommentsTable.id, newComment.id));

        log?.info({ commentId: newComment.id, agent: mentionedAgent }, "wiki comment resolved by agent");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log?.error({ err, commentId: newComment.id }, "wiki comment agent processing failed");
        await db.update(wikiCommentsTable).set({ status: "error", errorMessage: msg })
          .where(eq(wikiCommentsTable.id, newComment.id));
      }
    });

    res.status(201).json(newComment);
  } catch (err) {
    req.log.error({ err }, "Failed to create wiki comment");
    res.status(500).json({ error: "Failed to create comment" });
  }
});

// GET /pages/:id/comments — list comments for a page
router.get("/pages/:id/comments", async (req, res) => {
  try {
    const pageId = parseInt(req.params.id, 10);
    if (isNaN(pageId) || pageId <= 0) return res.status(400).json({ error: "Invalid page ID" });

    const comments = await db.select().from(wikiCommentsTable)
      .where(eq(wikiCommentsTable.pageId, pageId));

    res.json(comments);
  } catch (err) {
    req.log.error({ err }, "Failed to get wiki comments");
    res.status(500).json({ error: "Failed to get comments" });
  }
});

export default router;
