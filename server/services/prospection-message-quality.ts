/**
 * Contrôle de qualité des messages de prospection. PURE.
 *
 * Fondé sur les 41 messages RÉELLEMENT produits en production, lus le 18 septembre 2026 :
 *   39/41 contenaient une question, 31/41 se TERMINAIENT par une question,
 *   13 disaient « curieuse » et 1 disait « curieux ».
 *
 * `prospection-audit.ts` validait déjà la longueur, le nombre de phrases et les tirets longs.
 * Rien ne regardait ce qui donne envie de lire.
 *
 * Ces règles attrapent les défauts OBSERVÉS, pas tous les mauvais messages possibles. Elles
 * ne remplacent pas le jugement de l'utilisatrice — elles lui évitent de relire quarante
 * messages pour retrouver les trois qui clochent.
 */

export type DefautMessage =
  /** Se termine sur une question ouverte : la dernière chose lue est une demande. */
  | "finit_par_question"
  /** « X a les bons codes, mais rarement Y » — dire que le travail de quelqu'un est médiocre. */
  | "compliment_retourne"
  /** Formule creuse qui signale une prospection de masse. */
  | "formule_creuse";

const FORMULES_CREUSES = [
  /j'ai vu votre profil/i,
  /je me permets de vous contacter/i,
  /en tant qu'expert[e]?/i,
  /j'espère que vous allez bien/i,
];

/**
 * Compliment retourné : une louange suivie d'un « mais » qui la retire.
 *
 * On ne cherche pas « mais » seul — trop fréquent et souvent légitime. On cherche le motif
 * précis observé : « mais rarement / mais peu / mais sans », qui transforme l'observation en
 * jugement sur le travail du destinataire.
 */
const COMPLIMENT_RETOURNE = /,\s*mais\s+(rarement|peu\b|sans\b|jamais)/i;

/**
 * Le message finit-il sur une question ?
 *
 * On ignore une éventuelle signature finale : « … ? Jeanne » finit bien par une question du
 * point de vue du lecteur. En revanche une question suivie d'une vraie phrase ne compte pas —
 * une question rhétorique à laquelle on répond soi-même n'a pas le même effet.
 */
function finitParQuestion(texte: string): boolean {
  const sansSignature = texte
    .trim()
    // Retire un dernier mot isolé de type prénom, éventuellement précédé d'un point.
    .replace(/[.\s]*\b[A-ZÀ-Ý][a-zà-ÿ]+\.?\s*$/, "")
    .trim();
  return sansSignature.endsWith("?");
}

export function defautsDuMessage(texte: string | null | undefined): DefautMessage[] {
  const t = (texte ?? "").trim();
  if (!t) return [];

  const defauts: DefautMessage[] = [];
  if (finitParQuestion(t)) defauts.push("finit_par_question");
  if (COMPLIMENT_RETOURNE.test(t)) defauts.push("compliment_retourne");
  if (FORMULES_CREUSES.some((r) => r.test(t))) defauts.push("formule_creuse");
  return defauts;
}

/**
 * L'expéditrice change-t-elle de genre d'un message à l'autre ?
 *
 * Le défaut trouvé en production. Il se détecte SANS savoir qui est l'expéditrice : le même
 * compte ne peut pas être à la fois « curieux » et « curieuse ».
 *
 * On ne retient que les adjectifs qui se rapportent à l'expéditrice — précédés de « je suis »
 * ou en tête de phrase. « Votre approche est intéressante » décrit l'approche du prospect,
 * pas l'expéditrice : sans cette distinction, tout lot serait signalé.
 */
const RACINES = ["curieu", "ravi", "intéress", "interess", "surpris", "convaincu", "impressionn"];

function comptePorteesDeGenre(messages: string[]): { masculins: number; feminins: number } {
  let masculins = 0;
  let feminins = 0;

  for (const brut of messages ?? []) {
    const t = (brut ?? "").toString();
    for (const racine of RACINES) {
      // « je suis curieuse », « Curieuse de… » en tête de phrase.
      const feminin = new RegExp(`(?:je suis\\s+|(?:^|[.!?]\\s+))${racine}[a-zà-ÿ]*e\\b`, "i");
      const masculin = new RegExp(`(?:je suis\\s+|(?:^|[.!?]\\s+))${racine}[a-zà-ÿ]*[^e\\s][\\s,.]`, "i");
      if (feminin.test(t)) { feminins += 1; break; }
      if (masculin.test(t)) { masculins += 1; break; }
    }
  }
  return { masculins, feminins };
}

export interface VerdictGenre {
  incoherent: boolean;
  masculins: number;
  feminins: number;
}

export function incoherenceDeGenre(messages: string[]): VerdictGenre {
  const { masculins, feminins } = comptePorteesDeGenre(messages ?? []);
  // Zéro des deux n'est PAS une incohérence : c'est exactement ce que le prompt demande,
  // des messages qui ne se décrivent pas.
  return { incoherent: masculins > 0 && feminins > 0, masculins, feminins };
}
