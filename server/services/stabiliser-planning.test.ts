import { describe, it, expect, vi } from "vitest";
import { stabiliserPlanning, calendrierDepuisPreferences, deplacementsAdmissibles, type DeplacementPlanning } from "./stabiliser-planning";

const mv = (id: number): DeplacementPlanning => ({ id, scheduledDate: "2026-10-07", scheduledTime: "10:00" });

// Fabrique les trois fonctions injectées : `calculs` est la suite des réponses de
// `calculerDeplacements` (une Error = le calcul lève ; au-delà de la liste : []).
function fabrique(calculs: Array<DeplacementPlanning[] | Error>, retasseParTour = 1) {
  let n = 0;
  const calculerDeplacements = vi.fn(async () => {
    const r = calculs[n++] ?? [];
    if (r instanceof Error) throw r;
    return r;
  });
  const appliquerDeplacements = vi.fn(async (_d: DeplacementPlanning[]) => {});
  const retasser = vi.fn(async () => retasseParTour);
  return { calculerDeplacements, appliquerDeplacements, retasser };
}

describe("stabiliserPlanning", () => {
  it("(a) aucun déplacement → un seul re-tassage, stable", async () => {
    const f = fabrique([[]], 3);
    const r = await stabiliserPlanning(f);
    expect(f.retasser).toHaveBeenCalledTimes(1);
    expect(f.appliquerDeplacements).not.toHaveBeenCalled();
    expect(r).toEqual({ tours: 1, retasses: 3, deplaces: 0, stable: true });
  });

  it("(b) un déplacement puis stable → appliqué une fois, deux calculs", async () => {
    const f = fabrique([[mv(1)], []]);
    const r = await stabiliserPlanning(f);
    expect(f.appliquerDeplacements).toHaveBeenCalledTimes(1);
    expect(f.appliquerDeplacements).toHaveBeenCalledWith([mv(1)]);
    expect(f.calculerDeplacements).toHaveBeenCalledTimes(2);
    expect(f.retasser).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ tours: 1, retasses: 1, deplaces: 1, stable: true });
  });

  it("(c) violation recréée par le re-tassage au tour 1, résolue au tour 2", async () => {
    const f = fabrique([[mv(1)], [mv(2)], []]);
    const r = await stabiliserPlanning(f);
    expect(f.appliquerDeplacements.mock.calls).toEqual([[[mv(1)]], [[mv(2)]]]);
    expect(f.retasser).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ tours: 2, retasses: 2, deplaces: 2, stable: true });
  });

  it("(d) violation perpétuelle → s'arrête à 5 tours, stable: false, sans lever", async () => {
    const f = fabrique([]);
    f.calculerDeplacements.mockImplementation(async () => [mv(1)]);
    const r = await stabiliserPlanning(f);
    expect(f.appliquerDeplacements).toHaveBeenCalledTimes(5);
    expect(f.retasser).toHaveBeenCalledTimes(5);
    expect(r).toEqual({ tours: 5, retasses: 5, deplaces: 5, stable: false });
  });

  it("(d bis) maxTours personnalisé respecté", async () => {
    const f = fabrique([]);
    f.calculerDeplacements.mockImplementation(async () => [mv(1)]);
    const r = await stabiliserPlanning({ ...f, maxTours: 2 });
    expect(f.retasser).toHaveBeenCalledTimes(2);
    expect(r.tours).toBe(2);
    expect(r.stable).toBe(false);
  });

  it("(e) calculerDeplacements qui lève → re-tasse quand même une fois, ne lève pas", async () => {
    const f = fabrique([new Error("db down")], 4);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await stabiliserPlanning(f);
    err.mockRestore();
    expect(f.retasser).toHaveBeenCalledTimes(1);
    expect(f.appliquerDeplacements).not.toHaveBeenCalled();
    expect(r).toEqual({ tours: 1, retasses: 4, deplaces: 0, stable: false });
  });

  it("(f) appliquerDeplacements qui lève → re-tasse quand même une fois, ne lève pas", async () => {
    const f = fabrique([[mv(1)]], 2);
    f.appliquerDeplacements.mockRejectedValue(new Error("update ko"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await stabiliserPlanning(f);
    err.mockRestore();
    expect(f.retasser).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ tours: 1, retasses: 2, deplaces: 0, stable: false });
  });

  it("(g) le calcul de contrôle qui lève après un tour → s'arrête sans lever", async () => {
    const f = fabrique([[mv(1)], new Error("boom")]);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await stabiliserPlanning(f);
    err.mockRestore();
    expect(f.retasser).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ tours: 1, retasses: 1, deplaces: 1, stable: false });
  });
});

describe("calendrierDepuisPreferences", () => {
  it("valeurs par défaut sans préférences", () => {
    const c = calendrierDepuisPreferences(undefined, 30);
    expect([...c.joursTravailles]).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    expect(c).toMatchObject({ debutJournee: "09:00", finJournee: "18:00", tamponMin: 10 });
  });

  it("reprend les préférences valides, tampon plafonné comme le re-tassage", () => {
    const c = calendrierDepuisPreferences({ workDays: " Mon,sat ", workDayStart: "08:30", workDayEnd: "17:00", bufferMin: 999 }, 30);
    expect([...c.joursTravailles]).toEqual(["mon", "sat"]);
    expect(c).toMatchObject({ debutJournee: "08:30", finJournee: "17:00", tamponMin: 30 });
  });

  it("tampon négatif → 0", () => {
    expect(calendrierDepuisPreferences({ bufferMin: -5 }, 30).tamponMin).toBe(0);
  });

  it("valeurs malformées → valeurs par défaut", () => {
    const c = calendrierDepuisPreferences({ workDays: "lundi,,", workDayStart: "9h", workDayEnd: "25:99", bufferMin: null }, 30);
    expect([...c.joursTravailles]).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    expect(c).toMatchObject({ debutJournee: "09:00", finJournee: "18:00", tamponMin: 10 });
  });

  it("début après la fin → les deux bornes par défaut", () => {
    const c = calendrierDepuisPreferences({ workDayStart: "19:00", workDayEnd: "10:00" }, 30);
    expect(c).toMatchObject({ debutJournee: "09:00", finJournee: "18:00" });
  });
});

describe("deplacementsAdmissibles", () => {
  const d = (id: number, date: string, h: string): DeplacementPlanning => ({ id, scheduledDate: date, scheduledTime: h });

  it("écarte une tâche du jour courant placée avant maintenant et toute date passée", () => {
    const r = deplacementsAdmissibles(
      [d(1, "2026-10-06", "10:00"), d(2, "2026-10-06", "15:00"), d(3, "2026-10-05", "16:00"), d(4, "2026-10-07", "09:00")],
      { aujourdhui: "2026-10-06", maintenantMin: 14 * 60, idsFixes: new Set() },
    );
    expect(r.map((x) => x.id)).toEqual([2, 4]);
  });

  it("garde un départ pile à maintenant", () => {
    const r = deplacementsAdmissibles([d(1, "2026-10-06", "14:00")], { aujourdhui: "2026-10-06", maintenantMin: 14 * 60, idsFixes: new Set() });
    expect(r).toHaveLength(1);
  });

  it("ne déplace jamais une tâche à créneau fixe (rituel)", () => {
    const r = deplacementsAdmissibles([d(1, "2026-10-07", "10:00"), d(2, "2026-10-07", "11:00")], { aujourdhui: "2026-10-06", maintenantMin: 0, idsFixes: new Set([1]) });
    expect(r.map((x) => x.id)).toEqual([2]);
  });
});
