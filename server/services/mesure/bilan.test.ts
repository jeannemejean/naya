import { describe, it, expect, vi } from "vitest";
import { blocMesure, resumeBilan, executerBilan, routineBilanPour, type DepsBilan } from "./bilan";

const sept = { mois: "2026-09", ca: 10000, nouveauxClients: 20, commandes: 100, depenses: { paid_social: 1500, outils: 500 }, bilan: null, bilanLe: null, updatedAt: new Date("2026-10-01") };
const aout = { mois: "2026-08", ca: 8000, nouveauxClients: 25, commandes: 80, depenses: { paid_social: 1600, outils: 400 }, bilan: "BILAN AOUT", bilanLe: new Date("2026-09-02"), updatedAt: new Date("2026-09-01") };

describe("blocMesure", () => {
  it("vide sans registre", () => {
    expect(blocMesure([])).toBe("");
  });
  it("indicateurs des 3 derniers mois et dernier bilan", () => {
    const b = blocMesure([sept, aout] as any);
    expect(b).toContain("septembre 2026");
    expect(b).toContain("MER 5,0");
    expect(b).toContain("CAC 75");
    expect(b).toContain("BILAN AOUT");
    expect(b).not.toContain("null");
  });
});

describe("resumeBilan", () => {
  it("MER et CAC avec leur évolution", () => {
    expect(resumeBilan("2026-09", [sept, aout] as any)).toBe("Bilan de septembre 2026 prêt : MER 5,0 (+25 %), CAC 75 € (+17 %).");
  });
  it("sans dépenses : CA et nouveaux clients", () => {
    expect(resumeBilan("2026-09", [{ ...sept, depenses: {} }] as any)).toBe("Bilan de septembre 2026 prêt : CA 10 000 €, 20 nouveaux clients.");
  });
});

const routine = { id: 1, userId: "u", kind: "mesure_bilan", cible: { projectId: 7 } } as any;
function deps(lignes: any[] = [sept, aout], over: Partial<DepsBilan> = {}) {
  const d: DepsBilan = {
    storage: {
      getProject: vi.fn(async () => ({ id: 7 })),
      getMesures: vi.fn(async () => lignes),
      setBilanMesure: vi.fn(async () => {}),
      getFondations: vi.fn(async () => ({ statuts: { kpis: "valide" }, kpis: [{ nom: "Nouveaux clients", cible: "30 par mois" }] })),
    },
    garde: vi.fn(async () => null),
    ia: vi.fn(async () => "  Le MER monte.  "),
    maintenant: () => new Date("2026-10-02T05:00:00Z"),
    ...over,
  };
  return d;
}

describe("executerBilan", () => {
  it("projet disparu → désactiver", async () => {
    const d = deps(); (d.storage.getProject as any).mockResolvedValue(undefined);
    expect((await executerBilan(routine, d)).desactiver).toBe(true);
  });
  it("mois précédent pas saisi → rappel notifié, aucun appel", async () => {
    const d = deps([aout]);
    const r = await executerBilan(routine, d);
    expect(r).toMatchObject({ statut: "rien_a_faire", notifier: true });
    expect(r.resume).toContain("septembre 2026");
    expect(d.ia).not.toHaveBeenCalled();
    expect(d.garde).not.toHaveBeenCalled();
  });
  it("bilan déjà écrit et chiffres inchangés → rien, aucun appel", async () => {
    const d = deps([{ ...sept, bilan: "x", bilanLe: new Date("2026-10-01T12:00:00Z") }, aout]);
    expect((await executerBilan(routine, d)).statut).toBe("rien_a_faire");
    expect(d.ia).not.toHaveBeenCalled();
  });
  it("chiffres modifiés après le bilan → refait", async () => {
    const d = deps([{ ...sept, bilan: "x", bilanLe: new Date("2026-09-30") }, aout]);
    expect((await executerBilan(routine, d)).statut).toBe("ok");
  });
  it("le mois de comparaison (août) corrigé après le bilan de septembre → septembre est refait", async () => {
    const d = deps([
      { ...sept, updatedAt: new Date("2026-09-30"), bilan: "x", bilanLe: new Date("2026-10-01T12:00:00Z") },
      { ...aout, updatedAt: new Date("2026-10-01T15:00:00Z") },
    ]);
    const r = await executerBilan(routine, d);
    expect(r.statut).toBe("ok");
    expect(r.details).toMatchObject({ mois: "2026-09" });
  });
  it("garde refusée → rendue telle quelle", async () => {
    const d = deps(undefined, { garde: vi.fn(async () => ({ statut: "rien_a_faire" as const, resume: "Budget" })) });
    expect((await executerBilan(routine, d)).resume).toBe("Budget");
    expect(d.ia).not.toHaveBeenCalled();
  });
  it("écrit le bilan, notifie avec un résumé calculé", async () => {
    const d = deps();
    const r = await executerBilan(routine, d);
    expect(d.storage.setBilanMesure).toHaveBeenCalledWith("u", 7, "2026-09", "Le MER monte.", sept.updatedAt);
    expect(r).toMatchObject({ statut: "ok", notifier: true, resume: "Bilan de septembre 2026 prêt : MER 5,0 (+25 %), CAC 75 € (+17 %)." });
    expect(r.lien).toBe("/projects/7?onglet=mesure");
    const prompt = (d.ia as any).mock.calls[0][2] as string;
    expect(prompt).toContain("30 par mois");
    expect(prompt).toContain("2026-08");
  });
  it("réponse vide → erreur, rien n'est écrit", async () => {
    const d = deps(undefined, { ia: vi.fn(async () => "   ") });
    expect((await executerBilan(routine, d)).statut).toBe("erreur");
    expect(d.storage.setBilanMesure).not.toHaveBeenCalled();
  });
});

describe("executerBilan — relecture", () => {
  it("I2 : septembre saisi en retard (après le passage du 2 octobre) a son bilan au passage suivant de novembre", async () => {
    const d = deps([{ ...sept, updatedAt: new Date("2026-10-10") }, aout], { maintenant: () => new Date("2026-11-02T05:00:00Z") });
    const r = await executerBilan(routine, d);
    expect(d.storage.setBilanMesure).toHaveBeenCalledWith("u", 7, "2026-09", "Le MER monte.", expect.anything());
    expect(r.resume).toContain("septembre 2026");
    expect(r.resume).toContain("octobre 2026"); // rappel du mois manquant
  });
  it("M2 : le prompt n'inclut pas le mois en cours", async () => {
    const oct = { ...sept, mois: "2026-10", ca: 777 };
    const d = deps([oct, sept, aout]);
    await executerBilan(routine, d);
    expect((d.ia as any).mock.calls[0][2]).not.toContain("2026-10");
  });
  it("M3 : le bilan n'est écrit que si les chiffres lus n'ont pas changé (updatedAt transmis)", async () => {
    const d = deps();
    await executerBilan(routine, d);
    expect((d.storage.setBilanMesure as any).mock.calls[0][4]).toEqual(sept.updatedAt);
  });
});

describe("routineBilanPour", () => {
  it("mensuelle, le 2 à 5 h", () => {
    const r = routineBilanPour({ userId: "u", projectId: 7 }, new Date("2026-10-13T10:00:00Z"));
    expect(r).toMatchObject({ kind: "mesure_bilan", cadence: "mensuelle", cibleCle: "project:7", actif: true });
    expect(r.prochainPassage.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
});

describe("langue du compte", () => {
  it("compte en anglais : résumé du bilan et rappel en anglais", async () => {
    expect(resumeBilan("2026-09", [sept, aout], "en")).toMatch(/^September 2026 review ready: MER 5\.0 \(\+/);
    const d = deps([aout], { langue: vi.fn(async () => "en" as const) });
    const r = await executerBilan(routine, d);
    expect(r.resume).toBe("Tell me your September 2026 figures (revenue, new customers, spend), here or in Measure: I'll write your monthly review.");
  });
  it("compte en français : inchangé", () => {
    expect(resumeBilan("2026-09", [sept, aout])).toMatch(/^Bilan de septembre 2026 prêt : MER 5,0/);
  });
});
