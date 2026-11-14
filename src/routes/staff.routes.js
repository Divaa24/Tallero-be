import { Router } from "express";
import authenticate from "../middlewares/authenticate.js";
import authorize from "../middlewares/authorize.js";
import validate from "../middlewares/validate.js";
import { staffQueueQuerySchema } from "../validations/bookings.validation.js";
import * as staffController from "../controllers/staff.controller.js";
import reviewsController from "../controllers/reviews.controller.js";
import { listReviewsQuerySchema } from "../validations/reviews.validation.js";
import { mechanicTipsQuerySchema } from "../validations/reports.validation.js";

const staffRouter = Router();

staffRouter.use(authenticate);

// 1. Dashboard antrian staf bengkel (5 bagian: waiting, inProgress, waitingApproval, readyForPickup, expectedToday)
staffRouter.get(
  "/queue",
  authorize("MECHANIC", "ADMIN"),
  validate(staffQueueQuerySchema),
  staffController.getQueue
);

// 2. Mekanik mengambil job berikutnya dari kepala antrian
staffRouter.post("/queue/claim-next", authorize("MECHANIC"), staffController.claimNext);

// 3. Pekerjaan yang ditugaskan kepada mekanik saat ini
staffRouter.get("/me/jobs", authorize("MECHANIC"), staffController.getMeJobs);

// 4. Ulasan dan rating performa mekanik saat ini
staffRouter.get(
  "/me/reviews",
  authorize("MECHANIC"),
  validate(listReviewsQuerySchema, "query"),
  reviewsController.listMechanicReviews
);

// 5. Daftar dan total tip yang diterima mekanik
staffRouter.get(
  "/me/tips",
  authorize("MECHANIC"),
  validate(mechanicTipsQuerySchema, "query"),
  staffController.getMeTips
);

export default staffRouter;
