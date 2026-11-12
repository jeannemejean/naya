// Priorité des tâches clés : pur, aucune base. Deux objectifs : A (échéance proche, urgent) et B (lointain).
import { describe, it, expect, vi } from "vitest";

vi.mock("../../storage", () => ({ storage: {} }));
vi.mock("../../db", () => ({ db: {}, pool: { query: vi.fn(), on: vi.fn() } }));

import { classerTachesCles, type EcheanceProche } from "./priorite";
import type { CarteFil, EtapeCarte, ObjectifCarte } from "./carte";

const AUJOURDHUI = "2026-11-12";

const etape = (id: number, objectifId: number, faites: number, prevues: number, statut = "active"): EtapeCarte =>
  ({ id, objectifId, projetId: 7, titre: `Étape ${id}`, pourquoi: `Pourquoi étape ${id}`, statut, ordre: 0, faites, prevues });
const objectif = (id: number, dueDate: Date | null, etapes: EtapeCarte[]): ObjectifCarte =>
  ({ id, projetId: 7, titre: `Objectif ${id}`, successMode: "revenue", goalType: "monthly", cible: null, dueDate, etapes });

// A : échéance dans 10 jours, étape 10 presque franchie (6/7) ; étape 11 verrouillée.
// B : échéance dans 200 jours, étape 20 à 1/10.
const carte: CarteFil = {
  objectifs: [
    objectif(1, new Date("2026-11-22T12:00:00Z"), [etape(10, 1, 0, 3), etape(11, 1, 0, 4, "locked")]),
    objectif(2, new Date("2027-05-30T12:00:00Z"), [etape(20, 2, 1, 10)]),
  ],
  chainesSansObjectif: new Map(),
  depuis: null,
};

let n = 0;
const tache = (p: Record<string, unknown>): any =>
  ({ id: ++n, title: `T${n}`, priority: 2, completed: false, archivedAt: null, taskEnergyType: null, goalId: null, milestoneId: null, pourquoi: null, ...p });
const ids = (r: { tacheId: number }[]) => r.map((x) => x.tacheId);

describe("classerTachesCles", () => {
  it("journée vide : []", () => {
    expect(classerTachesCles([], carte, [], null, AUJOURDHUI)).toEqual([]);
  });

  it("ignore les tâches faites ou archivées", () => {
    const t = [tache({ id: 1, completed: true, goalId: 1 }), tache({ id: 2, archivedAt: new Date(), goalId: 1 })];
    expect(classerTachesCles(t, carte, [], null, AUJOURDHUI)).toEqual([]);
  });

  it("ordre attendu sur 6 tâches et 2 objectifs, 3 gardées", () => {
    const t = [
      tache({ id: 1, goalId: 2, milestoneId: 20 }),                 // B seule : urgence faible
      tache({ id: 2, goalId: 1, milestoneId: 10 }),                 // A, étape à 3 pour franchir ... (3 restantes : pas de bonus)
      tache({ id: 3, goalId: 1, milestoneId: 10, priority: 1 }),    // A + priorité 1
      tache({ id: 4, goalId: 1, milestoneId: 10 }),                 // A + échéance
      tache({ id: 5, goalId: 2, milestoneId: 20, priority: 1 }),    // B + priorité 1
      tache({ id: 6 }),                                             // sans objectif
    ];
    const r = classerTachesCles(t, carte, [{ tacheId: 4, date: "2026-11-13" }], null, AUJOURDHUI);
    expect(ids(r)).toEqual([4, 3, 5]);
    expect(r[0].score).toBeGreaterThan(r[1].score);
    expect(r[0].lien?.objectifId).toBe(1);
    expect(r[0].lien?.etapeTitre).toBe("Étape 10");
    expect(r[0].pourquoi).toBe("Pourquoi étape 10");
  });

  it("+25 quand l'étape active est à au plus 2 tâches de franchir", () => {
    const proche: CarteFil = { ...carte, objectifs: [objectif(1, null, [etape(10, 1, 5, 7)])] };
    const loin: CarteFil = { ...carte, objectifs: [objectif(1, null, [etape(10, 1, 4, 7)])] };
    const a = classerTachesCles([tache({ id: 1, goalId: 1, milestoneId: 10 })], proche, [], null, AUJOURDHUI);
    const b = classerTachesCles([tache({ id: 1, goalId: 1, milestoneId: 10 })], loin, [], null, AUJOURDHUI);
    // +25, moins ~2 points : l'objectif plus avancé est un peu moins urgent (travail restant).
    expect(a[0].score - b[0].score).toBeGreaterThan(20);
    expect(a[0].score - b[0].score).toBeLessThan(25);
  });

  it("une étape verrouillée ne donne pas le bonus de déblocage", () => {
    const c: CarteFil = { ...carte, objectifs: [objectif(1, null, [etape(10, 1, 0, 1, "locked")])] };
    const r = classerTachesCles([tache({ id: 1, goalId: 1, milestoneId: 10 })], c, [], null, AUJOURDHUI);
    expect(r[0].score).toBeLessThan(25);
  });

  it("échéance liée dans les 2 jours : +25 ; au-delà : rien", () => {
    const t = (id: number) => tache({ id, goalId: 2, milestoneId: 20 });
    const base = classerTachesCles([t(1)], carte, [], null, AUJOURDHUI)[0].score;
    const dans2 = classerTachesCles([t(1)], carte, [{ tacheId: 1, date: "2026-11-14" }], null, AUJOURDHUI)[0].score;
    const dans3 = classerTachesCles([t(1)], carte, [{ tacheId: 1, date: "2026-11-15" }], null, AUJOURDHUI)[0].score;
    const parEtape = classerTachesCles([t(1)], carte, [{ etapeId: 20, date: "2026-11-12" }], null, AUJOURDHUI)[0].score;
    expect(dans2 - base).toBeCloseTo(25, 5);
    expect(dans3).toBeCloseTo(base, 5);
    expect(parEtape - base).toBeCloseTo(25, 5);
  });

  it("au plus 2 tâches par objectif tant qu'un autre objectif a une candidate", () => {
    const t = [
      tache({ id: 1, goalId: 1, milestoneId: 10, priority: 1 }),
      tache({ id: 2, goalId: 1, milestoneId: 10, priority: 1 }),
      tache({ id: 3, goalId: 1, milestoneId: 10, priority: 1 }),
      tache({ id: 4, goalId: 2, milestoneId: 20 }),
    ];
    const r = classerTachesCles(t, carte, [], null, AUJOURDHUI);
    expect(ids(r).sort()).toEqual([1, 2, 4]);
  });

  it("le plafond saute s'il n'y a qu'un objectif", () => {
    const t = [1, 2, 3, 4].map((id) => tache({ id, goalId: 1, milestoneId: 10 }));
    expect(classerTachesCles(t, carte, [], null, AUJOURDHUI)).toHaveLength(3);
  });

  it("une tâche sans objectif n'entre que s'il y a moins de 2 candidates avec objectif", () => {
    const libre = tache({ id: 9, priority: 1 });
    const deux = [tache({ id: 1, goalId: 1, milestoneId: 10 }), tache({ id: 2, goalId: 2, milestoneId: 20 })];
    expect(ids(classerTachesCles([...deux, libre], carte, [], null, AUJOURDHUI))).not.toContain(9);
    const une = classerTachesCles([deux[0], libre], carte, [], null, AUJOURDHUI);
    expect(ids(une).sort()).toEqual([1, 9]);
    expect(une.find((x) => x.tacheId === 9)?.lien).toBeNull();
  });

  it("énergie basse : une deep_work passe derrière à 10 points près, pas au-delà", () => {
    const deep = (p: Record<string, unknown>) => tache({ taskEnergyType: "deep_work", ...p });
    // même objectif, même étape : seule la priorité 1 (+10) sépare.
    const t = [deep({ id: 1, goalId: 2, milestoneId: 20, priority: 1 }), tache({ id: 2, goalId: 2, milestoneId: 20 })];
    expect(ids(classerTachesCles(t, carte, [], "energized", AUJOURDHUI))).toEqual([1, 2]);
    expect(ids(classerTachesCles(t, carte, [], "low", AUJOURDHUI))).toEqual([2, 1]);
    expect(ids(classerTachesCles(t, carte, [], "depleted", AUJOURDHUI))).toEqual([2, 1]);
    // écart de 25 (échéance) : la deep_work reste devant.
    const e: EcheanceProche[] = [{ tacheId: 1, date: AUJOURDHUI }];
    expect(ids(classerTachesCles(t, carte, e, "low", AUJOURDHUI))).toEqual([1, 2]);
  });
});
