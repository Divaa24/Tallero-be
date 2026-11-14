import { sendSuccess } from "../utils/response.js";
import * as vehiclesService from "../services/vehicles.service.js";

export const listVehicles = async (req, res) => {
  const { items, meta } = await vehiclesService.listMyVehicles({
    actor: req.user,
    query: req.valid.query,
  });
  return sendSuccess(res, { data: items, meta });
};

export const createVehicle = async (req, res) => {
  const data = await vehiclesService.createVehicle({
    actor: req.user,
    data: req.valid.body,
  });
  return sendSuccess(res, { data, statusCode: 201 });
};

export const getVehicle = async (req, res) => {
  const data = await vehiclesService.getMyVehicleById({
    actor: req.user,
    vehicleId: req.valid.params.id,
  });
  return sendSuccess(res, { data });
};

export const updateVehicle = async (req, res) => {
  const data = await vehiclesService.updateVehicle({
    actor: req.user,
    vehicleId: req.valid.params.id,
    data: req.valid.body,
  });
  return sendSuccess(res, { data });
};

export const deleteVehicle = async (req, res) => {
  const data = await vehiclesService.deleteVehicle({
    actor: req.user,
    vehicleId: req.valid.params.id,
  });
  return sendSuccess(res, { data });
};

export const getVehicleHistory = async (req, res) => {
  const { data, meta } = await vehiclesService.getVehicleHistory({
    actor: req.user,
    vehicleId: req.valid.params.id,
    query: req.valid.query,
  });
  return sendSuccess(res, { data, meta });
};

export const getVehicleReminders = async (req, res) => {
  const { data, meta } = await vehiclesService.getVehicleReminders({
    actor: req.user,
    vehicleId: req.valid.params.id,
    query: req.valid.query,
  });
  return sendSuccess(res, { data, meta });
};
