import { describe, it, expect } from "vitest";
import { consigneSeance, consigneFinSeance } from "./consigne";

const seance: any = {
  id: 1, statut: "en_cours", projetCourant: 2,
  projets: [{ projectId: 2, etat: "en_cours" }, { projectId: 4, etat: "a_faire" }],
  bilan: { depuis: "2026-11-10T00:00:00.000Z", projets: [
    { projectId: 2, nom: "Agence JMD", statut: "active", priorite: 1, noteActuelle: "Trois actus par jour", tachesEnRetard: [{ id: 10, titre: "Écrire le brief Sézane", date: "2026-11-12" }], tachesAnciennes: [{ id: 30, titre: "Rédiger la promesse centrale", creeeLe: "2026-10-14", date: "2026-12-02" }], derniereTacheFaite: null, postsPrevus: 12, postsPublies: 9, creneaux: [], envoisEnCours: [] },
    { projectId: 4, nom: "Boutique secrète", statut: "active", priorite: 2, noteActuelle: "Ne pas montrer", tachesEnRetard: [{ id: 20, titre: "Tâche de l'autre projet", date: "2026-11-12" }], derniereTacheFaite: null, postsPrevus: 0, postsPublies: 0, creneaux: [], envoisEnCours: [] },
  ] },
};

describe("consigneSeance", () => {
  const c = consigneSeance(seance);
  it("les tâches anciennes sont listées avec leur id, et Naya demande lesquelles garder (archiver les autres)", () => {
    expect(c).toContain("30 : Rédiger la promesse centrale");
    expect(c).toMatch(/encore d'actualité/);
    expect(c).toMatch(/archiver_tache/);
  });
  it("nomme le projet suivant (le seul que Naya annonce après la validation), sans rien en dire d'autre", () => {
    expect(c).toMatch(/Projet suivant : « Boutique secrète »/);
    expect(c).not.toContain("Ne pas montrer");
  });
  it("dernier projet : aucun projet suivant, la séance se termine", () => {
    const dernier = consigneSeance({ ...seance, projetCourant: 4, projets: [{ projectId: 2, etat: "fait" }, { projectId: 4, etat: "en_cours" }] });
    expect(dernier).toMatch(/dernier projet/);
    expect(dernier).not.toMatch(/Projet suivant/);
  });
  it("proposer_bilan_projet avec le projectId du projet dont elle parle ; ne dire fait que ce que le résultat dit réussi", () => {
    expect(c).toMatch(/projectId 2/);
    expect(c).toMatch(/réussi/);
  });
  it("parle du projet courant, avec ses tâches en retard et ses ids", () => {
    expect(c).toContain("Agence JMD");
    expect(c).toContain("Écrire le brief Sézane");
    expect(c).toContain("10");
    expect(c).toContain("projet 1 sur 2");
  });
  it("rien d'un autre projet (seulement le nom du suivant)", () => {
    expect(c).not.toContain("Ne pas montrer");
    expect(c).not.toContain("Tâche de l'autre projet");
  });
  it("les règles : ne pas demander ce qui est connu, 2 relances au plus, proposer un créneau pour le travail fait ailleurs", () => {
    expect(c).toMatch(/proposer_bilan_projet/);
    expect(c).toMatch(/2 questions/);
    expect(c).toMatch(/hors de Naya/);
  });
});

describe("consigneSeance : nouveau projet", () => {
  it("sans récit : commencer par résumer et demander, ne rien reprendre du projet précédent", () => {
    expect(consigneSeance(seance)).toMatch(/n'a pas encore parlé de ce projet/);
    expect(consigneSeance(seance)).not.toMatch(/projet précédent/); // premier projet
    const second = consigneSeance({ ...seance, projetCourant: 4, projets: [{ projectId: 2, etat: "fait" }, { projectId: 4, etat: "en_cours" }] });
    expect(second).toMatch(/projet précédent/);
    expect(second).toMatch(/n'a pas encore parlé de ce projet/);
  });
  it("avec récit : plus de rappel « pas encore parlé »", () => {
    const c = consigneSeance({ ...seance, projets: [{ projectId: 2, etat: "en_cours", recit: true }, { projectId: 4, etat: "a_faire" }] });
    expect(c).not.toMatch(/n'a pas encore parlé de ce projet/);
  });
});

describe("consigneSeance : proposition en attente ou à refaire", () => {
  it("en attente : le dire, ne pas en refaire une", () => {
    const c = consigneSeance({ ...seance, projets: [{ projectId: 2, etat: "en_cours", recit: true, propositionId: 31 }, { projectId: 4, etat: "a_faire" }] });
    expect(c).toMatch(/proposition n° 31 attend/);
  });
  it("à refaire : le dire", () => {
    const c = consigneSeance({ ...seance, projets: [{ projectId: 2, etat: "en_cours", recit: true, aRefaire: true }, { projectId: 4, etat: "a_faire" }] });
    expect(c).toMatch(/à refaire/);
  });
});

describe("consigneFinSeance : codes traduits", () => {
  it("chaque limite a sa phrase en clair", () => {
    const c = consigneFinSeance({ evaluation: { depuis: "x", parReseau: [], limites: ["portee_manquante", "metricool_absent", "linkedin_profil_non_lisible"] } } as any);
    expect(c).toMatch(/reconnecte Instagram/);
    expect(c).toMatch(/Metricool n'est pas connecté/);
    expect(c).toMatch(/LinkedIn/);
  });
});

describe("consigneSeance : proposition validée sans effet", () => {
  it("dit ce qui a échoué et demande une proposition corrigée", () => {
    const c = consigneSeance({ ...seance, projets: [{ projectId: 2, etat: "en_cours", recit: true, aRefaire: true, echecs: ["Tâche n° 9 : introuvable"] }, { projectId: 4, etat: "a_faire" }] });
    expect(c).toContain("Tâche n° 9 : introuvable");
    expect(c).toMatch(/AUCUN changement/);
    expect(c).not.toMatch(/a expiré ou a été annulée/);
  });
});
