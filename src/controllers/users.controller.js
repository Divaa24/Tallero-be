import { sendSuccess } from "../utils/response.js";
import * as usersService from "../services/users.service.js";

export const listUsers = async (req, res) => {
  const { items, meta } = await usersService.listUsers({ query: req.valid.query });
  return sendSuccess(res, { data: items, meta });
};

export const getUser = async (req, res) => {
  const data = await usersService.getUserById({ userId: req.valid.params.id });
  return sendSuccess(res, { data });
};

export const createStaff = async (req, res) => {
  const data = await usersService.createStaff({
    actor: req.user,
    data: req.valid.body,
    ip: req.ip,
  });
  return sendSuccess(res, { data, statusCode: 201 });
};

export const updateUser = async (req, res) => {
  const data = await usersService.updateUser({
    actor: req.user,
    userId: req.valid.params.id,
    data: req.valid.body,
    ip: req.ip,
  });
  return sendSuccess(res, { data });
};

export const updateUserStatus = async (req, res) => {
  const data = await usersService.updateUserStatus({
    actor: req.user,
    userId: req.valid.params.id,
    isActive: req.valid.body.isActive,
    ip: req.ip,
  });
  return sendSuccess(res, { data });
};

export const deleteUser = async (req, res) => {
  const data = await usersService.softDeleteUser({
    actor: req.user,
    userId: req.valid.params.id,
    ip: req.ip,
  });
  return sendSuccess(res, { data });
};

export const restoreUser = async (req, res) => {
  const data = await usersService.restoreUser({
    actor: req.user,
    userId: req.valid.params.id,
    ip: req.ip,
  });
  return sendSuccess(res, { data });
};
