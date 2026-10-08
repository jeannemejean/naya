import { describe, it, expect } from "vitest";
import { entrelacerParProjet, repartirCapaciteDuJour, capaciteRestanteDuJour } from "./repartition-projets";

// 9 octobre 2026 : une journée entière liée à un seul projet. L'auto-planner ne traitait que
// le projet sélectionné dans la barre latérale, sautait toute journée déjà entamée, et
// generate-daily posait les tâches projet par projet — aujourd'hui = projet 1, demain = projet 2.

describe("entrelacerParProjet", () => {
  const t = (p: string, n: number) => ({ p, n });
  const cle = (x: { p: string }) => x.p;

  it("alterne les projets à tour de rôle", () => {
    const lot = [t("A", 1), t("A", 2), t("A", 3), t("B", 1), t("B", 2), t("C", 1)];
    expect(entrelacerParProjet(lot, cle).map((x) => `${x.p}${x.n}`)).toEqual(["A1", "B1", "C1", "A2", "B2", "A3"]);
  });

  it("garde l'ordre interne de chaque projet (dépendances déjà triées)", () => {
    const lot = [t("B", 1), t("A", 1), t("B", 2), t("A", 2)];
    const sortie = entrelacerParProjet(lot, cle);
    expect(sortie.filter((x) => x.p === "A").map((x) => x.n)).toEqual([1, 2]);
    expect(sortie.filter((x) => x.p === "B").map((x) => x.n)).toEqual([1, 2]);
    expect(sortie[0].p).toBe("B"); // ordre des projets = ordre de première apparition
  });

  it("ne perd ni ne duplique rien, et rend les mêmes objets", () => {
    const lot = [t("A", 1), t("B", 1), t("A", 2)];
    const sortie = entrelacerParProjet(lot, cle);
    expect(sortie).toHaveLength(3);
    for (const x of lot) expect(sortie).toContain(x);
  });

  it("un seul projet : ordre inchangé ; liste vide : vide", () => {
    const lot = [t("A", 1), t("A", 2)];
    expect(entrelacerParProjet(lot, cle)).toEqual(lot);
    expect(entrelacerParProjet([], cle)).toEqual([]);
  });
});

describe("repartirCapaciteDuJour", () => {
  const projets = [
    { id: 1, dailyTimeBudgetHours: 4 }, // Agence JMD
    { id: 2, dailyTimeBudgetHours: 1 }, // Encore Merci
    { id: 3, dailyTimeBudgetHours: null }, // défaut 2h
  ];

  it("la somme ne dépasse jamais la capacité du jour", () => {
    for (const cap of [0, 1, 2, 3, 5, 6, 9]) {
      const caps = repartirCapaciteDuJour(projets, cap);
      expect(caps.reduce((a, b) => a + b, 0)).toBe(cap);
    }
  });

  it("chaque projet actif a au moins une tâche quand la capacité le permet", () => {
    const caps = repartirCapaciteDuJour(projets, 6);
    expect(caps.every((c) => c >= 1)).toBe(true);
  });

  it("le reste est pondéré par le budget temps", () => {
    const [jmd, em, defaut] = repartirCapaciteDuJour(projets, 9);
    expect(jmd).toBeGreaterThan(defaut);
    expect(defaut).toBeGreaterThanOrEqual(em);
  });

  it("capacité plus petite que le nombre de projets : les plus gros budgets d'abord", () => {
    expect(repartirCapaciteDuJour(projets, 2)).toEqual([1, 0, 1]);
    expect(repartirCapaciteDuJour(projets, 1)).toEqual([1, 0, 0]);
  });

  it("aucun projet : liste vide", () => {
    expect(repartirCapaciteDuJour([], 5)).toEqual([]);
  });
});

describe("capaciteRestanteDuJour", () => {
  it("une journée vide reçoit toute sa capacité", () => {
    expect(capaciteRestanteDuJour([], 6)).toBe(6);
  });

  it("une journée entamée (rituel, tâche du calendrier, report) reçoit le reste", () => {
    const jour = [
      { source: "ritual", type: "admin" },
      { source: "content_production", type: "content" },
      { source: "manual", type: "admin", completed: true }, // une tâche faite a pris sa place
    ];
    expect(capaciteRestanteDuJour(jour, 6)).toBe(3);
  });

  it("les jalons ne comptent pas", () => {
    expect(capaciteRestanteDuJour([{ type: "milestone" }], 4)).toBe(4);
  });

  it("une journée déjà planifiée par l'auto-planner n'est pas regénérée", () => {
    expect(capaciteRestanteDuJour([{ source: "auto", type: "planning" }], 6)).toBe(0);
  });

  it("jamais négatif", () => {
    const plein = Array.from({ length: 8 }, () => ({ source: "manual", type: "admin" }));
    expect(capaciteRestanteDuJour(plein, 6)).toBe(0);
  });
});
