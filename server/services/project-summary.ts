export const PROJECT_STAGES = ["ideation", "early", "growth", "mature"] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number];

export function isValidStage(s: string): boolean {
  return (PROJECT_STAGES as readonly string[]).includes(s);
}

/** Prompt (userMessage) envoyé à Claude pour le "point de situation" d'un projet. */
export function buildSituationPrompt(projectName: string): string {
  return `Fais un POINT DE SITUATION court et concret sur le projet « ${projectName} », à partir de tout ce que tu sais (stade, statut noté par l'utilisateur, jalons faits/à venir, objectif). Deux parties, sans blabla :
1) Où en est ce projet, en 2-3 phrases (ce qui avance, ce qui traîne).
2) Les 2-3 PROCHAINES priorités concrètes.
Ton direct et utile. Pas de tiret long. Pas de liste à puces interminable.`;
}
