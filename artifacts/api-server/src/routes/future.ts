import { Router } from "express";
import { db, futureItemsTable } from "@workspace/db";
import { eq, and, or, ilike } from "drizzle-orm";

const router = Router();

// GET /api/future
router.get("/future", async (req, res) => {
  try {
    const { type, status, q } = req.query as Record<string, string>;
    let query = db.select().from(futureItemsTable).$dynamic();
    const conditions = [];
    if (type) conditions.push(eq(futureItemsTable.type, type as "todo" | "idea" | "plan"));
    if (status) conditions.push(eq(futureItemsTable.status, status as "active" | "done" | "archived"));
    if (q) conditions.push(or(ilike(futureItemsTable.title, `%${q}%`), ilike(futureItemsTable.body, `%${q}%`))!);
    if (conditions.length) query = query.where(and(...conditions));
    const items = await query.orderBy(futureItemsTable.createdAt);
    res.json(items);
  } catch (err) {
    req.log.error({ err }, "Failed to list future items");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/future
router.post("/future", async (req, res) => {
  try {
    const { type, title, body, status, links, tags, dueDate } = req.body;
    if (!type || !title) {
      res.status(400).json({ error: "type and title are required" });
      return;
    }
    const [item] = await db
      .insert(futureItemsTable)
      .values({
        type,
        title,
        body: body ?? "",
        status: status ?? "active",
        links: links ?? [],
        tags: tags ?? [],
        dueDate: dueDate ? new Date(dueDate) : null,
      })
      .returning();
    res.status(201).json(item);
  } catch (err) {
    req.log.error({ err }, "Failed to create future item");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/future/:id
router.patch("/future/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { title, body, status, links, tags, dueDate, type } = req.body;
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (title !== undefined) updateData.title = title;
    if (body !== undefined) updateData.body = body;
    if (status !== undefined) updateData.status = status;
    if (links !== undefined) updateData.links = links;
    if (tags !== undefined) updateData.tags = tags;
    if (type !== undefined) updateData.type = type;
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null;

    const [item] = await db
      .update(futureItemsTable)
      .set(updateData)
      .where(eq(futureItemsTable.id, id))
      .returning();
    if (!item) { res.status(404).json({ error: "Not found" }); return; }
    res.json(item);
  } catch (err) {
    req.log.error({ err }, "Failed to update future item");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/future/:id
router.delete("/future/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [item] = await db
      .delete(futureItemsTable)
      .where(eq(futureItemsTable.id, id))
      .returning();
    if (!item) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete future item");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
