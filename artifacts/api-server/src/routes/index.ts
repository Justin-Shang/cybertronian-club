import { Router, type IRouter } from "express";
import healthRouter from "./health";
import agentsRouter from "./agents";
import roomsRouter from "./rooms";
import messagesRouter from "./messages";
import externalAgentRouter from "./external-agent";

const router: IRouter = Router();

router.use(healthRouter);
router.use(agentsRouter);
router.use(roomsRouter);
router.use(messagesRouter);
router.use(externalAgentRouter);

export default router;
