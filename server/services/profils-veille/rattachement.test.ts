import { describe, it, expect, vi } from "vitest";
import { rattacherProjet, type DepsRattachement } from "./rattachement";

const projet = { userId: "u", projectId: 4, nom: "Lune", contexte: "Coach bien-être, Instagram", exclus: [] as number[], rattachementId: null };
function deps(over: Partial<DepsRattachement> = {}): DepsRattachement {
  return {
    garde: vi.fn(async () => null),
    catalogue: vi.fn(async () => [{ id: 1, nom: "Coachs bien-être", description: "d", criteres: {} }, { id: 2, nom: "Mode éthique", description: "d", criteres: {} }]),
    choisir: vi.fn(async () => ({ profilId: 1, confiance: 0.86, raison: "Coach indépendante." })),
    enregistrer: vi.fn(async () => {}),
    proposer: vi.fn(async () => ({ nom: "Céramistes", description: "Ateliers de céramique", criteres: { typesBusiness: ["artisanat"], cibles: [], motsCles: ["céramique"] }, requetes: ["céramiste atelier"] })),
    chercher: vi.fn(async () => ["https://www.instagram.com/terre.atelier/", "https://www.instagram.com/p/X/", "https://www.instagram.com/argile_co/"]),
    creerProposition: vi.fn(async () => 9),
    ...over,
  };
}

describe("rattacherProjet", () => {
  it("confiance ≥ 0,7 : rattaché (propose), avec la raison", async () => {
    const d = deps();
    expect(await rattacherProjet(d, projet)).toBe("rattache");
    expect(d.enregistrer).toHaveBeenCalledWith({ userId: "u", projectId: 4, profilId: 1, confiance: 0.86, raison: "Coach indépendante.", statut: "propose" });
  });
  it("exclut les profils refusés et ignore un id hors catalogue", async () => {
    const d = deps({ choisir: vi.fn(async () => ({ profilId: 1, confiance: 0.9, raison: "r" })) });
    await rattacherProjet(d, { ...projet, exclus: [1] });
    const cat = (d.choisir as any).mock.calls[0][0].catalogue;
    expect(cat.map((c: any) => c.id)).toEqual([2]);
    expect(d.proposer).toHaveBeenCalled(); // id 1 exclu → traité comme « aucun »
  });
  it("confiance faible : proposition de profil pour Jeanne, comptes Instagram trouvés, rattachement en attente", async () => {
    const d = deps({ choisir: vi.fn(async () => ({ profilId: 2, confiance: 0.4, raison: "r" })) });
    expect(await rattacherProjet(d, projet)).toBe("propose_a_jeanne");
    expect(d.creerProposition).toHaveBeenCalledWith(
      { nom: "Céramistes", description: "Ateliers de céramique", criteres: { typesBusiness: ["artisanat"], cibles: [], motsCles: ["céramique"] } },
      [{ plateforme: "instagram", compte: "terre.atelier", url: "https://www.instagram.com/terre.atelier/" }, { plateforme: "instagram", compte: "argile_co", url: "https://www.instagram.com/argile_co/" }],
    );
    expect(d.enregistrer).toHaveBeenCalledWith(expect.objectContaining({ profilId: 9, statut: "en_attente" }));
  });
  it("catalogue vide : proposition directe", async () => {
    const d = deps({ catalogue: vi.fn(async () => []) });
    expect(await rattacherProjet(d, projet)).toBe("propose_a_jeanne");
    expect(d.choisir).not.toHaveBeenCalled();
  });
  it("garde de dépense : rien n'est fait", async () => {
    const d = deps({ garde: vi.fn(async () => ({ refus: true })) });
    expect(await rattacherProjet(d, projet)).toBe("refus_garde");
    expect(d.choisir).not.toHaveBeenCalled();
  });
  it("erreur IA : erreur, rien d'enregistré", async () => {
    const d = deps({ choisir: vi.fn(async () => { throw new Error("x"); }) });
    expect(await rattacherProjet(d, projet)).toBe("erreur");
    expect(d.enregistrer).not.toHaveBeenCalled();
  });
});
