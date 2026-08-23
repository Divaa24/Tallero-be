const prisma = require("../config/prisma.config");
const AppError = require("../utils/appError.util");

const getAllOutlets = async (req, res, next) => {
  try {
    const outlets = await prisma.outlet.findMany();
    res.status(200).json({
      status: "success",
      data: { outlets },
    });
  } catch (error) {
    next(error);
  }
};

const createOutlet = async (req, res, next) => {
  try {
    const { name, address, phone, latitude, longitude, isActive } = req.body;
    const outlet = await prisma.outlet.create({
      data: {
        name,
        address,
        phone: phone || null,
        latitude,
        longitude,
        isActive: isActive !== undefined ? isActive : true,
      },
    });
    res.status(201).json({
      status: "success",
      data: { outlet },
    });
  } catch (error) {
    next(error);
  }
};

const updateOutlet = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, address, phone, latitude, longitude, isActive } = req.body;

    const existingOutlet = await prisma.outlet.findUnique({ where: { id } });

    if (!existingOutlet) {
      return next(new AppError("Outlet not found.", 404));
    }

    const updatedOutlet = await prisma.outlet.update({
      where: { id },
      data: {
        name: name !== undefined ? name : existingOutlet.name,
        address: address !== undefined ? address : existingOutlet.address,
        phone: phone !== undefined ? phone : existingOutlet.phone,
        latitude: latitude !== undefined ? latitude : existingOutlet.latitude,
        longitude: longitude !== undefined ? longitude : existingOutlet.longitude,
        isActive: isActive !== undefined ? isActive : existingOutlet.isActive,
      },
    });

    res.status(200).json({
      status: "success",
      data: { outlet: updatedOutlet },
    });
  } catch (error) {
    next(error);
  }
};

const deleteOutlet = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    
    const existingOutlet = await prisma.outlet.findUnique({ where: { id } });

    if (!existingOutlet) {
      return next(new AppError("Outlet not found.", 404));
    }

    await prisma.outlet.delete({ where: { id } });

    res.status(200).json({
      status: "success",
      data: { message: "Outlet deleted successfully." },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllOutlets,
  createOutlet,
  updateOutlet,
  deleteOutlet,
};
