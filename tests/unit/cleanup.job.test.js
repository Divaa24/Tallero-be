import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "../../src/config/prisma.js";
import { runTokenCleanup } from "../../src/jobs/cleanup.job.js";

describe("cleanup.job", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes expired and stale consumed/revoked auth tokens", async () => {
    const otpDel = vi.spyOn(prisma.registrationOtp, "deleteMany").mockResolvedValue({ count: 3 });
    const resetDel = vi
      .spyOn(prisma.passwordResetToken, "deleteMany")
      .mockResolvedValue({ count: 2 });
    const refreshDel = vi.spyOn(prisma.refreshToken, "deleteMany").mockResolvedValue({ count: 5 });

    const fixedNow = new Date("2026-11-12T10:00:00.000Z");
    const result = await runTokenCleanup(fixedNow);

    expect(result).toEqual({
      deletedOtps: 3,
      deletedResetTokens: 2,
      deletedRefreshTokens: 5,
    });

    expect(otpDel).toHaveBeenCalledWith({
      where: {
        OR: [
          { expiresAt: { lte: fixedNow } },
          { consumedAt: { lte: new Date("2026-11-05T10:00:00.000Z") } },
        ],
      },
    });
    expect(resetDel).toHaveBeenCalledOnce();
    expect(refreshDel).toHaveBeenCalledOnce();
  });
});
