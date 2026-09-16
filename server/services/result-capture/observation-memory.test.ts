import { describe, it, expect } from "vitest";
import {
  decideMemoire, salienceDe,
  APPUIS_POUR_SALIENCE_MAX, SALIENCE_MIN, SALIENCE_MAX,
} from "./observation-memory";

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

  it("apparie par PREFIXE, jamais par contenu partiel", () => {
    // Une memoire dont le contenu contient le prefixe ailleurs qu'au debut
    // ne doit pas etre prise pour la meme identite.
    const vivantes = [{ id: 9, prefixe: "AUTRE:", contenu: "AUTRE: mentionne P: au milieu" }];
    expect(decideMemoire(obs("P:", "P: nouvelle"), vivantes).action).toBe("ecrire");
  });
});

describe("salienceDe", () => {
  it("rend la salience minimale au seuil", () => {
    expect(salienceDe(1)).toBeCloseTo(SALIENCE_MIN, 5);
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
