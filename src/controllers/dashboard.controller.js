const prisma = require("../config/prisma.config");

const getDashboardStats = async (req, res, next) => {
  try {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth(); // 0-11
    
    // Total Bookings This Year
    const totalBookingsThisYear = await prisma.booking.count({
      where: {
        bookingDate: {
          gte: new Date(`${currentYear}-01-01`),
          lt: new Date(`${currentYear + 1}-01-01`),
        },
      },
    });

    // Total Bookings Last Year
    const totalBookingsLastYear = await prisma.booking.count({
      where: {
        bookingDate: {
          gte: new Date(`${currentYear - 1}-01-01`),
          lt: new Date(`${currentYear}-01-01`),
        },
      },
    });

    // Percentage Change
    let bookingChangePercentage = 0;
    if (totalBookingsLastYear > 0) {
      bookingChangePercentage = ((totalBookingsThisYear - totalBookingsLastYear) / totalBookingsLastYear) * 100;
    } else if (totalBookingsThisYear > 0) {
      bookingChangePercentage = 100;
    }

    // Revenue calculations (Only for COMPLETED & PAID bookings)
    const bookingsThisYear = await prisma.booking.findMany({
      where: {
        status: "COMPLETED",
        paymentStatus: "PAID",
        bookingDate: {
          gte: new Date(`${currentYear}-01-01`),
          lt: new Date(`${currentYear + 1}-01-01`),
        },
      },
      select: {
        bookingDate: true,
        totalPrice: true,
      },
    });

    let totalRevenueThisYear = 0;
    let totalRevenueThisMonth = 0;

    // Monthly Chart Data initialization
    const monthlyData = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      totalTransactions: 0,
      totalRevenue: 0,
    }));

    bookingsThisYear.forEach((booking) => {
      const amount = parseFloat(booking.totalPrice) || 0;
      const monthIndex = booking.bookingDate.getMonth(); // 0-11
      
      totalRevenueThisYear += amount;
      if (monthIndex === currentMonth) {
        totalRevenueThisMonth += amount;
      }
      
      monthlyData[monthIndex].totalTransactions += 1;
      monthlyData[monthIndex].totalRevenue += amount;
    });

    // Active Customers Count
    const activeCustomers = await prisma.user.count({
      where: {
        role: "CUSTOMER",
        isActive: true,
      },
    });

    // Total Outlets
    const totalOutlets = await prisma.outlet.count();

    // Booking Status Distribution
    const statusGroups = await prisma.booking.groupBy({
      by: ["status"],
      _count: {
        status: true,
      },
    });
    const bookingStats = statusGroups.reduce((acc, curr) => {
      acc[curr.status] = curr._count.status;
      return acc;
    }, {});

    // Top 5 Best-Selling Services
    const serviceGroups = await prisma.booking.groupBy({
      by: ["serviceId"],
      _count: {
        serviceId: true,
      },
      orderBy: {
        _count: {
          serviceId: "desc",
        },
      },
      take: 5,
    });

    // Resolve service names
    const topServices = await Promise.all(
      serviceGroups.map(async (sg) => {
        const service = await prisma.service.findUnique({
          where: { id: sg.serviceId },
          select: { name: true, price: true },
        });
        return {
          serviceId: sg.serviceId,
          name: service ? service.name : "Unknown",
          price: service ? parseFloat(service.price) : 0,
          totalBookings: sg._count.serviceId,
        };
      })
    );

    res.status(200).json({
      status: "success",
      data: {
        totalBookingsThisYear,
        totalBookingsLastYear,
        bookingChangePercentage: bookingChangePercentage.toFixed(2),
        totalRevenueThisYear,
        totalRevenueThisMonth,
        activeCustomers,
        totalOutlets,
        bookingStats,
        monthlyChartData: monthlyData,
        topServices,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboardStats,
};
