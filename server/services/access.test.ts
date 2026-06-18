import { describe, it, expect } from "vitest";
import { hasNayaAccess } from "./access";

const now = new Date("2026-06-17T12:00:00Z");
const future = new Date("2026-07-17T12:00:00Z");
const past = new Date("2026-06-10T12:00:00Z");

describe("hasNayaAccess", () => {
  it("owner a toujours accès, sans abonnement", () => {
    expect(hasNayaAccess({ role: "owner" }, null, now)).toBe(true);
  });
  it("comped a toujours accès", () => {
    expect(hasNayaAccess({ role: "comped" }, null, now)).toBe(true);
  });
  it("user sans abonnement = pas d'accès", () => {
    expect(hasNayaAccess({ role: "user" }, null, now)).toBe(false);
  });
  it("statut trialing = accès", () => {
    expect(hasNayaAccess({ role: "user" }, { status: "trialing", currentPeriodEnd: future }, now)).toBe(true);
  });
  it("statut active = accès", () => {
    expect(hasNayaAccess({ role: "user" }, { status: "active", currentPeriodEnd: future }, now)).toBe(true);
  });
  it("past_due avant fin de période = accès (tolérance)", () => {
    expect(hasNayaAccess({ role: "user" }, { status: "past_due", currentPeriodEnd: future }, now)).toBe(true);
  });
  it("past_due après fin de période = pas d'accès", () => {
    expect(hasNayaAccess({ role: "user" }, { status: "past_due", currentPeriodEnd: past }, now)).toBe(false);
  });
  it("canceled = pas d'accès", () => {
    expect(hasNayaAccess({ role: "user" }, { status: "canceled", currentPeriodEnd: future }, now)).toBe(false);
  });
});
