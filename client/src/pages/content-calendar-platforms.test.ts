// Complète la garantie du typage : `PLATFORMS`/`CONTENT_TYPES` sont typés contre
// `PlateformeConnue`/`TypeContenuConnu` (@shared/content-platforms), ce qui empêche
// d'y AJOUTER une valeur hors de ces unions — mais un tableau plus court reste
// assignable au même type, donc oublier ici une plateforme déjà connue du serveur ne
// casserait aucun typage. Ce test ferme ce sens-là : les deux listes doivent contenir
// EXACTEMENT les mêmes valeurs.
import { describe, it, expect } from "vitest";
import { PLATFORMS, CONTENT_TYPES } from "./content-calendar-platforms";
import { PLATEFORMES_CONNUES, TYPES_CONTENU_CONNUS } from "@shared/content-platforms";

describe("PLATFORMS ↔ PLATEFORMES_CONNUES", () => {
  it("contiennent exactement les mêmes valeurs", () => {
    expect(PLATFORMS.map((p) => p.value).sort()).toEqual([...PLATEFORMES_CONNUES].sort());
  });
});

describe("CONTENT_TYPES ↔ TYPES_CONTENU_CONNUS", () => {
  it("contiennent exactement les mêmes valeurs", () => {
    expect(CONTENT_TYPES.map((c) => c.value).sort()).toEqual([...TYPES_CONTENU_CONNUS].sort());
  });
});
