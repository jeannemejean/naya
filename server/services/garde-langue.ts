// Remet dans la langue du compte les textes de tâches générés dans une autre langue.
//
// Pourquoi : voir `ecritDansUneAutreLangue` dans shared/language.ts. La consigne de langue
// est transmise au modèle, mais les prompts de génération sont en anglais et le modèle
// rapide les imite sur une partie des sorties. Jeanne : « il faut absolument que ça
// n'arrive pas ». On vérifie donc la sortie, champ par champ.
//
// Ne lève jamais : une traduction ratée laisse le texte d'origine. Mieux vaut une tâche
// dans la mauvaise langue qu'une génération de planning perdue.

import { consigneDeTraduction, ecritDansUneAutreLangue, resolveLanguage, type Language } from "@shared/language";
import { callClaude, CLAUDE_MODELS } from "./claude";
import { storage } from "../storage";

const CHAMPS = ["title", "description", "activationPrompt"] as const;
type Champ = (typeof CHAMPS)[number];
type TacheTextuelle = Partial<Record<Champ, unknown>>;

/** Traduit une liste de textes ; rend une liste de même longueur. Injectable pour les tests. */
export type Traducteur = (textes: string[], langue: Language) => Promise<string[]>;

export const traducteurClaude = (userId?: string): Traducteur => async (textes, langue) => {
  const brut = await callClaude({
    model: CLAUDE_MODELS.fast,
    system: consigneDeTraduction(langue),
    messages: [{ role: "user", content: JSON.stringify(textes) }],
    max_tokens: 2000,
    userId,
    taskKind: "fast_generation",
  });
  const json = brut.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(json);
};

/**
 * Corrige EN PLACE les champs textuels écrits dans une autre langue que `langue`, et rend
 * le nombre de champs corrigés. Un seul appel au traducteur pour tout le lot.
 */
export async function imposerLangue(
  taches: TacheTextuelle[],
  langue: Language,
  traduire: Traducteur,
): Promise<number> {
  const cibles: Array<{ tache: TacheTextuelle; champ: Champ; texte: string }> = [];
  for (const tache of taches ?? []) {
    for (const champ of CHAMPS) {
      const v = tache?.[champ];
      if (typeof v === "string" && ecritDansUneAutreLangue(v, langue)) {
        cibles.push({ tache, champ, texte: v });
      }
    }
  }
  if (cibles.length === 0) return 0;

  try {
    const traduits = await traduire(cibles.map((c) => c.texte), langue);
    if (!Array.isArray(traduits) || traduits.length !== cibles.length) {
      console.error(`[GardeLangue] réponse inexploitable (${cibles.length} attendus) — textes d'origine gardés`);
      return 0;
    }
    let corriges = 0;
    cibles.forEach((c, i) => {
      const t = traduits[i];
      if (typeof t === "string" && t.trim()) {
        c.tache[c.champ] = t.trim();
        corriges++;
      }
    });
    console.log(`[GardeLangue] ${corriges} texte(s) remis en ${langue}`);
    return corriges;
  } catch (err: any) {
    console.error("[GardeLangue] traduction échouée — textes d'origine gardés:", err?.message ?? err);
    return 0;
  }
}

/** Variante qui lit la langue du compte. Ne lève jamais. */
export async function imposerLangueDuCompte(taches: TacheTextuelle[], userId: string): Promise<number> {
  let langue: Language;
  try {
    const prefs = await storage.getUserPreferences(userId);
    langue = resolveLanguage({ account: (prefs as any)?.language });
  } catch {
    langue = resolveLanguage({});
  }
  return imposerLangue(taches, langue, traducteurClaude(userId));
}
