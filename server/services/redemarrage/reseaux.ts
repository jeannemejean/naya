// Évaluation des réseaux de fin de séance (remplacée par la version complète, Task 8).
export interface EvaluationReseaux { depuis: string; parReseau: unknown[]; limites: string[] }
export const depsEvaluation = {};
export async function evaluationReseaux(_deps: unknown, _userId: string, depuis: Date, _maintenant: Date): Promise<EvaluationReseaux> {
  return { depuis: depuis.toISOString(), parReseau: [], limites: ["evaluation_indisponible"] };
}
