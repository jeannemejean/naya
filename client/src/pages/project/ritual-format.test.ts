import { describe, it, expect } from "vitest";
import { formatDays, formatRythme } from "./ritual-format";

describe("formatDays", () => {
  it("résume la semaine de travail", () => {
    expect(formatDays("mon,tue,wed,thu,fri")).toBe("du lun au ven");
  });

  it("résume la semaine complète", () => {
    expect(formatDays("mon,tue,wed,thu,fri,sat,sun")).toBe("tous les jours");
  });

  it("liste les jours épars", () => {
    expect(formatDays("mon,wed,fri")).toBe("lun · mer · ven");
  });

  it("tolère espaces et majuscules", () => {
    expect(formatDays("Mon, Wed")).toBe("lun · mer");
  });
});

describe("formatRythme", () => {
  it("chaque semaine : les jours seuls", () => {
    expect(formatRythme("mon", 1)).toBe("lun");
    expect(formatRythme("mon", null)).toBe("lun");
  });
  it("toutes les N semaines", () => {
    expect(formatRythme("mon", 2)).toBe("lun, toutes les 2 semaines");
  });
});
