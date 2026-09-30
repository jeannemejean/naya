import { describe, it, expect } from "vitest";
import { parseDateRelative } from "./source";

const TODAY = new Date("2026-10-01T06:00:00Z");

describe("parseDateRelative — Google Actualités date en clair, pas en ISO", () => {
  it("lit « il y a 2 jours »", () => {
    const d = parseDateRelative("il y a 2 jours", TODAY);
    expect(d?.toISOString().slice(0, 10)).toBe("2026-09-29");
  });

  it("lit « il y a 3 heures » → aujourd'hui", () => {
    expect(parseDateRelative("il y a 3 heures", TODAY)?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("lit la forme anglaise « 2 days ago »", () => {
    expect(parseDateRelative("2 days ago", TODAY)?.toISOString().slice(0, 10)).toBe("2026-09-29");
  });

  it("lit une date absolue ISO", () => {
    expect(parseDateRelative("2026-09-28", TODAY)?.toISOString().slice(0, 10)).toBe("2026-09-28");
  });

  it("rend null sur une date absente ou incompréhensible — l'étage 1 écartera le candidat", () => {
    expect(parseDateRelative(undefined, TODAY)).toBeNull();
    expect(parseDateRelative("l'autre jour", TODAY)).toBeNull();
  });

  it("ne rend jamais une date future", () => {
    expect(parseDateRelative("2027-01-01", TODAY)).toBeNull();
  });
});
