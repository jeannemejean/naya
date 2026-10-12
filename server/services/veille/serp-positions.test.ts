import { describe, it, expect } from "vitest";
import { positions, comparerSerp, bilanSerp } from "./serp-positions";

const r = (domaines: string[]) => domaines.map((d, i) => ({ link: `https://${d}/page${i}`, title: d }));
const entites = [{ cle: "marque", nom: "Lune", domaine: "lune.fr" }, { cle: "c1", nom: "Soleil", domaine: "soleil.fr" }];

describe("positions", () => {
  it("donne la position 1-10 de chaque domaine, sous-domaines compris", () => {
    const p = positions(r(["a.com", "blog.lune.fr", "soleil.fr", "lune.fr"]), entites);
    expect(p).toEqual({ marque: 2, c1: 3 });
  });
  it("absent du top 10 → null", () => {
    expect(positions(r(Array.from({ length: 12 }, (_, i) => (i === 11 ? "lune.fr" : `x${i}.com`))), entites)).toEqual({ marque: null, c1: null });
  });
  it("un domaine qui se termine pareil n'est pas confondu", () => {
    expect(positions(r(["malune.fr"]), entites).marque).toBeNull();
  });
});

describe("comparerSerp", () => {
  const ctx = { motCle: "bougie artisanale", marqueCle: "marque", concurrents: [{ cle: "c1", nom: "Soleil" }] };
  it("premier relevé : rien", () => {
    expect(comparerSerp(null, { marque: 4, c1: 2 }, ctx)).toEqual([]);
  });
  it("signale un gain ou une perte d'au moins 3 places", () => {
    expect(comparerSerp({ marque: 8, c1: null }, { marque: 3, c1: null }, ctx)[0].texte).toMatch(/8.*3/);
    expect(comparerSerp({ marque: 3, c1: null }, { marque: 5, c1: null }, ctx)).toEqual([]);
    expect(comparerSerp({ marque: 2, c1: null }, { marque: 6, c1: null }, ctx)).toHaveLength(1);
  });
  it("signale une entrée et une sortie du top 10", () => {
    expect(comparerSerp({ marque: null, c1: null }, { marque: 9, c1: null }, ctx)).toHaveLength(1);
    expect(comparerSerp({ marque: 9, c1: null }, { marque: null, c1: null }, ctx)).toHaveLength(1);
  });
  it("signale un concurrent qui entre dans le top 3", () => {
    const c = comparerSerp({ marque: null, c1: 6 }, { marque: null, c1: 2 }, ctx);
    expect(c).toHaveLength(1);
    expect(c[0].texte).toContain("Soleil");
  });
});

it("bilanSerp compte les requêtes où la marque est dans le top 10", () => {
  expect(bilanSerp([{ marque: 3 }, { marque: null }, { marque: 10 }], "marque")).toEqual({ presentes: 2, total: 3 });
});
