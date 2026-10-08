import { describe, it, expect, vi } from "vitest";
import { raisonExclusionGenerateur, filtrerTachesGenerees } from "./filtre-taches-generees";

// Décision de Jeanne (9 octobre 2026) : le contenu vient UNIQUEMENT du calendrier éditorial,
// la prospection UNIQUEMENT du pipeline de prospection. Les générateurs génériques
// (journée, semaine, mois, objectif, jalon) ne doivent plus en fabriquer.

describe("raisonExclusionGenerateur — prospection", () => {
  it.each([
    "Draft DM outreach template targeting 3 indie mode/beauty founders on Instagram",
    "Send the 3 personalized DMs (based on outreach template) + document responses",
    "Identify 3 mode/beauty/lifestyle founders or CMOs…",
    "Identifier 10 prospects sur LinkedIn",
    "Envoyer 5 DM aux fondatrices repérées",
    "Relancer les prospects de la semaine dernière",
    "Rédiger le message de prospection pour les marques beauté",
    "Envoyer les demandes de connexion LinkedIn",
    "Lister 15 fondateurs de marques mode à contacter",
  ])("écarte « %s »", (title) => {
    expect(raisonExclusionGenerateur({ title, type: "planning" })).toBe("prospection");
  });

  it("écarte par type, workflowGroup ou taskType", () => {
    expect(raisonExclusionGenerateur({ title: "Préparer la semaine", type: "outreach" })).toBe("prospection");
    expect(raisonExclusionGenerateur({ title: "Préparer la semaine", type: "admin", workflowGroup: "prospection" })).toBe("prospection");
    expect(raisonExclusionGenerateur({ title: "Préparer la semaine", type: "admin", workflowGroup: "12::prospection" })).toBe("prospection");
    expect(raisonExclusionGenerateur({ title: "Préparer la semaine", taskType: "linkedin_message" })).toBe("prospection");
    expect(raisonExclusionGenerateur({ title: "Préparer la semaine", taskType: "outreach_action" })).toBe("prospection");
  });
});

describe("raisonExclusionGenerateur — création de contenu", () => {
  it.each([
    "Draft 3-part carousel: 'What changed when we stopped making content…'",
    "Create Reel script: '3 signs your brand universe isn't working'",
    "Write 200-word LinkedIn post about the Q4 launch",
    "Rédiger le post LinkedIn de jeudi",
    "Tourner le reel coulisses de l'atelier",
    "Écrire la newsletter d'octobre",
    "Créer le carrousel « 5 erreurs de marque »",
  ])("écarte « %s »", (title) => {
    expect(raisonExclusionGenerateur({ title, type: "planning" })).toBe("contenu");
  });

  it("écarte par type, workflowGroup ou taskType", () => {
    expect(raisonExclusionGenerateur({ title: "Bloc du matin", type: "content" })).toBe("contenu");
    expect(raisonExclusionGenerateur({ title: "Bloc du matin", type: "admin", workflowGroup: "content" })).toBe("contenu");
    expect(raisonExclusionGenerateur({ title: "Bloc du matin", taskType: "post_publish" })).toBe("contenu");
    expect(raisonExclusionGenerateur({ title: "Bloc du matin", taskType: "canva_task" })).toBe("contenu");
  });
});

describe("raisonExclusionGenerateur — ce qui reste", () => {
  it.each([
    { title: "Rédiger une note 'Brain' : ce que la marque refuse", type: "planning", workflowGroup: "strategy" },
    { title: "Définir ta signature visuelle pour la rentrée", type: "planning", workflowGroup: "strategy" },
    { title: "Préparer le devis Encore Merci", type: "admin", workflowGroup: "client" },
    { title: "Relancer la facture impayée de Mr Darcy", type: "admin", workflowGroup: "admin" },
    { title: "Analyser les retours du dernier post", type: "planning", workflowGroup: "strategy" },
    { title: "Point stratégie Q4 avec l'équipe", type: "planning" },
    { title: "Valider les messages préparés", type: "admin" },
    { title: "Livrer la charte graphique à Mr Darcy", type: "admin", workflowGroup: "client" },
    { title: "Structurer l'offre d'accompagnement", type: "planning", workflowGroup: "product" },
  ])("garde « $title »", (t) => {
    expect(raisonExclusionGenerateur(t)).toBeNull();
  });

  it("un livrable client reste, même typé contenu (travail facturé, pas de la visibilité)", () => {
    expect(raisonExclusionGenerateur({ title: "Rédiger les 4 posts du mois pour Encore Merci", type: "content", workflowGroup: "client" })).toBeNull();
  });

  it("la prospection reste écartée même rangée côté client", () => {
    expect(raisonExclusionGenerateur({ title: "Envoyer 5 DM à des prospects", type: "admin", workflowGroup: "client" })).toBe("prospection");
  });

  it("tolère une tâche incomplète", () => {
    expect(raisonExclusionGenerateur({})).toBeNull();
    expect(raisonExclusionGenerateur(null as any)).toBeNull();
  });
});

describe("filtrerTachesGenerees", () => {
  it("garde l'ordre et les objets d'origine, sans rien combler", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const a = { title: "Définir l'offre Q4", type: "planning" };
    const b = { title: "Send the 3 personalized DMs", type: "outreach" };
    const c = { title: "Préparer le devis Encore Merci", type: "admin" };
    const d = { title: "Draft 3-part carousel", type: "content" };
    const gardees = filtrerTachesGenerees([a, b, c, d], "test");
    expect(gardees).toEqual([a, c]);
    expect(gardees[0]).toBe(a);
  });

  it("lit les champs d'un objet enveloppé via l'accesseur", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const lot = [{ taskData: { title: "Identifier 10 prospects", type: "planning" } }, { taskData: { title: "Clarifier l'offre", type: "planning" } }];
    expect(filtrerTachesGenerees(lot, "test", (p) => p.taskData)).toEqual([lot[1]]);
  });

  it("supporte une liste absente", () => {
    expect(filtrerTachesGenerees(undefined as any, "test")).toEqual([]);
  });
});
