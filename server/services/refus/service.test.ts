import { describe, it, expect } from "vitest";
import { refuserTache, type RefusDeps, type TacheRefusable } from "./service";

const tache = (o: Partial<TacheRefusable> = {}): TacheRefusable => ({
  id: 10, userId: "u1", title: "Poster sur Instagram", description: "d", type: "content", category: "trust",
  source: "generated", projectId: 5, scheduledDate: "2026-10-08", scheduledTime: "10:00",
  estimatedDuration: 45, learnedAdjustmentCount: 2, ...o,
});
const remp = { title: "Poster sur LinkedIn", description: "desc", type: "content", category: "trust", estimatedDuration: 30, activationPrompt: "go" };

function faire(over: Partial<RefusDeps> = {}, t: TacheRefusable | null = tache()) {
  const j: string[] = [];
  const d: any = {
    j,
    lireTache: async () => t ?? undefined,
    enregistrerRetour: async (r: any) => { j.push("retour"); d.retour = r; },
    ecrireSouvenir: async (i: any) => { j.push("souvenir"); d.souvenir = i; },
    lireDependances: async () => { j.push("deps"); return { prerequis: [], dependants: [] }; },
    refusRecents: async () => { j.push("recents"); return ["- x"]; },
    generer: async (i: any) => { j.push("generer"); d.genInput = i; return remp; },
    creerTache: async (r: any) => { j.push("creer"); d.cree = r; return { id: 99, ...r }; },
    ajouterDependance: async (u: string, a: number, b: number) => { j.push(`dep:${a}<-${b}`); return true; },
    supprimerTache: async (id: number) => { j.push(`suppr:${id}`); },
    retasser: async (u: string, f: string) => { j.push(`retasse:${f}`); d.retasseDepuis = f; },
    aujourdhui: () => "2026-10-06",
    ...over,
  };
  return d;
}
const entree = { userId: "u1", taskId: 10, raison: "not_useful" as const, freeText: "Je préfère LinkedIn" };

describe("refuserTache", () => {
  it("introuvable si absente, sans écriture", async () => {
    const d = faire({}, null);
    expect(await refuserTache(d, entree)).toEqual({ statut: "introuvable" });
    expect(d.j).toEqual([]);
  });
  it("introuvable si autre compte, sans écriture", async () => {
    const d = faire({}, tache({ userId: "autre" }));
    expect(await refuserTache(d, entree)).toEqual({ statut: "introuvable" });
    expect(d.j).toEqual([]);
  });
  it("ordre exact et remplacement au même créneau/projet/source", async () => {
    const d = faire();
    const r: any = await refuserTache(d, entree);
    expect(d.j).toEqual(["retour", "souvenir", "deps", "recents", "generer", "creer", "suppr:10", "retasse:2026-10-08"]);
    expect(r.statut).toBe("refusee");
    expect(r.remplacement.id).toBe(99);
    expect(d.cree).toMatchObject({ userId: "u1", projectId: 5, scheduledDate: "2026-10-08", scheduledTime: "10:00", source: "replacement", title: remp.title, estimatedDuration: 30 });
    expect(d.retour).toMatchObject({ feedbackType: "refused", reason: "not_useful", freeText: "Je préfère LinkedIn", timesRescheduled: 2, taskId: 10, projectId: 5 });
    expect(d.souvenir.projectId).toBe(5);
    expect(d.souvenir.texte).toContain("Je préfère LinkedIn");
  });
  it("pas de souvenir sans texte", async () => {
    const d = faire();
    await refuserTache(d, { ...entree, freeText: "  " });
    expect(d.j).not.toContain("souvenir");
  });
  it("dépendances transférées dans les deux sens, avant suppression", async () => {
    const d = faire({ lireDependances: async () => ({ prerequis: [1, 2], dependants: [3] }) });
    await refuserTache(d, entree);
    expect(d.j.filter((x: string) => x.startsWith("dep:"))).toEqual(["dep:99<-1", "dep:99<-2", "dep:3<-99"]);
    expect(d.j.indexOf("dep:3<-99")).toBeLessThan(d.j.indexOf("suppr:10"));
  });
  it("échec de génération: suppression, retassage, generation_failed", async () => {
    const d = faire({ generer: async () => null });
    expect(await refuserTache(d, entree)).toEqual({ statut: "refusee", remplacement: null, raison: "generation_failed" });
    expect(d.j).toEqual(["retour", "souvenir", "deps", "recents", "suppr:10", "retasse:2026-10-08"]);
  });
  it("échec souvenir non bloquant", async () => {
    const d = faire({ ecrireSouvenir: async () => { throw new Error("x"); } });
    const r: any = await refuserTache(d, entree);
    expect(r.remplacement.id).toBe(99);
  });
  it("échec création: refus valide sans remplacement, tâche refusée supprimée", async () => {
    const d = faire({ creerTache: async () => { throw new Error("x"); } });
    const r: any = await refuserTache(d, entree);
    expect(r).toEqual({ statut: "refusee", remplacement: null, raison: "generation_failed" });
    expect(d.j).toContain("suppr:10");
  });
  it("échec dépendance ou retassage non bloquant", async () => {
    const d = faire({
      lireDependances: async () => ({ prerequis: [1], dependants: [] }),
      ajouterDependance: async () => { throw new Error("x"); },
      retasser: async () => { throw new Error("x"); },
    });
    const r: any = await refuserTache(d, entree);
    expect(r.remplacement.id).toBe(99);
  });
  it("tâche sans projet", async () => {
    const d = faire({}, tache({ projectId: null }));
    await refuserTache(d, entree);
    expect(d.souvenir.projectId).toBeNull();
    expect(d.cree.projectId).toBeNull();
    expect(d.retour.projectId).toBeNull();
  });
  it("tâche sans date: remplacement sans date, retassage depuis aujourd'hui", async () => {
    const d = faire({}, tache({ scheduledDate: null, scheduledTime: null }));
    await refuserTache(d, entree);
    expect(d.cree.scheduledDate).toBeNull();
    expect(d.cree.scheduledTime).toBeNull();
    expect(d.retasseDepuis).toBe("2026-10-06");
  });
  it("tâche passée: retassage depuis aujourd'hui", async () => {
    const d = faire({}, tache({ scheduledDate: "2026-09-01" }));
    await refuserTache(d, entree);
    expect(d.retasseDepuis).toBe("2026-10-06");
  });
});
