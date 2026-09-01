import { describe, it, expect } from "vitest";
import { selectContentsInWindow, attribute, type ContentCandidate } from "./attribute";

const JOUR = 86_400_000;
const CONV = new Date("2026-06-30T12:00:00.000Z");
const conversion = { id: 1, projectId: 7, convertedAt: CONV, attributionWindowDays: 30 };

const publie = (id: number, joursAvant: number, projectId = 7): ContentCandidate => ({
  id, projectId, publishedAt: new Date(CONV.getTime() - joursAvant * JOUR),
});

describe("selectContentsInWindow", () => {
  it("retient un contenu publié dans la fenêtre", () => {
    expect(selectContentsInWindow(conversion, [publie(1, 10)]).map(c => c.id)).toEqual([1]);
  });

  // Décision actée n°3 : la borne basse est INCLUSIVE.
  it("retient un contenu publié exactement à J moins la fenêtre", () => {
    expect(selectContentsInWindow(conversion, [publie(1, 30)]).map(c => c.id)).toEqual([1]);
  });

  it("exclut un contenu publié une milliseconde avant la borne basse", () => {
    const tropVieux: ContentCandidate = {
      id: 1, projectId: 7, publishedAt: new Date(CONV.getTime() - 30 * JOUR - 1),
    };
    expect(selectContentsInWindow(conversion, [tropVieux])).toEqual([]);
  });

  it("retient un contenu publié exactement à l'instant de la conversion (borne haute inclusive)", () => {
    expect(selectContentsInWindow(conversion, [publie(1, 0)]).map(c => c.id)).toEqual([1]);
  });

  it("exclut un contenu publié après la conversion", () => {
    const apres: ContentCandidate = { id: 1, projectId: 7, publishedAt: new Date(CONV.getTime() + 1) };
    expect(selectContentsInWindow(conversion, [apres])).toEqual([]);
  });

  it("exclut un contenu non publié", () => {
    expect(selectContentsInWindow(conversion, [{ id: 1, projectId: 7, publishedAt: null }])).toEqual([]);
  });

  it("exclut un contenu d'une autre marque", () => {
    expect(selectContentsInWindow(conversion, [publie(1, 10, 99)])).toEqual([]);
  });

  it("ordonne de façon déterministe : par date de publication puis par id", () => {
    const a = publie(3, 10), b = publie(1, 10), c = publie(2, 5);
    expect(selectContentsInWindow(conversion, [a, b, c]).map(x => x.id)).toEqual([1, 3, 2]);
  });
});

describe("attribute — linéaire uniforme", () => {
  const somme = (lignes: { creditWeight: number }[]) =>
    lignes.reduce((s, l) => s + l.creditWeight, 0);

  it("une fenêtre vide ne crédite personne — et ce n'est pas une erreur", () => {
    expect(attribute(conversion, [])).toEqual([]);
  });

  it("un seul contenu reçoit tout le crédit", () => {
    const r = attribute(conversion, selectContentsInWindow(conversion, [publie(1, 5)]));
    expect(r).toEqual([{ contentId: 1, creditWeight: 1 }]);
  });

  // L'invariant central du brief.
  it.each([1, 2, 3, 5, 7])("la somme des poids vaut EXACTEMENT 1 sur %i contenus", (n) => {
    const contenus = Array.from({ length: n }, (_, i) => publie(i + 1, n - i));
    const r = attribute(conversion, selectContentsInWindow(conversion, contenus));
    expect(r).toHaveLength(n);
    expect(somme(r)).toBe(1);
  });

  it("les poids restent uniformes à 1e-9 près malgré l'absorption du résidu", () => {
    const contenus = Array.from({ length: 3 }, (_, i) => publie(i + 1, 3 - i));
    for (const l of attribute(conversion, selectContentsInWindow(conversion, contenus))) {
      expect(Math.abs(l.creditWeight - 1 / 3)).toBeLessThan(1e-9);
    }
  });

  // ANTI-LAST-TOUCH : le contenu le plus proche ne doit jamais rafler la mise.
  it("ne crédite jamais 100 % au contenu le plus récent quand la fenêtre en contient plusieurs", () => {
    const contenus = [publie(1, 28), publie(2, 21), publie(3, 14), publie(4, 6), publie(5, 2)];
    const r = attribute(conversion, selectContentsInWindow(conversion, contenus));
    const leplusRecent = r.find(l => l.contentId === 5)!;
    expect(leplusRecent.creditWeight).toBeLessThan(0.9);
    expect(r.every(l => l.creditWeight > 0)).toBe(true);
  });

  it("reproduit le cas chiffré de la note de décision : cinq contenus à 20 % chacun", () => {
    const contenus = [publie(1, 28), publie(2, 21), publie(3, 14), publie(4, 6), publie(5, 2)];
    for (const l of attribute(conversion, selectContentsInWindow(conversion, contenus))) {
      expect(Math.abs(l.creditWeight - 0.2)).toBeLessThan(1e-9);
    }
  });

  it("une fenêtre plus courte exclut les contenus anciens (cf. §5 de la note)", () => {
    const courte = { ...conversion, attributionWindowDays: 14 };
    const contenus = [publie(1, 28), publie(2, 21), publie(3, 14), publie(4, 6), publie(5, 2)];
    const r = attribute(courte, selectContentsInWindow(courte, contenus));
    expect(r.map(l => l.contentId)).toEqual([3, 4, 5]);
    expect(somme(r)).toBe(1);
  });
});
