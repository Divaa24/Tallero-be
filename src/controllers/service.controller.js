const prisma = require("../config/prisma.config");
const AppError = require("../utils/appError.util");

const getAllServices = async (req, res, next) => {
  try {
    const services = await prisma.service.findMany({
      include: {
        category: true,
      },
    });

    res.status(200).json({
      status: "success",
      data: { services },
    });
  } catch (error) {
    next(error);
  }
};

const createService = async (req, res, next) => {
  try {
    const { categoryId, name, price, estimatedTime, description, isActive } = req.body;

    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      return next(new AppError("Category not found", 404));
    }

    const service = await prisma.service.create({
      data: {
        categoryId,
        name,
        price,
        estimatedTime,
        description: description || null,
        isActive: isActive !== undefined ? isActive : true,
      },
    });

    res.status(201).json({
      status: "success",
      data: { service },
    });
  } catch (error) {
    next(error);
  }
};

const updateService = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { categoryId, name, price, estimatedTime, description, isActive } = req.body;

    const existingService = await prisma.service.findUnique({ where: { id } });
    if (!existingService) {
      return next(new AppError("Service not found", 404));
    }

    const service = await prisma.service.update({
      where: { id },
      data: {
        categoryId: categoryId !== undefined ? categoryId : existingService.categoryId,
        name: name !== undefined ? name : existingService.name,
        price: price !== undefined ? price : existingService.price,
        estimatedTime: estimatedTime !== undefined ? estimatedTime : existingService.estimatedTime,
        description: description !== undefined ? description : existingService.description,
        isActive: isActive !== undefined ? isActive : existingService.isActive,
      },
    });

    res.status(200).json({
      status: "success",
      data: { service },
    });
  } catch (error) {
    next(error);
  }
};

const deleteService = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existingService = await prisma.service.findUnique({ where: { id } });
    if (!existingService) {
      return next(new AppError("Service not found", 404));
    }

    await prisma.service.delete({ where: { id } });

    res.status(200).json({
      status: "success",
      data: { message: "Service deleted successfully" },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllServices,
  createService,
  updateService,
  deleteService,
};
