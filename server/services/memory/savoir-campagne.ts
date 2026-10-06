import { retrieveMemories } from "./retrieve";

/** Intitulé imposé de la section injectée dans les prompts de campagne. */
export const TITRE_SAVOIR = "CE QU'ON T'A APPRIS (recherche déposée)";

/** Formate les morceaux de savoir en lignes à puces ; undefined s'il n'y en a pas. */
export function formaterSavoirCampagne(morceaux: Array<{ content: string }>): string | undefined {
  const lignes = morceaux.map((m) => (m.content ?? "").trim()).filter(Boolean).map((c) => `- ${c}`);
  return lignes.length ? lignes.join("\n") : undefined;
}

/**
 * Savoir déposé pertinent pour une campagne. Best-effort : toute défaillance → undefined,
 * la génération continue avec un prompt inchangé.
 */
export async function savoirPourCampagne(
  userId: string,
  projectId: number | null | undefined,
  focus: { objective?: string; name?: string },
): Promise<string | undefined> {
  try {
    const focusText = [focus.objective, focus.name].filter(Boolean).join(" — ");
    const mem = await retrieveMemories(userId, projectId ?? null, focusText || undefined);
    return formaterSavoirCampagne(mem.savoir ?? []);
  } catch {
    return undefined;
  }
}
