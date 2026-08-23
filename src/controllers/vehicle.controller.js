const prisma = require("../config/prisma.config");
const AppError = require("../utils/appError.util");

const getMyVehicles = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const vehicles = await prisma.vehicle.findMany({
      where: { userId },
    });

    res.status(200).json({
      status: "success",
      data: { vehicles },
    });
  } catch (error) {
    next(error);
  }
};

const addVehicle = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { licensePlate, brand, model, type, year } = req.body;

    const existingVehicle = await prisma.vehicle.findFirst({
      where: { licensePlate },
    });

    if (existingVehicle) {
      return next(new AppError("License plate already registered.", 400));
    }

    const vehicle = await prisma.vehicle.create({
      data: {
        userId,
        licensePlate,
        brand,
        model,
        type: type || "Car",
        year,
      },
    });

    res.status(201).json({
      status: "success",
      data: { vehicle },
    });
  } catch (error) {
    next(error);
  }
};

const deleteVehicle = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = req.user.id;

    const vehicle = await prisma.vehicle.findFirst({
      where: { id, userId },
    });

    if (!vehicle) {
      return next(new AppError("Vehicle not found or does not belong to you.", 404));
    }

    await prisma.vehicle.delete({ where: { id } });

    res.status(200).json({
      status: "success",
      data: { message: "Vehicle deleted successfully." },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMyVehicles,
  addVehicle,
  deleteVehicle,
};
