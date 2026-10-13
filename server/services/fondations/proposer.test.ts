import { describe, it, expect, vi } from "vitest";
import { proposerFondations, type DepsProposer } from "./proposer";

const reponseIA = JSON.stringify({
  offre: { nom: "Coffret découverte", description: "3 cafés", pourquoi: "goûter sans risque" },
  motivations: [{ nom: "Rituel plaisir", angle: "le matin à soi", formats: ["coulisses"] }],
  kpis: [{ nom: "Abonnés actifs", etage: "business", frequence: "mensuel" }],
  plan: { maturite: "demarrage", briques: [{ cle: "organique_social", statut: "maintenant" }] },
});

function deps(over: Partial<DepsProposer> = {}, existant: any = undefined, relu: any = existant) {
  const ecrit: any[] = [];
  let lectures = 0;
  const d: DepsProposer = {
    storage: {
      getProject: vi.fn(async () => ({ id: 7, name: "Mouture" })),
      // 1re lecture : avant l'appel IA ; suivantes : juste avant l'écriture.
      getFondations: vi.fn(async () => (lectures++ === 0 ? existant : relu)),
      upsertFondations: vi.fn(async (_u, _p, patch) => { ecrit.push(patch); return { ...existant, ...patch }; }),
      getProjectProofs: vi.fn(async () => [{ clientLabel: "Café Lumière", citable: false, whatWasDone: "carte", result: "+20 %" }]),
    },
    garde: vi.fn(async () => null),
    ia: vi.fn(async () => reponseIA),
    ...over,
  };
  return { d, ecrit };
}

describe("proposerFondations", () => {
  it("projet introuvable", async () => {
    const { d } = deps({ storage: { ...deps().d.storage, getProject: vi.fn(async () => undefined) } });
    expect(await proposerFondations("u", 7, undefined, d)).toEqual({ statut: "introuvable" });
  });

  it("refus de la garde, sans appel IA", async () => {
    const { d } = deps({ garde: vi.fn(async () => ({ statut: "rien_a_faire" as const, resume: "Budget atteint" })) });
    expect(await proposerFondations("u", 7, undefined, d)).toEqual({ statut: "refus", raison: "Budget atteint" });
    expect(d.ia).not.toHaveBeenCalled();
  });

  it("propose toutes les sections non validées, statut « propose »", async () => {
    const { d, ecrit } = deps();
    const r = await proposerFondations("u", 7, undefined, d);
    expect(r.statut).toBe("ok");
    expect(ecrit[0].statuts).toEqual({ offre: "propose", motivations: "propose", kpis: "propose", plan: "propose" });
    expect(ecrit[0].offre.nom).toBe("Coffret découverte");
    // Client non citable : jamais nommé dans le prompt.
    const prompt = (d.ia as any).mock.calls[0][2] as string;
    expect(prompt).not.toContain("Café Lumière");
    expect(prompt).toContain("+20 %");
  });

  it("ne remplace jamais une section validée non demandée", async () => {
    const existant = { statuts: { offre: "valide" }, offre: { nom: "Essai gratuit", description: "", pourquoi: "", existe: true } };
    const { d, ecrit } = deps({}, existant);
    await proposerFondations("u", 7, undefined, d);
    expect(ecrit[0].offre).toBeUndefined();
    // Seuls les statuts des sections écrites sont envoyés : les autres ne sont jamais réécrits.
    expect(ecrit[0].statuts.offre).toBeUndefined();
    const prompt = (d.ia as any).mock.calls[0][2] as string;
    expect(prompt).toContain("Essai gratuit");
  });

  it("une section validée explicitement demandée est reproposée", async () => {
    const existant = { statuts: { offre: "valide", motivations: "valide" }, offre: { nom: "Essai" } };
    const { d, ecrit } = deps({}, existant);
    await proposerFondations("u", 7, ["offre"], d);
    expect(ecrit[0].offre.nom).toBe("Coffret découverte");
    expect(ecrit[0].statuts).toEqual({ offre: "propose" });
    expect(ecrit[0].motivations).toBeUndefined();
  });

  it("tout est validé et rien n'est demandé → rien, sans appel", async () => {
    const existant = { statuts: { offre: "valide", motivations: "valide", kpis: "valide", plan: "valide" } };
    const { d } = deps({}, existant);
    expect(await proposerFondations("u", 7, undefined, d)).toEqual({ statut: "rien" });
    expect(d.ia).not.toHaveBeenCalled();
  });

  it("réponse inexploitable → vide, rien n'est écrit", async () => {
    const { d, ecrit } = deps({ ia: vi.fn(async () => '{"offre":{"description":"sans nom"}}') });
    expect(await proposerFondations("u", 7, undefined, d)).toEqual({ statut: "vide" });
    expect(ecrit).toHaveLength(0);
  });

  it("garde ce qui est lisible quand une section est mauvaise", async () => {
    const { d, ecrit } = deps({ ia: vi.fn(async () => JSON.stringify({ offre: { nom: "Essai" }, plan: { maturite: "géant" } })) });
    const r = await proposerFondations("u", 7, ["offre", "plan"], d);
    expect(r.statut).toBe("ok");
    expect(ecrit[0].offre.nom).toBe("Essai");
    expect(ecrit[0].plan).toBeUndefined();
    expect(ecrit[0].statuts.plan).toBeUndefined();
  });

  it("une section validée PENDANT l'appel IA n'est pas écrasée (sauf demande explicite)", async () => {
    const relu = { statuts: { offre: "valide" }, offre: { nom: "Validée entre-temps" } };
    const { d, ecrit } = deps({}, undefined, relu);
    await proposerFondations("u", 7, undefined, d);
    expect(ecrit[0].offre).toBeUndefined();
    expect(ecrit[0].statuts.offre).toBeUndefined();
    expect(ecrit[0].motivations).toBeDefined();
  });

  it("reproposer les motivations : clés existantes transmises, pas présentées comme « à ne pas refaire »", async () => {
    const existant = {
      statuts: { motivations: "valide", offre: "valide" },
      offre: { nom: "OFFRE VALIDEE" },
      motivations: [{ cle: "rituel", nom: "Rituel plaisir" }],
    };
    const { d } = deps({}, existant);
    await proposerFondations("u", 7, ["motivations"], d);
    const prompt = (d.ia as any).mock.calls[0][2] as string;
    const valide = prompt.split("Déjà validé")[1]?.split("Motivations actuelles")[0] || "";
    expect(valide).toContain("OFFRE VALIDEE");
    expect(valide).not.toContain("Rituel plaisir");
    expect(prompt).toContain("- rituel : Rituel plaisir");
    expect(prompt).toMatch(/"cle"/);
  });
});
