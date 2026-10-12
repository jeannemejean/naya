import { describe, it, expect } from "vitest";
import { parseRegles, doitExtraire, correctionsAExtraire, SEUIL_EXTRACTION, validerRaisonEcart } from "./regles-apprises";

describe("parseRegles", () => {
  it("garde au plus 5 règles non vides, sans doublon", () => {
    const raw = JSON.stringify({ regles: ["", "Retire la formule de politesse d'ouverture.", "retire la formule de politesse d'ouverture.", "a", "Cite le client par son nom.", "R3 assez longue", "R4 assez longue", "R5 assez longue", "R6 assez longue"] });
    const r = parseRegles(raw);
    expect(r.length).toBeLessThanOrEqual(5);
    expect(r).toContain("Retire la formule de politesse d'ouverture.");
    expect(r.filter((x) => x.toLowerCase().startsWith("retire")).length).toBe(1);
    expect(r).not.toContain("a");
  });
  it("une réponse illisible ne donne aucune règle", () => {
    expect(parseRegles("non")).toEqual([]);
  });
});

describe("doitExtraire / correctionsAExtraire", () => {
  const fb = (id: number, action: string, over: any = {}) => ({ id, action, original: "o", extraitLe: null, ...over }) as any;
  it(`déclenche à partir de ${SEUIL_EXTRACTION} corrections ou écarts pas encore traités`, () => {
    const neuf = Array.from({ length: SEUIL_EXTRACTION - 1 }, (_, i) => fb(i + 1, "modifie"));
    expect(doitExtraire(neuf)).toBe(false);
    expect(doitExtraire([...neuf, fb(99, "ecarte")])).toBe(true);
    expect(doitExtraire([...neuf, fb(99, "valide_tel_quel")])).toBe(false);
  });
  it("une correction déjà traitée ne compte plus, même si aucune règle n'en est sortie", () => {
    const tous = Array.from({ length: SEUIL_EXTRACTION }, (_, i) => fb(i + 1, "modifie", { extraitLe: new Date() }));
    expect(doitExtraire(tous)).toBe(false);
  });
  it("un message collé (sans original) n'est pas une correction", () => {
    const colles = Array.from({ length: SEUIL_EXTRACTION }, (_, i) => fb(i + 1, "modifie", { original: null }));
    expect(doitExtraire(colles)).toBe(false);
    expect(correctionsAExtraire(colles)).toEqual([]);
  });
});

describe("validerRaisonEcart", () => {
  it("accepte les raisons prévues, refuse le reste", () => {
    expect(validerRaisonEcart("pas_mon_ton")).toBe(true);
    expect(validerRaisonEcart("n_importe")).toBe(false);
  });
});
