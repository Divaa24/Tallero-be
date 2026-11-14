import { sendSuccess } from "../utils/response.js";
import * as bookingsService from "../services/bookings.service.js";

export const getOutletAvailability = async (req, res) => {
  const data = await bookingsService.getOutletAvailability({
    outletId: req.valid.params.id,
    date: req.valid.query.date,
    serviceIds: req.valid.query.serviceIds,
  });
  return sendSuccess(res, { data });
};

export const createBooking = async (req, res) => {
  const data = await bookingsService.createBooking({
    actor: req.user,
    data: req.valid.body,
  });
  return sendSuccess(res, { data, statusCode: 201 });
};

export const listBookings = async (req, res) => {
  const { items, meta } = await bookingsService.listBookings({
    actor: req.user,
    query: req.valid.query,
  });
  return sendSuccess(res, { data: items, meta });
};

export const getBooking = async (req, res) => {
  const data = await bookingsService.getBookingById({
    actor: req.user,
    bookingId: req.valid.params.id,
  });
  return sendSuccess(res, { data });
};

export const getBookingLogs = async (req, res) => {
  const data = await bookingsService.getBookingLogs({
    actor: req.user,
    bookingId: req.valid.params.id,
  });
  return sendSuccess(res, { data });
};

export const getBookingQr = async (req, res) => {
  const data = await bookingsService.getBookingQr({
    actor: req.user,
    bookingId: req.valid.params.id,
  });
  return sendSuccess(res, { data });
};

export const cancelBooking = async (req, res) => {
  const data = await bookingsService.cancelBooking({
    actor: req.user,
    bookingId: req.valid.params.id,
    reason: req.valid.body?.reason,
  });
  return sendSuccess(res, { data });
};

export const checkInBooking = async (req, res) => {
  const data = await bookingsService.checkInBooking({
    actor: req.user,
    data: req.valid.body,
  });
  return sendSuccess(res, { data, message: "Check-in berhasil diproses" });
};

export const assignMechanic = async (req, res) => {
  const data = await bookingsService.assignMechanic({
    actor: req.user,
    bookingId: req.valid.params.id,
    mechanicId: req.valid.body.mechanicId,
  });
  return sendSuccess(res, { data, message: "Mekanik berhasil ditugaskan" });
};

export const startBooking = async (req, res) => {
  const data = await bookingsService.startBooking({
    actor: req.user,
    bookingId: req.valid.params.id,
    mechanicId: req.valid.body?.mechanicId,
  });
  return sendSuccess(res, { data, message: "Pengerjaan servis berhasil dimulai" });
};

export const getQueuePosition = async (req, res) => {
  const data = await bookingsService.getQueuePosition({
    actor: req.user,
    bookingId: req.valid.params.id,
  });
  return sendSuccess(res, { data });
};

export const addBookingItem = async (req, res) => {
  const data = await bookingsService.addBookingItem({
    actor: req.user,
    bookingId: req.valid.params.id,
    data: req.valid.body,
  });
  return sendSuccess(res, { data, statusCode: 201, message: "Item tambahan berhasil diajukan" });
};

export const deleteBookingItem = async (req, res) => {
  const data = await bookingsService.deleteBookingItem({
    actor: req.user,
    bookingId: req.valid.params.id,
    itemId: req.valid.params.itemId,
  });
  return sendSuccess(res, { data, message: "Item tambahan berhasil dihapus" });
};

export const decideBookingApprovals = async (req, res) => {
  const data = await bookingsService.decideBookingApprovals({
    actor: req.user,
    bookingId: req.valid.params.id,
    data: req.valid.body,
  });
  return sendSuccess(res, { data, message: "Keputusan persetujuan berhasil diproses" });
};

export const uploadBookingPhoto = async (req, res) => {
  const data = await bookingsService.uploadBookingPhoto({
    actor: req.user,
    bookingId: req.valid.params.id,
    file: req.file,
    data: req.valid.body,
  });
  return sendSuccess(res, { data, statusCode: 201, message: "Foto inspeksi berhasil diunggah" });
};

export const listBookingPhotos = async (req, res) => {
  const data = await bookingsService.listBookingPhotos({
    actor: req.user,
    bookingId: req.valid.params.id,
  });
  return sendSuccess(res, { data });
};

export const deleteBookingPhoto = async (req, res) => {
  const data = await bookingsService.deleteBookingPhoto({
    actor: req.user,
    bookingId: req.valid.params.id,
    photoId: req.valid.params.photoId,
  });
  return sendSuccess(res, { data, message: "Foto inspeksi berhasil dihapus" });
};

export const updateInspection = async (req, res) => {
  const data = await bookingsService.updateInspection({
    actor: req.user,
    bookingId: req.valid.params.id,
    data: req.valid.body,
  });
  return sendSuccess(res, { data, message: "Inspeksi berhasil diperbarui" });
};

export const markBookingReady = async (req, res) => {
  const data = await bookingsService.markBookingReady({
    actor: req.user,
    bookingId: req.valid.params.id,
  });
  return sendSuccess(res, { data, message: "Kendaraan siap diambil oleh pelanggan" });
};

export const completeBooking = async (req, res) => {
  const data = await bookingsService.completeBooking({
    actor: req.user,
    bookingId: req.valid.params.id,
    note: req.valid.body?.note,
  });
  return sendSuccess(res, { data, message: "Transaksi booking berhasil diselesaikan" });
};

export default {
  getOutletAvailability,
  createBooking,
  listBookings,
  getBooking,
  getBookingLogs,
  getBookingQr,
  cancelBooking,
  checkInBooking,
  assignMechanic,
  startBooking,
  getQueuePosition,
  addBookingItem,
  deleteBookingItem,
  decideBookingApprovals,
  uploadBookingPhoto,
  listBookingPhotos,
  deleteBookingPhoto,
  updateInspection,
  markBookingReady,
  completeBooking,
};
