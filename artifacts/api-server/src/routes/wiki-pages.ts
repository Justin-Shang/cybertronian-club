import { Router } from "express";
import { db, pagesTable, auditLogsTable, knowledgeGraphsTable } from "@workspace/db";
import { eq, ilike, or, sql, and, gte, isNull } from "drizzle-orm";
import {
  ListPagesQueryParams,
  CreatePageBody,
  GetPageParams,
  UpdatePageParams,
  UpdatePageBody,
  DeletePageParams,
  GetRecentActivityQueryParams,
} from "@workspace/api-zod";
import { ingestContent } from "../lib/graph-ingest";
import crypto from "node:crypto";

const router = Router();

type PageRow = typeof pagesTable.$inferSelect;
interface PageTreeNode extends PageRow {
  children: PageTreeNode[];
}

function buildTree(rows: PageRow[]): PageTreeNode[] {
  const map = new Map<number, PageTreeNode>();
  for (const row of rows) map.set(row.id, { ...row, children: [] });
  const roots: PageTreeNode[] = [];
  for (const node of map.values()) {
    if (node.parentId == null) {
      roots.push(node);
    } else {
      const parent = map.get(node.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
  }
  const sortByTitle = (a: PageTreeNode, b: PageTreeNode) => a.title.localeCompare(b.title);
  const sort = (nodes: PageTreeNode[]) => {
    nodes.sort(sortByTitle);
    for (const n of nodes) sort(n.children);
  };
  sort(roots);
  return roots;
}

async function writeAudit(
  actor: string,
  action: string,
  pageId: number | null,
  pageTitle: string | null,
  details?: string
) {
  await db.insert(auditLogsTable).values({
    actor,
    action,
    pageId: pageId ?? undefined,
    pageTitle: pageTitle ?? undefined,
    details,
  });
}

// P0-3: async hook — when a wiki page is created, auto-ingest into graphs
// whose owner_agent (comma-separated) contains the page author. Fire-and-forget.
async function triggerGraphIngest(page: PageRow, log?: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void }) {
  try {
    const graphs = await db.select().from(knowledgeGraphsTable);
    const author = (page.author ?? "").trim();
    if (!author) return;
    const matched = graphs.filter((g) => {
      const owners = (g.ownerAgent ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      return owners.some((o) => o === author);
    });
    if (matched.length === 0) return;
    const contentHash = crypto.createHash("sha256").update(page.content || "").digest("hex");
    const generatedAt = (page.createdAt instanceof Date ? page.createdAt : new Date(page.createdAt))
      .toISOString()
      .slice(0, 10);
    for (const g of matched) {
      // Fire ingest; errors are caught inside ingestContent and logged, never thrown.
      ingestContent(
        g.id,
        { content: page.content || "", contentHash, source: author, pageId: page.id, generatedAt },
        log as never,
      ).catch((e) => log?.error?.({ err: e, graphId: g.id }, "ingest hook failed"));
    }
    log?.info({ author, graphIds: matched.map((g) => g.id), pageId: page.id }, "graph ingest hook triggered");
  } catch (err) {
    log?.error({ err, pageId: page.id }, "triggerGraphIngest failed");
  }
}

// GET /pages
router.get("/pages", async (req, res) => {
  try {
    const query = ListPagesQueryParams.parse(req.query);
    const conditions = [];

    if (query.category) {
      conditions.push(eq(pagesTable.category, query.category as "communication" | "skill" | "document"));
    }
    if (query.author) {
      conditions.push(ilike(pagesTable.author, `%${query.author}%`));
    }
    if (query.search) {
      conditions.push(
        or(
          ilike(pagesTable.title, `%${query.search}%`),
          ilike(pagesTable.content, `%${query.search}%`)
        )
      );
    }
    if (query.tag) {
      conditions.push(sql`${query.tag} = ANY(${pagesTable.tags})`);
    }
    if (query.parentId !== undefined) {
      if (query.parentId === null) {
        conditions.push(isNull(pagesTable.parentId));
      } else {
        conditions.push(eq(pagesTable.parentId, query.parentId));
      }
    }

    const pages = await db
      .select()
      .from(pagesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(sql`${pagesTable.updatedAt} DESC`);

    res.json(pages);
  } catch (err) {
    req.log.error({ err }, "Failed to list pages");
    res.status(400).json({ error: "Invalid query parameters" });
  }
});

// GET /pages/tree  — must be registered before /pages/:id
router.get("/pages/tree", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(pagesTable)
      .orderBy(pagesTable.title);
    res.json(buildTree(rows));
  } catch (err) {
    req.log.error({ err }, "Failed to get pages tree");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /pages
router.post("/pages", async (req, res) => {
  try {
    const body = CreatePageBody.parse(req.body);
    const [page] = await db
      .insert(pagesTable)
      .values({
        parentId: body.parentId ?? null,
        title: body.title,
        content: body.content,
        category: body.category as "communication" | "skill" | "document",
        author: body.author,
        tags: body.tags ?? [],
      })
      .returning();
    await writeAudit(req.actor ?? "Unknown", "CREATE", page.id, page.title);
    // P0-3: fire-and-forget graph ingest hook (async, does not block response)
    setImmediate(() => {
      triggerGraphIngest(page, req.log).catch(() => { /* swallow; logged inside */ });
    });
    res.status(201).json(page);
  } catch (err) {
    req.log.error({ err }, "Failed to create page");
    res.status(400).json({ error: "Invalid request body" });
  }
});

// GET /pages/:id
router.get("/pages/:id", async (req, res) => {
  try {
    const { id } = GetPageParams.parse(req.params);
    const [page] = await db.select().from(pagesTable).where(eq(pagesTable.id, id));
    if (!page) { res.status(404).json({ error: "Page not found" }); return; }
    res.json(page);
  } catch (err) {
    req.log.error({ err }, "Failed to get page");
    res.status(400).json({ error: "Invalid request" });
  }
});

// PATCH /pages/:id
router.patch("/pages/:id", async (req, res) => {
  try {
    const { id } = UpdatePageParams.parse(req.params);
    const body = UpdatePageBody.parse(req.body);

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) updateData.title = body.title;
    if (body.content !== undefined) updateData.content = body.content;
    if (body.category !== undefined) updateData.category = body.category;
    if (body.author !== undefined) updateData.author = body.author;
    if (body.tags !== undefined) updateData.tags = body.tags;
    if ("parentId" in body) updateData.parentId = body.parentId ?? null;

    const [page] = await db
      .update(pagesTable)
      .set(updateData)
      .where(eq(pagesTable.id, id))
      .returning();

    if (!page) { res.status(404).json({ error: "Page not found" }); return; }
    await writeAudit(req.actor ?? "Unknown", "UPDATE", page.id, page.title);
    // P0-3: also trigger ingest hook on content update (idempotent by contentHash)
    if (body.content !== undefined) {
      setImmediate(() => {
        triggerGraphIngest(page, req.log).catch(() => { /* swallow; logged inside */ });
      });
    }
    res.json(page);
  } catch (err) {
    req.log.error({ err }, "Failed to update page");
    res.status(400).json({ error: "Invalid request" });
  }
});

// DELETE /pages/:id
router.delete("/pages/:id", async (req, res) => {
  try {
    const { id } = DeletePageParams.parse(req.params);
    const [existing] = await db.select().from(pagesTable).where(eq(pagesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Page not found" }); return; }
    await db
      .update(pagesTable)
      .set({ parentId: null })
      .where(eq(pagesTable.parentId, id));
    await db.delete(pagesTable).where(eq(pagesTable.id, id));
    await writeAudit(req.actor ?? "Unknown", "DELETE", id, existing.title);
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete page");
    res.status(400).json({ error: "Invalid request" });
  }
});

// GET /activity/recent
router.get("/activity/recent", async (req, res) => {
  try {
    const query = GetRecentActivityQueryParams.parse(req.query);
    const limit = query.limit ?? 10;
    const pages = await db
      .select()
      .from(pagesTable)
      .orderBy(sql`${pagesTable.updatedAt} DESC`)
      .limit(limit);
    res.json(pages);
  } catch (err) {
    req.log.error({ err }, "Failed to get recent activity");
    res.status(400).json({ error: "Invalid request" });
  }
});

// GET /activity/summary
router.get("/activity/summary", async (req, res) => {
  try {
    const [totals] = await db
      .select({
        total: sql<number>`count(*)::int`,
        communication: sql<number>`count(*) filter (where category = 'communication')::int`,
        skill: sql<number>`count(*) filter (where category = 'skill')::int`,
        document: sql<number>`count(*) filter (where category = 'document')::int`,
        totalTags: sql<number>`count(distinct tag)::int`,
      })
      .from(pagesTable)
      .leftJoin(sql`unnest(tags) as tag`, sql`true`);

    const recentAuthorsRows = await db
      .select({
        author: pagesTable.author,
        lastUpdated: sql<Date>`max(${pagesTable.updatedAt})`,
      })
      .from(pagesTable)
      .groupBy(pagesTable.author)
      .orderBy(sql`max(${pagesTable.updatedAt}) DESC`)
      .limit(5);

    res.json({
      totalPages: totals?.total ?? 0,
      byCategory: {
        communication: totals?.communication ?? 0,
        skill: totals?.skill ?? 0,
        document: totals?.document ?? 0,
      },
      recentAuthors: recentAuthorsRows.map((r) => r.author),
      totalTags: totals?.totalTags ?? 0,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get wiki summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /activity/weekly
router.get("/activity/weekly", async (req, res) => {
  try {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const pages = await db
      .select()
      .from(pagesTable)
      .where(gte(pagesTable.updatedAt, weekAgo))
      .orderBy(sql`${pagesTable.updatedAt} DESC`);
    res.json(pages);
  } catch (err) {
    req.log.error({ err }, "Failed to get weekly digest");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
