import { describe, it, expect } from "vitest";
import { lireEtiquettes } from "./etiquetage";

describe("lireEtiquettes", () => {
  const ids = new Set([1, 2, 3]);
  const cles = new Set(["efficacite", "cadeau"]);

  it("garde les étiquettes valides, format inconnu → null", () => {
    const r = lireEtiquettes('ok {"etiquettes":[{"id":1,"angle":"efficacite","format":"demonstration"},{"id":2,"angle":"aucun","format":"danse"}]}', ids, cles);
    expect(r).toEqual([
      { id: 1, angle: "efficacite", formatCreatif: "demonstration" },
      { id: 2, angle: "aucun", formatCreatif: null },
    ]);
  });

  it("ignore les ids inconnus, les angles inconnus et les doublons", () => {
    const r = lireEtiquettes('{"etiquettes":[{"id":9,"angle":"cadeau"},{"id":3,"angle":"inventee"},{"id":1,"angle":"cadeau"},{"id":1,"angle":"efficacite"}]}', ids, cles);
    expect(r).toEqual([{ id: 1, angle: "cadeau", formatCreatif: null }]);
  });

  it("null si la réponse est illisible", () => {
    expect(lireEtiquettes("désolée", ids, cles)).toBeNull();
    expect(lireEtiquettes('{"autre":1}', ids, cles)).toBeNull();
  });
});

import { vi } from "vitest";
import { executerEtiquetage, routineEtiquetagePour, type DepsEtiquetage } from "./etiquetage";

const routine = { id: 1, userId: "u", kind: "fondations_etiquetage", cible: { projectId: 7 } } as any;
const fondationsValidees = {
  statuts: { motivations: "valide" },
  motivations: [{ cle: "efficacite", nom: "Efficacité" }, { cle: "cadeau", nom: "Cadeau" }],
};

function depsE(over: Partial<DepsEtiquetage> = {}, fond: any = fondationsValidees, contenus: any[] = [{ id: 1, title: "T1", body: "corps" }, { id: 2, title: "T2", body: "b" }]) {
  const ecrits: any[] = [];
  const d: DepsEtiquetage = {
    storage: {
      getProject: vi.fn(async () => ({ id: 7 })),
      getFondations: vi.fn(async () => fond),
      getContenusAEtiqueter: vi.fn(async () => contenus),
      etiqueterContenus: vi.fn(async (_u, rows) => { ecrits.push(...rows); return rows.length; }),
    },
    garde: vi.fn(async () => null),
    ia: vi.fn(async () => '{"etiquettes":[{"id":1,"angle":"efficacite","format":"demonstration"},{"id":2,"angle":"aucun"}]}'),
    ...over,
  };
  return { d, ecrits };
}

describe("executerEtiquetage", () => {
  it("projet disparu → désactiver", async () => {
    const { d } = depsE({ storage: { ...depsE().d.storage, getProject: vi.fn(async () => undefined) } });
    const r = await executerEtiquetage(routine, d);
    expect(r.desactiver).toBe(true);
  });

  it("motivations non validées → rien à faire, aucun appel", async () => {
    const { d } = depsE({}, { statuts: { motivations: "propose" }, motivations: fondationsValidees.motivations });
    const r = await executerEtiquetage(routine, d);
    expect(r.statut).toBe("rien_a_faire");
    expect(d.ia).not.toHaveBeenCalled();
  });

  it("aucun contenu à étiqueter → aucun appel, pas même la garde", async () => {
    const { d } = depsE({}, fondationsValidees, []);
    const r = await executerEtiquetage(routine, d);
    expect(r.statut).toBe("rien_a_faire");
    expect(d.garde).not.toHaveBeenCalled();
    expect(d.ia).not.toHaveBeenCalled();
  });

  it("garde refusée → rendue telle quelle", async () => {
    const { d } = depsE({ garde: vi.fn(async () => ({ statut: "rien_a_faire" as const, resume: "Budget" })) });
    expect((await executerEtiquetage(routine, d)).resume).toBe("Budget");
    expect(d.ia).not.toHaveBeenCalled();
  });

  it("étiquette et résume, sans notifier", async () => {
    const { d, ecrits } = depsE();
    const r = await executerEtiquetage(routine, d);
    expect(ecrits).toEqual([{ id: 1, angle: "efficacite", formatCreatif: "demonstration" }, { id: 2, angle: "aucun", formatCreatif: null }]);
    expect(r.statut).toBe("ok");
    expect(r.resume).toBe("2 contenus étiquetés : 1 Efficacité, 1 hors motivations.");
    expect(r.notifier).toBeFalsy();
    expect((d.ia as any).mock.calls[0][2]).toContain("Efficacité");
  });

  it("réponse illisible → erreur, rien n'est écrit", async () => {
    const { d, ecrits } = depsE({ ia: vi.fn(async () => "oups") });
    const r = await executerEtiquetage(routine, d);
    expect(r.statut).toBe("erreur");
    expect(ecrits).toHaveLength(0);
  });
});

describe("routineEtiquetagePour", () => {
  it("quotidienne, une par projet", () => {
    const r = routineEtiquetagePour({ userId: "u", projectId: 7 }, new Date("2026-10-13T10:00:00Z"));
    expect(r).toMatchObject({ kind: "fondations_etiquetage", cibleCle: "project:7", cadence: "quotidienne", heureUtc: 5, actif: true, cible: { projectId: 7 } });
    expect(r.prochainPassage.toISOString()).toBe("2026-10-14T05:00:00.000Z");
  });
});
