import { describe, it, expect } from "vitest";
import { prochainPassageApres } from "./temps";

describe("prochainPassageApres", () => {
  it("quotidienne : aujourd'hui à l'heure dite si elle n'est pas passée", () => {
    const r = prochainPassageApres("quotidienne", 5, new Date("2026-10-12T03:00:00Z"));
    expect(r.toISOString()).toBe("2026-10-12T05:00:00.000Z");
  });
  it("quotidienne : demain si l'heure est passée (ou exacte)", () => {
    expect(prochainPassageApres("quotidienne", 5, new Date("2026-10-12T05:00:00Z")).toISOString()).toBe("2026-10-13T05:00:00.000Z");
    expect(prochainPassageApres("quotidienne", 5, new Date("2026-10-12T14:30:00Z")).toISOString()).toBe("2026-10-13T05:00:00.000Z");
  });
  it("change de mois et d'année", () => {
    expect(prochainPassageApres("quotidienne", 5, new Date("2026-12-31T23:00:00Z")).toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });
  it("hebdomadaire : dans sept jours à l'heure dite", () => {
    expect(prochainPassageApres("hebdomadaire", 5, new Date("2026-10-12T14:30:00Z")).toISOString()).toBe("2026-10-19T05:00:00.000Z");
  });
  it("heure hors bornes ramenée entre 0 et 23", () => {
    expect(prochainPassageApres("quotidienne", 30, new Date("2026-10-12T03:00:00Z")).getUTCHours()).toBe(23);
  });
});
