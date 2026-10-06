// Génération d'une tâche de remplacement après un refus. Ne lève jamais.
import { callClaudeWithContext, CLAUDE_MODELS } from "../claude";
import { imposerLangueDuCompte } from "../garde-langue";
import { remplacerReferencesNumerotees } from "../references-taches";
import { libelleRaison, validerRemplacement, type RaisonRefus, type Remplacement } from "./pur";

// Retire les clôtures ``` éventuelles autour du JSON.
function retirerClotures(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export async function genererRemplacement(input: {
  userId: string;
  tache: { title: string; description?: string | null; type?: string | null; category?: string | null; estimatedDuration?: number | null; projectId?: number | null };
  raison: RaisonRefus;
  freeText?: string | null;
  refusRecents: string[];
}): Promise<Remplacement | null> {
  try {
    const { userId, tache, raison, freeText, refusRecents } = input;
    const explication = (freeText ?? "").trim().slice(0, 1500);
    const message = [
      "The user refused this task:",
      `Title: ${tache.title}`,
      `Description: ${tache.description || ""}`,
      `Reason: ${libelleRaison(raison)}`,
      explication ? `Explanation from the user: ${explication}` : "",
      refusRecents.length ? `Recent refusals and dismissals:\n${refusRecents.slice(0, 10).join("\n")}` : "",
      "",
      "Propose ONE replacement task serving the same goal for this project, avoiding what was refused and why.",
      "The description must be self-contained; never refer to another task by number.",
      'Respond with JSON only: {"title","description","type","category","estimatedDuration","activationPrompt"}',
    ].filter(Boolean).join("\n");

    const texte = await callClaudeWithContext({
      userId,
      projectId: tache.projectId ?? null,
      userMessage: message,
      model: CLAUDE_MODELS.fast,
      max_tokens: 800,
    });

    let brut: unknown;
    try {
      brut = JSON.parse(retirerClotures(texte));
    } catch {
      console.error("[refus] génération : réponse non JSON");
      return null;
    }
    const r = validerRemplacement(brut, tache.estimatedDuration);
    if (!r) {
      console.error("[refus] génération : remplacement invalide");
      return null;
    }
    await imposerLangueDuCompte([r as any], userId);
    r.description = remplacerReferencesNumerotees(r.description, []);
    if (r.activationPrompt) r.activationPrompt = remplacerReferencesNumerotees(r.activationPrompt, []);
    return r;
  } catch (e: any) {
    console.error("[refus] génération échouée :", e?.message || e);
    return null;
  }
}
