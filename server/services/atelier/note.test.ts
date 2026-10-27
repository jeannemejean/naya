import { describe, it, expect } from "vitest";
import { decisionDuMotif, lireNote, normaliserDecisionNote, promptNote, supprimerPostAtelier, traiterNote, type DepsNote, type PostNote } from "./note";

const brouillon = (o: Partial<PostNote> = {}): PostNote => ({
  id: 12, title: "Les 3 erreurs de rentrée", body: "Texte", platform: "instagram", scheduledFor: "2026-10-29T09:00:00Z",
  contentStatus: "draft", consigne: "L'idée", campaignId: 3, autoPost: false, postStatus: "pending", ...o,
});

function faire(post: PostNote | undefined = brouillon(), over: Partial<DepsNote> = {}) {
  const j: string[] = [];
  const d: DepsNote & { j: string[]; refus?: any; consigne?: string } = {
    j,
    lirePost: async () => post,
    garde: async () => null,
    decider: async () => null,
    autresSujets: async () => ["Board Automne"],
    devalider: async () => { j.push("devalider"); return { statut: "brouillon" }; },
    refaire: async (_u, _id, c) => { j.push("refaire"); d.consigne = c; return { statut: "redige", body: "Nouveau texte" }; },
    refuser: async (_u, _id, o) => { j.push(o.remplacer ? "remplacer" : "supprimer"); d.refus = o; return { statut: "refuse", remplacement: o.remplacer ? { id: 99, title: "Un autre sujet" } : null }; },
    ...over,
  };
  return d;
}

describe("lireNote", () => {
  it("un motif connu, une note, ou les deux ; jamais rien", () => {
    expect(lireNote({ motif: "deja_programme" })).toEqual({ motif: "deja_programme", note: "" });
    expect(lireNote({ note: "  trop   long " })).toEqual({ motif: null, note: "trop long" });
    expect(lireNote({})).toBeNull();
    expect(lireNote({ motif: "autre" })).toBeNull();
    expect(lireNote({ note: 3 })).toBeNull();
    expect(lireNote({ note: "x".repeat(2000) })!.note).toHaveLength(1000);
  });
});

describe("décision", () => {
  it("« déjà programmé » : remplacé, rien n'est mémorisé", () => {
    const d = decisionDuMotif("deja_programme", "sur Later");
    expect(d.action).toBe("remplacer");
    expect(d.souvenir).toBe(false);
    expect(d.consigne).toContain("déjà été programmé");
    expect(d.consigne).toContain("sur Later");
  });
  it("sans avis du modèle : réécrit selon la note", () => {
    expect(normaliserDecisionNote(null, "plus court")).toEqual({ action: "reecrire", consigne: "plus court", souvenir: false });
  });
  it("une réécriture ne va jamais dans la mémoire ; une consigne vide reprend la note", () => {
    expect(normaliserDecisionNote({ action: "reecrire", consigne: "", apprendre: true }, "moins vendeur"))
      .toEqual({ action: "reecrire", consigne: "moins vendeur", souvenir: false });
    expect(normaliserDecisionNote({ action: "remplacer", consigne: "Pas de promo", apprendre: true }, "n").souvenir).toBe(true);
  });
  it("le prompt donne le post, son texte et la note", () => {
    const p = promptNote(brouillon(), "déjà posté en story");
    expect(p).toContain("« Les 3 erreurs de rentrée » — instagram, prévu le 2026-10-29");
    expect(p).toContain("La note de l'utilisatrice : déjà posté en story");
  });
});

describe("traiterNote", () => {
  it("« déjà programmé » : remplacé sans appel au modèle, les sujets voisins sont évités", async () => {
    const d = faire(brouillon(), { decider: async () => { throw new Error("pas d'IA ici"); } });
    const r = await traiterNote(d, "u1", 12, { motif: "deja_programme", note: "" });
    expect(r).toEqual({ statut: "remplace", remplacement: { id: 99, title: "Un autre sujet" } });
    expect(d.refus).toMatchObject({ remplacer: true, souvenir: false });
    expect(d.refus.explication).toContain("« Board Automne »");
  });

  it("une note libre suit l'avis du modèle", async () => {
    const d = faire(brouillon(), { decider: async () => ({ action: "supprimer", consigne: "", apprendre: false }) });
    expect(await traiterNote(d, "u1", 12, { motif: null, note: "On a trop de posts cette semaine" })).toEqual({ statut: "supprime", remplacementEchoue: false });
    expect(d.j).toEqual(["supprimer"]);
  });

  it("le modèle en panne : la note sert de consigne de réécriture", async () => {
    const d = faire(brouillon(), { decider: async () => { throw new Error("529"); } });
    expect(await traiterNote(d, "u1", 12, { motif: null, note: "Plus court" })).toEqual({ statut: "reecrit", body: "Nouveau texte" });
    expect(d.consigne).toBe("Plus court");
  });

  it("un post validé redevient brouillon avant d'être réécrit", async () => {
    const d = faire(brouillon({ contentStatus: "ready", autoPost: true }), { decider: async () => ({ action: "reecrire", consigne: "Sans emoji", apprendre: false }) });
    await traiterNote(d, "u1", 12, { motif: null, note: "enlève les emojis" });
    expect(d.j).toEqual(["devalider", "refaire"]);
  });

  it("le remplaçant n'a pas pu être écrit : le post est retiré, et on le dit", async () => {
    const d = faire(brouillon(), { refuser: async () => ({ statut: "refuse", remplacement: null, raison: "generation_failed" }) });
    expect(await traiterNote(d, "u1", 12, { motif: "plus_actuel", note: "" })).toEqual({ statut: "supprime", remplacementEchoue: true });
  });

  it("publié, en cours de publication ou introuvable : rien n'est touché", async () => {
    for (const p of [brouillon({ publishedAt: new Date() }), brouillon({ postStatus: "posting" })]) {
      const d = faire(p);
      expect(await traiterNote(d, "u1", 12, { motif: "deja_programme", note: "" })).toEqual({ statut: "deja_publie" });
      expect(d.j).toEqual([]);
    }
    expect(await traiterNote(faire(brouillon(), { lirePost: async () => undefined }), "u1", 12, { motif: "deja_programme", note: "" })).toEqual({ statut: "introuvable" });
  });

  it("budget IA atteint : une note libre n'est pas lue", async () => {
    const d = faire(brouillon(), { garde: async () => ({ raison: "budget" }) });
    expect(await traiterNote(d, "u1", 12, { motif: null, note: "plus court" })).toEqual({ statut: "refus" });
    expect(d.j).toEqual([]);
  });
});

describe("supprimerPostAtelier", () => {
  it("supprime sans remplaçant et sans rien mémoriser", async () => {
    const d = faire();
    expect(await supprimerPostAtelier(d, "u1", 12)).toEqual({ statut: "supprime", remplacementEchoue: false });
    expect(d.refus).toEqual({ explication: null, remplacer: false, souvenir: false });
  });
});
