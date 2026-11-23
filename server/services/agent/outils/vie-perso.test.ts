import { describe, it, expect, vi } from "vitest";

const actif = vi.fn((u: string) => u === "u1");
const lirePlan = vi.fn(async () => null);
vi.mock("../../vie-perso/deps", () => ({
  viePersoActivePour: (u: string) => actif(u),
  depsViePerso: { lirePlan: (...a: any[]) => (lirePlan as any)(...a) },
  storeViePerso: { listerActivites: async () => [] },
}));
vi.mock("../../vie-perso/service", () => ({}));
vi.mock("../propositions", () => ({
  outilAValider: (def: any) => ({ ...def, classe: "a_valider", aValider: { apercu: def.apercu, executer: def.executer } }),
}));

const { consulterViePerso, preparerRepasSemaine, planifierActiviteOutil } = await import("./vie-perso");
const ctx = (userId: string) => ({ userId, maintenant: new Date("2026-11-25T10:00:00Z"), fuseau: "Europe/Paris" });

describe("outils vie perso", () => {
  it("refusés sans l'option", async () => {
    expect((await consulterViePerso.executer(ctx("u2"), {})).pourModele).toEqual({ erreur: "option Vie perso inactive" });
    expect(await (preparerRepasSemaine as any).aValider.apercu(ctx("u2"), {})).toEqual({ erreur: "option Vie perso inactive" });
    expect(await (planifierActiviteOutil as any).aValider.apercu(ctx("u2"), { titre: "x" })).toEqual({ erreur: "option Vie perso inactive" });
  });
  it("préparer : par défaut la semaine prochaine (lundi)", async () => {
    const a = await (preparerRepasSemaine as any).aValider.apercu(ctx("u1"), {});
    expect(a.resume).toBe("Préparer les repas de la semaine du 2026-11-30");
    expect(a.changements[0].avant).toBeNull();
  });
  it("activité : titre requis, date vérifiée", async () => {
    expect(await (planifierActiviteOutil as any).aValider.apercu(ctx("u1"), { titre: " " })).toEqual({ erreur: "titre vide ou trop long" });
    expect(await (planifierActiviteOutil as any).aValider.apercu(ctx("u1"), { titre: "Feutrine", dateCible: "demain" })).toEqual({ erreur: "dateCible doit être AAAA-MM-JJ" });
    expect((await (planifierActiviteOutil as any).aValider.apercu(ctx("u1"), { titre: "Feutrine", avecQui: "Lou" })).resume).toBe("Planifier « Feutrine »");
  });
  it("consulter : les deux semaines, sans plan", async () => {
    const r: any = (await consulterViePerso.executer(ctx("u1"), {})).pourModele;
    expect(r.semaines.map((s: any) => s.semaine)).toEqual(["2026-11-23", "2026-11-30"]);
  });
});
