/**
 * Contrôle qualité d'une relance rédigée (« vous m'aviez dit de revenir vers vous début 2027 »).
 * Mêmes règles que les messages de prospection (doctrine.ts / qualite.ts : aucun tiret long,
 * aucune formule d'IA, court, aucun lien inventé) PLUS ce qui compte ici : la relance ne
 * s'appuie QUE sur l'échange. Une « observation », une « analyse » ou un chiffre qui ne
 * figurent pas dans le fil sont inventés. PURE.
 */
import { sanitizeEmailBody, sanitizeMessage } from "../prospection-audit";
import { controlerMessage, type Defaut } from "../prospection/qualite";
import { limitePour } from "../prospection/doctrine";

export type CanalRelance = "email" | "linkedin";

/** Paragraphes au plus (salutation non comprise). */
export const PARAGRAPHES_MAX = 4;

/** Mises en scène d'un travail qui n'a pas eu lieu (« une observation que j'ai faite sur… »). */
const PRETENDU_TRAVAIL: Array<[RegExp, string]> = [
  [/\bobservations?\b/i, "observation"],
  [/\bj['’]ai\s+(?:remarqu|observ|analys|regard|étudi|etudi|audit|not)/i, "j'ai remarqué / analysé"],
  [/\ben\s+(?:regardant|analysant|parcourant|étudiant|etudiant)\b/i, "en regardant / analysant"],
  [/\b(?:audit|analyse|diagnostic|étude|etude)\b/i, "analyse / audit"],
  [/\b(?:i\s+(?:noticed|looked|analy[sz]ed|reviewed))\b|\bobservation\b|\baudit\b/i, "noticed / audit"],
];

const sansAccents = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Nettoyage déterministe : tirets longs retirés (mise en page email gardée), espaces. */
export function nettoyerRelance(texte: string, canal: CanalRelance): string {
  return canal === "email" ? sanitizeEmailBody(texte) : sanitizeMessage(texte);
}

/** Le corps sans la signature finale (elle ne compte ni dans la longueur ni dans les contrôles). */
function sansSignature(texte: string, signature: string): string {
  const t = texte.trim();
  const s = signature.trim();
  return s && t.endsWith(s) ? t.slice(0, -s.length).trim() : t;
}

export interface ContexteRelance {
  canal: CanalRelance;
  /** Signature attendue en fin d'email (vide : pas de contrôle). */
  signature: string;
  /** Tout le texte de l'échange (nos messages, ses réponses, l'offre) : seule source permise. */
  sources: string;
  entreprise?: string | null;
}

/** Défauts d'une relance (vide : bonne à proposer). */
export function controlerRelance(texte: string, ctx: ContexteRelance): Defaut[] {
  const corps = sansSignature(texte, ctx.signature);
  const liens = ctx.sources.match(/\b(?:https?:\/\/|www\.)\S+/g) ?? [];
  const out: Defaut[] = controlerMessage(
    { role: "relance", canal: ctx.canal, body: corps },
    { entreprise: ctx.entreprise ?? null, liensAutorises: liens, premiereTouche: false },
  );
  const add = (d: Defaut) => { if (!out.some((x) => x.code === d.code && x.raison === d.raison)) out.push(d); };

  // Rien d'inventé : un « travail » (observation, analyse…) absent de l'échange.
  const sources = sansAccents(ctx.sources);
  for (const [re, nom] of PRETENDU_TRAVAIL) {
    const m = re.exec(corps);
    if (m && !sources.includes(sansAccents(m[0]))) {
      add({ code: "relecture", raison: `Le message évoque un travail qui n'a pas eu lieu (« ${nom} ») : appuie-toi UNIQUEMENT sur l'échange (ses mots, l'offre de départ).` });
      break;
    }
  }
  // Un chiffre « de preuve » (pourcentage, montant, nombre de clients…) absent de l'échange est
  // inventé. Une durée d'appel (« 15 minutes ») ou une date ne l'est pas.
  const chiffres = corps.match(/\b\d+(?:[.,]\d+)?\s*(?:%|€|\$|k€|clients?|marques?|projets?|entreprises?|fois|x\b)/gi) ?? [];
  const sourcesCompactes = ctx.sources.replace(/\s+/g, "").toLowerCase();
  if (chiffres.some((c) => !sourcesCompactes.includes(c.replace(/\s+/g, "").toLowerCase()))) {
    add({ code: "relecture", raison: "Le message cite un chiffre qui ne vient pas de l'échange : retire-le." });
  }

  if (ctx.canal === "email") {
    // Salutation + 4 paragraphes au plus.
    const paragraphes = corps.split(/\n\s*\n/).filter((p) => p.trim()).length;
    if (paragraphes > PARAGRAPHES_MAX + 1) {
      add({ code: "trop_long", raison: `Le message a ${paragraphes - 1} paragraphes : ${PARAGRAPHES_MAX} au plus, courts.` });
    }
    if (ctx.signature.trim() && !texte.trim().endsWith(ctx.signature.trim())) {
      add({ code: "relecture", raison: `Le message doit se terminer par la signature « ${ctx.signature.trim()} ».` });
    }
  }
  return out;
}

/** Longueur permise, pour le prompt (la même que le contrôle). */
export function longueurRelance(canal: CanalRelance): string {
  const l = limitePour("relance", canal);
  return l.maxCaracteres ? `${l.maxCaracteres} caractères au plus` : `${l.motsMax} mots au plus (signature non comprise)`;
}

/** Signature posée en fin d'email si le modèle l'a oubliée (règle déterministe, jamais deux fois). */
export function avecSignature(texte: string, signature: string, canal: CanalRelance): string {
  const t = texte.trim();
  const s = signature.trim();
  if (canal !== "email" || !s || t.endsWith(s)) return t;
  return `${t}\n\n${s}`;
}
