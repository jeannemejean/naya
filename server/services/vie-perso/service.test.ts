import { describe, it, expect, vi } from "vitest";
import { preparerPlan, changerRepas, validerPlan, decouperActivite, planifierActivite, type DepsViePerso, type PlanLu } from "./service";
import { PROFIL_DEFAUT, type PlanRepas } from "@shared/vie-perso";

const repas = (titre: string, prep = 20) => ({ titre, detail: "d", kcal: 500, proteines: 30, lipides: 10, glucides: 40, variantes: [], preparationMin: prep });
const PLAN: PlanRepas = {
  jours: ["x1", "x2", "x3", "x4", "x5", "x6", "x7"].map((date) => ({ date, dejeuner: repas("Déj — bowl", 0), diner: repas("Dîner"), dessert: { ...repas(""), kcal: 0 } })),
  batch: { dureeMin: 90, etapes: [{ appareil: "Four", action: "Rôtir" }] },
  courses: [{ article: "Saumon", quantite: "x4", magasin: "Picard", rayon: "Surgelés", pour: "tous" }],
  regles: [], snacks: [],
};

function deps(o: Partial<DepsViePerso> = {}) {
  let plan: PlanLu | null = null;
  const d: DepsViePerso = {
    profil: vi.fn(async () => PROFIL_DEFAUT),
    membres: vi.fn(async () => []),
    recettes: vi.fn(async () => []),
    lirePlan: vi.fn(async () => plan),
    ecrirePlan: vi.fn(async (_u, _s, contenu, x) => { plan = { statut: x.statut, contenu, coches: x.garderCoches ? plan?.coches ?? [] : [] }; }),
    lireActivite: vi.fn(async () => null),
    ecrireActivite: vi.fn(async () => {}),
    supprimerTachesNonFaites: vi.fn(async () => 0),
    occupes: vi.fn(async () => new Map()),
    creerTaches: vi.fn(async (_u, _o, t) => t.length),
    generer: vi.fn(async () => ({ valeur: PLAN as any, coutEur: 0.05 })),
    maintenant: () => ({ jour: "2026-11-23", min: 9 * 60 }),
    ...o,
  };
  return d;
}

describe("preparerPlan", () => {
  it("génère, nettoie, recale les dates sur la semaine, écrit un brouillon", async () => {
    const d = deps();
    const r = await preparerPlan("u", "2026-11-30", d);
    expect(r).toEqual({ ok: true, coutEur: 0.05 });
    const [, semaine, contenu, o] = (d.ecrirePlan as any).mock.calls[0];
    expect(semaine).toBe("2026-11-30");
    expect(contenu.jours.map((j: any) => j.date)).toEqual(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]);
    expect(contenu.jours[0].dejeuner.titre).toBe("Déj, bowl");
    expect(o.statut).toBe("brouillon");
    expect(contenu.jours[0].dessert).toBeNull();
    expect((d.generer as any).mock.calls[0][0].rapide).toBe(false);
  });
});

describe("validerPlan", () => {
  it("remplace les tâches non faites du plan, place et crée, marque validé", async () => {
    const d = deps();
    await preparerPlan("u", "2026-11-30", d);
    const r = await validerPlan("u", "2026-11-30", d);
    expect(r.ok).toBe(true);
    expect(d.supprimerTachesNonFaites).toHaveBeenCalledWith("u", { plan: "2026-11-30" });
    // courses (sam. 28) + batch (dim. 29) + 7 dîners
    expect((d.creerTaches as any).mock.calls[0][2]).toHaveLength(9);
    expect((d.occupes as any).mock.calls[0].slice(1)).toEqual(["2026-11-28", "2026-12-06"]);
    expect((await d.lirePlan("u", "2026-11-30"))!.statut).toBe("valide");
    // la suppression a lieu avant la lecture des plages occupées
    expect((d.supprimerTachesNonFaites as any).mock.invocationCallOrder[0]).toBeLessThan((d.occupes as any).mock.invocationCallOrder[0]);
  });
  it("sans plan : erreur", async () => {
    expect(await validerPlan("u", "2026-11-30", deps())).toEqual({ ok: false, erreur: "plan_introuvable" });
  });
});

describe("changerRepas", () => {
  it("remplace le seul repas visé et la liste de courses, garde le statut", async () => {
    const d = deps();
    await preparerPlan("u", "2026-11-30", d);
    (d.generer as any).mockResolvedValueOnce({ valeur: { repas: repas("Nouveau"), courses: [{ article: "Thon", quantite: "1", magasin: "Aldi", rayon: "Épicerie", pour: "tous" }] }, coutEur: 0.01 });
    expect(await changerRepas("u", "2026-11-30", "2026-12-01", "diner", "plus léger", d)).toEqual({ ok: true });
    const p = (await d.lirePlan("u", "2026-11-30"))!;
    expect(p.contenu.jours[1].diner!.titre).toBe("Nouveau");
    expect(p.contenu.jours[0].diner!.titre).toBe("Dîner");
    expect(p.contenu.courses.map((c) => c.article)).toEqual(["Thon"]);
    expect(p.statut).toBe("brouillon");
  });
  it("jour hors plan ou repas inconnu : refus", async () => {
    const d = deps();
    await preparerPlan("u", "2026-11-30", d);
    expect(await changerRepas("u", "2026-11-30", "2027-01-01", "diner", null, d)).toEqual({ ok: false, erreur: "jour_invalide" });
    expect(await changerRepas("u", "2026-11-30", "2026-11-30", "gouter" as any, null, d)).toEqual({ ok: false, erreur: "repas_invalide" });
  });
});

describe("activités", () => {
  const act = { id: 3, titre: "Feutrine", description: "", avecQui: "", quand: "soir" as const, dateCible: null, statut: "a_planifier", contenu: null };
  it("découper : écrit le contenu généré", async () => {
    const contenu = { achats: [], etapes: [{ titre: "Couper", dureeMin: 30, ensemble: false }] };
    const d = deps({ lireActivite: vi.fn(async () => act), generer: vi.fn(async () => ({ valeur: contenu as any, coutEur: 0 })) });
    expect(await decouperActivite("u", 3, d)).toEqual({ ok: true });
    expect(d.ecrireActivite).toHaveBeenCalledWith("u", 3, { contenu, statut: "a_planifier" });
  });
  it("planifier sans découpage : refus ; avec : tâches créées", async () => {
    expect(await planifierActivite("u", 3, deps({ lireActivite: vi.fn(async () => act) }))).toEqual({ ok: false, erreur: "activite_non_decoupee" });
    const d = deps({ lireActivite: vi.fn(async () => ({ ...act, contenu: { achats: [], etapes: [{ titre: "Couper", dureeMin: 30, ensemble: false }] } })) });
    const r = await planifierActivite("u", 3, d);
    expect(r).toEqual({ ok: true, taches: 1, nonPlacees: [] });
    expect(d.supprimerTachesNonFaites).toHaveBeenCalledWith("u", { activite: 3 });
    expect((d.creerTaches as any).mock.calls[0][2][0]).toMatchObject({ jour: "2026-11-23", heure: "18:30" });
  });
});
