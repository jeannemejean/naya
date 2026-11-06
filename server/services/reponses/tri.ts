/**
 * Tri d'un message entrant : vraie réponse, absence ou accusé de réception (spec §6.6).
 *
 * Règle d'or (anti-objectif §4, arbitrage R11) : un message n'est « automatique » QUE sur un
 * signal technique (en-tête) ou un sujet de répondeur — jamais sur une formule seule. Tout le reste, et tout cas douteux, est une vraie
 * réponse — une relance envoyée à quelqu'un qui a répondu est le pire des deux échecs.
 *
 * Seul le texte NOUVEAU compte : une réponse cite souvent notre email, dont le pied contient
 * « Se désinscrire » — sans retirer la citation, chaque réponse désinscrirait le prospect.
 * Pure, sans IA.
 */

export type NatureMessage = "reponse" | "absence" | "accuse";
export interface Classement { nature: NatureMessage; retourLe: Date | null; desinscription: boolean }

const JOUR_MS = 86400000;

// Retrait de la citation : partagé avec le client (fil et extrait de la boîte « Réponses »).
import { texteNouveau } from "@shared/citation";
export { texteNouveau };

function enTetesAutomatiques(headers: Record<string, string> | undefined): boolean {
  if (!headers) return false;
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v ?? "").trim().toLowerCase();
  if ("auto-submitted" in h && h["auto-submitted"] !== "no") return true;
  if ("x-autoreply" in h || "x-autorespond" in h) return true;
  if (/^(auto_reply|bulk|junk)$/.test(h["precedence"] ?? "")) return true;
  return false;
}

const FORMULE_ABSENCE =
  /absente?s? du bureau|en cong[ée]s?(?![a-z])|je suis absente?(?![a-z])|\bout of (the )?office\b|\booo\b|automatic reply|auto-reply|r[ée]ponse automatique/i;
const DESINSCRIPTION = /d[ée]sinscri|\bne\s+(?:\S+\s+)?plus\s+recevoir|retirez[- ]moi|unsubscribe|remove me/i;
const STOP_SEUL = /^\s*stop\s*[.!]*\s*$/im;

const MOIS: Array<[RegExp, number]> = [
  [/^(janv?|jan|january)/i, 0], [/^(f[ée]v|feb)/i, 1], [/^(mars?|mar)/i, 2], [/^(avr|apr)/i, 3],
  [/^(mai|may)/i, 4], [/^(juin|june?)/i, 5], [/^(juil|july?|jul)/i, 6], [/^(ao[uû]t?|aug)/i, 7],
  [/^(sept?|sep)/i, 8], [/^(oct)/i, 9], [/^(nov)/i, 10], [/^(d[ée]c|dec)/i, 11],
];
const MOT_MOIS = "(janv(?:ier|\\.)?|f[ée]vr?(?:ier|\\.)?|mars|avr(?:il|\\.)?|mai|juin|juil(?:let|\\.)?|ao[uû]t|sept(?:embre|\\.)?|oct(?:obre|\\.)?|nov(?:embre|\\.)?|d[ée]c(?:embre|\\.)?|jan(?:uary|\\.)?|feb(?:ruary|\\.)?|mar(?:ch|\\.)?|apr(?:il|\\.)?|may|june?|july?|aug(?:ust|\\.)?|sep(?:t|tember|\\.)?|october|november|dec(?:ember|\\.)?)";

function moisDe(mot: string): number | null {
  const m = MOIS.find(([re]) => re.test(mot));
  return m ? m[1] : null;
}

/**
 * Date (minuit UTC). Sans année : la prochaine occurrence (passée de plus d'un jour → l'an
 * prochain). Une année explicite hors {cette année, la suivante} n'est pas une date de retour.
 */
function dateDe(jour: number, mois: number, annee: number | null, now: Date): Date | null {
  if (mois < 0 || mois > 11 || jour < 1 || jour > 31) return null;
  const courante = now.getUTCFullYear();
  const an = annee == null ? courante : annee < 100 ? 2000 + annee : annee;
  if (annee != null && an !== courante && an !== courante + 1) return null;
  let d = new Date(Date.UTC(an, mois, jour));
  if (d.getUTCDate() !== jour) return null;
  if (annee == null && d.getTime() < now.getTime() - JOUR_MS) d = new Date(Date.UTC(an + 1, mois, jour));
  return d;
}

/**
 * Repère de retour juste avant la date, sur la même phrase (« jusqu'au », « au », « de retour
 * le », « until », « back on »…). Renvoie la distance repère → date, ou null sans repère.
 */
const REPERE = /(?:\b|')(au|retour|reprise|partir du|d[èe]s le|until|till|through|back|return(?:ing)?|to)\b([^\n.!?]{0,20})$/i;
function distanceAuRepere(texte: string, index: number): number | null {
  const m = REPERE.exec(texte.slice(Math.max(0, index - 40), index));
  return m ? m[2].length : null;
}

interface DateTrouvee { date: Date; repere: number | null; index: number }

/**
 * Dates lisibles du texte : FR « 12 novembre », EN « November 12th » / « 12 Nov » (repère
 * facultatif) ; numériques « 12/11 » ou « 12.11.26 » seulement isolées (jamais un morceau de
 * « 06.12.34.56.78 ») ET précédées d'un repère (jamais « Version 2.3 »).
 */
function datesDuTexte(texte: string, now: Date): DateTrouvee[] {
  const dates: DateTrouvee[] = [];
  const an = (s?: string) => (s ? Number(s) : null);
  const pousser = (d: Date | null, index: number, repereObligatoire = false) => {
    if (!d) return;
    const repere = distanceAuRepere(texte, index);
    if (repereObligatoire && repere == null) return;
    dates.push({ date: d, repere, index });
  };
  for (const m of texte.matchAll(new RegExp(`\\b(\\d{1,2})(?:er|st|nd|rd|th)?\\s+${MOT_MOIS}(?:\\s+(\\d{4}))?`, "gi"))) {
    const mois = moisDe(m[2]);
    if (mois != null) pousser(dateDe(Number(m[1]), mois, an(m[3]), now), m.index!);
  }
  for (const m of texte.matchAll(new RegExp(`\\b${MOT_MOIS}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "gi"))) {
    const mois = moisDe(m[1]);
    if (mois != null) pousser(dateDe(Number(m[2]), mois, an(m[3]), now), m.index!);
  }
  // Numérique : ordre français jour/mois (prospects majoritairement francophones).
  for (const m of texte.matchAll(/(?<![\d.,/])(\d{1,2})[/.](\d{1,2})(?:[/.](\d{4}|\d{2}))?(?![\d,/]|\.\d)/g)) {
    pousser(dateDe(Number(m[1]), Number(m[2]) - 1, an(m[3]), now), m.index!, true);
  }
  return dates;
}

/** Lendemain ouvré (samedi/dimanche sautés), 08:00 UTC. */
function lendemainOuvre(d: Date): Date {
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 8));
  while (r.getUTCDay() === 0 || r.getUTCDay() === 6) r.setUTCDate(r.getUTCDate() + 1);
  return r;
}

const RETOUR_MAX_MS = 60 * JOUR_MS;

function dateDeRetour(texte: string, now: Date): Date {
  const parDefaut = new Date(now.getTime() + 7 * JOUR_MS);
  const futures = datesDuTexte(texte, now).filter((d) => d.date.getTime() >= now.getTime() - JOUR_MS);
  if (!futures.length) return parDefaut;
  // La date la plus proche d'un repère (« jusqu'au 12 ») ; sans repère, la plus tardive.
  const avecRepere = futures.filter((d) => d.repere != null);
  const retenue = avecRepere.length
    ? avecRepere.reduce((a, b) => (b.repere! < a.repere! || (b.repere === a.repere && b.date > a.date) ? b : a))
    : futures.reduce((a, b) => (b.date > a.date ? b : a));
  const retour = lendemainOuvre(retenue.date);
  // Au-delà de 60 jours, la lecture est trop douteuse : on revient au délai par défaut.
  return retour.getTime() > now.getTime() + RETOUR_MAX_MS ? parDefaut : retour;
}

/**
 * Sujet posé par un répondeur automatique. Ancré au début : « Re: » / « TR: » = un humain
 * qui répond ou transfère, donc jamais automatique (R11).
 */
const SUJET_AUTO = /^\s*(r[ée]ponse automatique|automatic reply|auto\s*:|out of (the )?office|absente?s?\b|absence|accus[ée] de r[ée]ception)/i;
const SUJET_ABSENCE = /^\s*(out of (the )?office|absente?s?\b|absence)/i;

export function classerMessage(
  m: { subject?: string | null; body: string; headers?: Record<string, string> },
  now: Date,
): Classement {
  const nouveau = texteNouveau(m.body) || (m.body || "").trim();
  const sujet = m.subject ?? "";
  const texte = `${sujet}\n${nouveau}`;
  const desinscription = DESINSCRIPTION.test(nouveau) || STOP_SEUL.test(nouveau);

  // R11 : automatique SEULEMENT sur un signal technique (en-tête) ou un sujet de répondeur.
  // Les formules du corps ne servent ensuite qu'à distinguer absence / accusé et à lire la date.
  // Un message LinkedIn (ni en-tête ni sujet) est donc toujours une vraie réponse.
  const automatique = enTetesAutomatiques(m.headers) || SUJET_AUTO.test(sujet);
  if (!automatique) return { nature: "reponse", retourLe: null, desinscription };

  if (SUJET_ABSENCE.test(sujet) || FORMULE_ABSENCE.test(texte)) {
    return { nature: "absence", retourLe: dateDeRetour(texte, now), desinscription };
  }
  return { nature: "accuse", retourLe: null, desinscription };
}
