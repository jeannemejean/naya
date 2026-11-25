import { describe, it, expect, vi, beforeEach } from "vitest";

const s = vi.hoisted(() => ({ createRitual: vi.fn(), fixOverlappingTasks: vi.fn(async () => 0) }));
const m = vi.hoisted(() => ({ materializeRituals: vi.fn(async () => 1) }));
vi.mock("../storage", () => ({ storage: s }));
vi.mock("./ritual-materialize", () => m);

const { validerRituel, dateLocale, materialiserQuinzaine, creerRituelEtMaterialiser } = await import("./ritual-create");

beforeEach(() => vi.clearAllMocks());

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

describe("dates des créneaux : heure de Paris, pas celle du serveur", () => {
  it("23 h 30 UTC le 25 nov. = déjà le 26 à Paris", () => {
    expect(dateLocale(new Date("2026-11-25T23:30:00Z"))).toBe("2026-11-26");
  });
  it("création à 23 h 30 UTC : ancre et 14 jours comptés depuis le jour de Paris", async () => {
    s.createRitual.mockResolvedValue({ id: 8 });
    await creerRituelEtMaterialiser("u1", { projectId: null, title: "Actus", days: "mon", startTime: "09:00", durationMinutes: 15, intervalWeeks: 1, anchorDate: "2026-11-26" }, new Date("2026-11-25T23:30:00Z"));
    expect(m.materializeRituals).toHaveBeenCalledTimes(14);
    expect(m.materializeRituals.mock.calls[0]).toEqual(["u1", "2026-11-26"]);
    expect(m.materializeRituals.mock.calls[13]).toEqual(["u1", "2026-12-09"]);
    expect(s.fixOverlappingTasks).toHaveBeenCalledWith("u1", "2026-11-26");
  });
  it("quinzaine à cheval sur le changement d'heure : aucun jour sauté ni doublé", async () => {
    await materialiserQuinzaine("u1", "2026-10-20");
    const jours = m.materializeRituals.mock.calls.map((c: any[]) => c[1]);
    expect(jours).toHaveLength(14);
    expect(new Set(jours).size).toBe(14);
    expect(jours).toContain("2026-10-25");
    expect(jours.at(-1)).toBe("2026-11-02");
  });
});
