import { Router, type IRouter } from "express";
import askRouter from "../documents/ask";
import compareRouter from "../documents/compare";
import crudRouter from "../documents/crud";
import uploadRouter from "../documents/upload";

export {
  answerDocumentQuestion,
} from "../documents/qa";
export {
  getAccessibleDocument,
  getDocumentRecord,
  purgeDocumentsFor,
  sweepExpiredMemoryDocuments,
} from "../documents/store";

const router: IRouter = Router();

router.use(uploadRouter);
router.use(crudRouter);
router.use(askRouter);
router.use(compareRouter);

export default router;