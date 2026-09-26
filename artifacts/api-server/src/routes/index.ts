import { Router, type IRouter } from "express";
import audioRouter from "./audio";
import healthRouter from "./health";
import documentsRouter from "./documents";
import questionsRouter from "./questions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(audioRouter);
router.use(documentsRouter);
router.use(questionsRouter);

export default router;
