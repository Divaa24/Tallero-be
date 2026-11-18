import { describe, expect, it, vi, beforeEach } from "vitest";
import env from "../../src/config/env.js";
import * as authController from "../../src/controllers/auth.controller.js";
import * as sessionTokens from "../../src/services/sessionTokens.service.js";

describe("Cookie Refresh & Web Client Token Security (AGENTS.md §4.6 & FASE I-1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("buildRefreshCookieOptions sets httpOnly: true, path: /api/v1/auth, sameSite, and domain from env", () => {
    const opts = authController.buildRefreshCookieOptions();

    // 1. Cookie tidak boleh bisa dibaca oleh JavaScript (Anti-XSS)
    expect(opts.httpOnly).toBe(true);

    // 2. Path dibatasi hanya ke /api/v1/auth (endpoint refresh & logout)
    expect(opts.path).toBe(env.COOKIE_PATH || "/api/v1/auth");

    // 3. SameSite diatur sesuai env
    expect(["strict", "lax", "none"]).toContain(opts.sameSite);

    // 4. Secure diatur false untuk dev localhost non-production (kecuali di-override env)
    expect(typeof opts.secure).toBe("boolean");
  });

  it("dengan header X-Client: web, token keluar di cookie httpOnly dan TIDAK bocor di body JSON", async () => {
    vi.spyOn(sessionTokens, "rotateRefreshToken").mockResolvedValue({
      accessToken: "mock_access_jwt_123",
      refreshToken: "mock_opaque_refresh_token_48_bytes",
      tokenType: "Bearer",
      expiresIn: 900,
    });

    const cookiesSet = {};
    const mockReq = {
      get: (header) => (header.toLowerCase() === "x-client" ? "web" : null),
      cookies: {
        refreshToken: "valid_existing_refresh_token",
      },
      valid: { body: {} },
      ip: "127.0.0.1",
    };

    let responsePayload = null;
    let _responseStatus = null;

    const mockRes = {
      cookie: (name, val, opts) => {
        cookiesSet[name] = { val, opts };
      },
      status: (code) => {
        _responseStatus = code;
        return mockRes;
      },
      json: (payload) => {
        responsePayload = payload;
        return mockRes;
      },
    };

    await authController.refresh(mockReq, mockRes);

    // 1. Cookie refreshToken berhasil di-set
    expect(cookiesSet.refreshToken).toBeDefined();
    expect(cookiesSet.refreshToken.val).toBe("mock_opaque_refresh_token_48_bytes");
    expect(cookiesSet.refreshToken.opts.httpOnly).toBe(true);
    expect(cookiesSet.refreshToken.opts.path).toBe("/api/v1/auth");

    // 2. Token refreshToken TIDAK keluar di JSON body respons client
    expect(responsePayload.success).toBe(true);
    expect(responsePayload.data.accessToken).toBe("mock_access_jwt_123");
    expect(responsePayload.data.refreshToken).toBeUndefined();
  });

  it("tanpa header X-Client: web (mis. mobile native), token TIDAK keluar di cookie dan dikembalikan di body JSON", async () => {
    vi.spyOn(sessionTokens, "rotateRefreshToken").mockResolvedValue({
      accessToken: "mock_access_jwt_mobile",
      refreshToken: "mock_opaque_refresh_token_mobile",
      tokenType: "Bearer",
      expiresIn: 900,
    });

    const cookiesSet = {};
    const mockReq = {
      get: (_header) => null, // Tidak mengirim x-client
      cookies: {},
      valid: {
        body: { refreshToken: "valid_mobile_refresh_token" },
      },
      ip: "127.0.0.1",
    };

    let responsePayload = null;
    const mockRes = {
      cookie: (name, val, opts) => {
        cookiesSet[name] = { val, opts };
      },
      status: () => mockRes,
      json: (payload) => {
        responsePayload = payload;
        return mockRes;
      },
    };

    await authController.refresh(mockReq, mockRes);

    // 1. Tidak ada cookie yang di-set
    expect(Object.keys(cookiesSet).length).toBe(0);

    // 2. Token refreshToken tetap disertakan di body JSON untuk disimpan di SecureStore mobile
    expect(responsePayload.success).toBe(true);
    expect(responsePayload.data.accessToken).toBe("mock_access_jwt_mobile");
    expect(responsePayload.data.refreshToken).toBe("mock_opaque_refresh_token_mobile");
  });

  it("clearRefreshCookie membersihkan cookie dengan opsi path & domain yang identik", () => {
    let clearedCookie = null;
    const mockRes = {
      clearCookie: (name, opts) => {
        clearedCookie = { name, opts };
      },
    };

    authController.clearRefreshCookie(mockRes);

    expect(clearedCookie).toBeDefined();
    expect(clearedCookie.name).toBe("refreshToken");
    expect(clearedCookie.opts.path).toBe(env.COOKIE_PATH || "/api/v1/auth");
    expect(clearedCookie.opts.httpOnly).toBe(true);
  });
});
