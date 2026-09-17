import { describe, it, expect } from "vitest";
import {
  ETAPES_PROSPECT,
  ETAPE_EN_ATTENTE_DE_VALIDATION,
  ETAPE_PREMIER_CONTACT,
  type EtapeProspect,
  transitionAutorisee,
  peutEtreContacte,
  estValide,
  transitionsHumaines,
  cheminsVersPremierContact,
} from "./prospection-validation";

/**
 * La barrière de validation entre « messages prêts » et « invitation envoyée ».
 *
 * Naya prépare, l'humaine décide. En production, 43 prospects sont déjà à `messages_ready`
 * dont 41 avec un message rédigé : la barrière a des candidats réels dès sa mise en service.
 *
 * Le vocabulaire est celui de `leads.stage`, pas un vocabulaire inventé pour l'occasion —
 * une première version de ce module avait fait l'erreur, et deux vocabulaires concurrents
 * auraient divergé à la première évolution.
 */
describe("peutEtreContacte", () => {
  const valide = new Date("2026-09-17T10:00:00Z");

  it("un message prêt ET validé peut partir", () => {
    expect(peutEtreContacte({ stage: "messages_ready", validatedAt: valide })).toBe(true);
  });

  it("un message prêt mais NON validé ne part pas", () => {
    // Le cas des 41 prospects qui attendent aujourd'hui en production.
    expect(peutEtreContacte({ stage: "messages_ready", validatedAt: null })).toBe(false);
    expect(peutEtreContacte({ stage: "messages_ready", validatedAt: undefined })).toBe(false);
  });

  it("une validation ne suffit pas si l'étape n'est plus la bonne", () => {
    // Bug visé : ne regarder que `validatedAt`. Une validation ancienne autoriserait alors
    // un contact sur un prospect qui a depuis changé d'étape.
    for (const etape of ETAPES_PROSPECT) {
      if (etape === ETAPE_EN_ATTENTE_DE_VALIDATION) continue;
      expect(peutEtreContacte({ stage: etape, validatedAt: valide }), `étape ${etape}`).toBe(false);
    }
  });

  it("une étape absente ou inconnue ne permet rien", () => {
    for (const stage of [null, undefined, "", "MESSAGES_READY", "constructor"]) {
      expect(peutEtreContacte({ stage, validatedAt: valide }), `stage « ${stage} »`).toBe(false);
    }
  });
});

describe("estValide", () => {
  it("une vraie date vaut validation", () => {
    expect(estValide(new Date("2026-09-17T10:00:00Z"))).toBe(true);
  });

  it("l'absence de date n'est pas une validation", () => {
    expect(estValide(null)).toBe(false);
    expect(estValide(undefined)).toBe(false);
  });

  it("une date INVALIDE n'est pas une validation", () => {
    // Bug visé, et il est sournois : `new Date("n'importe quoi")` est un objet Date
    // parfaitement réel dont le temps vaut NaN. Un simple test de présence le prendrait
    // pour une validation, et un message partirait sur une date qui n'existe pas.
    expect(estValide(new Date("pas une date"))).toBe(false);
    expect(estValide(new Date(NaN))).toBe(false);
  });
});

describe("transitionAutorisee", () => {
  it("Naya peut préparer les messages sans demander la permission", () => {
    expect(transitionAutorisee("identified", "messages_ready")).toBe(true);
  });

  it("le premier contact EXIGE la validation", () => {
    expect(transitionAutorisee("messages_ready", "connection_sent", { validee: false })).toBe(false);
    expect(transitionAutorisee("messages_ready", "connection_sent", { validee: true })).toBe(true);
  });

  it("sans option, la validation est réputée ABSENTE", () => {
    // Bug visé : un défaut permissif. Oublier de passer l'option autoriserait l'envoi.
    expect(transitionAutorisee("messages_ready", "connection_sent")).toBe(false);
  });

  it("la suite du pipeline n'exige AUCUNE validation", () => {
    // Le reste avance sur des faits observés — la personne a accepté, elle a répondu — pas
    // sur des décisions. Exiger une validation partout rendrait le dispositif inutilisable
    // et pousserait à le contourner.
    expect(transitionAutorisee("connection_sent", "connected")).toBe(true);
    expect(transitionAutorisee("connected", "followup1_sent")).toBe(true);
    expect(transitionAutorisee("in_discussion", "proposal_sent")).toBe(true);
  });

  it("on peut renoncer à un prospect à tout moment, sans validation", () => {
    for (const etape of ETAPES_PROSPECT) {
      if (etape === "signed" || etape === "no_follow") continue;
      expect(transitionAutorisee(etape, "no_follow"), `${etape} → no_follow`).toBe(true);
    }
  });

  it("renoncer n'est pas bannir : un prospect écarté peut être repréparé", () => {
    expect(transitionAutorisee("no_follow", "messages_ready")).toBe(true);
  });

  it("aucun raccourci ne saute la préparation", () => {
    expect(transitionAutorisee("identified", "connection_sent", { validee: true })).toBe(false);
    expect(transitionAutorisee("identified", "connected", { validee: true })).toBe(false);
  });

  it("AUCUN chemin n'atteint le premier contact sans passer par messages_ready", () => {
    // LE test du lot. Il vérifie une propriété du graphe entier, pas une transition : quel
    // que soit le départ, tout chemin menant au premier contact traverse l'étape où la
    // validation est exigée. Un raccourci ajouté plus tard le ferait tomber.
    for (const depart of ETAPES_PROSPECT) {
      for (const chemin of cheminsVersPremierContact(depart)) {
        expect(chemin, `depuis ${depart} : ${chemin.join(" → ")}`).toContain(
          ETAPE_EN_ATTENTE_DE_VALIDATION,
        );
      }
    }
  });

  it("une étape signée est terminale", () => {
    for (const vers of ETAPES_PROSPECT) {
      expect(transitionAutorisee("signed", vers, { validee: true }), `signed → ${vers}`).toBe(false);
    }
  });

  it("une étape inconnue n'autorise rien", () => {
    for (const inconnu of ["", "valide", "CONNECTED", "constructor", "toString", "__proto__"]) {
      expect(
        transitionAutorisee(inconnu as EtapeProspect, "connection_sent", { validee: true }),
        `« ${inconnu} » en départ`,
      ).toBe(false);
      expect(
        transitionAutorisee("messages_ready", inconnu as EtapeProspect, { validee: true }),
        `« ${inconnu} » en arrivée`,
      ).toBe(false);
    }
  });
});

describe("transitionsHumaines", () => {
  it("autoriser le premier contact est la SEULE décision réservée à une personne", () => {
    expect(transitionsHumaines()).toEqual([
      [ETAPE_EN_ATTENTE_DE_VALIDATION, ETAPE_PREMIER_CONTACT],
    ]);
  });

  it("cette liste n'a qu'une entrée", () => {
    // La voir grossir signalerait qu'une décision humaine vient d'être automatisée, ou
    // qu'une décision mécanique a été promue en corvée inutile.
    expect(transitionsHumaines()).toHaveLength(1);
  });
});
