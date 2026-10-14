// server/services/profils-veille/analyse.test.ts
import { describe, it, expect, vi } from "vitest";
import { lancerAnalyse, finaliserAnalyse, type DepsAnalyse } from "./analyse";
import { cleFormat } from "@shared/profils-veille";

const profil = { id: 7, nom: "Coachs bien-être", description: "Coachs indépendantes" };
const maintenant = new Date("2026-10-18T06:00:00Z");
const AV = cleFormat("instagram", "carrousel", "avant_apres");

const fenetre = [
  ...["a", "b", "c"].map((cle, i) => ({ cle, compteId: i % 2 ? 1 : 2, plateforme: "instagram" as const, typeMedia: "carrousel" as const, structure: "avant_apres" as const, fort: true })),
  { cle: "d", compteId: 1, plateforme: "instagram" as const, typeMedia: "carrousel" as const, structure: "avant_apres" as const, fort: false },
  ...["e", "f", "g", "h", "i", "j"].map((cle, i) => ({ cle, compteId: 3, plateforme: "instagram" as const, typeMedia: "image" as const, structure: "liste" as const, fort: i === 0 })),
];

function deps(over: Partial<DepsAnalyse> = {}): DepsAnalyse {
  return {
    creerAnalyse: vi.fn(async () => 30),
    majAnalyse: vi.fn(async () => {}),
    depenseDuMois: vi.fn(async () => 0),
    postsAClasser: vi.fn(async () => [{ id: 1, typeMedia: "carrousel", legende: "Avant / après" }]),
    classer: vi.fn(async () => ({ resultats: [{ id: 1, structure: "avant_apres", accroche: "chiffre", autreLibelle: null }], coutEur: 0.01 })),
    enregistrerFormat: vi.fn(async () => {}),
    postsFenetre: vi.fn(async () => fenetre),
    exemples: vi.fn(async (_p: number, cles: string[]) => cles.slice(0, 3).map((c, i) => ({ cle: c, url: `https://ig/${c}`, legende: `légende ${c}`, compteId: i, accroche: "chiffre" }))),
    tendancesPrecedentes: vi.fn(async () => []),
    soumettre: vi.fn(async () => "lot_9"),
    lire: vi.fn(async () => null),
    enregistrerTendances: vi.fn(async () => {}),
    modeleRaisonnement: "smart", modeleRapide: "fast",
    ...over,
  };
}

describe("lancerAnalyse", () => {
  it("déjà lancée cette semaine : rien", async () => {
    const d = deps({ creerAnalyse: vi.fn(async () => null) });
    expect(await lancerAnalyse(d, profil, "2026-10-19", maintenant)).toBe("deja");
    expect(d.classer).not.toHaveBeenCalled();
  });
  it("plafond atteint : statut plafond, aucun appel IA", async () => {
    const d = deps({ depenseDuMois: vi.fn(async () => 10) });
    expect(await lancerAnalyse(d, profil, "2026-10-19", maintenant)).toBe("plafond");
    expect(d.majAnalyse).toHaveBeenCalledWith(30, expect.objectContaining({ statut: "plafond" }));
    expect(d.classer).not.toHaveBeenCalled();
  });
  it("classe les posts sans format, compte, soumet un lot pour chaque format retenu", async () => {
    const d = deps();
    expect(await lancerAnalyse(d, profil, "2026-10-19", maintenant)).toBe("lot_soumis");
    expect(d.enregistrerFormat).toHaveBeenCalledWith(1, { structure: "avant_apres", accroche: "chiffre", autreLibelle: null });
    const reqs = (d.soumettre as any).mock.calls[0][0];
    expect(reqs.map((r: any) => r.customId)).toEqual([AV]);
    expect(reqs[0].prompt).toContain("Carrousel avant/après");
    expect(reqs[0].model).toBe("smart");
    expect(d.majAnalyse).toHaveBeenLastCalledWith(30, expect.objectContaining({ statut: "lot_soumis", batchId: "lot_9", coutEur: 0.01 }));
  });
  it("aucun format au-dessus du seuil : statut rien, pas de lot (zéro tendance est normal)", async () => {
    const d = deps({ postsFenetre: vi.fn(async () => fenetre.filter((p) => p.structure !== "avant_apres")) });
    expect(await lancerAnalyse(d, profil, "2026-10-19", maintenant)).toBe("rien");
    expect(d.soumettre).not.toHaveBeenCalled();
  });
  it("le classement échoue : statut erreur, écrit, sans lot", async () => {
    const d = deps({ classer: vi.fn(async () => { throw new Error("structure_invalide: x"); }) });
    expect(await lancerAnalyse(d, profil, "2026-10-19", maintenant)).toBe("erreur");
    expect(d.majAnalyse).toHaveBeenLastCalledWith(30, expect.objectContaining({ statut: "erreur", erreur: expect.stringContaining("structure_invalide") }));
  });
  it("format retenu la semaine d'avant, encore ≥ 1 mais sous le seuil : fiche « en baisse », sans appel IA ni lot", async () => {
    const LI = cleFormat("instagram", "image", "liste");
    const p = (cle: string, compteId: number, typeMedia: any, structure: any, fort: boolean) => ({ cle, compteId, plateforme: "instagram" as const, typeMedia, structure, fort });
    // avant_apres 3 forts / 6 (lift 0,83) ; liste 3 forts / 4 mais un seul compte (lift 1,25, non retenue)
    const fen = [
      p("a", 1, "carrousel", "avant_apres", true), p("b", 2, "carrousel", "avant_apres", true), p("c", 1, "carrousel", "avant_apres", true),
      p("d", 1, "carrousel", "avant_apres", false), p("e", 2, "carrousel", "avant_apres", false), p("f", 2, "carrousel", "avant_apres", false),
      p("g", 3, "image", "liste", true), p("h", 3, "image", "liste", true), p("i", 3, "image", "liste", true), p("j", 3, "image", "liste", false),
    ];
    const d = deps({
      postsFenetre: vi.fn(async () => fen),
      tendancesPrecedentes: vi.fn(async () => [{ cle: LI, pourquoi: "p", commentAdapter: "c", exemples: ["u"], plateforme: "instagram", typeMedia: "image", structure: "liste", accrocheDominante: null } as any]),
    });
    expect(await lancerAnalyse(d, profil, "2026-10-19", maintenant)).toBe("lot_soumis");
    expect(d.soumettre).not.toHaveBeenCalled();
    const derniere = (d.majAnalyse as any).mock.calls.at(-1)[1];
    expect(derniere).toMatchObject({ statut: "lot_soumis", batchId: null });
    expect(derniere.retenus).toEqual([expect.objectContaining({ cle: LI, statut: "en_baisse", enBaisse: true, pourquoi: "p", exemples: ["u"] })]);
    // la finalisation écrit la fiche sans lire de lot
    expect(await finaliserAnalyse(d, { id: 30, profilId: 7, semaine: "2026-10-19", batchId: null, retenus: derniere.retenus, coutEur: 0 })).toBe("termine");
    expect(d.lire).not.toHaveBeenCalled();
    expect(d.enregistrerTendances).toHaveBeenCalledWith([expect.objectContaining({ cle: LI, statut: "en_baisse" })]);
  });
});

describe("lancerAnalyse : base du statut", () => {
  it("une fiche « en baisse » la semaine d'avant ne compte pas comme précédente (ni confirme, ni re-en baisse)", async () => {
    const d = deps({
      tendancesPrecedentes: vi.fn(async () => [{ cle: AV, statut: "en_baisse", pourquoi: "p", commentAdapter: "c", exemples: [], plateforme: "instagram", typeMedia: "carrousel", structure: "avant_apres", accrocheDominante: null } as any]),
    });
    expect(await lancerAnalyse(d, profil, "2026-10-19", maintenant)).toBe("lot_soumis");
    const derniere = (d.majAnalyse as any).mock.calls.at(-1)[1];
    expect(derniere.retenus).toEqual([expect.objectContaining({ cle: AV, statut: "nouveau" })]);
  });
});

describe("finaliserAnalyse", () => {
  const analyse = { id: 30, profilId: 7, semaine: "2026-10-19", batchId: "lot_9", coutEur: 0.01,
    retenus: [{ cle: AV, plateforme: "instagram", typeMedia: "carrousel", structure: "avant_apres", lift: 1.9, nbPosts: 4, nbForts: 3, nbComptes: 2, clesForts: ["a", "b", "c"], exemples: ["https://ig/a", "https://ig/b"], accrocheDominante: "chiffre", statut: "nouveau" }] };
  it("lot en cours : rien n'est écrit", async () => {
    const d = deps();
    expect(await finaliserAnalyse(d, analyse)).toBe("en_cours");
    expect(d.enregistrerTendances).not.toHaveBeenCalled();
  });
  it("lot terminé : une tendance par format réussi, coût ajouté, statut termine", async () => {
    const d = deps({ lire: vi.fn(async () => [{ customId: AV, texte: '{"pourquoi":"Le résultat se voit.","commentAdapter":"Montre une transformation."}', coutEur: 0.004 }]) });
    expect(await finaliserAnalyse(d, analyse)).toBe("termine");
    expect(d.enregistrerTendances).toHaveBeenCalledWith([expect.objectContaining({
      profilId: 7, semaine: "2026-10-19", cle: AV, lift: 1.9, nbForts: 3, nbComptes: 2, exemples: ["https://ig/a", "https://ig/b"],
      pourquoi: "Le résultat se voit.", commentAdapter: "Montre une transformation.", statut: "nouveau",
    })]);
    const maj = (d.majAnalyse as any).mock.calls.at(-1)[1];
    expect(maj.statut).toBe("termine");
    expect(maj.coutEur).toBeCloseTo(0.014);
  });
  it("lecture du lot ou écriture qui lève : statut erreur écrit sur l'analyse (plus retentée), jamais d'exception", async () => {
    for (const over of [{ lire: vi.fn(async () => { throw new Error("lot illisible"); }) }, {
      lire: vi.fn(async () => [{ customId: AV, texte: '{"pourquoi":"a","commentAdapter":"b"}', coutEur: 0 }]),
      enregistrerTendances: vi.fn(async () => { throw new Error("db"); }),
    }]) {
      const d = deps(over as any);
      expect(await finaliserAnalyse(d, analyse)).toBe("erreur");
      expect(d.majAnalyse).toHaveBeenLastCalledWith(30, expect.objectContaining({ statut: "erreur", erreur: expect.any(String) }));
    }
  });
  it("une réponse invalide n'écrit pas cette tendance et le dit", async () => {
    const d = deps({ lire: vi.fn(async () => [{ customId: AV, texte: "{}", coutEur: 0.004 }]) });
    expect(await finaliserAnalyse(d, analyse)).toBe("termine");
    expect(d.enregistrerTendances).toHaveBeenCalledWith([]);
    expect(d.majAnalyse).toHaveBeenCalledWith(30, expect.objectContaining({ erreur: expect.stringContaining(AV) }));
  });
});
