import { describe, it, expect, vi } from "vitest";
import { proposerListe, type DepsProposer } from "./proposer";

const projet = { id: 7, userId: "u1", name: "Lune", category: "bougies artisanales" };
const reponse = JSON.stringify({
  marque: { nom: "Lune", site: "lune.fr" },
  concurrents: [{ nom: "Soleil", site: "soleil.fr" }, { nom: "Étoile" }],
  requetes_voc: ["site:reddit.com bougie parfumée avis"],
  mots_cles: ["bougie artisanale lyon"],
  prompts_geo: ["Quelle bougie artisanale offrir ?"],
});

function deps(over: Partial<DepsProposer> = {}): DepsProposer {
  const items: any[] = [{ id: 1, type: "concurrent", libelle: "Étoile", statut: "ecarte" }];
  return {
    storage: {
      getProject: vi.fn(async (id: number, u: string) => (id === 7 && u === "u1" ? projet : undefined)),
      getVeilleItems: vi.fn(async () => items),
      createVeilleItems: vi.fn(async (rows: any[]) => rows.map((r, i) => ({ id: 10 + i, ...r }))),
    },
    garde: vi.fn(async () => null),
    serpConfigure: () => true,
    chercher: vi.fn(async () => [{ link: "https://soleil.fr", title: "Soleil — bougies" }]),
    ia: vi.fn(async () => reponse),
    ...over,
  } as DepsProposer;
}

describe("proposerListe", () => {
  it("projet introuvable ou d'une autre utilisatrice", async () => {
    const d = deps();
    expect((await proposerListe("u2", 7, d)).statut).toBe("introuvable");
    expect(d.ia).not.toHaveBeenCalled();
  });
  it("garde refusée : aucun appel payant", async () => {
    const d = deps({ garde: vi.fn(async () => ({ statut: "rien_a_faire" as const, resume: "Budget du mois atteint" })) });
    const r = await proposerListe("u1", 7, d);
    expect(r).toEqual({ statut: "refus", raison: "Budget du mois atteint" });
    expect(d.chercher).not.toHaveBeenCalled();
    expect(d.ia).not.toHaveBeenCalled();
  });
  it("ancre la proposition sur de vrais résultats Google, puis enregistre sans doublon ni élément écarté", async () => {
    const d = deps();
    const r = await proposerListe("u1", 7, d);
    expect(r.statut).toBe("ok");
    const prompt = (d.ia as any).mock.calls[0][2];
    expect(prompt).toContain("https://soleil.fr");
    const rows = (d.storage.createVeilleItems as any).mock.calls[0][0];
    expect(rows.map((x: any) => x.libelle)).toEqual(["Lune", "Soleil", "site:reddit.com bougie parfumée avis", "bougie artisanale lyon", "Quelle bougie artisanale offrir ?"]);
    expect(rows.every((x: any) => x.userId === "u1" && x.projectId === 7 && x.statut === "propose")).toBe(true);
  });
  it("une recherche en panne n'empêche pas la proposition", async () => {
    const d = deps({ chercher: vi.fn(async () => { throw new Error("HTTP 401"); }) });
    expect((await proposerListe("u1", 7, d)).statut).toBe("ok");
  });
  it("réponse illisible de l'IA : rien d'enregistré, erreur lisible", async () => {
    const d = deps({ ia: vi.fn(async () => "désolée") });
    const r = await proposerListe("u1", 7, d);
    expect(r.statut).toBe("vide");
    expect(d.storage.createVeilleItems).not.toHaveBeenCalled();
  });
});
