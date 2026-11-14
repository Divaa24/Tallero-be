import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/app.js";

describe("GET /api/v1/health", () => {
  it("harus mengembalikan status 200 dan status: 'ok' dengan request id", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("success", true);
    expect(response.body.data).toHaveProperty("status", "ok");
    expect(response.body.data).toHaveProperty("uptime");
    expect(response.headers).toHaveProperty("x-request-id");
  });

  it("harus mengembalikan 404 berformat standar untuk rute yang tidak dikenal", async () => {
    const response = await request(app).get("/api/v1/random-unknown-endpoint");

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty("success", false);
    expect(response.body.error).toHaveProperty("code", "NOT_FOUND");
    expect(response.body.error).toHaveProperty("message");
  });
});
