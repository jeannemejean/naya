import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tourProfilsVeille, scheduleProfilsVeille, _reinitialiserTour, type DepsTour } from "./planificateur";

function deps(over: Partial<DepsTour> = {}): DepsTour {
  return {
    projetsARattacher: vi.fn(async () => [{ userId: "u", projectId: 4 } as any]),
    rattacher: vi.fn(async () => "rattache"),
    profilsCollectables: vi.fn(async () => [{ id: 7, nom: "n", description: "d" }]),
    collecter: vi.fn(async () => ({ statut: "ok" }) as any),
    lancerAnalyse: vi.fn(async () => "lot_soumis" as const),
    analysesEnAttente: vi.fn(async () => [{ id: 30 } as any]),
    finaliser: vi.fn(async () => "termine" as const),
    rattachementsATrier: vi.fn(async () => [{ userId: "u", projectId: 4, profilId: 7, dernierTri: null }]),
    trier: vi.fn(async () => "ok" as const),
    purger: vi.fn(async () => 0),
    ...over,
  };
}

beforeEach(() => _reinitialiserTour());

describe("tourProfilsVeille", () => {
  it("mercredi 6 h UTC : collecte Instagram des profils collectables, pas d'analyse", async () => {
    const d = deps();
    await tourProfilsVeille(new Date("2026-10-14T06:00:00Z"), d);
    expect(d.collecter).toHaveBeenCalledWith(7, "instagram", expect.any(Date));
    expect(d.lancerAnalyse).not.toHaveBeenCalled();
  });
  it("mercredi 4 h UTC : pas encore de collecte", async () => {
    const d = deps();
    await tourProfilsVeille(new Date("2026-10-14T04:00:00Z"), d);
    expect(d.collecter).not.toHaveBeenCalled();
  });
  it("jeudi : aucune collecte", async () => {
    const d = deps();
    await tourProfilsVeille(new Date("2026-10-15T06:00:00Z"), d);
    expect(d.collecter).not.toHaveBeenCalled();
  });
  it("dimanche 6 h UTC : analyse pour la semaine qui commence le lendemain", async () => {
    const d = deps();
    await tourProfilsVeille(new Date("2026-10-18T06:00:00Z"), d);
    expect(d.lancerAnalyse).toHaveBeenCalledWith({ id: 7, nom: "n", description: "d" }, "2026-10-19", expect.any(Date));
    expect(d.purger).toHaveBeenCalled();
  });
  it("lundi 7 h UTC : rattachements, lots en attente, tris de la semaine en cours", async () => {
    const d = deps();
    await tourProfilsVeille(new Date("2026-10-19T07:00:00Z"), d);
    expect(d.rattacher).toHaveBeenCalledTimes(1);
    expect(d.finaliser).toHaveBeenCalled();
    expect(d.trier).toHaveBeenCalledTimes(1);
    expect(d.trier).toHaveBeenCalledWith({ userId: "u", projectId: 4, profilId: 7, dernierTri: null }, "2026-10-19", expect.any(Date));
  });
  it("une étape qui lève n'empêche pas les suivantes", async () => {
    const d = deps({ projetsARattacher: vi.fn(async () => { throw new Error("db"); }) });
    await tourProfilsVeille(new Date("2026-10-14T06:00:00Z"), d);
    expect(d.collecter).toHaveBeenCalled();
    expect(d.finaliser).toHaveBeenCalled();
  });
  it("rattachements : pas avant 5 h UTC", async () => {
    const d = deps();
    await tourProfilsVeille(new Date("2026-10-14T04:00:00Z"), d);
    expect(d.rattacher).not.toHaveBeenCalled();
    expect(d.projetsARattacher).not.toHaveBeenCalled();
  });
  it("rattachements : une seule fois par jour UTC, de nouveau le lendemain", async () => {
    const d = deps();
    await tourProfilsVeille(new Date("2026-10-14T07:00:00Z"), d);
    await tourProfilsVeille(new Date("2026-10-14T07:15:00Z"), d);
    expect(d.rattacher).toHaveBeenCalledTimes(1);
    await tourProfilsVeille(new Date("2026-10-15T07:00:00Z"), d);
    expect(d.rattacher).toHaveBeenCalledTimes(2);
  });
  it("tris : au plus une fois par heure", async () => {
    const d = deps();
    await tourProfilsVeille(new Date("2026-10-14T07:00:00Z"), d);
    await tourProfilsVeille(new Date("2026-10-14T07:15:00Z"), d);
    expect(d.trier).toHaveBeenCalledTimes(1);
    await tourProfilsVeille(new Date("2026-10-14T08:00:00Z"), d);
    expect(d.trier).toHaveBeenCalledTimes(2);
  });
});

describe("scheduleProfilsVeille", () => {
  const ancien = process.env.PROFILS_VEILLE_ROBOT;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers(); vi.restoreAllMocks();
    if (ancien === undefined) delete process.env.PROFILS_VEILLE_ROBOT; else process.env.PROFILS_VEILLE_ROBOT = ancien;
  });
  it("ne démarre pas sans PROFILS_VEILLE_ROBOT=on", () => {
    delete process.env.PROFILS_VEILLE_ROBOT;
    const si = vi.spyOn(globalThis, "setInterval");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    scheduleProfilsVeille();
    expect(si).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('[profils-veille] robot désactivé (PROFILS_VEILLE_ROBOT ≠ "on")');
  });
  it("démarre un intervalle de 15 min avec PROFILS_VEILLE_ROBOT=on", () => {
    process.env.PROFILS_VEILLE_ROBOT = "on";
    const si = vi.spyOn(globalThis, "setInterval");
    vi.spyOn(console, "log").mockImplementation(() => {});
    scheduleProfilsVeille();
    expect(si).toHaveBeenCalledWith(expect.any(Function), 15 * 60_000);
  });
});
