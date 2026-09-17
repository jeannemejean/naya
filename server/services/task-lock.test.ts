import { describe, it, expect } from "vitest";
import { verrouDeTache } from "./task-lock";

/**
 * Le verrou : une tâche dont l'étape précédente n'est pas cochée ne peut pas être cochée.
 *
 * Demande de Jeanne (17 septembre) : « si on a une tâche qui mène à un but relié à un
 * objectif, on est obligé de passer par toutes les étapes, et pour que l'étape suivante soit
 * mise dans le calendrier il faut que la précédente soit validée — donc il faut que
 * l'utilisateur les coche. »
 *
 * Arbitrage : la tâche suivante reste VISIBLE, verrouillée, avec le nom de ce qui la bloque.
 * On voit la chaîne entière plutôt que de découvrir les étapes une par une.
 */

const prerequis = (id: number, title: string, completed: boolean) => [id, { title, completed }] as const;

describe("verrouDeTache", () => {
  it("sans dépendance, rien ne verrouille", () => {
    const r = verrouDeTache({ dependances: [], prerequis: new Map() });

    expect(r.verrouillee).toBe(false);
    expect(r.bloqueePar).toEqual([]);
  });

  it("un prérequis non coché verrouille, et se nomme", () => {
    // Le cas rapporté : publier avant d'avoir rédigé.
    const r = verrouDeTache({
      dependances: [{ dependsOnTaskId: 422 }],
      prerequis: new Map([prerequis(422, "Rédiger le post LinkedIn", false)]),
    });

    expect(r.verrouillee).toBe(true);
    expect(r.bloqueePar).toEqual([{ id: 422, titre: "Rédiger le post LinkedIn" }]);
  });

  it("un prérequis coché libère la tâche", () => {
    const r = verrouDeTache({
      dependances: [{ dependsOnTaskId: 422 }],
      prerequis: new Map([prerequis(422, "Rédiger le post LinkedIn", true)]),
    });

    expect(r.verrouillee).toBe(false);
    expect(r.bloqueePar).toEqual([]);
  });

  it("il suffit d'UN prérequis non coché pour verrouiller", () => {
    // Bug visé : se contenter d'un `some(completed)` au lieu d'un `every`.
    const r = verrouDeTache({
      dependances: [{ dependsOnTaskId: 1 }, { dependsOnTaskId: 2 }],
      prerequis: new Map([prerequis(1, "Fait", true), prerequis(2, "Pas fait", false)]),
    });

    expect(r.verrouillee).toBe(true);
    expect(r.bloqueePar).toEqual([{ id: 2, titre: "Pas fait" }]);
  });

  it("tous les bloqueurs sont nommés, pas seulement le premier", () => {
    const r = verrouDeTache({
      dependances: [{ dependsOnTaskId: 1 }, { dependsOnTaskId: 2 }],
      prerequis: new Map([prerequis(1, "A", false), prerequis(2, "B", false)]),
    });

    expect(r.bloqueePar).toHaveLength(2);
  });

  it("un prérequis INTROUVABLE ne verrouille pas", () => {
    // LE test. Une tâche supprimée ne sera jamais cochée : la traiter comme bloquante
    // verrouillerait la suivante POUR TOUJOURS, sans que rien n'indique pourquoi ni comment
    // en sortir. Un lien casse doit liberer, jamais emprisonner.
    const r = verrouDeTache({
      dependances: [{ dependsOnTaskId: 999 }],
      prerequis: new Map(),
    });

    expect(r.verrouillee).toBe(false);
    expect(r.bloqueePar).toEqual([]);
  });

  it("une dépendance sur soi-même ne verrouille pas", () => {
    // Bug visé : une tâche qui se bloque elle-même serait incochable a jamais.
    const r = verrouDeTache({
      dependances: [{ dependsOnTaskId: 7 }],
      prerequis: new Map([prerequis(7, "Moi-même", false)]),
      tacheId: 7,
    });

    expect(r.verrouillee).toBe(false);
  });

  it("un identifiant de dépendance absent est ignoré", () => {
    for (const absent of [null, undefined, NaN]) {
      const r = verrouDeTache({
        dependances: [{ dependsOnTaskId: absent as number }],
        prerequis: new Map([prerequis(1, "A", false)]),
      });
      expect(r.verrouillee, `dependsOnTaskId = ${String(absent)}`).toBe(false);
    }
  });

  it("le même prérequis cité deux fois n'est nommé qu'une fois", () => {
    // Bug visé : afficher « attend : Rédiger, Rédiger » à l'utilisatrice.
    const r = verrouDeTache({
      dependances: [{ dependsOnTaskId: 1 }, { dependsOnTaskId: 1 }],
      prerequis: new Map([prerequis(1, "Rédiger", false)]),
    });

    expect(r.bloqueePar).toEqual([{ id: 1, titre: "Rédiger" }]);
  });

  it("un prérequis sans titre reste nommable", () => {
    // Bug visé : afficher « attend : undefined ».
    const r = verrouDeTache({
      dependances: [{ dependsOnTaskId: 1 }],
      prerequis: new Map([[1, { title: "", completed: false }]]),
    });

    expect(r.verrouillee).toBe(true);
    expect(r.bloqueePar[0].titre.length).toBeGreaterThan(0);
  });
});
