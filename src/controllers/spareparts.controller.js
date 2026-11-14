import { sendSuccess } from "../utils/response.js";
import * as sparepartsService from "../services/spareparts.service.js";

export const listSpareparts = async (req, res) => {
  const { items, meta } = await sparepartsService.listSpareparts({
    actor: req.user,
    query: req.valid.query,
    adminMode: false,
  });
  return sendSuccess(res, { data: items, meta });
};

export const listAdminSpareparts = async (req, res) => {
  const { items, meta } = await sparepartsService.listSpareparts({
    actor: req.user,
    query: req.valid.query,
    adminMode: true,
  });
  return sendSuccess(res, { data: items, meta });
};

export const createSparepart = async (req, res) => {
  const data = await sparepartsService.createSparepart({
    actor: req.user,
    data: req.valid.body,
    ip: req.ip,
  });
  return sendSuccess(res, { data, statusCode: 201 });
};

export const updateSparepart = async (req, res) => {
  const data = await sparepartsService.updateSparepart({
    actor: req.user,
    sparepartId: req.valid.params.id,
    data: req.valid.body,
    ip: req.ip,
  });
  return sendSuccess(res, { data });
};

export const adjustSparepartStock = async (req, res) => {
  const data = await sparepartsService.adjustSparepartStock({
    actor: req.user,
    sparepartId: req.valid.params.id,
    ...req.valid.body,
    ip: req.ip,
  });
  return sendSuccess(res, { data });
};

export const deleteSparepart = async (req, res) => {
  const data = await sparepartsService.softDeleteSparepart({
    actor: req.user,
    sparepartId: req.valid.params.id,
    ip: req.ip,
  });
  return sendSuccess(res, { data });
};

export const restoreSparepart = async (req, res) => {
  const data = await sparepartsService.restoreSparepart({
    actor: req.user,
    sparepartId: req.valid.params.id,
    ip: req.ip,
  });
  return sendSuccess(res, { data });
};
