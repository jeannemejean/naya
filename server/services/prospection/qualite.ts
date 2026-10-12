/**
 * Contrôle qualité des messages de prospection, couche 1 (code). PURE.
 *
 * Vérifie tout ce que la doctrine (doctrine.ts) permet de vérifier sans IA. La couche 2
 * (relecture.ts) juge ce que le code ne voit pas : le ton, l'usage réel du déclencheur.
 *
 * Reprend les défauts déjà observés en production (prospection-message-quality.ts :
 * compliment retourné, formules creuses). « Finir sur une question » n'est PAS un défaut ici :
 * la doctrine autorise une demande facile ; ce sont les questions de RÉFLEXION qui sont
 * interdites.
 */
import { normaliserTexte } from "../sequence-distinct";
import { defautsDuMessage } from "../prospection-message-quality";
import {
  limitePour, OBJET_MOTS, TICS_INTERDITS, MOTIFS_TRACKING, estQuestionDeReflexion,
  type RoleTouche, type Canal,
} from "./doctrine";

export type CodeDefaut =
  | "trop_long" | "trop_court" | "objet" | "tic" | "question_reflexion" | "tracking"
  | "lien_inconnu" | "placeholder" | "tiret" | "genre" | "sans_entreprise" | "compliment_retourne"
  /** Défaut relevé par la relecture IA (couche 2). */
  | "relecture";

export interface Defaut { code: CodeDefaut; raison: string }

export interface MessageAControler {
  role: RoleTouche;
  canal: Canal;
  body: string;
  subject?: string | null;
}

export interface ContexteControle {
  /** Entreprise du prospect : la première touche doit la nommer (signe d'une vraie personnalisation). */
  entreprise?: string | null;
  /** Liens fournis par la preuve ou les consignes : seuls autorisés dans un message. */
  liensAutorises: string[];
  premiereTouche: boolean;
}

const mots = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

const LIEN = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
const nettoyerLien = (u: string) => u.replace(/[.,;:!?]+$/, "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "").toLowerCase();

/** Adjectif accordé qui décrit l'expéditrice : la phrase doit être tournée autrement. */
const RACINES_GENRE = "(?:curieu|ravi|intéress|interess|surpris|convaincu|impressionn|heureu|enchant|touch)[a-zà-ÿ]*";
const GENRE = new RegExp(
  // « je suis ravie », ou en tête de phrase : « Ravie d'être connectée », « Curieuse de… ».
  `(?:\\b(?:je\\s+suis|suis)\\s+(?:très\\s+|tres\\s+|vraiment\\s+)?${RACINES_GENRE}|(?:^|[.!?]\\s+)${RACINES_GENRE}\\s+(?:de|d['’]|que|par|pour))`,
  "i",
);

function nomme(body: string, entreprise: string): boolean {
  const corps = ` ${normaliserTexte(body)} `;
  const nom = normaliserTexte(entreprise);
  if (!nom) return true;
  if (corps.includes(` ${nom} `)) return true;
  // Un mot distinctif du nom suffit (« Marc Jacobs » → « Jacobs »).
  return nom.split(" ").filter((w) => w.length >= 4).some((w) => corps.includes(` ${w} `));
}

export function controlerMessage(m: MessageAControler, ctx: ContexteControle): Defaut[] {
  const body = (m.body ?? "").trim();
  const out: Defaut[] = [];
  const add = (code: CodeDefaut, raison: string) => {
    if (!out.some((d) => d.code === code)) out.push({ code, raison });
  };

  // Longueur
  const lim = limitePour(m.role, m.canal);
  if (lim.maxCaracteres && body.length > lim.maxCaracteres) {
    add("trop_long", `Le message fait ${body.length} caractères, la limite pour ce type de message est ${lim.maxCaracteres}.`);
  }
  const n = mots(body);
  if (lim.motsMax && n > lim.motsMax) add("trop_long", `Le message fait ${n} mots, il en faut ${lim.motsMax} au plus.`);
  if (lim.motsMin && n < lim.motsMin) add("trop_court", `Le message fait ${n} mots, il en faut au moins ${lim.motsMin} pour poser le contexte.`);

  // Objet d'email
  if (m.canal === "email" && (m.role === "email_ouverture" || m.subject)) {
    const s = (m.subject ?? "").trim();
    const ns = mots(s);
    if (!s || ns < OBJET_MOTS.min || ns > OBJET_MOTS.max || /[:!]/.test(s)) {
      add("objet", `L'objet doit faire ${OBJET_MOTS.min} à ${OBJET_MOTS.max} mots, factuels, sans formule poétique ni deux-points.`);
    }
  }

  // Tics et formules creuses
  const norm = ` ${normaliserTexte(`${m.subject ?? ""} ${body}`)} `;
  const tic = TICS_INTERDITS.find((t) => norm.includes(` ${t} `) || norm.includes(` ${t}`));
  if (tic) add("tic", `Formule d'IA ou de prospection de masse : « ${tic} ». Écris-le comme une personne le dirait.`);
  const anciens = defautsDuMessage(body);
  if (anciens.includes("formule_creuse")) add("tic", "Formule creuse typique d'une prospection de masse.");
  if (anciens.includes("compliment_retourne")) add("compliment_retourne", "Compliment suivi d'un « mais » qui le retire : cela revient à dire au prospect que son travail est médiocre.");

  if (estQuestionDeReflexion(body)) {
    add("question_reflexion", "La question demande au prospect de réfléchir pour toi. Remplace-la par une demande à laquelle on répond en trois mots.");
  }
  if (MOTIFS_TRACKING.some((r) => r.test(body))) {
    add("tracking", "Le message laisse entendre que tu sais qu'un message a été ouvert ou lu.");
  }

  // Liens
  const autorises = new Set(ctx.liensAutorises.map(nettoyerLien));
  const liens = body.match(LIEN) || [];
  if (liens.some((l) => !autorises.has(nettoyerLien(l)))) {
    add("lien_inconnu", "Le message contient un lien qui ne vient ni d'une preuve ni de tes consignes.");
  }

  if (/\[[^\]\n]{1,40}\]|\{\{[^}]*\}\}/.test(body)) add("placeholder", "Le message contient un texte à remplacer entre crochets.");
  if (/[—–]|\s--\s/.test(`${m.subject ?? ""} ${body}`)) add("tiret", "Le message contient un tiret long : remplace-le par une virgule ou un point.");
  if (GENRE.test(body)) add("genre", "L'expéditrice se décrit avec un adjectif accordé : tourne la phrase autrement.");

  if (ctx.premiereTouche && ctx.entreprise && !nomme(`${m.subject ?? ""} ${body}`, ctx.entreprise)) {
    add("sans_entreprise", `Le premier message ne nomme pas ${ctx.entreprise} : la personnalisation ne se voit pas.`);
  }
  return out;
}
