import { Router } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { desc, eq, gte, and } from "drizzle-orm";

const router = Router();

// GET /audit
router.get("/audit", async (req, res) => {
  try {
    const { actor, action, limit: limitRaw, since: sinceRaw } = req.query as Record<string, string | undefined>;

    const limit = Math.min(500, Math.max(1, parseInt(limitRaw ?? "50", 10) || 50));
    const conditions = [];

    if (actor) conditions.push(eq(auditLogsTable.actor, actor));
    if (action && ["CREATE", "UPDATE", "DELETE"].includes(action)) {
      conditions.push(eq(auditLogsTable.action, action));
    }
    if (sinceRaw) {
      const since = new Date(sinceRaw);
      if (!isNaN(since.getTime())) conditions.push(gte(auditLogsTable.createdAt, since));
    }

    const logs = await db
      .select()
      .from(auditLogsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit);

    res.json(logs);
  } catch (err) {
    req.log.error({ err }, "Failed to list audit logs");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
