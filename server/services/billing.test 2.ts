import { describe, it, expect } from "vitest";
import { validateAccessCode } from "./billing";

const now = new Date("2026-06-17T12:00:00Z");
const base = { id: 1, code: "BETA", label: null, redemptionCount: 0, maxRedemptions: null as number | null, expiresAt: null as Date | null, isActive: true, createdAt: now };

describe("validateAccessCode", () => {
  it("code valide", () => {
    expect(validateAccessCode(base, false, now)).toEqual({ ok: true });
  });
  it("code inexistant", () => {
    expect(validateAccessCode(undefined, false, now)).toEqual({ ok: false, reason: "invalid" });
  });
  it("code inactif", () => {
    expect(validateAccessCode({ ...base, isActive: false }, false, now)).toEqual({ ok: false, reason: "inactive" });
  });
  it("code expiré", () => {
    expect(validateAccessCode({ ...base, expiresAt: new Date("2026-06-10T00:00:00Z") }, false, now)).toEqual({ ok: false, reason: "expired" });
  });
  it("quota atteint", () => {
    expect(validateAccessCode({ ...base, maxRedemptions: 5, redemptionCount: 5 }, false, now)).toEqual({ ok: false, reason: "exhausted" });
  });
  it("déjà utilisé par ce user", () => {
    expect(validateAccessCode(base, true, now)).toEqual({ ok: false, reason: "already_redeemed" });
  });
});
