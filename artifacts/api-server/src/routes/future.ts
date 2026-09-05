import { Router } from "express";
import { db, futureItemsTable } from "@workspace/db";
import { eq, and, or, ilike, inArray } from "drizzle-orm";

const router = Router();

const VALID_TYPES = ["idea", "plan", "todo"] as const;
const VALID_STATUSES = ["not_started", "preparing", "in_progress", "done"] as const;
type ItemType = (typeof VALID_TYPES)[number];
const monthRe = /^\d{4}-\d{2}$/;
/** Format check (YYYY-MM) plus semantic check (month 01-12). */
function isValidMonth(m: string): boolean {
  if (!monthRe.test(m)) return false;
  const mm = Number(m.slice(5));
  return mm >= 1 && mm <= 12;
}

/**
 * Validate the parent-child type hierarchy.
 * - idea: parentId must be null
 * - plan: parentId must reference an existing idea
 * - todo: parentId must reference an existing plan
 * Returns null if valid, otherwise an error message string.
 */
async function validateHierarchy(
  type: ItemType,
  parentId: number | null,
  selfId?: number,
): Promise<string | null> {
  // idea must be top-level
  if (type === "idea") {
    if (parentId !== null && parentId !== undefined)
      return "idea cannot have a parentId (must be top-level)";
    return null;
  }
  // plan & todo require a parent
  if (parentId === null || parentId === undefined)
    return `${type} requires a parentId`;
  if (selfId !== undefined && parentId === selfId)
    return "parentId cannot equal id (self-reference)";
  // parent must exist
  const [parent] = await db
    .select({ id: futureItemsTable.id, type: futureItemsTable.type })
    .from(futureItemsTable)
    .where(eq(futureItemsTable.id, parentId));
  if (!parent) return `parent id=${parentId} does not exist`;
  // plan -> idea, todo -> plan
  const expectedParent: ItemType = type === "plan" ? "idea" : "plan";
  if (parent.type !== expectedParent)
    return `${type} must be under a ${expectedParent} (parent is ${parent.type})`;
  return null;
}

/**
 * Detect whether setting parentId on selfId would create a cycle
 * (i.e. selfId is an ancestor of the new parentId).
 */
async function detectCycle(selfId: number, newParentId: number): Promise<boolean> {
  let cur: number | null = newParentId;
  const seen = new Set<number>();
  while (cur !== null) {
    if (cur === selfId) return true;
    if (seen.has(cur)) return true; // existing cycle guard
    seen.add(cur);
    const [row] = await db
      .select({ parentId: futureItemsTable.parentId })
      .from(futureItemsTable)
      .where(eq(futureItemsTable.id, cur));
    if (!row) return false;
    cur = row.parentId;
  }
  return false;
}

router.get("/future", async (req, res) => {
  try {
    const { type, status, q } = req.query as Record<string, string>;
    let query = db.select().from(futureItemsTable).$dynamic();
    const conditions = [];
    if (type) {
      if (!VALID_TYPES.includes(type as ItemType)) {
        res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(",")}` });
        return;
      }
      conditions.push(eq(futureItemsTable.type, type as ItemType));
    }
    if (status) {
      if (!VALID_STATUSES.includes(status as any)) {
        res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(",")}` });
        return;
      }
      conditions.push(eq(futureItemsTable.status, status as any));
    }
    if (q) {
      // escape LIKE wildcards so user input is treated literally
      const esc = q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
      conditions.push(or(ilike(futureItemsTable.title, `%${esc}%`), ilike(futureItemsTable.body, `%${esc}%`))!);
    }
    if (conditions.length) query = query.where(and(...conditions));
    const items = await query.orderBy(futureItemsTable.createdAt);
    res.json(items);
  } catch (err) {
    req.log.error({ err }, "Failed to list future items");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/future/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "id must be a number" }); return; }
    const [item] = await db.select().from(futureItemsTable).where(eq(futureItemsTable.id, id));
    if (!item) { res.status(404).json({ error: "Not found" }); return; }
    res.json(item);
  } catch (err) {
    req.log.error({ err }, "Failed to get future item");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/future", async (req, res) => {
  try {
    const { type, title, body, status, links, tags, dueDate, parentId, startMonth, endMonth, backlog } = req.body;
    if (!type || !title) { res.status(400).json({ error: "type and title are required" }); return; }
    if (!VALID_TYPES.includes(type)) { res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(",")}` }); return; }
    if (title !== undefined && typeof title !== "string") { res.status(400).json({ error: "title must be a string" }); return; }
    if (!String(title).trim()) { res.status(400).json({ error: "title cannot be empty" }); return; }
    if (status !== undefined && status !== null && !VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(",")}` }); return;
    }
    if (links !== undefined && links !== null && !Array.isArray(links)) { res.status(400).json({ error: "links must be an array" }); return; }
    if (tags !== undefined && tags !== null && !Array.isArray(tags)) { res.status(400).json({ error: "tags must be an array" }); return; }
    if (parentId !== undefined && parentId !== null && (typeof parentId !== "number" || !Number.isFinite(parentId))) {
      res.status(400).json({ error: "parentId must be a number or null" }); return;
    }
    if (startMonth && !isValidMonth(startMonth)) { res.status(400).json({ error: "startMonth must be a valid YYYY-MM (01-12)" }); return; }
    if (endMonth && !isValidMonth(endMonth)) { res.status(400).json({ error: "endMonth must be a valid YYYY-MM (01-12)" }); return; }
    if (startMonth && endMonth && startMonth > endMonth) { res.status(400).json({ error: "startMonth cannot be after endMonth" }); return; }
    // hierarchy validation
    const parentIdNorm = parentId === undefined ? null : parentId;
    const hierarchyErr = await validateHierarchy(type as ItemType, parentIdNorm);
    if (hierarchyErr) { res.status(400).json({ error: hierarchyErr }); return; }
    const [item] = await db.insert(futureItemsTable).values({
      type, title: String(title).trim(),
      body: body ?? "",
      status: status ?? "not_started",
      links: links ?? [],
      tags: tags ?? [],
      dueDate: dueDate ? new Date(dueDate) : null,
      parentId: parentIdNorm,
      startMonth: startMonth ?? null,
      endMonth: endMonth ?? null,
      backlog: backlog ?? false,
    }).returning();
    res.status(201).json(item);
  } catch (err) {
    req.log.error({ err }, "Failed to create future item");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/future/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "id must be a number" }); return; }
    const { title, body, status, links, tags, dueDate, type, parentId, startMonth, endMonth, backlog } = req.body;
    // self-reference guard (applies whenever parentId is set)
    if (parentId !== undefined && parentId !== null && parentId === id) {
      res.status(400).json({ error: "parentId cannot equal id (self-reference)" }); return;
    }
    if (type !== undefined && type !== null && !VALID_TYPES.includes(type)) {
      res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(",")}` }); return;
    }
    if (status !== undefined && status !== null && !VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(",")}` }); return;
    }
    if (title !== undefined && title !== null && (typeof title !== "string" || !title.trim())) {
      res.status(400).json({ error: "title cannot be empty" }); return;
    }
    if (links !== undefined && links !== null && !Array.isArray(links)) { res.status(400).json({ error: "links must be an array" }); return; }
    if (tags !== undefined && tags !== null && !Array.isArray(tags)) { res.status(400).json({ error: "tags must be an array" }); return; }
    if (parentId !== undefined && parentId !== null && (typeof parentId !== "number" || !Number.isFinite(parentId))) {
      res.status(400).json({ error: "parentId must be a number or null" }); return;
    }
    if (startMonth && !isValidMonth(startMonth)) { res.status(400).json({ error: "startMonth must be a valid YYYY-MM (01-12)" }); return; }
    if (endMonth && !isValidMonth(endMonth)) { res.status(400).json({ error: "endMonth must be a valid YYYY-MM (01-12)" }); return; }

    // load current item to compute effective type/parentId/months after patch
    const [current] = await db.select().from(futureItemsTable).where(eq(futureItemsTable.id, id));
    if (!current) { res.status(404).json({ error: "Not found" }); return; }
    const effectiveType: ItemType = (type ?? current.type) as ItemType;
    const effectiveParentId: number | null = parentId === undefined ? current.parentId : parentId;
    // effective months: use incoming value if provided (incl. null to clear), else stored value
    const effStart = startMonth !== undefined ? startMonth : current.startMonth;
    const effEnd = endMonth !== undefined ? endMonth : current.endMonth;
    if (effStart && effEnd && effStart > effEnd) {
      res.status(400).json({ error: "startMonth cannot be after endMonth" }); return;
    }

    // hierarchy validation for the resulting state
    const hierarchyErr = await validateHierarchy(effectiveType, effectiveParentId, id);
    if (hierarchyErr) { res.status(400).json({ error: hierarchyErr }); return; }
    // cycle detection when reparenting
    if (parentId !== undefined && parentId !== null && parentId !== current.parentId) {
      if (await detectCycle(id, parentId)) {
        res.status(400).json({ error: "parentId would create a cycle" }); return;
      }
    }

    const u: Record<string, unknown> = { updatedAt: new Date() };
    if (title !== undefined) u.title = String(title).trim();
    if (body !== undefined) u.body = body ?? ""; // body column is NOT NULL
    if (status !== undefined) u.status = status;
    if (links !== undefined) u.links = links ?? [];
    if (tags !== undefined) u.tags = tags ?? [];
    if (type !== undefined) u.type = type;
    if (dueDate !== undefined) u.dueDate = dueDate ? new Date(dueDate) : null;
    if (parentId !== undefined) u.parentId = parentId;
    if (startMonth !== undefined) u.startMonth = startMonth;
    if (endMonth !== undefined) u.endMonth = endMonth;
    if (backlog !== undefined) u.backlog = backlog;
    const [item] = await db.update(futureItemsTable).set(u).where(eq(futureItemsTable.id, id)).returning();
    res.json(item);
  } catch (err) {
    req.log.error({ err }, "Failed to update future item");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/future/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "id must be a number" }); return; }
    const collect = async (pid: number, seen: Set<number> = new Set()): Promise<number[]> => {
      const rows = await db.select({ id: futureItemsTable.id }).from(futureItemsTable).where(eq(futureItemsTable.parentId, pid));
      const ids = rows.map(r => r.id).filter((i) => !seen.has(i));
      if (!ids.length) return [];
      ids.forEach((i) => seen.add(i));
      const sub = await Promise.all(ids.map((i) => collect(i, seen)));
      return [...ids, ...sub.flat()];
    };
    const descIds = await collect(id);
    if (descIds.length) await db.delete(futureItemsTable).where(inArray(futureItemsTable.id, descIds));
    const [item] = await db.delete(futureItemsTable).where(eq(futureItemsTable.id, id)).returning();
    if (!item) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true, deleted: descIds.length + 1 });
  } catch (err) {
    req.log.error({ err }, "Failed to delete future item");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
