import { describe, it, expect, vi } from "vitest";
import { createSoftDeleteHandler, SOFT_DELETE_MODELS } from "../../src/config/prisma.js";

describe("Unit: Soft-Delete Prisma Extension Handler", () => {
  it("menyisipkan deletedAt: null pada operasi find/count/aggregate/groupBy untuk model soft-delete", async () => {
    const handler = createSoftDeleteHandler({ getTargetClient: () => ({}) });
    const query = vi.fn(async (args) => args);

    for (const model of SOFT_DELETE_MODELS) {
      const res = await handler({
        model,
        operation: "findMany",
        args: { where: { isActive: true } },
        query,
      });
      expect(res.where).toEqual({ isActive: true, deletedAt: null });
    }

    const aggRes = await handler({
      model: "User",
      operation: "aggregate",
      args: {},
      query,
    });
    expect(aggRes.where).toEqual({ deletedAt: null });
  });

  it("tidak mengubah model non-soft-delete seperti Booking dan Payment", async () => {
    const handler = createSoftDeleteHandler({ getTargetClient: () => ({}) });
    const query = vi.fn(async (args) => args);

    const res = await handler({
      model: "Booking",
      operation: "findMany",
      args: { where: { status: "PENDING" } },
      query,
    });
    expect(res.where).toEqual({ status: "PENDING" });
  });

  it("mengubah delete menjadi update deletedAt dan membebaskan Vehicle.activePlate", async () => {
    const userUpdate = vi.fn(async (args) => ({ id: 1, ...args.data }));
    const vehicleUpdate = vi.fn(async (args) => ({ id: 2, ...args.data }));
    const outletUpdateMany = vi.fn(async () => ({ count: 2 }));

    const targetClient = {
      user: { update: userUpdate },
      vehicle: { update: vehicleUpdate },
      outlet: { updateMany: outletUpdateMany },
    };

    const handler = createSoftDeleteHandler({ getTargetClient: () => targetClient });
    const query = vi.fn();

    const deletedUser = await handler({
      model: "User",
      operation: "delete",
      args: { where: { id: 1 } },
      query,
    });
    expect(query).not.toHaveBeenCalled();
    expect(deletedUser.deletedAt).toBeInstanceOf(Date);
    expect(userUpdate.mock.calls[0][0].where).toEqual({ id: 1, deletedAt: null });

    const deletedVehicle = await handler({
      model: "Vehicle",
      operation: "delete",
      args: { where: { id: 2 } },
      query,
    });
    expect(deletedVehicle.deletedAt).toBeInstanceOf(Date);
    expect(deletedVehicle.activePlate).toBeNull();

    const deletedOutlets = await handler({
      model: "Outlet",
      operation: "deleteMany",
      args: { where: { isActive: false } },
      query,
    });
    expect(deletedOutlets).toEqual({ count: 2 });
    expect(outletUpdateMany.mock.calls[0][0].where).toEqual({ isActive: false, deletedAt: null });
  });
});
