import { describe, it, expect } from "vitest";
import { attribuerMarques } from "./attribution";

// Agence (perso, 1) a son Instagram ; Naya (perso, 2) n'a rien : repli sur les Réglages ;
// Client (client, 3) a son LinkedIn.
const marques = [{ id: 1, projectKind: "personal" }, { id: 2, projectKind: "personal" }, { id: 3, projectKind: "client" }];
const comptes = [
  { id: 10, platform: "instagram", projectId: 1 },
  { id: 11, platform: "instagram", projectId: null },
  { id: 12, platform: "linkedin", projectId: null },
  { id: 13, platform: "linkedin", projectId: 3 },
  { id: 14, platform: "facebook", projectId: 99 },
];

describe("attribuerMarques", () => {
  it("chaque cible prend la marque désignée, son compte doit être dans le périmètre de la marque", () => {
    expect(attribuerMarques([{ socialAccountId: 10, projectId: 1 }, { socialAccountId: 11, projectId: 2 }, { socialAccountId: 13, projectId: "3" }], marques, comptes))
      .toEqual({ ok: true, projectIds: [1, 2, 3] });
    // Le compte Instagram des Réglages n'est pas utilisable par Agence (elle a le sien).
    expect(attribuerMarques([{ socialAccountId: 11, projectId: 1 }], marques, comptes)).toEqual({ ok: false, message: "compte_hors_projet", index: 0 });
    // Un client n'utilise jamais les comptes des Réglages.
    expect(attribuerMarques([{ socialAccountId: 12, projectId: 3 }], marques, comptes)).toEqual({ ok: false, message: "compte_hors_projet", index: 0 });
  });
  it("marque hors du groupe : refusée", () => {
    expect(attribuerMarques([{ socialAccountId: 14, projectId: 99 }], marques, comptes)).toEqual({ ok: false, message: "marque_hors_groupe", index: 0 });
  });
  it("sans marque désignée : déduite du compte quand une seule marque le couvre (ou le possède)", () => {
    expect(attribuerMarques([{ socialAccountId: 10 }, { socialAccountId: 13 }, { socialAccountId: 11 }], marques, comptes))
      .toEqual({ ok: true, projectIds: [1, 3, 2] });
    // Le LinkedIn des Réglages couvre Agence ET Naya (repli) : ambigu.
    expect(attribuerMarques([{ socialAccountId: 12 }], marques, comptes)).toEqual({ ok: false, message: "marque_ambigue", index: 0 });
    expect(attribuerMarques([{ socialAccountId: 14 }], marques, comptes)).toEqual({ ok: false, message: "compte_hors_projet", index: 0 });
    expect(attribuerMarques([{}], marques, comptes)).toEqual({ ok: false, message: "marque_manquante", index: 0 });
  });
  it("une cible sans compte mais avec une marque du groupe : acceptée (le worker choisira dans son périmètre)", () => {
    expect(attribuerMarques([{ projectId: 2 }], marques, comptes)).toEqual({ ok: true, projectIds: [2] });
  });
});
