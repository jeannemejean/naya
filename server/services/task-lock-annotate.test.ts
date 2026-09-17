import { describe, it, expect } from "vitest";
import { annoterVerrous, prerequisManquants } from "./task-lock-annotate";

/**
 * Annotation d'une liste de tâches avec leur verrou, pour que l'interface puisse afficher
 * le cadenas et le nom de ce qui bloque.
 *
 * Le piège que ce module existe pour éviter : calculer le verrou à partir des SEULES tâches
 * affichées. Un prérequis planifié la veille ne serait alors pas trouvé, donc traité comme
 * introuvable, donc non bloquant — et le verrou se désactiverait en silence précisément dans
 * le cas le plus courant, celui d'une chaîne qui s'étale sur plusieurs jours.
 */

const t = (id: number, title: string, completed = false) => ({ id, title, completed });

describe("annoterVerrous", () => {
  it("une tâche sans dépendance n'est pas verrouillée", () => {
    const [a] = annoterVerrous({ taches: [t(1, "Seule")], dependances: [], etats: new Map() });

    expect(a.verrouillee).toBe(false);
    expect(a.bloqueePar).toEqual([]);
  });

  it("verrouille quand le prérequis est dans la même liste et non coché", () => {
    const taches = [t(344, "Publier"), t(422, "Rédiger")];
    const [publier] = annoterVerrous({
      taches,
      dependances: [{ taskId: 344, dependsOnTaskId: 422 }],
      etats: new Map(),
    });

    expect(publier.verrouillee).toBe(true);
    expect(publier.bloqueePar).toEqual([{ id: 422, titre: "Rédiger" }]);
  });

  it("verrouille quand le prérequis est HORS de la liste affichée", () => {
    // LE test. « Publier » est aujourd'hui, « Rédiger » était hier : elle n'apparaît pas dans
    // la liste du jour. Sans les états fournis a part, elle passerait pour introuvable et ne
    // bloquerait rien — le verrou serait inopérant sur toute chaine a cheval sur deux jours.
    const [publier] = annoterVerrous({
      taches: [t(344, "Publier")],
      dependances: [{ taskId: 344, dependsOnTaskId: 422 }],
      etats: new Map([[422, { title: "Rédiger (hier)", completed: false }]]),
    });

    expect(publier.verrouillee).toBe(true);
    expect(publier.bloqueePar).toEqual([{ id: 422, titre: "Rédiger (hier)" }]);
  });

  it("un prérequis coché hors liste ne verrouille pas", () => {
    const [publier] = annoterVerrous({
      taches: [t(344, "Publier")],
      dependances: [{ taskId: 344, dependsOnTaskId: 422 }],
      etats: new Map([[422, { title: "Rédiger", completed: true }]]),
    });

    expect(publier.verrouillee).toBe(false);
  });

  it("la liste de la tâche l'emporte sur les états fournis", () => {
    // Bug visé : afficher « verrouillée » alors que la case vient d'être cochée dans la même
    // page, parce qu'un état plus ancien traînait dans la table auxiliaire.
    const [publier] = annoterVerrous({
      taches: [t(344, "Publier"), t(422, "Rédiger", true)],
      dependances: [{ taskId: 344, dependsOnTaskId: 422 }],
      etats: new Map([[422, { title: "Rédiger", completed: false }]]),
    });

    expect(publier.verrouillee).toBe(false);
  });

  it("chaque tâche ne reçoit QUE ses propres dépendances", () => {
    // Bug visé : appliquer toutes les dépendances a toutes les tâches, ce qui verrouillerait
    // la journée entière des qu'une seule tâche est bloquée.
    const annotees = annoterVerrous({
      taches: [t(1, "A"), t(2, "B"), t(3, "C")],
      dependances: [{ taskId: 3, dependsOnTaskId: 1 }],
      etats: new Map(),
    });

    expect(annotees.find((x) => x.id === 1)!.verrouillee).toBe(false);
    expect(annotees.find((x) => x.id === 2)!.verrouillee).toBe(false);
    expect(annotees.find((x) => x.id === 3)!.verrouillee).toBe(true);
  });

  it("conserve tous les champs d'origine de la tâche", () => {
    // Bug visé : reconstruire un objet partiel et perdre l'heure, la durée, le projet.
    const source = { id: 1, title: "A", completed: false, scheduledTime: "09:00", projectId: 7 };
    const [a] = annoterVerrous({ taches: [source], dependances: [], etats: new Map() });

    expect(a).toMatchObject(source);
  });

  it("une liste vide ne casse rien", () => {
    expect(annoterVerrous({ taches: [], dependances: [], etats: new Map() })).toEqual([]);
  });

  it("les identifiants de prérequis à recuperer sont ceux qui manquent à la liste", () => {
    // Utilisé par la route pour ne charger que le strict nécessaire.
    const manquants = prerequisManquants(
      [t(344, "Publier")],
      [
        { taskId: 344, dependsOnTaskId: 422 },
        { taskId: 344, dependsOnTaskId: 344 },
      ],
    );

    expect(manquants).toEqual([422]);
  });
});
