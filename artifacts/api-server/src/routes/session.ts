import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/session", (req, res): void => {
  res.json({ csrfToken: req.session!.csrfToken });
});

export default router;