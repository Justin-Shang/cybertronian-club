import { Router } from "express";
import { db, kanbanColumnsTable, kanbanCardsTable } from "@workspace/db";
import { eq, asc, and, gte, lte, isNotNull } from "drizzle-orm";

const router = Router();

// GET /kanban/board — full board state with virtual Waiting column
router.get("/kanban/board", async (_req, res) => {
  try {
    const columns = await db
      .select()
      .from(kanbanColumnsTable)
      .orderBy(asc(kanbanColumnsTable.position));

    const cards = await db
      .select()
      .from(kanbanCardsTable)
      .orderBy(asc(kanbanCardsTable.position));

    // Virtual Waiting column: cards with dueDate within next 3 days
    const now = new Date();
    const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const waitingColumn = {
      id: -1,
      title: "Waiting",
      agentId: null as number | null,
      position: -1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      _virtual: true,
    };

    const waitingCards = cards.filter((c) => {
      if (!c.dueDate) return false;
      const due = new Date(c.dueDate);
      return due >= now && due <= threeDaysLater;
    });

    res.json({
      columns: [waitingColumn, ...columns],
      cards,
      waitingCardIds: waitingCards.map((c) => c.id),
    });
  } catch (err) {
    _req.log.error({ err }, "Failed to get kanban board");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /kanban/columns
router.post("/kanban/columns", async (req, res) => {
  try {
    const { title, agentId } = req.body;
    if (!title) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    const maxPos = await db
      .select({ max: kanbanColumnsTable.position })
      .from(kanbanColumnsTable)
      .orderBy(kanbanColumnsTable.position)
      .limit(1);

    const position = (maxPos[0]?.max ?? -1) + 1;

    const [col] = await db
      .insert(kanbanColumnsTable)
      .values({ title, agentId: agentId ?? null, position })
      .returning();

    res.status(201).json(col);
  } catch (err) {
    req.log.error({ err }, "Failed to create column");
    res.status(400).json({ error: "Invalid request" });
  }
});

// PATCH /kanban/columns/:id
router.patch("/kanban/columns/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { title, position } = req.body;

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (title !== undefined) updateData.title = title;
    if (position !== undefined) updateData.position = position;

    const [col] = await db
      .update(kanbanColumnsTable)
      .set(updateData)
      .where(eq(kanbanColumnsTable.id, id))
      .returning();

    if (!col) {
      res.status(404).json({ error: "Column not found" });
      return;
    }
    res.json(col);
  } catch (err) {
    req.log.error({ err }, "Failed to update column");
    res.status(400).json({ error: "Invalid request" });
  }
});

// DELETE /kanban/columns/:id
router.delete("/kanban/columns/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [col] = await db
      .delete(kanbanColumnsTable)
      .where(eq(kanbanColumnsTable.id, id))
      .returning();

    if (!col) {
      res.status(404).json({ error: "Column not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete column");
    res.status(400).json({ error: "Invalid request" });
  }
});

// POST /kanban/cards
router.post("/kanban/cards", async (req, res) => {
  try {
    const { title, description, columnId, agentId, dueDate } = req.body;
    if (!title || columnId == null) {
      res.status(400).json({ error: "title and columnId are required" });
      return;
    }

    const maxPos = await db
      .select({ max: kanbanCardsTable.position })
      .from(kanbanCardsTable)
      .where(eq(kanbanCardsTable.columnId, columnId))
      .orderBy(kanbanCardsTable.position)
      .limit(1);

    const position = (maxPos[0]?.max ?? -1) + 1;

    const [card] = await db
      .insert(kanbanCardsTable)
      .values({
        title,
        description: description ?? "",
        columnId,
        agentId: agentId ?? null,
        position,
        dueDate: dueDate ? new Date(dueDate) : null,
      })
      .returning();

    res.status(201).json(card);
  } catch (err) {
    req.log.error({ err }, "Failed to create card");
    res.status(400).json({ error: "Invalid request" });
  }
});

// PATCH /kanban/cards/:id
router.patch("/kanban/cards/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { title, description, columnId, agentId, position, dueDate } = req.body;

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (columnId !== undefined) updateData.columnId = columnId;
    if (agentId !== undefined) updateData.agentId = agentId;
    if (position !== undefined) updateData.position = position;
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null;

    const [card] = await db
      .update(kanbanCardsTable)
      .set(updateData)
      .where(eq(kanbanCardsTable.id, id))
      .returning();

    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    res.json(card);
  } catch (err) {
    req.log.error({ err }, "Failed to update card");
    res.status(400).json({ error: "Invalid request" });
  }
});

// DELETE /kanban/cards/:id
router.delete("/kanban/cards/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [card] = await db
      .delete(kanbanCardsTable)
      .where(eq(kanbanCardsTable.id, id))
      .returning();

    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete card");
    res.status(400).json({ error: "Invalid request" });
  }
});

export default router;
