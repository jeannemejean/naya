// Le langage commun du planning (spec 2026-11-19-chef-d-orchestre-design.md §1-2).
import { describe, it, expect } from "vitest";
import { contrainteDe, comparerRang, PEREMPTION_JOURS, estPerimee, aRamener } from "./contrainte";

const AUJ = "2026-11-19";
const due = (jour: string) => new Date(`${jour}T22:59:00.000Z`); // 23 h 59 à Paris

describe("contrainteDe", () => {
  it("étape d'un post : échéance dure, la veille du post (Publier : le jour même)", () => {
    expect(contrainteDe({ contentId: 3, title: "Rédiger — x" }, { aujourdhui: AUJ, jourPost: "2026-11-25" }))
      .toEqual({ echeance: "2026-11-24", durete: "dure" });
    expect(contrainteDe({ contentId: 3, title: "Publier — x" }, { aujourdhui: AUJ, jourPost: "2026-11-25" }))
      .toEqual({ echeance: "2026-11-25", durete: "dure" });
  });
  it("atelier : échéance dure de son actionData", () => {
    expect(contrainteDe({ taskType: "atelier_contenu", actionData: { echeance: "2026-11-23" } }, { aujourdhui: AUJ }))
      .toEqual({ echeance: "2026-11-23", durete: "dure" });
  });
  it("relance de prospect : dure, le jour promis", () => {
    expect(contrainteDe({ source: "relance_prospect", scheduledDate: "2026-11-21" }, { aujourdhui: AUJ }))
      .toEqual({ echeance: "2026-11-21", durete: "dure" });
  });
  it("clôture du vendredi : dure, le jour de sa création", () => {
    expect(contrainteDe({ source: "fil_cloture", createdAt: new Date("2026-11-20T05:00:00Z"), scheduledDate: "2026-12-07" }, { aujourdhui: AUJ }))
      .toEqual({ echeance: "2026-11-20", durete: "dure" });
  });
  it("actionData.echeanceDure (jalons d'appel d'offres) : dure", () => {
    expect(contrainteDe({ actionData: { echeanceDure: "2026-12-01" }, dueDate: due("2026-11-20") }, { aujourdhui: AUJ }))
      .toEqual({ echeance: "2026-12-01", durete: "dure" });
  });
  it("dueDate : souple, jour à Paris", () => {
    expect(contrainteDe({ dueDate: due("2026-11-21") }, { aujourdhui: AUJ })).toEqual({ echeance: "2026-11-21", durete: "souple" });
    expect(contrainteDe({ dueDate: "2026-11-21T22:59:00.000Z" }, { aujourdhui: AUJ })).toEqual({ echeance: "2026-11-21", durete: "souple" });
  });
  it(`dueDate dépassé de plus de ${PEREMPTION_JOURS} jours : plus d'échéance utile`, () => {
    expect(contrainteDe({ dueDate: due("2026-11-05") }, { aujourdhui: AUJ })).toEqual({ echeance: "2026-11-05", durete: "souple" });
    expect(contrainteDe({ dueDate: due("2026-11-04") }, { aujourdhui: AUJ })).toEqual({ echeance: null, durete: null });
  });
  it("rien : aucune échéance", () => {
    expect(contrainteDe({}, { aujourdhui: AUJ })).toEqual({ echeance: null, durete: null });
    expect(contrainteDe({ dueDate: "pas une date" }, { aujourdhui: AUJ })).toEqual({ echeance: null, durete: null });
  });
});

describe("estPerimee (le vivier)", () => {
  it("échéance souple dépassée de plus de 14 jours, sans échéance dure", () => {
    expect(estPerimee({ dueDate: due("2026-10-13") }, AUJ)).toBe(true);
    expect(estPerimee({ dueDate: due("2026-11-05") }, AUJ)).toBe(false);
    expect(estPerimee({}, AUJ)).toBe(false);
    expect(estPerimee({ source: "relance_prospect", scheduledDate: "2026-11-21", dueDate: due("2026-10-01") }, AUJ)).toBe(false);
    expect(estPerimee({ contentId: 4, title: "Rédiger — x", dueDate: due("2026-10-01") }, AUJ)).toBe(false);
  });
});

describe("comparerRang (qui garde sa place)", () => {
  const r = (echeance: string | null, durete: "dure" | "souple" | null, priority: number | null, scheduledDate = "2026-11-19") =>
    ({ contrainte: { echeance, durete }, priority, scheduledDate });
  it("l'échéance la plus proche d'abord ; sans échéance en dernier", () => {
    const l = [r(null, null, 1), r("2026-11-25", "souple", 3), r("2026-11-21", "souple", 3)];
    expect(l.sort(comparerRang).map((x) => x.contrainte.echeance)).toEqual(["2026-11-21", "2026-11-25", null]);
  });
  it("à date égale, dure avant souple ; puis priorité 1 avant 3 ; puis la plus anciennement planifiée", () => {
    expect([r("2026-11-21", "souple", 1), r("2026-11-21", "dure", 3)].sort(comparerRang)[0].contrainte.durete).toBe("dure");
    expect([r(null, null, 3), r(null, null, 1)].sort(comparerRang)[0].priority).toBe(1);
    expect([r(null, null, 2, "2026-11-20"), r(null, null, 2, "2026-11-12")].sort(comparerRang)[0].scheduledDate).toBe("2026-11-12");
  });
});

describe("aRamener (une tâche partie après son échéance revient)", () => {
  it("après son échéance (souple ou dure hors contenu) : revient aujourd'hui", () => {
    expect(aRamener({ scheduledDate: "2026-12-04", dueDate: due("2026-11-21") }, AUJ)).toBe(AUJ);
  });
  it("échéance dure dépassée (clôture du 20) : revient aujourd'hui", () => {
    expect(aRamener({ scheduledDate: "2026-12-07", source: "fil_cloture", createdAt: new Date("2026-11-20T05:00:00Z") }, "2026-11-23")).toBe("2026-11-23");
  });
  it("avant son échéance, sans échéance, ou périmée : ne bouge pas", () => {
    expect(aRamener({ scheduledDate: "2026-11-20", dueDate: due("2026-11-21") }, AUJ)).toBeNull();
    expect(aRamener({ scheduledDate: "2026-12-04" }, AUJ)).toBeNull();
    expect(aRamener({ scheduledDate: "2026-12-04", dueDate: due("2026-10-01") }, AUJ)).toBeNull();
  });
  it("étapes de posts et ateliers : jamais (ils ont leur propre placement)", () => {
    expect(aRamener({ scheduledDate: "2026-12-04", contentId: 3, title: "Rédiger — x", dueDate: due("2026-11-21") }, AUJ)).toBeNull();
    expect(aRamener({ scheduledDate: "2026-12-04", taskType: "atelier_contenu", actionData: { echeance: "2026-11-21" } }, AUJ)).toBeNull();
  });
});
