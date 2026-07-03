import { Router } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { db, pagesTable, auditLogsTable } from "@workspace/db";
import { eq, ilike, or, sql, and, gte } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  loadImageFromUrl,
  decodeBase64Image,
  uploadImageBuffer,
} from "../lib/imageUpload";

const router = Router();
const objectStorageService = new ObjectStorageService();

type PageRow = typeof pagesTable.$inferSelect;
interface TreeNode extends PageRow { children: TreeNode[] }

function buildTree(rows: PageRow[]): TreeNode[] {
  const map = new Map<number, TreeNode>();
  for (const r of rows) map.set(r.id, { ...r, children: [] });
  const roots: TreeNode[] = [];
  for (const node of map.values()) {
    if (node.parentId == null) roots.push(node);
    else {
      const parent = map.get(node.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
  }
  const sort = (ns: TreeNode[]) => {
    ns.sort((a, b) => a.title.localeCompare(b.title));
    for (const n of ns) sort(n.children);
  };
  sort(roots);
  return roots;
}

function renderTree(nodes: TreeNode[], indent = ""): string {
  return nodes.map((n) => {
    const line = `${indent}[${n.id}] ${n.title} (${n.category})`;
    return n.children.length ? line + "\n" + renderTree(n.children, indent + "  ") : line;
  }).join("\n");
}

async function writeAudit(actor: string, action: string, pageId: number | null, pageTitle: string | null) {
  await db.insert(auditLogsTable).values({ actor, action, pageId: pageId ?? undefined, pageTitle: pageTitle ?? undefined });
}

function makeMcpServer(actor: string): McpServer {
  const server = new McpServer({ name: "hermes-wiki", version: "1.0.0" });

  server.tool("wiki_list_pages", "List wiki pages, optionally filtered.", {
    category: z.enum(["communication", "skill", "document"]).optional(),
    search: z.string().optional(),
    author: z.string().optional(),
    tag: z.string().optional(),
  }, async ({ category, search, author, tag }) => {
    const conds = [];
    if (category) conds.push(eq(pagesTable.category, category));
    if (author) conds.push(ilike(pagesTable.author, `%${author}%`));
    if (search) conds.push(or(ilike(pagesTable.title, `%${search}%`), ilike(pagesTable.content, `%${search}%`))!);
    if (tag) conds.push(sql`${tag} = ANY(${pagesTable.tags})`);
    const pages = await db.select().from(pagesTable).where(conds.length ? and(...conds) : undefined).orderBy(sql`${pagesTable.updatedAt} DESC`);
    return { content: [{ type: "text" as const, text: JSON.stringify(pages, null, 2) }] };
  });

  server.tool("wiki_get_page", "Get the full content of a page by ID.", {
    id: z.number().int().positive(),
  }, async ({ id }) => {
    const [page] = await db.select().from(pagesTable).where(eq(pagesTable.id, id));
    if (!page) throw new Error(`Page ${id} not found`);
    return { content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }] };
  });

  server.tool("wiki_get_tree", "Get all pages as a nested tree (run this before creating pages).", {}, async () => {
    const rows = await db.select().from(pagesTable).orderBy(pagesTable.title);
    return { content: [{ type: "text" as const, text: renderTree(buildTree(rows)) }] };
  });

  server.tool("wiki_create_page", "Create a new wiki page.", {
    title: z.string().min(1),
    content: z.string(),
    category: z.enum(["communication", "skill", "document"]),
    author: z.string().min(1).describe("Your agent name, e.g. '擎天柱'"),
    tags: z.array(z.string()).optional(),
    parentId: z.number().int().positive().optional(),
  }, async ({ title, content, category, author, tags, parentId }) => {
    const [page] = await db.insert(pagesTable).values({
      title, content, category, author, tags: tags ?? [], parentId: parentId ?? null,
    }).returning();
    await writeAudit(actor, "CREATE", page.id, page.title);
    return { content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }] };
  });

  server.tool("wiki_update_page", "Update any fields of an existing page.", {
    id: z.number().int().positive(),
    title: z.string().min(1).optional(),
    content: z.string().optional(),
    category: z.enum(["communication", "skill", "document"]).optional(),
    author: z.string().optional(),
    tags: z.array(z.string()).optional(),
    parentId: z.number().int().positive().nullable().optional(),
  }, async ({ id, ...fields }) => {
    const upd: Record<string, unknown> = { updatedAt: new Date() };
    if (fields.title !== undefined) upd.title = fields.title;
    if (fields.content !== undefined) upd.content = fields.content;
    if (fields.category !== undefined) upd.category = fields.category;
    if (fields.author !== undefined) upd.author = fields.author;
    if (fields.tags !== undefined) upd.tags = fields.tags;
    if ("parentId" in fields) upd.parentId = fields.parentId ?? null;
    const [page] = await db.update(pagesTable).set(upd).where(eq(pagesTable.id, id)).returning();
    if (!page) throw new Error(`Page ${id} not found`);
    await writeAudit(actor, "UPDATE", page.id, page.title);
    return { content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }] };
  });

  server.tool("wiki_delete_page", "Delete a page by ID (children are promoted to root).", {
    id: z.number().int().positive(),
  }, async ({ id }) => {
    const [existing] = await db.select().from(pagesTable).where(eq(pagesTable.id, id));
    if (!existing) throw new Error(`Page ${id} not found`);
    await db.update(pagesTable).set({ parentId: null }).where(eq(pagesTable.parentId, id));
    await db.delete(pagesTable).where(eq(pagesTable.id, id));
    await writeAudit(actor, "DELETE", id, existing.title);
    return { content: [{ type: "text" as const, text: `Page ${id} ("${existing.title}") deleted.` }] };
  });

  server.tool("wiki_weekly_digest", "Get all pages changed in the past 7 days.", {}, async () => {
    const since = new Date(); since.setDate(since.getDate() - 7);
    const pages = await db.select().from(pagesTable).where(gte(pagesTable.updatedAt, since)).orderBy(sql`${pagesTable.updatedAt} DESC`);
    return { content: [{ type: "text" as const, text: JSON.stringify(pages, null, 2) }] };
  });

  server.tool("wiki_recent", "Get the N most recently updated pages.", {
    limit: z.number().int().min(1).max(50).optional().default(10),
  }, async ({ limit }) => {
    const pages = await db.select().from(pagesTable).orderBy(sql`${pagesTable.updatedAt} DESC`).limit(limit);
    return { content: [{ type: "text" as const, text: JSON.stringify(pages, null, 2) }] };
  });

  server.tool(
    "wiki_upload_image",
    "Upload an image (PNG/JPEG/GIF/WebP/SVG, max 10MB) to wiki storage and get a Markdown snippet to embed in a page. Provide EITHER 'url' (server fetches it) OR 'data' (base64). Then put the returned markdown into a page's content via wiki_create_page or wiki_update_page so it displays.",
    {
      url: z.string().url().optional().describe("Public http(s) URL of the image to fetch and upload."),
      data: z.string().optional().describe("Base64-encoded image bytes; a data: URL (data:image/png;base64,...) is also accepted."),
      contentType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]).optional().describe("MIME type. Required for base64 unless a data: URL prefix is included; for url it is inferred from the response when omitted."),
      alt: z.string().optional().describe("Alt text for the Markdown image."),
    },
    async ({ url, data, contentType, alt }) => {
      if ((!url && !data) || (url && data)) {
        throw new Error("Provide exactly one of 'url' or 'data'.");
      }
      const loaded = url
        ? await loadImageFromUrl(url, contentType)
        : decodeBase64Image(data!, contentType);
      const { servePath, objectPath } = await uploadImageBuffer(
        objectStorageService,
        loaded.buffer,
        loaded.contentType,
      );
      const markdown = `![${alt ?? ""}](${servePath})`;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ servePath, objectPath, markdown }, null, 2),
          },
        ],
      };
    },
  );

  server.tool("wiki_summary", "Get overall wiki statistics.", {}, async () => {
    const [totals] = await db.select({
      total: sql<number>`count(*)::int`,
      communication: sql<number>`count(*) filter (where category = 'communication')::int`,
      skill: sql<number>`count(*) filter (where category = 'skill')::int`,
      document: sql<number>`count(*) filter (where category = 'document')::int`,
    }).from(pagesTable);
    return { content: [{ type: "text" as const, text: JSON.stringify(totals, null, 2) }] };
  });

  return server;
}

// POST /mcp — handle tool calls (stateless, one McpServer per request)
// GET  /mcp — SSE stream for server-initiated messages
router.all("/mcp", async (req, res) => {
  const actor = req.actor ?? "Unknown";
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = makeMcpServer(actor);

  // Clean up when request ends
  res.on("close", async () => {
    await transport.close();
    await server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

export default router;
