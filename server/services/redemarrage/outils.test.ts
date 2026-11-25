import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../../db", () => ({ db: {} }));
const sc = vi.hoisted(() => ({ enCours: vi.fn(), rattacher: vi.fn(), passer: vi.fn() }));
const pr = vi.hoisted(() => ({ proposerHorsConversation: vi.fn() }));
vi.mock("./seance", () => ({
  depsSeance: { enCours: sc.enCours },
  rattacherProposition: sc.rattacher,
  passerProjet: sc.passer,
}));
vi.mock("../agent/propositions", () => ({ proposerHorsConversation: pr.proposerHorsConversation }));
const { proposerBilanProjet, passerProjetOutil } = await import("./outils");

const ctx = { userId: "u1", maintenant: new Date("2026-11-25T09:00:00Z"), fuseau: "Europe/Paris" };
beforeEach(() => vi.clearAllMocks());

describe("outils de séance", () => {
  it("proposer_bilan_projet : refusé tant qu'elle n'a pas parlé de ce projet", async () => {
    sc.enCours.mockResolvedValue({ id: 1, userId: "u1", projetCourant: 2, projets: [{ projectId: 2, etat: "en_cours" }] });
    const r = await proposerBilanProjet.executer(ctx, { operations: [{ type: "note_projet", texte: "t" }] });
    expect(r.pourModele).toMatchObject({ erreur: "attends_son_recit" });
    expect(pr.proposerHorsConversation).not.toHaveBeenCalled();
  });
  it("proposer_bilan_projet : pour le projet COURANT de la séance, rattachée, rendue à l'écran", async () => {
    sc.enCours.mockResolvedValue({ id: 1, userId: "u1", projetCourant: 2, projets: [{ projectId: 2, etat: "en_cours", recit: true }] });
    pr.proposerHorsConversation.mockResolvedValue({ id: 31, resume: "Agence : 1 changement", changements: [], expireA: "x", selectionnable: true });
    const r = await proposerBilanProjet.executer(ctx, { operations: [{ type: "note_projet", texte: "t" }] });
    expect(pr.proposerHorsConversation).toHaveBeenCalledWith("u1", "appliquer_bilan_projet", { projectId: 2, operations: [{ type: "note_projet", texte: "t" }] }, ctx.maintenant, { fuseau: "Europe/Paris" });
    expect(sc.rattacher).toHaveBeenCalledWith(expect.objectContaining({ id: 1, projetCourant: 2 }), 31);
    expect(r.proposition?.id).toBe(31);
  });
  it("sans séance en cours : refus", async () => {
    sc.enCours.mockResolvedValue(undefined);
    const r = await proposerBilanProjet.executer(ctx, { operations: [] });
    expect(r.pourModele).toEqual({ erreur: "aucune_seance" });
  });
  it("aperçu refusé : l'erreur remonte au modèle, rien n'est rattaché", async () => {
    sc.enCours.mockResolvedValue({ id: 1, userId: "u1", projetCourant: 2, projets: [{ projectId: 2, etat: "en_cours", recit: true }] });
    pr.proposerHorsConversation.mockResolvedValue({ erreur: "tache_introuvable" });
    const r = await proposerBilanProjet.executer(ctx, { operations: [{ type: "cocher_tache", taskId: 9 }] });
    expect(r.pourModele).toEqual({ erreur: "tache_introuvable" });
    expect(sc.rattacher).not.toHaveBeenCalled();
  });
  it("passer_projet : avance", async () => {
    sc.passer.mockResolvedValue({ seance: { projetCourant: 4 }, termineeMaintenant: false });
    expect((await passerProjetOutil.executer(ctx, {})).pourModele).toEqual({ ok: true, termineeMaintenant: false, projetSuivant: 4 });
  });
});

describe("consulter_evaluation_reseaux", () => {
  it("lit l'évaluation depuis le début de l'absence de la séance", async () => {
    const { consulterEvaluationReseaux } = await import("./outils");
    sc.enCours.mockResolvedValue({ id: 1, userId: "u1", projetCourant: 2, bilan: { depuis: "2026-11-10T00:00:00.000Z" } });
    const r = await consulterEvaluationReseaux.executer(ctx, {}, { evaluer: async (u: string, d: Date) => ({ u, depuis: d.toISOString() }) } as any);
    expect(r.pourModele).toEqual({ u: "u1", depuis: "2026-11-10T00:00:00.000Z" });
  });
});
