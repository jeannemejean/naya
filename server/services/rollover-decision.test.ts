import { describe, it, expect } from "vitest";
import { decisionReport, REPORTS_AVANT_QUESTION } from "./rollover-decision";

/**
 * Faut-il reporter une tâche une fois de plus, ou s'arrêter et la questionner ?
 *
 * Le cas réel qui motive cette fonction : « Publier le brouillon LinkedIn de ce matin » a été
 * créée le 30 juin et se fait reporter depuis — environ quatre-vingts fois. Elle parle d'un
 * brouillon du matin qui n'existe pas, et rien ne l'a jamais remise en question.
 *
 * L'évaluation de pertinence existait pourtant, mais uniquement dans le re-tassage
 * intra-journée, que Jeanne a demandé d'arrêter. La déplacer ici n'est pas un effet de bord
 * de cet arrêt : c'est l'endroit où elle aurait dû être depuis le début, puisque c'est au
 * moment de reporter qu'on peut encore renoncer.
 */
describe("decisionReport", () => {
  it("les premiers reports se font sans rien demander", () => {
    // Une tâche non faite aujourd'hui n'a rien d'anormal. Interroger dès le premier report
    // rendrait Naya insupportable.
    for (let n = 0; n < REPORTS_AVANT_QUESTION; n += 1) {
      expect(decisionReport({ reportsPrecedents: n, encorePertinente: null }), `${n} report(s)`).toBe(
        "reporter",
      );
    }
  });

  it("au seuil, une tâche jugée dépassée est questionnée au lieu d'être reportée", () => {
    expect(
      decisionReport({ reportsPrecedents: REPORTS_AVANT_QUESTION, encorePertinente: false }),
    ).toBe("questionner");
  });

  it("au seuil, une tâche jugée encore pertinente est reportée normalement", () => {
    expect(
      decisionReport({ reportsPrecedents: REPORTS_AVANT_QUESTION, encorePertinente: true }),
    ).toBe("reporter");
  });

  it("une évaluation INDISPONIBLE fait reporter, jamais disparaître", () => {
    // LE test. `null` veut dire « on n'a pas pu savoir » — modèle indisponible, quota
    // dépassé, réponse illisible. Traiter cette absence comme « plus pertinente » ferait
    // disparaître du travail réel parce qu'un appel réseau a raté. C'est le motif corrigé
    // partout dans ce dépôt : une absence de mesure n'est pas une mesure.
    for (const n of [REPORTS_AVANT_QUESTION, 10, 80]) {
      expect(decisionReport({ reportsPrecedents: n, encorePertinente: null }), `${n} reports`).toBe(
        "reporter",
      );
    }
  });

  it("le nombre de reports ne rend pas la question inévitable", () => {
    // Bug visé : questionner systématiquement au-delà du seuil, sans regarder la pertinence.
    // Une tâche longue et légitime serait remise en cause chaque soir.
    expect(decisionReport({ reportsPrecedents: 80, encorePertinente: true })).toBe("reporter");
  });

  it("un compteur absent ou aberrant vaut zéro report", () => {
    // `learnedAdjustmentCount` est nullable en base, et NaN comparé à un seuil est toujours
    // faux — on le traite donc explicitement plutôt que de compter sur ce hasard.
    //
    // Le cas -3 ne discrimine rien : un compteur négatif est sous le seuil de toute façon.
    // Il est gardé pour documenter l'entrée, pas pour prouver une protection.
    for (const aberrant of [null, undefined, NaN, -3]) {
      expect(
        decisionReport({ reportsPrecedents: aberrant as number, encorePertinente: false }),
        `compteur ${String(aberrant)}`,
      ).toBe("reporter");
    }
  });

  it("le seuil est une constante exportée, pas un nombre au milieu du code", () => {
    expect(REPORTS_AVANT_QUESTION).toBe(2);
  });
});
