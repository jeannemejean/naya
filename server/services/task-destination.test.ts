import { describe, it, expect } from "vitest";
import {
  DESTINATION_PAR_TYPE,
  destinationPourTache,
  type Destination,
} from "./task-destination";

/**
 * Où part le travail d'une tâche, une fois « Enregistrer » cliqué.
 *
 * Arbitrage de Jeanne (2026-09-16) : une table EXPLICITE, qu'elle contrôle, plutôt qu'une
 * décision prise par Naya au cas par cas. Une destination devinée est une destination qu'on
 * ne peut pas prévoir, donc pas corriger.
 *
 * La table est fondée sur les types réellement présents en production — content, outreach,
 * planning, admin — et non sur une énumération théorique. `workflow_group`, lui, est null
 * sur les 58 tâches : le prompt ne l'a jamais demandé (corrigé dans le lot A), il ne peut
 * donc pas servir de clé aujourd'hui.
 */
describe("destinationPourTache", () => {
  it("une tâche de contenu part au calendrier de contenu", () => {
    // Le cas rapporté : « écrire un post LinkedIn » doit rejoindre le calendrier, à
    // l'endroit des posts rédigés mais non publiés.
    expect(destinationPourTache("content")).toBe("content");
  });

  it("une tâche de prospection part vers la campagne liée", () => {
    expect(destinationPourTache("outreach")).toBe("prospection");
  });

  it("les tâches sans destination naturelle restent dans l'espace de travail", () => {
    for (const type of ["admin", "planning", "execution"]) {
      expect(destinationPourTache(type), `type ${type}`).toBe("espace_de_travail");
    }
  });

  it("un type inconnu reste dans l'espace de travail, il n'est JAMAIS deviné", () => {
    // LE test. Router au jugé enverrait le travail dans un endroit que l'utilisatrice
    // n'attend pas, et qu'elle ne penserait pas à aller regarder. Le repli doit être
    // l'endroit où elle vient d'écrire.
    for (const type of ["marketing", "CONTENT", "contenu", "", "content ", "recherche"]) {
      expect(destinationPourTache(type), `type « ${type} »`).toBe("espace_de_travail");
    }
  });

  it("un type absent reste dans l'espace de travail", () => {
    for (const absent of [null, undefined]) {
      expect(destinationPourTache(absent), `type ${String(absent)}`).toBe("espace_de_travail");
    }
  });

  it("un nom hérité du prototype ne renvoie pas une valeur du prototype", () => {
    // Trouvé par mutation. Un simple `TABLE[type] ?? repli` ne suffit PAS : en JavaScript,
    // TABLE["constructor"] ne vaut pas `undefined` mais la fonction héritée de
    // Object.prototype — que `??` laisse donc passer. `destinationPourTache("toString")`
    // aurait renvoyé une fonction là où le reste du code attend une chaîne, et le routage
    // aurait compare cette fonction a "content" sans jamais tomber sur le repli.
    //
    // `type` vient d'une colonne de base : rien ne garantit qu'elle ne contiendra jamais
    // l'une de ces valeurs.
    for (const herite of ["constructor", "toString", "valueOf", "__proto__", "hasOwnProperty"]) {
      expect(destinationPourTache(herite), `type « ${herite} »`).toBe("espace_de_travail");
    }
  });

  it("la table est exhaustive sur les types vus en production", () => {
    // Si un type réel manque, son travail retombe silencieusement dans l'espace de travail.
    // Ce test le rend visible plutôt que de le laisser passer.
    for (const type of ["content", "outreach", "admin", "planning"]) {
      expect(Object.keys(DESTINATION_PAR_TYPE), `type ${type} en production`).toContain(type);
    }
  });

  it("toute destination de la table est une destination connue", () => {
    const connues: Destination[] = ["content", "prospection", "espace_de_travail"];
    for (const [type, dest] of Object.entries(DESTINATION_PAR_TYPE)) {
      expect(connues, `${type} → ${dest}`).toContain(dest);
    }
  });

  it("la table est modifiable sans toucher à la fonction", () => {
    // L'intention de l'arbitrage : Jeanne doit pouvoir changer une destination en éditant
    // une ligne de données, pas en lisant de la logique.
    expect(typeof DESTINATION_PAR_TYPE).toBe("object");
    expect(Object.keys(DESTINATION_PAR_TYPE).length).toBeGreaterThanOrEqual(4);
  });
});
