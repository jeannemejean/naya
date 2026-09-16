import { describe, it, expect } from "vitest";
import {
  decideMemoire, salienceDe, decideAbsence,
  APPUIS_POUR_SALIENCE_MAX, SALIENCE_MIN, SALIENCE_MAX, SEUIL_PEREMPTION,
} from "./observation-memory";
import { MIN_OBSERVATIONS } from "./insight";

const obs = (prefixe: string, contenu: string, appuis = 6) => ({ prefixe, contenu, appuis });

describe("decideMemoire", () => {
  it("ecrit quand l'identite est absente", () => {
    const d = decideMemoire(obs("P:", "P: quelque chose"), []);
    expect(d.action).toBe("ecrire");
  });

  it("ne fait rien quand l'identite est presente et le contenu identique", () => {
    const vivantes = [{ id: 7, prefixe: "P:", contenu: "P: quelque chose" }];
    expect(decideMemoire(obs("P:", "P: quelque chose"), vivantes)).toEqual({ action: "rien" });
  });

  it("remplace quand l'identite est presente et le contenu different", () => {
    const vivantes = [{ id: 7, prefixe: "P:", contenu: "P: ancienne" }];
    const d = decideMemoire(obs("P:", "P: nouvelle"), vivantes);
    expect(d).toMatchObject({ action: "remplacer", ancienId: 7 });
  });

  it("n'invalide QUE l'identite concernee — un autre sujet vit sa vie", () => {
    const vivantes = [
      { id: 1, prefixe: "A:", contenu: "A: ancienne" },
      { id: 2, prefixe: "B:", contenu: "B: intacte" },
    ];
    const d = decideMemoire(obs("A:", "A: nouvelle"), vivantes);
    expect(d).toMatchObject({ action: "remplacer", ancienId: 1 });
  });

  it("n'invalide QUE l'identite concernee — meme quand elle n'est pas en premiere position", () => {
    const vivantes = [
      { id: 1, prefixe: "A:", contenu: "A: intacte" },
      { id: 2, prefixe: "B:", contenu: "B: ancienne" },
    ];
    const d = decideMemoire(obs("B:", "B: nouvelle"), vivantes);
    expect(d).toMatchObject({ action: "remplacer", ancienId: 2 });
  });

  it("apparie par PREFIXE, jamais par contenu partiel", () => {
    // Une memoire dont le contenu contient le prefixe ailleurs qu'au debut
    // ne doit pas etre prise pour la meme identite.
    const vivantes = [{ id: 9, prefixe: "AUTRE:", contenu: "AUTRE: mentionne P: au milieu" }];
    expect(decideMemoire(obs("P:", "P: nouvelle"), vivantes).action).toBe("ecrire");
  });
});

describe("salienceDe", () => {
  it("reste a la salience minimale bien en dessous du seuil (appuis = 1)", () => {
    expect(salienceDe(1)).toBeCloseTo(SALIENCE_MIN, 5);
  });

  it("rend la salience minimale PILE au vrai seuil MIN_OBSERVATIONS (ancrage importe, pas 1)", () => {
    // Important 4, revue finale du 2026-09-16 : le test precedent testait
    // salienceDe(1), pas le seuil. Une mutation qui ancre `salienceDe` sur 1 au
    // lieu de MIN_OBSERVATIONS passait TOUS les tests existants. Ancre sur la
    // constante IMPORTEE (pas recopiee), comme le reste du lot.
    expect(salienceDe(MIN_OBSERVATIONS)).toBeCloseTo(SALIENCE_MIN, 5);
  });

  it("reste a la salience minimale juste EN DESSOUS de MIN_OBSERVATIONS (cas absurde en pratique)", () => {
    expect(salienceDe(MIN_OBSERVATIONS - 1)).toBeCloseTo(SALIENCE_MIN, 5);
  });

  it("rend la salience maximale quand l'observation est largement etayee", () => {
    expect(salienceDe(APPUIS_POUR_SALIENCE_MAX)).toBeCloseTo(SALIENCE_MAX, 5);
  });

  it("ne depasse jamais le maximum, meme tres au-dela", () => {
    expect(salienceDe(APPUIS_POUR_SALIENCE_MAX * 100)).toBeCloseTo(SALIENCE_MAX, 5);
  });

  it("croit avec le nombre d'appuis", () => {
    expect(salienceDe(10)).toBeGreaterThan(salienceDe(3));
  });

  it("reste bornee sur une entree absurde", () => {
    expect(salienceDe(0)).toBeGreaterThanOrEqual(SALIENCE_MIN);
    expect(salienceDe(-5)).toBeGreaterThanOrEqual(SALIENCE_MIN);
  });
});

describe("decideAbsence", () => {
  it("incremente sans perimer sur un premier passage sans motif", () => {
    expect(decideAbsence(0)).toEqual({ action: "incrementer", nouveauCompte: 1 });
  });

  it("n'incremente jamais assez pour perimer AVANT SEUIL_PEREMPTION (ancrage importe)", () => {
    expect(decideAbsence(SEUIL_PEREMPTION - 2)).toEqual({
      action: "incrementer",
      nouveauCompte: SEUIL_PEREMPTION - 1,
    });
  });

  it("perime PILE au SEUIL_PEREMPTION-ieme passage consecutif", () => {
    expect(decideAbsence(SEUIL_PEREMPTION - 1)).toEqual({ action: "perimer" });
  });

  it("reste perime largement au-dela du seuil", () => {
    expect(decideAbsence(SEUIL_PEREMPTION * 10)).toEqual({ action: "perimer" });
  });
});
