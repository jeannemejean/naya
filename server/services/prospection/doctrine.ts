/**
 * Doctrine de prospection : LA source unique des règles de rédaction. PURE.
 *
 * Écrite le 12 octobre 2026 après la séquence « Sneha » : quatre fois la même question
 * abstraite, jamais de présentation, un mail lyrique sans rien de concret, une relance qui
 * avouait le tracking. Deux générateurs coexistaient avec des règles contraires (l'un
 * interdisait de finir sur une question ouverte, l'autre l'exigeait).
 *
 * Ces règles portent sur le MÉTIER de la prospection, pas sur la méthode d'une agence : elles
 * valent pour un artiste comme pour un cabinet. Les consignes de l'utilisatrice passent devant,
 * sauf les règles de sécurité (rien d'inventé, aucun lien non fourni, aucun placeholder).
 *
 * Tout ce qui se vérifie par du code est exporté en constantes et contrôlé par qualite.ts.
 */
import { normaliserTexte } from "../sequence-distinct";

export type RoleTouche = "invitation" | "premier_message" | "email_ouverture" | "relance" | "cloture";
export type Canal = "linkedin" | "email";

export interface Limite { maxCaracteres?: number; motsMin?: number; motsMax?: number }

/** Limites par rôle. Les relances et clôtures dépendent du canal (voir limitePour). */
export const LIMITES: Record<RoleTouche, Limite> = {
  invitation: { maxCaracteres: 300 },
  premier_message: { maxCaracteres: 300 },
  email_ouverture: { motsMin: 50, motsMax: 120 },
  relance: { maxCaracteres: 300, motsMax: 90 },
  cloture: { maxCaracteres: 300, motsMax: 70 },
};

export function limitePour(role: RoleTouche, canal: Canal): Limite {
  const l = LIMITES[role];
  if (canal === "linkedin") return { maxCaracteres: l.maxCaracteres ?? 300 };
  if (role === "email_ouverture") return { motsMin: l.motsMin, motsMax: l.motsMax };
  return { motsMax: l.motsMax ?? 120 };
}

export const OBJET_MOTS = { min: 2, max: 5 };

/**
 * Tics d'écriture IA et formules de prospection de masse, NORMALISÉS (minuscules, sans
 * accents ni ponctuation, voir normaliserTexte). Une occurrence suffit à signaler.
 */
export const TICS_INTERDITS: string[] = [
  "resonner", "resonne avec", "resonance",
  "regard exterieur", "un regard neuf",
  "la couture entre", "a la croisee", "au carrefour de",
  "je me permets", "j espere que vous allez bien", "j espere que tu vas bien",
  "j ai vu votre profil", "je suis tombee sur votre profil", "je suis tombe sur votre profil",
  "votre parcours est inspirant", "m a frappe", "m a frappee", "m interpelle",
  "je serais ravie", "je serais ravi", "n hesitez pas",
  "dans un monde ou", "plus que jamais", "a l heure ou",
  "terrain ou les arbitrages", "il y a quelque chose de particulier",
  "en tant qu expert", "en tant qu experte",
  "je reviens vers vous", "je me permets de revenir",
];

/** Début (normalisé) d'une question qui demande une réflexion au lieu d'une réponse courte. */
const DEBUTS_REFLEXION =
  /^(comment|pourquoi|en quoi|qu est ce qui|qu est ce que|quel|quelle|quels|quelles|de quelle|dans quelle|a quel|selon vous|que pensez|qu en pensez|ou en etes|how|why|what)\b/;

export const MOTIFS_QUESTION_REFLEXION: RegExp[] = [DEBUTS_REFLEXION];

/** Les phrases interrogatives d'un texte (découpage simple sur la ponctuation forte). */
function questions(texte: string): string[] {
  return (texte.match(/[^.!?\n]*\?/g) || []).map((q) => q.trim()).filter(Boolean);
}

/** Le texte contient-il une question qui demande au prospect de réfléchir pour nous ? */
export function estQuestionDeReflexion(texte: string): boolean {
  return questions(texte).some((q) => DEBUTS_REFLEXION.test(normaliserTexte(q)));
}

/** Aveux de suivi d'ouverture ou de clic : interdits, quel que soit le rôle. */
export const MOTIFS_TRACKING: RegExp[] = [
  /jet[ée]s?\s+un\s+(?:œ|oe)il/i,
  /jet[ée]s?\s+un\s+coup\s+d['’](?:œ|oe)il/i,
  /(?:avez|as)\s+(?:ouvert|lu|consulté|consulte|cliqué|clique)\s+(?:mon|ma|le|la)/i,
  /(?:mon|ma)\s+(?:précédent|precedent|dernier|dernière|derniere)?\s*(?:message|mail|email|e-mail)\s+(?:a\s+été|a\s+ete)\s+(?:ouvert|lu)/i,
  /\b(?:you\s+opened|saw\s+that\s+you\s+opened)\b/i,
];

const REGLE_DU_ROLE: Record<RoleTouche, string> = {
  invitation:
    "NOTE D'INVITATION : une raison précise et personnelle de se connecter, ancrée dans le déclencheur. Aucune offre, aucun lien, aucune question sur ses besoins. Une demi-phrase sur qui tu es est permise.",
  premier_message:
    "PREMIER MESSAGE (après acceptation) : remercie sans formule toute faite, dis en une ligne qui tu es et ce que tu fais pour qui, apporte la proposition du brief (preuve, idée ou échange), puis une demande facile.",
  email_ouverture:
    "EMAIL D'OUVERTURE : un objet de 2 à 5 mots, factuel, jamais poétique (le nom de son entreprise y a souvent sa place). Corps : le déclencheur en une phrase, qui tu es en une ligne, la proposition concrète, une demande facile.",
  relance:
    "RELANCE : un angle NOUVEAU (celui que le brief attribue à cette touche) ou une autre preuve. Ne résume pas les messages précédents, ne dis pas que tu reviens vers la personne.",
  cloture:
    "CLÔTURE : ferme la porte proprement, en deux ou trois phrases, sans culpabiliser ni insister. Laisse une porte ouverte précise (le sujet sur lequel revenir un jour).",
};

function ligneLongueur(role: RoleTouche, canal: Canal): string {
  const l = limitePour(role, canal);
  if (l.maxCaracteres) return `${l.maxCaracteres} caractères maximum, strict`;
  if (l.motsMin && l.motsMax) return `${l.motsMin} à ${l.motsMax} mots`;
  return `${l.motsMax} mots maximum`;
}

/** Bloc de prompt de la doctrine pour une touche donnée. */
export function blocDoctrine(role: RoleTouche, canal: Canal): string {
  return `DOCTRINE DE PROSPECTION (règles du métier, à appliquer strictement)
1. DÉCLENCHEUR RÉEL : la première prise de contact s'appuie sur le fait réel et nommé du brief (un lancement, un post, une nomination, une actualité). Jamais une généralité sur « votre marque » ou « votre division » : la première phrase doit être impossible à envoyer à quelqu'un d'autre.
2. QUI ÉCRIT : au plus tard dans le premier vrai message (après acceptation, ou dans le premier email), une ligne simple dit qui écrit, ce qu'elle fait et pour qui.
3. DONNER AVANT DE DEMANDER : apporte la proposition du brief (une preuve réelle, une idée précise pour SA marque, ou une observation utile). Ne demande jamais au prospect d'expliquer son métier ou de réfléchir pour toi.
4. DEMANDE FACILE : si tu poses une question, elle doit pouvoir recevoir une réponse en trois mots (« je vous l'envoie ? », « c'est un sujet chez vous en ce moment ? »). INTERDIT : les questions ouvertes de réflexion (« comment pensez-vous… », « qu'est-ce qui guide… », « quel regard… »).
5. COURT : ${ligneLongueur(role, canal)}. Des phrases simples, comme on écrit à quelqu'un, pas comme on rédige un texte.
6. RELANCE : chaque relance apporte du neuf (autre angle, autre preuve). Jamais « je reviens vers vous », jamais d'allusion au fait qu'un message a été ouvert, lu ou cliqué.
7. CLÔTURE : la dernière touche ferme la porte proprement, sans culpabiliser.
8. STYLE : aucune flatterie vague, aucun lyrisme, aucune formule d'IA (« résonner avec », « la couture entre », « un regard extérieur », « je serais ravie », « m'a frappée »…), aucun tiret (ni —, ni –), aucun adjectif qui accorde le genre de l'expéditrice, aucun placeholder entre crochets, aucune signature-slogan non demandée. N'invente jamais un lien, un chiffre, un client ou une ressource : n'utilise que ce que le brief et la preuve fournissent.

RÈGLE DE CETTE TOUCHE : ${REGLE_DU_ROLE[role]}`;
}
