// Remet dans la langue du compte les textes de tâches générés dans une autre langue.
//
// Pourquoi : voir `ecritDansUneAutreLangue` dans shared/language.ts. La consigne de langue
// est transmise au modèle, mais les prompts de génération sont en anglais et le modèle
// rapide les imite sur une partie des sorties. Jeanne : « il faut absolument que ça
// n'arrive pas ». On vérifie donc la sortie, champ par champ.
//
// Ne lève jamais : une traduction ratée laisse le texte d'origine. Mieux vaut une tâche
// dans la mauvaise langue qu'une génération de planning perdue.
//
// 9 octobre 2026 : le lot entier partait en UN appel (max_tokens 2000). Une semaine de
// tâches avec descriptions dépassait le budget, la réponse arrivait tronquée, le JSON.parse
// échouait et TOUT restait en anglais, sans bruit. D'où : paquets d'au plus
// `TACHES_PAR_PAQUET` tâches, réponse tronquée refusée, un nouvel essai par paquet, puis un
// repli minimal sur les seuls titres — ce que l'utilisatrice voit en premier.

import { consigneDeTraduction, ecritDansUneAutreLangue, resolveLanguage, type Language } from "@shared/language";
import { callClaudeDetailed, CLAUDE_MODELS } from "./claude";
import { storage } from "../storage";

const CHAMPS = ["title", "description", "activationPrompt"] as const;
type Champ = (typeof CHAMPS)[number];
type TacheTextuelle = Partial<Record<Champ, unknown>>;

/** Nombre maximal de tâches traduites par appel au modèle. */
export const TACHES_PAR_PAQUET = 4;

/** Traduit une liste de textes ; rend une liste de même longueur. Injectable pour les tests. */
export type Traducteur = (textes: string[], langue: Language) => Promise<string[]>;

export const traducteurClaude = (userId?: string): Traducteur => async (textes, langue) => {
  const { text, stopReason } = await callClaudeDetailed({
    model: CLAUDE_MODELS.fast,
    system: consigneDeTraduction(langue),
    messages: [{ role: "user", content: JSON.stringify(textes) }],
    max_tokens: 4000,
    userId,
    taskKind: "fast_generation",
  });
  if (stopReason === "max_tokens" || stopReason === "length") {
    throw new Error(`réponse tronquée (${textes.length} textes)`);
  }
  const json = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(json);
};

type Cible = { tache: TacheTextuelle; champ: Champ; texte: string };

/** Traduit et applique un paquet de cibles. Rend le nombre de champs corrigés, ou null si échec. */
async function traduirePaquet(cibles: Cible[], langue: Language, traduire: Traducteur): Promise<number | null> {
  try {
    const traduits = await traduire(cibles.map((c) => c.texte), langue);
    if (!Array.isArray(traduits) || traduits.length !== cibles.length) {
      console.error(`[GardeLangue] réponse inexploitable (${cibles.length} attendus, ${Array.isArray(traduits) ? traduits.length : typeof traduits} reçus)`);
      return null;
    }
    let corriges = 0;
    cibles.forEach((c, i) => {
      const t = traduits[i];
      if (typeof t === "string" && t.trim()) {
        c.tache[c.champ] = t.trim();
        corriges++;
      }
    });
    return corriges;
  } catch (err: any) {
    console.error(`[GardeLangue] traduction échouée (${cibles.length} textes):`, err?.message ?? err);
    return null;
  }
}

/**
 * Corrige EN PLACE les champs textuels écrits dans une autre langue que `langue`, et rend
 * le nombre de champs corrigés. Les tâches sont traduites par paquets d'au plus
 * `TACHES_PAR_PAQUET` ; un paquet qui échoue est retenté une fois, puis réduit à ses titres.
 */
export async function imposerLangue(
  taches: TacheTextuelle[],
  langue: Language,
  traduire: Traducteur,
): Promise<number> {
  // Cibles regroupées par tâche, pour découper le lot en paquets de tâches entières.
  const parTache: Cible[][] = [];
  for (const tache of taches ?? []) {
    const cibles: Cible[] = [];
    for (const champ of CHAMPS) {
      const v = tache?.[champ];
      if (typeof v === "string" && ecritDansUneAutreLangue(v, langue)) {
        cibles.push({ tache, champ, texte: v });
      }
    }
    if (cibles.length > 0) parTache.push(cibles);
  }
  if (parTache.length === 0) return 0;

  let corriges = 0;
  let restes = 0;
  for (let i = 0; i < parTache.length; i += TACHES_PAR_PAQUET) {
    const paquet = parTache.slice(i, i + TACHES_PAR_PAQUET).flat();

    let n = await traduirePaquet(paquet, langue, traduire);
    if (n === null) n = await traduirePaquet(paquet, langue, traduire); // un nouvel essai
    if (n === null) {
      // Repli minimal : au moins les titres, ce que l'utilisatrice lit en premier.
      const titres = paquet.filter((c) => c.champ === "title");
      n = titres.length > 0 ? await traduirePaquet(titres, langue, traduire) : null;
      if (n === null) {
        restes += paquet.length;
        console.error(`[GardeLangue] ${paquet.length} texte(s) laissés dans la mauvaise langue après repli`);
        continue;
      }
      restes += paquet.length - titres.length;
      console.warn(`[GardeLangue] repli sur les titres : ${paquet.length - titres.length} description(s) non traduite(s)`);
    }
    corriges += n;
  }

  console.log(`[GardeLangue] ${corriges} texte(s) remis en ${langue}${restes ? `, ${restes} non traduit(s)` : ""}`);
  return corriges;
}

/** Langue du compte (préférence enregistrée, sinon défaut). Ne lève jamais. */
export async function langueDuCompte(userId: string): Promise<Language> {
  try {
    const prefs = await storage.getUserPreferences(userId);
    return resolveLanguage({ account: (prefs as any)?.language });
  } catch {
    return resolveLanguage({});
  }
}

/** Variante qui lit la langue du compte. Ne lève jamais. */
export async function imposerLangueDuCompte(taches: TacheTextuelle[], userId: string): Promise<number> {
  const langue = await langueDuCompte(userId);
  return imposerLangue(taches, langue, traducteurClaude(userId));
}
