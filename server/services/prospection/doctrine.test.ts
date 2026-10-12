import { describe, it, expect } from "vitest";
import {
  blocDoctrine, LIMITES, TICS_INTERDITS, MOTIFS_QUESTION_REFLEXION, MOTIFS_TRACKING, estQuestionDeReflexion,
} from "./doctrine";

describe("doctrine de prospection", () => {
  it("le bloc contient les huit règles et la limite exacte du rôle", () => {
    const b = blocDoctrine("invitation", "linkedin");
    expect(b).toContain("DÉCLENCHEUR RÉEL");
    expect(b).toContain("QUI ÉCRIT");
    expect(b).toContain("DONNER AVANT DE DEMANDER");
    expect(b).toContain("DEMANDE FACILE");
    expect(b).toContain("COURT");
    expect(b).toContain("RELANCE");
    expect(b).toContain("CLÔTURE");
    expect(b).toContain("STYLE");
    expect(b).toContain(`${LIMITES.invitation.maxCaracteres} caractères`);
  });

  it("la règle propre au rôle est présente", () => {
    expect(blocDoctrine("cloture", "email")).toMatch(/ferme la porte/i);
    expect(blocDoctrine("email_ouverture", "email")).toMatch(/objet/i);
  });

  it("ne demande jamais une question ouverte en fin de message", () => {
    const b = blocDoctrine("premier_message", "linkedin");
    expect(b).not.toMatch(/termine par une (seule )?question ouverte/i);
  });

  it("les tics IA connus sont interdits", () => {
    for (const t of ["resonner", "regard exterieur", "je me permets", "la couture entre"]) {
      expect(TICS_INTERDITS).toContain(t);
    }
  });

  it("repère une question de réflexion mais pas une demande facile", () => {
    expect(estQuestionDeReflexion("Comment pensez-vous l'équilibre entre héritage et renouveau ?")).toBe(true);
    expect(estQuestionDeReflexion("Qu'est-ce qui guide vos arbitrages éditoriaux quand les deux entrent en tension ?")).toBe(true);
    expect(estQuestionDeReflexion("Je vous l'envoie ?")).toBe(false);
    expect(estQuestionDeReflexion("C'est un sujet chez vous en ce moment ?")).toBe(false);
    expect(MOTIFS_QUESTION_REFLEXION.length).toBeGreaterThan(0);
  });

  it("repère un tracking avoué", () => {
    const t = "Vous avez jeté un œil à mon message précédent, ce qui m'a donné envie de revenir vers vous.";
    expect(MOTIFS_TRACKING.some((r) => r.test(t))).toBe(true);
    expect(MOTIFS_TRACKING.some((r) => r.test("Je vous envoie le cas complet."))).toBe(false);
  });
});
