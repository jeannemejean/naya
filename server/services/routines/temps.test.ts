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

describe("prochainPassageApres — mensuelle (le 2 du mois)", () => {
  it("le 2 du mois courant si l'heure n'est pas passée", () => {
    expect(prochainPassageApres("mensuelle", 5, new Date("2026-10-01T10:00:00Z")).toISOString()).toBe("2026-10-02T05:00:00.000Z");
    expect(prochainPassageApres("mensuelle", 5, new Date("2026-10-02T04:59:00Z")).toISOString()).toBe("2026-10-02T05:00:00.000Z");
  });
  it("le 2 du mois suivant sinon, y compris décembre → janvier", () => {
    expect(prochainPassageApres("mensuelle", 5, new Date("2026-10-02T05:00:00Z")).toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(prochainPassageApres("mensuelle", 5, new Date("2026-10-31T23:00:00Z")).toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(prochainPassageApres("mensuelle", 5, new Date("2026-12-15T00:00:00Z")).toISOString()).toBe("2027-01-02T05:00:00.000Z");
  });
});
