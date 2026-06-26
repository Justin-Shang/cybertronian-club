import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, agentsTable } from "@workspace/db";
import {
  CreateAgentBody,
  UpdateAgentBody,
  GetAgentParams,
  UpdateAgentParams,
  DeleteAgentParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/agents", async (_req, res): Promise<void> => {
  const agents = await db.select().from(agentsTable).orderBy(agentsTable.createdAt);
  res.json(agents);
});

router.post("/agents", async (req, res): Promise<void> => {
  const parsed = CreateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [agent] = await db.insert(agentsTable).values(parsed.data).returning();
  res.status(201).json(agent);
});

router.get("/agents/:agentId", async (req, res): Promise<void> => {
  const params = GetAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, params.data.agentId));
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(agent);
});

router.patch("/agents/:agentId", async (req, res): Promise<void> => {
  const params = UpdateAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [agent] = await db
    .update(agentsTable)
    .set(parsed.data)
    .where(eq(agentsTable.id, params.data.agentId))
    .returning();
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(agent);
});

router.delete("/agents/:agentId", async (req, res): Promise<void> => {
  const params = DeleteAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(agentsTable).where(eq(agentsTable.id, params.data.agentId));
  res.sendStatus(204);
});

export default router;
