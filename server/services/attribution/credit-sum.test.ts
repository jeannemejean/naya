import { describe, it, expect } from "vitest";
import { creditSumFromAggregate } from "./credit-sum";

/**
 * C1 (revue finale) — la seule frontière où « aucune ligne d'attribution » doit se
 * distinguer de « une somme nulle ». Voir credit-sum.ts pour la démonstration : puisque
 * `attribute()` donne un poids STRICTEMENT positif à tout contenu d'une fenêtre, un
 * contenu passé par au moins une fenêtre a forcément au moins une ligne de poids > 0.
 * Une somme absente ne peut donc vouloir dire qu'une chose : ce contenu n'a jamais été
 * dans une fenêtre de conversion — NON MESURÉ, jamais « mesuré à zéro ».
 */
describe("creditSumFromAggregate", () => {
  it("AUCUNE ligne d'attribution (sum SQL à NULL) → null : non mesuré, jamais zéro mesuré", () => {
    expect(creditSumFromAggregate(null)).toBeNull();
  });

  it("aucune ligne renvoyée du tout (undefined) → null", () => {
    expect(creditSumFromAggregate(undefined)).toBeNull();
  });

  it("une somme réelle est renvoyée telle quelle", () => {
    expect(creditSumFromAggregate(0.6)).toBe(0.6);
  });

  it("normalise le retour texte du driver numeric sans passer par NaN", () => {
    expect(creditSumFromAggregate("0.6")).toBe(0.6);
  });

  it("un 0 EXPLICITE reste un 0 mesuré — la sémantique de score.ts n'est pas touchée", () => {
    expect(creditSumFromAggregate(0)).toBe(0);
    expect(creditSumFromAggregate("0")).toBe(0);
  });

  it("une valeur illisible retombe sur non mesuré plutôt que de fabriquer un NaN ou un 0", () => {
    expect(creditSumFromAggregate("pas un nombre")).toBeNull();
  });
});
