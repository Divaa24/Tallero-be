import { afterEach, describe, expect, it, vi } from "vitest";
import { getStatus } from "../../src/services/midtrans.service.js";

afterEach(() => vi.unstubAllGlobals());
const respond = (status, body) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: status < 400, status, json: async () => body }))
  );

describe("Midtrans status transport and provider codes", () => {
  it("accepts the matching pending transaction", async () => {
    respond(200, { status_code: "201", order_id: "TEST-1", transaction_status: "pending" });
    await expect(getStatus("TEST-1")).resolves.toMatchObject({ transaction_status: "pending" });
  });
  it.each([200, 404])(
    "maps provider 404 carried by HTTP %s to PAYMENT_NOT_FOUND",
    async (httpStatus) => {
      respond(httpStatus, { status_code: "404", status_message: "Transaction doesn't exist" });
      await expect(getStatus("TEST-1")).rejects.toMatchObject({
        statusCode: 404,
        code: "PAYMENT_NOT_FOUND",
      });
    }
  );
  it("rejects a provider authentication error carried by HTTP 200", async () => {
    respond(200, { status_code: "401", status_message: "Access denied" });
    await expect(getStatus("TEST-1")).rejects.toMatchObject({
      statusCode: 502,
      code: "MIDTRANS_GATEWAY_ERROR",
    });
  });
  it("rejects a different transaction in the status response", async () => {
    respond(200, { status_code: "200", order_id: "OTHER", transaction_status: "settlement" });
    await expect(getStatus("TEST-1")).rejects.toMatchObject({ code: "MIDTRANS_GATEWAY_ERROR" });
  });
  it("rejects a malformed status response", async () => {
    respond(200, {});
    await expect(getStatus("TEST-1")).rejects.toMatchObject({ code: "MIDTRANS_GATEWAY_ERROR" });
  });
});
