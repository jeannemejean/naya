import { describe, it, expect } from "vitest";
import {
  ETATS_PROSPECT,
  type EtatProspect,
  transitionAutorisee,
  peutEntrerEnCampagne,
  transitionsHumaines,
  cheminVersCampagne,
} from "./prospection-validation";

/**
 * La barrière de validation entre un prospect préparé et son entrée en campagne.
 *
 * Demande de Jeanne : « la tâche doit être réalisée par Naya en ne demandant qu'une simple
 * validation de l'utilisateur ». Naya prépare le message, l'humaine décide. Cette séparation
 * n'est pas qu'une commodité d'interface : c'est la seule conduite défendable sur LinkedIn,
 * où l'automatisation d'invitations et de messages fait l'objet de poursuites contre les
 * éditeurs, et de restrictions graduées contre les comptes.
 *
 * C'est aussi la règle permanente de ce dépôt depuis l'incident des 14 posts publiés par
 * erreur : rien qui agit vers l'extérieur ne part sans qu'un humain l'ait voulu.
 */
describe("transitions d'état d'un prospect", () => {
  it("Naya peut préparer un prospect découvert", () => {
    expect(transitionAutorisee("discovered", "prepared")).toBe(true);
  });

  it("l'humaine peut valider ou écarter un prospect préparé", () => {
    expect(transitionAutorisee("prepared", "validated")).toBe(true);
    expect(transitionAutorisee("prepared", "rejected")).toBe(true);
  });

  it("un prospect validé peut entrer en campagne", () => {
    expect(transitionAutorisee("validated", "enrolled")).toBe(true);
  });

  it("un prospect écarté peut être repréparé plus tard", () => {
    // Écarter n'est pas bannir : un message mal tourné aujourd'hui peut être réécrit.
    expect(transitionAutorisee("rejected", "prepared")).toBe(true);
  });

  it("AUCUN chemin ne mène en campagne sans passer par la validation", () => {
    // LE test du lot. Il ne vérifie pas une transition, il vérifie une PROPRIÉTÉ du graphe
    // entier : quel que soit le point de départ, tout chemin menant à `enrolled` traverse
    // `validated`. Une transition ajoutée par mégarde plus tard le ferait tomber.
    for (const depart of ETATS_PROSPECT) {
      for (const chemin of cheminVersCampagne(depart)) {
        expect(chemin, `chemin depuis ${depart} : ${chemin.join(" → ")}`).toContain("validated");
      }
    }
  });

  it("rien ne saute la préparation ni la validation", () => {
    expect(transitionAutorisee("discovered", "enrolled")).toBe(false);
    expect(transitionAutorisee("discovered", "validated")).toBe(false);
    expect(transitionAutorisee("prepared", "enrolled")).toBe(false);
    expect(transitionAutorisee("rejected", "enrolled")).toBe(false);
    expect(transitionAutorisee("rejected", "validated")).toBe(false);
  });

  it("un prospect déjà en campagne n'y rentre pas deux fois", () => {
    for (const vers of ETATS_PROSPECT) {
      expect(transitionAutorisee("enrolled", vers), `enrolled → ${vers}`).toBe(false);
    }
  });

  it("aucun état ne se transitionne vers lui-même", () => {
    // Bug visé : une boucle sur soi masquerait une absence de progression en la faisant
    // passer pour un changement d'état réussi.
    for (const e of ETATS_PROSPECT) {
      expect(transitionAutorisee(e, e), `${e} → ${e}`).toBe(false);
    }
  });

  it("un état inconnu n'autorise rien", () => {
    // `type` vient de la base : rien ne garantit qu'elle ne contiendra pas une valeur
    // ancienne ou mal écrite. Dans le doute, on refuse — on n'enrôle pas.
    for (const inconnu of ["", "valide", "VALIDATED", "constructor", "toString"]) {
      expect(
        transitionAutorisee(inconnu as EtatProspect, "enrolled"),
        `« ${inconnu} » → enrolled`,
      ).toBe(false);
      expect(peutEntrerEnCampagne(inconnu as EtatProspect), `« ${inconnu} »`).toBe(false);
    }
  });
});

describe("peutEntrerEnCampagne", () => {
  it("seul un prospect validé le peut", () => {
    for (const e of ETATS_PROSPECT) {
      expect(peutEntrerEnCampagne(e), `état ${e}`).toBe(e === "validated");
    }
  });
});

describe("transitionsHumaines", () => {
  it("valider et écarter sont les SEULES décisions réservées à l'humaine", () => {
    // Ce que Naya n'a pas le droit de faire seule. Si une transition venait à sortir de
    // cette liste, elle deviendrait automatisable sans que personne ne le remarque.
    expect(transitionsHumaines()).toEqual(
      expect.arrayContaining([
        ["prepared", "validated"],
        ["prepared", "rejected"],
      ]),
    );
    expect(transitionsHumaines()).toHaveLength(2);
  });

  it("l'entrée en campagne n'est PAS une décision humaine", () => {
    // Elle découle de la validation : une fois validé, le prospect entre. L'humaine décide
    // du message, pas de la mécanique.
    const humaines = transitionsHumaines().map(([de, vers]) => `${de}->${vers}`);
    expect(humaines).not.toContain("validated->enrolled");
  });
});
