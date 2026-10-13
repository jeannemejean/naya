import { describe, it, expect, vi } from "vitest";
import { lireSections, preparerRapport, type DepsRapport } from "./rediger";

const SECTIONS = { synthese: "Un bon mois.", realise: "4 posts.", resultats: "MER 6.", prochainesEtapes: "Tester un format." };
const entrees = {
  mesures: [{ mois: "2026-09", ca: 12000, nouveauxClients: 20, depenses: { paid_social: 2000 } }],
  contenus: [], scores: [], messages: [], leads: [], constats: [],
};
function deps(over: Partial<DepsRapport> = {}): DepsRapport {
  return {
    getProject: vi.fn(async () => ({ id: 7, name: "Maison X", projectKind: "client", clientName: "Maison X" })),
    getRapport: vi.fn(async () => undefined),
    lireEntrees: vi.fn(async () => entrees as any),
    nomAgence: vi.fn(async () => "Agence JMD"),
    garde: vi.fn(async () => null),
    ia: vi.fn(async () => JSON.stringify(SECTIONS)),
    enregistrer: vi.fn(async (_u, _p, mois, v) => ({ mois, statut: "brouillon", ...v }) as any),
    ...over,
  };
}

describe("lireSections", () => {
  it("lit les quatre textes, même entourés de texte ou de ```json", () => {
    expect(lireSections("Voici :\n```json\n" + JSON.stringify(SECTIONS) + "\n```")).toEqual(SECTIONS);
  });
  it("refuse une sortie illisible ou incomplète", () => {
    expect(lireSections("pas de json")).toBeNull();
    expect(lireSections(JSON.stringify({ synthese: "x" }))).toBeNull();
  });
});

describe("preparerRapport", () => {
  it("projet introuvable → introuvable ; projet perso → projet_perso ; aucun appel IA", async () => {
    const d1 = deps({ getProject: vi.fn(async () => undefined) });
    expect((await preparerRapport("u", 7, "2026-09", d1)).statut).toBe("introuvable");
    const d2 = deps({ getProject: vi.fn(async () => ({ id: 7, projectKind: "personal" })) });
    expect((await preparerRapport("u", 7, "2026-09", d2)).statut).toBe("projet_perso");
    expect(d1.ia).not.toHaveBeenCalled();
    expect(d2.ia).not.toHaveBeenCalled();
  });
  it("rapport déjà publié → jamais réécrit", async () => {
    const d = deps({ getRapport: vi.fn(async () => ({ statut: "publie" }) as any) });
    expect((await preparerRapport("u", 7, "2026-09", d)).statut).toBe("deja_publie");
    expect(d.ia).not.toHaveBeenCalled();
  });
  it("aucune donnée du mois → rien, aucun appel IA", async () => {
    const d = deps({ lireEntrees: vi.fn(async () => ({ ...entrees, mesures: [] }) as any) });
    expect((await preparerRapport("u", 7, "2026-09", d)).statut).toBe("rien");
    expect(d.garde).not.toHaveBeenCalled();
    expect(d.ia).not.toHaveBeenCalled();
  });
  it("garde de dépense refusée → refus, aucun appel", async () => {
    const d = deps({ garde: vi.fn(async () => ({ statut: "refus", resume: "budget" }) as any) });
    expect((await preparerRapport("u", 7, "2026-09", d)).statut).toBe("refus");
    expect(d.ia).not.toHaveBeenCalled();
  });
  it("brouillon : rédigé au client, chiffres du calcul transmis, enregistré", async () => {
    const d = deps();
    const r = await preparerRapport("u", 7, "2026-09", d);
    expect(r.statut).toBe("ok");
    const prompt = (d.ia as any).mock.calls[0][2] as string;
    expect(prompt).toContain("Maison X");
    expect(prompt).toContain("Agence JMD");
    expect(prompt).toMatch(/vouvoie/i);
    expect(prompt).toContain("12");
    expect(d.enregistrer).toHaveBeenCalledWith("u", 7, "2026-09", expect.objectContaining({ sections: SECTIONS }));
  });
  it("sortie IA illisible → erreur, rien d'écrit", async () => {
    const d = deps({ ia: vi.fn(async () => "bla") });
    expect((await preparerRapport("u", 7, "2026-09", d)).statut).toBe("illisible");
    expect(d.enregistrer).not.toHaveBeenCalled();
  });
  it("publié entre-temps (écriture refusée) → deja_publie", async () => {
    const d = deps({ enregistrer: vi.fn(async () => undefined) });
    expect((await preparerRapport("u", 7, "2026-09", d)).statut).toBe("deja_publie");
  });
});
