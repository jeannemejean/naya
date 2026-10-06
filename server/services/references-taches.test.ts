import { describe, it, expect } from "vitest";
import { remplacerReferencesNumerotees as r } from "./references-taches";

const titres = ["Rédiger le modèle de DM", "Lister 10 fondatrices", "Envoyer les DMs"];

describe("remplacerReferencesNumerotees", () => {
  it("« Task 2 » (1-based dans le texte) → titre de l'index 1", () =>
    expect(r("Using the list from Task 2, send", titres)).toBe("Using the list from « Lister 10 fondatrices », send"));
  it("« Tâche 1 » et « task #3 »", () => {
    expect(r("Reprends la Tâche 1.", titres)).toBe("Reprends « Rédiger le modèle de DM ».");
    expect(r("after task #3", titres)).toBe("after « Envoyer les DMs »");
  });
  it("index inconnu → « la tâche précédente »", () => expect(r("from Task 9", titres)).toBe("from la tâche précédente"));
  it("aucune mention → inchangé", () => expect(r("Rien à voir, 3 DMs", titres)).toBe("Rien à voir, 3 DMs"));
  it("texte vide ou nul → inchangé", () => {
    expect(r("", titres)).toBe("");
    expect(r(null as any, titres)).toBe(null);
  });
});
