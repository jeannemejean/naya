import { describe, it, expect } from "vitest";
import { texteDePreuve, liensDePreuve, dedoublonnerPropositions, validerPreuve, parsePropositions } from "./preuves";

const p = (over: any = {}) => ({
  id: 1, userId: "u", projectId: 7, clientLabel: "Maison Lancaster", citable: true,
  whatWasDone: "Refonte de la ligne éditoriale Instagram", result: "+40 % d'engagement en trois mois",
  url: "https://jmd.fr/cas/lancaster", mediaId: null, tags: ["parfum"], status: "validated",
  source: "manual", createdAt: null, updatedAt: null, ...over,
});

describe("texteDePreuve", () => {
  it("cite le client quand il est citable", () => {
    const t = texteDePreuve(p() as any);
    expect(t).toContain("Maison Lancaster");
    expect(t).toContain("+40 %");
    expect(t).toContain("https://jmd.fr/cas/lancaster");
  });
  it("ne cite jamais le nom quand le client n'est pas citable", () => {
    const t = texteDePreuve(p({ citable: false }) as any);
    expect(t).not.toContain("Lancaster");
    expect(t).toMatch(/ne pas nommer/i);
  });
});

describe("liensDePreuve", () => {
  it("renvoie le lien de la preuve, ou rien", () => {
    expect(liensDePreuve(p() as any)).toEqual(["https://jmd.fr/cas/lancaster"]);
    expect(liensDePreuve(null)).toEqual([]);
    expect(liensDePreuve(p({ url: null }) as any)).toEqual([]);
  });
});

describe("dedoublonnerPropositions", () => {
  it("ignore la casse, les accents et les doublons déjà en base", () => {
    const out = dedoublonnerPropositions(
      [p() as any],
      [
        { clientLabel: "MAISON LANCASTER", whatWasDone: "Refonte de la ligne editoriale instagram" },
        { clientLabel: "Studio Nord", whatWasDone: "Lancement d'une marque de bougies" },
        { clientLabel: "studio nord", whatWasDone: "Lancement d'une marque de bougies" },
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0].clientLabel).toBe("Studio Nord");
  });
});

describe("validerPreuve", () => {
  it("accepte une preuve correcte et nettoie les champs", () => {
    const r = validerPreuve({ clientLabel: "  Studio Nord ", whatWasDone: "Lancement", url: "https://a.fr", status: "validated", tags: ["x", 3] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valeur.clientLabel).toBe("Studio Nord");
      expect(r.valeur.tags).toEqual(["x"]);
    }
  });
  it("refuse un statut inconnu, une URL non http et des champs obligatoires vides", () => {
    expect(validerPreuve({ clientLabel: "a", whatWasDone: "b", status: "publie" }).ok).toBe(false);
    expect(validerPreuve({ clientLabel: "a", whatWasDone: "b", url: "javascript:alert(1)" }).ok).toBe(false);
    expect(validerPreuve({ clientLabel: "", whatWasDone: "b" }).ok).toBe(false);
  });
  it("en mise à jour partielle, les champs absents ne sont pas exigés", () => {
    expect(validerPreuve({ status: "archived" }, { partiel: true }).ok).toBe(true);
  });
});

describe("parsePropositions", () => {
  it("lit la réponse de l'IA et écarte les entrées incomplètes", () => {
    const raw = `{"preuves":[{"clientLabel":"Studio Nord","whatWasDone":"Lancement","result":"x","citable":true,"tags":["bougie"]},{"clientLabel":"","whatWasDone":"y"}]}`;
    const out = parsePropositions(raw);
    expect(out).toHaveLength(1);
    expect(out[0].citable).toBe(false); // jamais citable par défaut : c'est l'utilisatrice qui décide
  });
  it("une réponse illisible ne donne rien", () => {
    expect(parsePropositions("nope")).toEqual([]);
  });
});
