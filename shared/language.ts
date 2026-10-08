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

// Mots outils français.
const MOTS_OUTILS_FR = new Set([
  "le", "la", "les", "de", "des", "du", "et", "ton", "ta", "tes", "tu", "toi", "pour", "avec",
  "une", "un", "sur", "dans", "chaque", "à", "au", "aux", "ce", "cette", "ces", "qui", "que",
  "est", "en", "par", "ou", "ne", "pas", "plus", "son", "sa", "ses", "d", "l", "qu", "j",
  "vos", "votre", "nos", "notre", "mon", "ma", "mes", "leur", "leurs", "sont", "il", "elle",
  "ils", "elles", "nous", "vous", "je", "se", "si", "où", "comme", "mais", "sans", "sous",
  "chez", "entre", "après", "avant", "puis", "aussi", "très", "tout", "tous", "toute", "toutes",
]);

// Verbes d'action français qui ouvrent un titre de tâche. Utilisés seulement pour le compte
// français (pour un compte anglais, la règle historique reste celle des mots outils).
const VERBES_FR = new Set([
  "rédiger", "définir", "préparer", "envoyer", "créer", "écrire", "publier", "identifier",
  "relancer", "lister", "choisir", "appeler", "organiser", "mettre", "planifier", "analyser",
  "finaliser", "valider", "contacter", "répondre", "revoir", "relire", "construire", "faire",
  "tourner", "monter", "filmer", "photographier", "programmer", "caler", "noter", "trier",
  "vérifier", "compléter", "structurer", "clarifier", "fixer", "bloquer", "facturer", "payer",
]);

const MOTS_OUTILS_EN = new Set([
  "the", "and", "your", "you", "with", "for", "from", "of", "to", "in", "into", "about",
  "based", "this", "that", "these", "each", "one", "set", "send", "create", "write", "share",
  "review", "build", "draft", "update", "reach", "follow", "daily", "weekly", "week", "day",
  "today", "at", "by", "is", "are", "it", "its", "their", "them", "up",
]);

// Marqueurs anglais supplémentaires pour repérer un titre COURT : verbes d'action qui
// ouvrent les tâches générées, et mots outils sans homographe français. Volontairement
// sans les anglicismes courants en français (post, DM, reel, brief, call, check, test,
// email, pitch, brainstorm, shooting…) : un titre français qui en contient ne bascule pas.
const MARQUEURS_EN = new Set([
  ...Array.from(MOTS_OUTILS_EN),
  "identify", "publish", "prepare", "schedule", "outline", "define", "finalize",
  "research", "list", "pick", "choose", "track", "engage", "compile", "collect", "gather",
  "launch", "write", "find", "make", "shoot",
  "what", "when", "why", "how", "who", "which", "we", "our", "my", "isn", "aren", "don",
  "doesn", "will", "not", "has", "have", "than", "then", "after", "before", "next",
  "personalized", "targeting", "responses", "signs", "changed", "stopped", "making", "working",
]);

const MOT = /[a-zà-ÿœæ]+/g;
const ACCENT_FR = /[éèêëàâçùûüîïôœ]/;

/**
 * Retire les passages cités (« … », “…”, "…", '…') : une accroche en anglais citée dans
 * un titre français (« Relire le carrousel 'What changed…' ») ne dit rien de la langue du
 * titre. L'apostrophe d'élision (l'atelier, d'un) n'ouvre jamais une citation : il faut
 * un début de texte, une espace, une parenthèse ou deux-points juste avant.
 */
function sansCitations(texte: string): string {
  return texte
    .replace(/«[^»]*»/g, " ")
    .replace(/“[^”]*”/g, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/(^|[\s(:])['‘](?:[^'’‘\n]|['’](?=[a-zà-ÿ]))+['’](?=$|[\s).,:;!?…])/gi, "$1 ");
}

function compter(texte: string): { fr: number; en: number; outilsFr: number; outilsEn: number } {
  const mots = texte.toLowerCase().match(MOT) ?? [];
  let fr = 0, en = 0, outilsFr = 0, outilsEn = 0;
  for (const m of mots) {
    if (MOTS_OUTILS_FR.has(m)) { outilsFr++; fr++; }
    else if (VERBES_FR.has(m) || ACCENT_FR.test(m)) fr++;
    if (MOTS_OUTILS_EN.has(m)) outilsEn++;
    if (MARQUEURS_EN.has(m)) en++;
  }
  return { fr, en, outilsFr, outilsEn };
}

/**
 * Vrai si `texte` semble rédigé dans une AUTRE langue que `langue`. PURE.
 *
 * Compte français : on compare les marqueurs anglais (mots outils + verbes d'action qui
 * ouvrent les tâches) aux marqueurs français (mots outils, verbes, mots accentués), hors
 * passages cités. Un seul marqueur anglais suffit si rien de français ne le contredit :
 * « Draft DM outreach template… » ou « Identify 3 founders… » passaient sous l'ancien
 * seuil de deux mots outils (9 octobre 2026). Un nom propre, un anglicisme (post, DM,
 * reel, brief) ou une accroche anglaise citée dans un titre français ne déclenchent rien.
 *
 * Compte anglais : règle prudente historique (au moins deux mots outils français).
 */
export function ecritDansUneAutreLangue(texte: string, langue: Language): boolean {
  if (!texte) return false;
  if (langue === "en") {
    const { outilsFr, outilsEn } = compter(texte);
    return outilsFr >= 2 && outilsFr > outilsEn;
  }
  let c = compter(sansCitations(texte));
  // Un titre entièrement cité : on juge sur le texte complet.
  if (c.fr === 0 && c.en === 0) c = compter(texte);
  return c.en >= 1 && c.en > c.fr;
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
