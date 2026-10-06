import { describe, it, expect } from "vitest";
import { refuserTache, type RefusDeps, type TacheRefusable, heureDeFin } from "./service";

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
    lireTache: async (id: number) => (id === 99 ? d.cree : t ?? undefined),
    enregistrerRetour: async (r: any) => { j.push("retour"); d.retour = r; },
    nomProjet: async () => "Marque X",
    ecrireSouvenir: async (i: any) => { j.push("souvenir"); d.souvenir = i; },
    lireDependances: async () => { j.push("deps"); return { prerequis: [], dependants: [] }; },
    refusRecents: async () => { j.push("recents"); return ["- x"]; },
    generer: async (i: any) => { j.push("generer"); d.genInput = i; return remp; },
    refuseePresente: true,
    // Modélise le garde de collision : la refusée occupe son créneau, le remplaçant est décalé.
    creerTache: async (r: any) => { j.push("creer"); d.creeEnvoye = r; d.cree = { id: 99, ...r, ...(d.refuseePresente && r.scheduledTime ? { scheduledTime: "10:45" } : {}) }; return d.cree; },
    ajouterDependance: async (u: string, a: number, b: number) => { j.push(`dep:${a}<-${b}`); return true; },
    supprimerTache: async (id: number) => { j.push(`suppr:${id}`); d.refuseePresente = false; },
    restaurerCreneau: async (_u: string, id: number, c: any) => { j.push(`restaure:${id}`); d.creneau = c; d.cree = { ...d.cree, ...c }; },
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
    expect(d.j).toEqual(["retour", "souvenir", "deps", "recents", "generer", "creer", "suppr:10", "restaure:99", "retasse:2026-10-08"]);
    expect(r.statut).toBe("refusee");
    expect(r.remplacement.id).toBe(99);
    expect(d.creeEnvoye).toMatchObject({ userId: "u1", projectId: 5, scheduledDate: "2026-10-08", scheduledTime: "10:00", source: "replacement", title: remp.title, estimatedDuration: 30 });
    expect(d.retour).toMatchObject({ feedbackType: "refused", reason: "not_useful", freeText: "Je préfère LinkedIn", timesRescheduled: 2, taskId: 10, projectId: 5 });
    expect(d.souvenir.projectId).toBeUndefined();
    expect(d.souvenir.texte).toContain("projet « Marque X »");
    expect(d.souvenir.texte).toContain("Je préfère LinkedIn");
  });
  it("le remplacement retrouve le créneau exact de la refusée malgré le garde de collision", async () => {
    const d = faire();
    const r: any = await refuserTache(d, entree);
    expect(d.creeEnvoye.scheduledTime).toBe("10:00");
    expect(r.remplacement.scheduledDate).toBe("2026-10-08");
    expect(r.remplacement.scheduledTime).toBe("10:00");
    expect(r.remplacement.scheduledEndTime).toBe("10:30");
  });
  it("heureDeFin plafonne à 23:59", () => {
    expect(heureDeFin("23:30", 60)).toBe("23:59");
    expect(heureDeFin(null, 30)).toBeNull();
  });
  it("tâche terminée: deja_terminee sans écriture", async () => {
    const d = faire({}, tache({ completed: true }));
    expect(await refuserTache(d, entree)).toEqual({ statut: "deja_terminee" });
    expect(d.j).toEqual([]);
  });
  it("reprend goalId, milestoneId, workflowGroup, priority", async () => {
    const d = faire({}, tache({ goalId: 7, milestoneId: 8, workflowGroup: "g", priority: 3 }));
    await refuserTache(d, entree);
    expect(d.creeEnvoye).toMatchObject({ goalId: 7, milestoneId: 8, workflowGroup: "g", priority: 3 });
  });
  it("pas de restauration sans heure", async () => {
    const d = faire({}, tache({ scheduledTime: null }));
    await refuserTache(d, entree);
    expect(d.j).not.toContain("restaure:99");
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
    expect(d.souvenir.texte).not.toContain("projet «");
    expect(d.creeEnvoye.projectId).toBeNull();
    expect(d.retour.projectId).toBeNull();
  });
  it("tâche sans date: remplacement sans date, retassage depuis aujourd'hui", async () => {
    const d = faire({}, tache({ scheduledDate: null, scheduledTime: null }));
    await refuserTache(d, entree);
    expect(d.creeEnvoye.scheduledDate).toBeNull();
    expect(d.creeEnvoye.scheduledTime).toBeNull();
    expect(d.retasseDepuis).toBe("2026-10-06");
  });
  it("tâche passée: retassage depuis aujourd'hui", async () => {
    const d = faire({}, tache({ scheduledDate: "2026-09-01" }));
    await refuserTache(d, entree);
    expect(d.retasseDepuis).toBe("2026-10-06");
  });
  it("souvenir transverse : pas de projectId, nom du projet dans le texte", async () => {
    const d = faire();
    await refuserTache(d, entree);
    expect(d.souvenir).not.toHaveProperty("projectId");
    expect(d.souvenir.texte).toBe("A refusé la tâche « Poster sur Instagram » (projet « Marque X », pas utile) : Je préfère LinkedIn");
  });
  it("nom du projet indisponible : souvenir sans mention du projet", async () => {
    const d = faire({ nomProjet: async () => { throw new Error("x"); } });
    await refuserTache(d, entree);
    expect(d.souvenir.texte).not.toContain("projet «");
  });
  it("événement Google Agenda : refusé sans aucune écriture", async () => {
    const d = faire({}, tache({ source: "gcal" }));
    expect(await refuserTache(d, entree)).toEqual({ statut: "evenement_agenda" });
    expect(d.j).toEqual([]);
  });
});
