import { describe, it, expect } from "vitest";
import { doitRegenerer, parseRequetes, MAX_REQUETES_PAR_PROJET, REGENERATION_JOURS } from "./queries";

const TODAY = new Date("2026-10-01T05:00:00Z");
const ilYA = (j: number) => new Date(TODAY.getTime() - j * 24 * 3600 * 1000);

describe("doitRegenerer — des requêtes stables font une veille stable", () => {
  it("aucune requête encore générée → on génère", () => {
    expect(doitRegenerer(null, TODAY)).toBe(true);
  });

  it("générées hier → on ne régénère pas", () => {
    expect(doitRegenerer(ilYA(1), TODAY)).toBe(false);
  });

  it(`générées il y a plus de ${REGENERATION_JOURS} jours → on régénère`, () => {
    expect(doitRegenerer(ilYA(REGENERATION_JOURS + 1), TODAY)).toBe(true);
  });

  it("exactement à la limite → on ne régénère pas encore", () => {
    expect(doitRegenerer(ilYA(REGENERATION_JOURS), TODAY)).toBe(false);
  });
});

describe("parseRequetes", () => {
  it("lit un tableau JSON de chaînes", () => {
    expect(parseRequetes('["packaging durable 2026","reglementation emballage France"]')).toEqual([
      "packaging durable 2026",
      "reglementation emballage France",
    ]);
  });

  it("tolère le bavardage autour du JSON", () => {
    expect(parseRequetes('Voici :\n```json\n["a","b"]\n```')).toEqual(["a", "b"]);
  });

  it(`plafonne à ${MAX_REQUETES_PAR_PROJET} requêtes`, () => {
    const dix = JSON.stringify(Array.from({ length: 10 }, (_, i) => `requete ${i}`));
    expect(parseRequetes(dix)).toHaveLength(MAX_REQUETES_PAR_PROJET);
  });

  it("écarte le vide, les doublons et les non-chaînes", () => {
    expect(parseRequetes('["a","","a",42,"  ","b"]')).toEqual(["a", "b"]);
  });

  it("rend une liste vide sur une sortie illisible", () => {
    expect(parseRequetes("rien de lisible")).toEqual([]);
  });
});
