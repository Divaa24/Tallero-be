import { sendSuccess } from "../utils/response.js";
import * as catalogCategories from "../services/catalogCategories.service.js";
import * as catalogService from "../services/catalog.service.js";

export const listPublicCategories = async (req, res) => {
  const { items, meta } = await catalogCategories.listCategories({
    query: req.valid.query,
    admin: false,
  });
  return sendSuccess(res, { data: items, meta });
};

export const listAdminCategories = async (req, res) => {
  const { items, meta } = await catalogCategories.listCategories({
    query: req.valid.query,
    admin: true,
  });
  return sendSuccess(res, { data: items, meta });
};

export const createCategory = async (req, res) => {
  const data = await catalogCategories.createCategory({
    actor: req.user,
    data: req.valid.body,
    ip: req.ip,
  });
  return sendSuccess(res, { data, statusCode: 201 });
};

export const updateCategory = async (req, res) => {
  const data = await catalogCategories.updateCategory({
    actor: req.user,
    categoryId: req.valid.params.id,
    data: req.valid.body,
    ip: req.ip,
  });
  return sendSuccess(res, { data });
};

export const deleteCategory = async (req, res) => {
  const data = await catalogCategories.softDeleteCategory({
    actor: req.user,
    categoryId: req.valid.params.id,
    ip: req.ip,
  });
  return sendSuccess(res, { data });
};

export const restoreCategory = async (req, res) => {
  const data = await catalogCategories.restoreCategory({
    actor: req.user,
    categoryId: req.valid.params.id,
    ip: req.ip,
  });
  return sendSuccess(res, { data });
};

export const listPublicServices = async (req, res) => {
  const { items, meta } = await catalogService.listPublicServices({ query: req.valid.query });
  return sendSuccess(res, { data: items, meta });
};

export const getPublicService = async (req, res) => {
  const data = await catalogService.getPublicServiceById({ serviceId: req.valid.params.id });
  return sendSuccess(res, { data });
};

export const listAdminServices = async (req, res) => {
  const { items, meta } = await catalogService.listAdminServices({ query: req.valid.query });
  return sendSuccess(res, { data: items, meta });
};

export const createService = async (req, res) => {
  const data = await catalogService.createService({
    actor: req.user,
    data: req.valid.body,
    ip: req.ip,
  });
  return sendSuccess(res, { data, statusCode: 201 });
};

export const updateService = async (req, res) => {
  const data = await catalogService.updateService({
    actor: req.user,
    serviceId: req.valid.params.id,
    data: req.valid.body,
    ip: req.ip,
  });
  return sendSuccess(res, { data });
};

export const deleteService = async (req, res) => {
  const data = await catalogService.softDeleteService({
    actor: req.user,
    serviceId: req.valid.params.id,
    ip: req.ip,
  });
  return sendSuccess(res, { data });
};

export const restoreService = async (req, res) => {
  const data = await catalogService.restoreService({
    actor: req.user,
    serviceId: req.valid.params.id,
    ip: req.ip,
  });
  return sendSuccess(res, { data });
};
