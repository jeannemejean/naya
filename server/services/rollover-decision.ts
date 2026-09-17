/**
 * Reporter une tâche une fois de plus, ou s'arrêter et la questionner ? PURE.
 *
 * Le cas réel qui motive cette fonction : « Publier le brouillon LinkedIn de ce matin » a été
 * créée le 30 juin et se fait reporter depuis — environ quatre-vingts fois. Elle parle d'un
 * brouillon du matin qui n'existe pas, et rien ne l'a jamais remise en question.
 *
 * L'évaluation de pertinence existait pourtant. Elle ne vivait que dans le re-tassage
 * intra-journée, que Jeanne a demandé d'arrêter parce qu'il déplaçait les tâches toutes les
 * quinze minutes et détruisait le signal « prévue à 10 h, faite à 11 h ». La déplacer ici
 * n'est pas une conséquence de cet arrêt : c'est l'endroit où elle aurait dû être, puisque
 * c'est au moment de reporter qu'on peut encore renoncer.
 */

/**
 * Nombre de reports avant de demander si la tâche a encore un sens.
 *
 * Deux : en dessous, une tâche non faite n'a rien d'anormal, et interroger dès le premier
 * report rendrait Naya insupportable.
 */
export const REPORTS_AVANT_QUESTION = 2;

export type DecisionReport = "reporter" | "questionner";

export interface EntreeDecision {
  /** `learnedAdjustmentCount`, nullable en base. */
  reportsPrecedents: number | null | undefined;
  /**
   * Verdict de l'évaluation de pertinence.
   * `null` = on n'a PAS PU savoir : modèle indisponible, quota dépassé, réponse illisible.
   * Ce n'est pas « plus pertinente ».
   */
  encorePertinente: boolean | null;
}

export function decisionReport(e: EntreeDecision): DecisionReport {
  // Pas de Math.max(0, ...) : un compteur négatif est de toute façon sous le seuil, donc la
  // borne n'aurait aucun effet. Une protection sans effet laisse croire qu'elle protège.
  const reports =
    typeof e.reportsPrecedents === "number" && Number.isFinite(e.reportsPrecedents)
      ? e.reportsPrecedents
      : 0;

  if (reports < REPORTS_AVANT_QUESTION) return "reporter";

  // Seul un verdict EXPLICITEMENT négatif arrête le report. Une évaluation indisponible fait
  // reporter : faire disparaître du travail réel parce qu'un appel réseau a raté serait le
  // défaut que ce dépôt corrige partout — une absence de mesure prise pour une mesure.
  return e.encorePertinente === false ? "questionner" : "reporter";
}
