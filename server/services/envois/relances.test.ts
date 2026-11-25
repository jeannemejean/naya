import { describe, it, expect, vi } from "vitest";
vi.mock("../../db", () => ({ db: {} }));
const storage = { getTasksInRange: vi.fn(), deleteTask: vi.fn(async () => {}) };
vi.mock("../../storage", () => ({ storage }));
const { materializeRelances, titreRelance, retirerRelanceNonFaite } = await import("./relances");

const envoi = (o: any = {}) => ({ id: 1, userId: "u1", projectId: 4, marque: "Sézane", objet: "Campagne printemps", statut: "envoye", prochaineRelance: "2026-11-30", ...o });

function deps(envois: any[], taches: any[] = []) {
  const creees: any[] = [];
  return {
    creees,
    d: {
      envoisARelancer: vi.fn(async (userId: string, date: string) => envois.filter((e) => e.userId === userId && e.prochaineRelance <= date)),
      tachesDeRelance: vi.fn(async () => taches),
      creerTache: vi.fn(async (t: any) => { creees.push(t); taches.push({ ...t, id: 99 }); }),
      marquerRelanceCreee: vi.fn(async (_u: string, id: number, jour: string) => { const e = envois.find((x) => x.id === id); if (e) e.relanceCreeePour = jour; }),
    },
  };
}

describe("materializeRelances", () => {
  it("relance due aujourd'hui : une tâche courte, rattachée au projet", async () => {
    const { d, creees } = deps([envoi()]);
    expect(await materializeRelances("u1", "2026-11-30", d)).toBe(1);
    expect(creees[0]).toMatchObject({
      userId: "u1", projectId: 4, title: "Relancer Sézane : Campagne printemps", scheduledDate: "2026-11-30",
      estimatedDuration: 15, source: "relance_envoi", schedulingMode: "flexible",
    });
  });
  it("idempotente", async () => {
    const { d } = deps([envoi()]);
    await materializeRelances("u1", "2026-11-30", d);
    expect(await materializeRelances("u1", "2026-11-30", d)).toBe(0);
  });
  it("statut réponse : rien", async () => {
    const { d } = deps([envoi({ statut: "reponse" })]);
    expect(await materializeRelances("u1", "2026-11-30", d)).toBe(0);
  });
  it("l'envoi d'une autre : rien", async () => {
    const { d } = deps([envoi({ userId: "u2" })]);
    expect(await materializeRelances("u1", "2026-11-30", d)).toBe(0);
  });
  it("relance oubliée (jour non ouvert) : rattrapée le jour suivant, une seule fois", async () => {
    const { d, creees } = deps([envoi({ prochaineRelance: "2026-11-27" })]);
    expect(await materializeRelances("u1", "2026-11-30", d)).toBe(1);
    expect(creees[0].scheduledDate).toBe("2026-11-30");
    expect(await materializeRelances("u1", "2026-12-01", d)).toBe(0);
  });
  it("relance déjà faite (cochée) depuis la date prévue : pas recréée", async () => {
    const { d } = deps([envoi()], [{ id: 5, title: "Relancer Sézane : Campagne printemps", source: "relance_envoi", completed: true, scheduledDate: "2026-11-30" }]);
    expect(await materializeRelances("u1", "2026-12-02", d)).toBe(0);
  });
  it("tâche de relance supprimée à la main : ne revient pas", async () => {
    const taches: any[] = [];
    const { d } = deps([envoi()], taches);
    expect(await materializeRelances("u1", "2026-11-30", d)).toBe(1);
    taches.length = 0; // elle la supprime
    expect(await materializeRelances("u1", "2026-12-01", d)).toBe(0);
  });
  it("nouvelle date de relance après une relance supprimée : recréée", async () => {
    const taches: any[] = [];
    const e = envoi();
    const { d } = deps([e], taches);
    await materializeRelances("u1", "2026-11-30", d);
    taches.length = 0;
    e.prochaineRelance = "2026-12-07";
    expect(await materializeRelances("u1", "2026-12-07", d)).toBe(1);
  });
  it("titre", () => {
    expect(titreRelance({ marque: "Sézane", objet: "X" })).toBe("Relancer Sézane : X");
  });
});

describe("retirerRelanceNonFaite", () => {
  it("retire la tâche non faite (quelle que soit sa date), garde une cochée et celles des autres", async () => {
    storage.getTasksInRange.mockResolvedValue([
      { id: 1, userId: "u1", source: "relance_envoi", title: "Relancer Sézane : X", completed: false },
      { id: 2, userId: "u1", source: "relance_envoi", title: "Relancer Sézane : X", completed: true },
      { id: 3, userId: "u1", source: "manual", title: "Relancer Sézane : X", completed: false },
      { id: 4, userId: "u2", source: "relance_envoi", title: "Relancer Sézane : X", completed: false },
    ]);
    expect(await retirerRelanceNonFaite("u1", { marque: "Sézane", objet: "X" }, { tachesDeRelance: async () => (await storage.getTasksInRange()) as any })).toBe(1);
    expect(storage.deleteTask).toHaveBeenCalledTimes(1);
    expect(storage.deleteTask).toHaveBeenCalledWith(1);
  });
});
