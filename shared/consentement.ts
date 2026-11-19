// Le « oui » dans la conversation de Naya (agent omniscient).
//
// Avant (16 nov. 2026) : répondre « oui » à une proposition l'ANNULAIT (le client la mettait de
// côté comme un « ajustement »), puis le modèle en refaisait une autre, et finissait par écrire
// « 11 tâches supprimées » alors que rien n'avait été appliqué. Ici, deux règles pures :
// - estConsentement : un message court qui ne fait qu'acquiescer vaut validation de la
//   proposition en attente (rien d'autre : « oui mais… », une question, une consigne → ajuster) ;
// - affirmeUneActionFaite : la réponse du modèle annonce-t-elle un geste comme déjà fait ?
// Copie conforme dans mobile/lib/consentement.ts (le mobile n'importe pas @shared).

const normaliser = (s: string) =>
  s.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();

/** Mots qui, seuls, disent oui. */
const ACCORD = new Set([
  "oui", "ouais", "ok", "okay", "okey", "go", "vas-y", "parfait", "bien", "bon", "d'accord", "daccord",
  "valide", "valider", "validé", "confirme", "confirmé", "confirmer", "yes", "top", "nickel", "super",
  "fais-le", "fais", "carrément", "exactement", "impeccable", "génial", "allez", "applique", "lance",
  "nettoie", "supprime", "👍", "✅", "👌",
]);

/** Mots permis autour (« je valide », « oui très bien », « c'est bon », « ok, fais-le »). */
const LIANTS = new Set(["je", "très", "tres", "c'est", "le", "la", "ça", "ca", "y", "vas", "merci", "tout", "à", "fait", "go", "!"]);

/** Ce qui fait d'un « oui » un ajustement ou une question. */
const RESERVE = /\?|\b(mais|sauf|non|pas|attends?|plutôt|plutot|seulement|ensuite|garde|excepté|hors)\b/;

export function estConsentement(message: string): boolean {
  const m = normaliser(message);
  if (!m || RESERVE.test(m)) return false;
  const mots = m
    .replace(/vas y/g, "vas-y").replace(/fais le/g, "fais-le")
    .split(/[\s,.;:!…]+/).filter(Boolean);
  if (mots.length === 0 || mots.length > 6) return false;
  if (!mots.some((x) => ACCORD.has(x))) return false;
  return mots.every((x) => ACCORD.has(x) || LIANTS.has(x));
}

const PARTICIPES = "(?:supprimée?s?|déplacée?s?|décalée?s?|archivée?s?|nettoyée?s?|repositionnée?s?|déprogrammée?s?|reprogrammée?s?|retirée?s?|annulée?s?|repensée?s?|retenue?s?|enregistrée?s?|lancée?s?)";

const AFFIRMATIONS: RegExp[] = [
  // « C'est fait », en tête de phrase (pas « confirme et c'est fait »).
  /(?:^|[.!:\n—–-]\s*)c'est fait/,
  /\bj'ai (?:bien )?(?:supprimé|déplacé|décalé|archivé|nettoyé|repositionné|déprogrammé|reprogrammé|retiré|annulé|repensé (?:la |ta |les |cette |ce )?campagne|enregistré|lancé)/,
  new RegExp(`\\b(?:sont|est|ont été|a été) (?:bien |toutes |tous )?${PARTICIPES}`),
  new RegExp(`\\b\\d+ (?:\\S+ )?(?:tâches?|posts?|publications?|ateliers?) ${PARTICIPES}`),
  /\bplanning (?:est )?nettoyé/,
];

/** Vrai si le texte annonce un changement comme déjà appliqué. */
export function affirmeUneActionFaite(texte: string): boolean {
  const t = normaliser(texte);
  return AFFIRMATIONS.some((r) => r.test(t));
}
