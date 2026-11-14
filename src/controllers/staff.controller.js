import { sendSuccess } from "../utils/response.js";
import * as bookingsService from "../services/bookings.service.js";
import * as staffService from "../services/staff.service.js";

export const getQueue = async (req, res) => {
  const data = await bookingsService.getStaffQueue({
    actor: req.user,
    outletId: req.valid.query.outletId,
  });
  return sendSuccess(res, { data });
};

export const claimNext = async (req, res) => {
  const data = await bookingsService.claimNextBooking({
    actor: req.user,
  });
  return sendSuccess(res, {
    data,
    message: "Pekerjaan berikutnya berhasil diambil dari antrian",
  });
};

export const getMeJobs = async (req, res) => {
  const data = await bookingsService.getStaffMeJobs({
    actor: req.user,
  });
  return sendSuccess(res, { data });
};

export const getMeTips = async (req, res) => {
  const result = await staffService.getStaffMeTips({
    actor: req.user,
    query: req.valid.query,
  });
  return sendSuccess(res, {
    data: {
      totalTips: result.totalTips,
      tips: result.items,
    },
    meta: result.meta,
  });
};

export default {
  getQueue,
  claimNext,
  getMeJobs,
  getMeTips,
};
