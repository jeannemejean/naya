import { describe, it, expect } from "vitest";
import {
  sortByDeclaredDependencies,
  groupTasksByWorkflow,
  orderGeneratedTasks,
} from "./dependency-sort";

/**
 * Le planificateur reçoit de l'IA des tâches SANS id (elles ne sont pas encore en base)
 * accompagnées d'un tableau `dependencies` qui désigne les tâches PAR LEUR INDICE.
 *
 * `sortTasksByDependencies` ne peut rien pour ce cas : elle lit les dépendances en base,
 * et des tâches sans id n'en ont aucune. D'où cette fonction, qui trie sur les dépendances
 * DÉCLARÉES, avant toute écriture.
 */
describe("sortByDeclaredDependencies", () => {
  const t = (title: string) => ({ title });

  it("place le prérequis avant la tâche qui en dépend", () => {
    // Le cas rapporté : on demandait de publier un post avant de l'avoir écrit.
    const tasks = [t("Publier le post LinkedIn"), t("Rédiger le post LinkedIn")];
    const deps = [{ taskIndex: 0, dependsOnIndex: 1, relationType: "blocked_by" }];

    const sorted = sortByDeclaredDependencies(tasks, deps);

    expect(sorted.map((x) => x.title)).toEqual([
      "Rédiger le post LinkedIn",
      "Publier le post LinkedIn",
    ]);
  });

  it("respecte une chaîne de trois tâches donnée dans le désordre", () => {
    // Bug visé : un tri qui ne regarderait qu'une arête et s'arrêterait là.
    const tasks = [t("Publier"), t("Relire"), t("Rédiger")];
    const deps = [
      { taskIndex: 0, dependsOnIndex: 1, relationType: "blocked_by" }, // publier après relire
      { taskIndex: 1, dependsOnIndex: 2, relationType: "blocked_by" }, // relire après rédiger
    ];

    expect(sortByDeclaredDependencies(tasks, deps).map((x) => x.title)).toEqual([
      "Rédiger",
      "Relire",
      "Publier",
    ]);
  });

  it("conserve l'ordre d'origine quand aucune dépendance n'est déclarée", () => {
    // Bug visé : un tri instable qui remanierait l'ordre choisi par l'IA sans raison.
    const tasks = [t("A"), t("B"), t("C"), t("D")];

    expect(sortByDeclaredDependencies(tasks, []).map((x) => x.title)).toEqual(["A", "B", "C", "D"]);
  });

  it("conserve l'ordre relatif des tâches indépendantes entre elles", () => {
    // Bug visé : un tri topologique qui viderait une file en désordre.
    const tasks = [t("A"), t("B"), t("C"), t("D")];
    const deps = [{ taskIndex: 3, dependsOnIndex: 0, relationType: "blocked_by" }];

    expect(sortByDeclaredDependencies(tasks, deps).map((x) => x.title)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  it("ne perd aucune tâche en présence d'un cycle", () => {
    // Bug visé : une boucle infinie, ou des tâches avalées par un cycle non résolu.
    const tasks = [t("A"), t("B")];
    const deps = [
      { taskIndex: 0, dependsOnIndex: 1, relationType: "blocked_by" },
      { taskIndex: 1, dependsOnIndex: 0, relationType: "blocked_by" },
    ];

    const sorted = sortByDeclaredDependencies(tasks, deps);

    expect(sorted).toHaveLength(2);
    expect(sorted.map((x) => x.title).sort()).toEqual(["A", "B"]);
  });

  it("ignore un indice hors bornes sans perdre de tâche", () => {
    // Bug visé : une IA qui renvoie un indice inventé fait planter toute la génération.
    const tasks = [t("A"), t("B")];
    const deps = [
      { taskIndex: 0, dependsOnIndex: 7, relationType: "blocked_by" },
      { taskIndex: -1, dependsOnIndex: 0, relationType: "blocked_by" },
    ];

    expect(sortByDeclaredDependencies(tasks, deps).map((x) => x.title)).toEqual(["A", "B"]);
  });

  it("ignore une tâche déclarée dépendante d'elle-même", () => {
    // Bug visé : une auto-dépendance donne un degré entrant qui ne retombe jamais à zéro,
    // et la tâche disparaît de la sortie.
    const tasks = [t("A"), t("B")];
    const deps = [{ taskIndex: 0, dependsOnIndex: 0, relationType: "blocked_by" }];

    expect(sortByDeclaredDependencies(tasks, deps).map((x) => x.title)).toEqual(["A", "B"]);
  });

  it("ne modifie pas le tableau reçu", () => {
    // Bug visé : un tri en place, qui décalerait les indices que l'appelant doit encore utiliser
    // pour retrouver quelle tâche correspond à quelle dépendance.
    const tasks = [t("Publier"), t("Rédiger")];
    const deps = [{ taskIndex: 0, dependsOnIndex: 1, relationType: "blocked_by" }];

    sortByDeclaredDependencies(tasks, deps);

    expect(tasks.map((x) => x.title)).toEqual(["Publier", "Rédiger"]);
  });
});

describe("le regroupement par workflow ne casse jamais une dépendance", () => {
  it("garde le prérequis devant, même quand son groupe passe APRÈS celui du dépendant", () => {
    // LE piège. Le commentaire du module affirme « en cas de conflit, les dépendances
    // priment », mais le regroupement s'appliquait APRÈS le tri et pouvait donc le défaire.
    //
    // Cas choisi pour être discriminant : le prérequis est dans `admin`, le dépendant dans
    // `strategy`. WORKFLOW_ORDER place `strategy` AVANT `admin` — un regroupement appliqué
    // en dernier remonterait donc le dépendant devant son prérequis.
    //
    // (La première version de ce test utilisait content/prospection et passait sans rien
    // prouver : `content` précède déjà `prospection`, l'ordre était bon par hasard.)
    const tasks = [
      { title: "Valider le budget", workflowGroup: "admin" },
      { title: "Choisir l'axe stratégique", workflowGroup: "strategy" },
    ];
    const deps = [{ taskIndex: 1, dependsOnIndex: 0, relationType: "blocked_by" }];

    const ordered = orderGeneratedTasks(tasks, deps);
    const posPrerequis = ordered.findIndex((x: any) => x.title === "Valider le budget");
    const posDependant = ordered.findIndex((x: any) => x.title === "Choisir l'axe stratégique");

    expect(posPrerequis).toBeLessThan(posDependant);
  });

  it("applique le regroupement entre tâches qu'aucune dépendance ne relie", () => {
    // Le pendant du test précédent : sans contrainte, le regroupement doit bel et bien agir,
    // sinon on l'aurait simplement neutralisé pour faire passer le test du dessus.
    const tasks = [
      { title: "Classer les factures", workflowGroup: "admin" },
      { title: "Choisir l'axe stratégique", workflowGroup: "strategy" },
    ];

    expect(orderGeneratedTasks(tasks, []).map((x: any) => x.title)).toEqual([
      "Choisir l'axe stratégique",
      "Classer les factures",
    ]);
  });

  it("groupTasksByWorkflow reste stable à l'intérieur d'un même groupe", () => {
    const tasks = [
      { title: "A", workflowGroup: "content" },
      { title: "B", workflowGroup: "content" },
      { title: "C", workflowGroup: "content" },
    ];

    expect(groupTasksByWorkflow(tasks).map((x: any) => x.title)).toEqual(["A", "B", "C"]);
  });
});
