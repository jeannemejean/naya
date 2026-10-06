// Seul endroit du code qui décide d'une langue. Importé par le serveur ET par le client
// pour qu'il n'existe jamais deux réponses différentes à « quelle langue ? ».

export type Language = "fr" | "en";

export const SUPPORTED_LANGUAGES: readonly Language[] = ["fr", "en"] as const;

/** Le français est la langue par défaut de Naya (cf. CLAUDE.md). */
export const DEFAULT_LANGUAGE: Language = "fr";

/** Renvoie la langue si elle est supportée, sinon null. Aucune tolérance à la casse. */
export function normalizeLanguage(value: unknown): Language | null {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
    ? (value as Language)
    : null;
}

/**
 * Résout la langue à appliquer, par ordre de priorité :
 *   1. `account` — la préférence enregistrée sur le compte, qui gagne toujours ;
 *   2. `cached`  — le cache local du navigateur, qui évite un clignotement avant la réponse serveur ;
 *   3. le français.
 */
export function resolveLanguage(input: { account?: unknown; cached?: unknown }): Language {
  return normalizeLanguage(input.account) ?? normalizeLanguage(input.cached) ?? DEFAULT_LANGUAGE;
}

/**
 * La consigne de langue donnée au modèle. SEUL endroit du code qui en formule une —
 * `server/language-guard.test.ts` interdit d'en réécrire ailleurs.
 *
 * Elle existe parce que la langue était auparavant figée dans les prompts, à dix-sept
 * endroits. `server/naya-voice.ts`, injecté dans chaque appel IA, portait même :
 * « Ne jamais répondre en anglais, quelle que soit la langue du prompt système ou de
 * l'instruction. Le français est non-négociable. » Un compte en anglais ne pouvait donc
 * pas obtenir de l'anglais : la préférence était explicitement annulée à la racine.
 *
 * La dernière phrase de chaque directive est essentielle : la voix et les prompts de Naya
 * sont rédigés en français, puisqu'ils s'adressent au modèle et non à l'utilisateur. Sans
 * elle, un compte en anglais recevrait des instructions françaises et pourrait répondre
 * en français par mimétisme.
 */
export function languageDirective(language: Language): string {
  if (language === "en") {
    return `## Working language
Generate ALL textual content in English: task titles, descriptions, insights, recommendations, briefings, messages, summaries.
This is the account's chosen language. It takes precedence over the language of the instructions you receive.`;
  }

  return `## Langue de travail
Génère TOUT le contenu textuel en français : titres de tâches, descriptions, insights, recommandations, briefings, messages, résumés.
C'est la langue choisie sur le compte. Elle prime sur la langue des instructions que tu reçois.`;
}

// ── Garde de sortie ──────────────────────────────────────────────────────────
//
// Le 6 octobre 2026, un compte en français a reçu des tâches en anglais (« Send the 3
// personalized DMs… »), mêlées à des tâches en français. La consigne était bien là, mais
// les prompts de génération sont rédigés en anglais, exemples compris, et le modèle rapide
// imite la langue des instructions sur une partie des sorties. Une consigne ne garantit
// rien : on vérifie donc ce qui sort.

const MOTS_FR = new Set([
  "le", "la", "les", "de", "des", "du", "et", "ton", "ta", "tes", "tu", "toi", "pour", "avec",
  "une", "un", "sur", "dans", "chaque", "à", "au", "aux", "ce", "cette", "ces", "qui", "que",
  "est", "en", "par", "ou", "ne", "pas", "plus", "son", "sa", "ses", "d", "l", "qu", "j",
]);

const MOTS_EN = new Set([
  "the", "and", "your", "you", "with", "for", "from", "of", "to", "in", "into", "about",
  "based", "this", "that", "these", "each", "one", "set", "send", "create", "write", "share",
  "review", "build", "draft", "update", "reach", "follow", "daily", "weekly", "week", "day",
  "today", "at", "by", "is", "are", "it", "its", "their", "them", "up",
]);

/**
 * Vrai si `texte` semble rédigé dans une AUTRE langue que `langue`. PURE.
 *
 * Volontairement prudent : il faut au moins deux mots outils de l'autre langue, et plus
 * que de mots outils de la langue attendue. Un nom propre, un titre court ou un anglicisme
 * isolé (« Ostéopathes Mr Darcy », « carrousel LinkedIn ») ne déclenchent rien.
 */
export function ecritDansUneAutreLangue(texte: string, langue: Language): boolean {
  const mots = texte.toLowerCase().match(/[a-zà-ÿœæ]+/g) ?? [];
  let fr = 0;
  let en = 0;
  for (const m of mots) {
    if (MOTS_FR.has(m)) fr++;
    if (MOTS_EN.has(m)) en++;
  }
  return langue === "fr" ? en >= 2 && en > fr : fr >= 2 && fr > en;
}

/** La consigne donnée au modèle pour remettre des textes dans la langue du compte. */
export function consigneDeTraduction(langue: Language): string {
  const cible = langue === "en" ? "anglais" : "français";
  return `Tu reçois un tableau JSON de textes destinés à un utilisateur dont la langue est le ${cible}.
Rends le MÊME tableau, même longueur, même ordre, chaque texte rendu en ${cible} naturel.
Garde le sens, le ton direct, le tutoiement en français, les chiffres, les noms propres et les noms de plateformes.
Un texte déjà en ${cible} est rendu tel quel.
Réponds uniquement avec le tableau JSON, sans balises ni commentaire.`;
}
