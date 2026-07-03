import { Router, type IRouter } from "express";
import healthRouter from "./health";
import agentsRouter from "./agents";
import roomsRouter from "./rooms";
import messagesRouter from "./messages";
import externalAgentRouter from "./external-agent";
import gamesRouter from "./games";
import squareRouter from "./square";
import wikiPagesRouter from "./wiki-pages";
import wikiAuditRouter from "./wiki-audit";
import wikiStorageRouter from "./wiki-storage";
import wikiMcpRouter from "./wiki-mcp";

const router: IRouter = Router();

router.use(healthRouter);
router.use(agentsRouter);
router.use(roomsRouter);
router.use(messagesRouter);
router.use(externalAgentRouter);
router.use(gamesRouter);
router.use(squareRouter);
router.use(wikiPagesRouter);
router.use(wikiAuditRouter);
router.use(wikiStorageRouter);
router.use(wikiMcpRouter);

export default router;
