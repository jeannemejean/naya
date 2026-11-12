// Le lien de chaque tâche vers son étape et son objectif (LienFil), joint aux routes des tâches.
// Pur pour lienDeTache ; dépendances injectées pour avecLiens : aucune requête réelle.
import { describe, it, expect, vi } from "vitest";

vi.mock("../../storage", () => ({ storage: {} }));
vi.mock("../../db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));

import { avecLiens, lienDeTache } from "./lien";
import type { CarteFil, EtapeCarte, ObjectifCarte } from "./carte";

const etape = (id: number, objectifId: number | null, faites: number, prevues: number): EtapeCarte =>
  ({ id, objectifId, projetId: 7, titre: `Étape ${id}`, pourquoi: null, statut: "active", ordre: 0, faites, prevues });

const objectif = (id: number, cible: string | null, dueDate: Date | null, etapes: EtapeCarte[]): ObjectifCarte =>
  ({ id, projetId: 7, titre: `Objectif ${id}`, successMode: "revenue", goalType: "monthly", cible, dueDate, etapes });

const carte: CarteFil = {
  objectifs: [
    objectif(1, "3 nouveaux clients", new Date("2026-12-31T12:00:00Z"), [etape(10, 1, 3, 7)]),
    objectif(2, null, null, []),
  ],
  chainesSansObjectif: new Map([[7, [etape(30, null, 0, 2)]]]),
  depuis: null,
};

describe("lienDeTache", () => {
  it("étape d'un objectif : étape, avancement et cible", () => {
    expect(lienDeTache(carte, { goalId: 1, milestoneId: 10 })).toEqual({
      objectifId: 1, objectifTitre: "Objectif 1", etapeId: 10, etapeTitre: "Étape 10",
      etapeFaites: 3, etapePrevues: 7, cible: "3 nouveaux clients d'ici fin décembre",
    });
  });

  it("l'étape fait foi : objectif retrouvé par l'étape même sans goalId", () => {
    expect(lienDeTache(carte, { goalId: null, milestoneId: 10 })?.objectifId).toBe(1);
  });

  it("objectif seul : pas d'étape", () => {
    expect(lienDeTache(carte, { goalId: 2, milestoneId: null })).toEqual({
      objectifId: 2, objectifTitre: "Objectif 2", etapeId: null, etapeTitre: null, etapeFaites: 0, etapePrevues: 0, cible: null,
    });
  });

  it("jalon d'une chaîne de projet + goalId : l'objectif seul", () => {
    expect(lienDeTache(carte, { goalId: 2, milestoneId: 30 })?.etapeId).toBeNull();
  });

  it("rien à relier : null (objectif inconnu ou non actif, aucune attache, tâche virtuelle)", () => {
    expect(lienDeTache(carte, { goalId: 99, milestoneId: null })).toBeNull();
    expect(lienDeTache(carte, { goalId: null, milestoneId: 30 })).toBeNull();
    expect(lienDeTache(carte, {})).toBeNull();
    expect(lienDeTache(carte, { goalId: 1, milestoneId: 10, _virtual: true })).toBeNull();
  });
});

describe("avecLiens", () => {
  const taches = [{ id: 1, goalId: 1, milestoneId: 10 }, { id: 2, goalId: null, milestoneId: null }];

  it("hors interrupteur : tâches rendues telles quelles, carte jamais chargée", async () => {
    const charger = vi.fn();
    const r = await avecLiens("u1", taches, { filActif: () => false, charger, depuis: async () => null });
    expect(r).toBe(taches);
    expect(charger).not.toHaveBeenCalled();
  });

  it("sous interrupteur : lien joint à chaque tâche (null si rien), carte chargée depuis la mise en route", async () => {
    const depuis = new Date("2026-11-12T00:00:00Z");
    const charger = vi.fn(async () => carte);
    const r = await avecLiens("u1", taches, { filActif: () => true, charger, depuis: async () => depuis });
    expect(charger).toHaveBeenCalledWith("u1", depuis);
    expect(r.map((x: any) => x.lien?.etapeId ?? null)).toEqual([10, null]);
    expect("lien" in r[1]).toBe(true);
  });

  it("carte en échec : tâches rendues telles quelles (jamais d'erreur sur la liste des tâches)", async () => {
    const r = await avecLiens("u1", taches, { filActif: () => true, charger: async () => { throw new Error("db"); }, depuis: async () => null });
    expect(r).toBe(taches);
  });
});
