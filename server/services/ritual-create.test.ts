import { describe, it, expect } from "vitest";
import { validerRituel } from "./ritual-create";

describe("validerRituel", () => {
  const base = { title: "Valider les actus", startTime: "09:00", durationMinutes: 15 };
  it("par défaut : lun-ven, chaque semaine", () => {
    expect(validerRituel(base, "2026-11-25")).toEqual({
      ok: true, donnees: { projectId: null, title: "Valider les actus", days: "mon,tue,wed,thu,fri", startTime: "09:00", durationMinutes: 15, intervalWeeks: 1, anchorDate: "2026-11-25" },
    });
  });
  it("toutes les 2 semaines, ancre = aujourd'hui", () => {
    const r = validerRituel({ ...base, days: "mon", intervalWeeks: 2 }, "2026-11-25");
    expect(r).toMatchObject({ ok: true, donnees: { intervalWeeks: 2, anchorDate: "2026-11-25", days: "mon" } });
  });
  it("intervalle hors 1..8 : refusé", () => {
    expect(validerRituel({ ...base, intervalWeeks: 9 }, "2026-11-25")).toEqual({ ok: false, message: "intervalWeeks invalide (1 à 8)" });
    expect(validerRituel({ ...base, intervalWeeks: 0 }, "2026-11-25")).toMatchObject({ ok: false });
    expect(validerRituel({ ...base, intervalWeeks: 1.5 }, "2026-11-25")).toMatchObject({ ok: false });
  });
  it("reprend les refus existants", () => {
    expect(validerRituel({ ...base, title: " " }, "2026-11-25")).toMatchObject({ ok: false, message: "title requis" });
    expect(validerRituel({ ...base, startTime: "99:99" }, "2026-11-25")).toMatchObject({ ok: false });
    expect(validerRituel({ ...base, days: "lundi" }, "2026-11-25")).toMatchObject({ ok: false });
  });
});
