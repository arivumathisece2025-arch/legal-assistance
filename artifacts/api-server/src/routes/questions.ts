import { Router, type IRouter } from "express";
import { handleAskRequest } from "../documents/ask";

const router: IRouter = Router();

router.post("/questions", async (req, res): Promise<void> => {
  await handleAskRequest(req, res);
});

export default router;