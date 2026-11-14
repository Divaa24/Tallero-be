import { sendSuccess } from "../utils/response.js";
import * as outletsService from "../services/outlets.service.js";
import * as bookingsService from "../services/bookings.service.js";

export const getOutletAvailability = async (req, res) => {
  const data = await bookingsService.getOutletAvailability({
    outletId: req.valid.params.id,
    dateStr: req.valid.query.date,
    serviceIds: req.valid.query.serviceIds,
  });
  return sendSuccess(res, { data });
};

export const listPublicOutlets = async (req, res) => {
  const { items, meta } = await outletsService.listPublicOutlets({ query: req.valid.query });
  return sendSuccess(res, { data: items, meta });
};

export const getPublicOutlet = async (req, res) => {
  const data = await outletsService.getPublicOutletById({ outletId: req.valid.params.id });
  return sendSuccess(res, { data });
};

export const listAdminOutlets = async (req, res) => {
  const { items, meta } = await outletsService.listAdminOutlets({ query: req.valid.query });
  return sendSuccess(res, { data: items, meta });
};

export const createOutlet = async (req, res) => {
  const data = await outletsService.createOutlet({
    actor: req.user,
    data: req.valid.body,
    ip: req.ip,
  });
  return sendSuccess(res, { data, statusCode: 201 });
};

export const updateOutlet = async (req, res) => {
  const data = await outletsService.updateOutlet({
    actor: req.user,
    outletId: req.valid.params.id,
    data: req.valid.body,
    ip: req.ip,
  });
  return sendSuccess(res, { data });
};

export const deleteOutlet = async (req, res) => {
  const data = await outletsService.softDeleteOutlet({
    actor: req.user,
    outletId: req.valid.params.id,
    ip: req.ip,
  });
  return sendSuccess(res, { data });
};

export const restoreOutlet = async (req, res) => {
  const data = await outletsService.restoreOutlet({
    actor: req.user,
    outletId: req.valid.params.id,
    ip: req.ip,
  });
  return sendSuccess(res, { data });
};

export const addOutletClosure = async (req, res) => {
  const data = await outletsService.addOutletClosure({
    actor: req.user,
    outletId: req.valid.params.id,
    ...req.valid.body,
    ip: req.ip,
  });
  return sendSuccess(res, { data, statusCode: 201 });
};

export const removeOutletClosure = async (req, res) => {
  const data = await outletsService.removeOutletClosure({
    actor: req.user,
    outletId: req.valid.params.id,
    closureId: req.valid.params.closureId,
    ip: req.ip,
  });
  return sendSuccess(res, { data });
};
