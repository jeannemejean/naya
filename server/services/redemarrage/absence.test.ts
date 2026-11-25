import { describe, it, expect, vi } from "vitest";
vi.mock("../../db", () => ({ db: {} }));
const { derniereActivite, absenceDetectee, SEUIL_ABSENCE_JOURS } = await import("./absence");

const M = new Date("2026-11-25T09:00:00Z");
const ilYa = (j: number) => new Date(M.getTime() - j * 86_400_000);

describe("absence", () => {
  it("seuil : 7 jours", () => { expect(SEUIL_ABSENCE_JOURS).toBe(7); });
  it("activité il y a 8 jours : absence", () => { expect(absenceDetectee(ilYa(8), M)).toBe(true); });
  it("il y a 6 jours : non", () => { expect(absenceDetectee(ilYa(6), M)).toBe(false); });
  it("aucune activité (compte neuf) : non", () => { expect(absenceDetectee(null, M)).toBe(false); });
  it("dernière activité : la plus récente des trois", async () => {
    const deps = {
      derniereTacheCochee: vi.fn(async () => ilYa(20)),
      dernierMessage: vi.fn(async () => ilYa(9)),
      dernierEvenementPlanning: vi.fn(async () => null),
    };
    expect(await derniereActivite("u1", deps)).toEqual(ilYa(9));
    expect(deps.dernierMessage).toHaveBeenCalledWith("u1");
  });
  it("rien du tout : null", async () => {
    const vide = async () => null;
    expect(await derniereActivite("u1", { derniereTacheCochee: vide, dernierMessage: vide, dernierEvenementPlanning: vide })).toBeNull();
  });
});
