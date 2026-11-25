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
      envoisARelancer: vi.fn(async (userId: string, date: string) => envois.filter((e) => e.userId === userId && e.prochaineRelance === date)),
      tachesDuJour: vi.fn(async () => taches),
      creerTache: vi.fn(async (t: any) => { creees.push(t); taches.push({ ...t, id: 99 }); }),
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
  it("titre", () => {
    expect(titreRelance({ marque: "Sézane", objet: "X" })).toBe("Relancer Sézane : X");
  });
});

describe("retirerRelanceNonFaite", () => {
  it("retire la tâche non faite de l'ancienne date, garde une cochée et celles des autres", async () => {
    storage.getTasksInRange.mockResolvedValue([
      { id: 1, userId: "u1", source: "relance_envoi", title: "Relancer Sézane : X", completed: false },
      { id: 2, userId: "u1", source: "relance_envoi", title: "Relancer Sézane : X", completed: true },
      { id: 3, userId: "u1", source: "manual", title: "Relancer Sézane : X", completed: false },
      { id: 4, userId: "u2", source: "relance_envoi", title: "Relancer Sézane : X", completed: false },
    ]);
    expect(await retirerRelanceNonFaite("u1", { marque: "Sézane", objet: "X" }, "2026-11-27")).toBe(1);
    expect(storage.deleteTask).toHaveBeenCalledTimes(1);
    expect(storage.deleteTask).toHaveBeenCalledWith(1);
  });
});
