import { describe, it, expect } from "vitest";
import { consigneSeance } from "./consigne";

const seance: any = {
  id: 1, statut: "en_cours", projetCourant: 2,
  projets: [{ projectId: 2, etat: "en_cours" }, { projectId: 4, etat: "a_faire" }],
  bilan: { depuis: "2026-11-10T00:00:00.000Z", projets: [
    { projectId: 2, nom: "Agence JMD", statut: "active", priorite: 1, noteActuelle: "Trois actus par jour", tachesEnRetard: [{ id: 10, titre: "Écrire le brief Sézane", date: "2026-11-12" }], derniereTacheFaite: null, postsPrevus: 12, postsPublies: 9, creneaux: [], envoisEnCours: [] },
    { projectId: 4, nom: "Boutique secrète", statut: "active", priorite: 2, noteActuelle: "Ne pas montrer", tachesEnRetard: [{ id: 20, titre: "Tâche de l'autre projet", date: "2026-11-12" }], derniereTacheFaite: null, postsPrevus: 0, postsPublies: 0, creneaux: [], envoisEnCours: [] },
  ] },
};

describe("consigneSeance", () => {
  const c = consigneSeance(seance);
  it("parle du projet courant, avec ses tâches en retard et ses ids", () => {
    expect(c).toContain("Agence JMD");
    expect(c).toContain("Écrire le brief Sézane");
    expect(c).toContain("10");
    expect(c).toContain("projet 1 sur 2");
  });
  it("rien d'un autre projet", () => {
    expect(c).not.toContain("Boutique secrète");
    expect(c).not.toContain("Tâche de l'autre projet");
  });
  it("les règles : ne pas demander ce qui est connu, 2 relances au plus, proposer un créneau pour le travail fait ailleurs", () => {
    expect(c).toMatch(/proposer_bilan_projet/);
    expect(c).toMatch(/2 questions/);
    expect(c).toMatch(/hors de Naya/);
  });
});
