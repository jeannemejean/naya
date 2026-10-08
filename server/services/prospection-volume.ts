/**
 * Combien de prospects une campagne doit-elle trouver ? PUR — testé isolément.
 *
 * Avant : aucune cible. Le sourcing faisait 4 requêtes Google, première page seulement,
 * et s'arrêtait là — moins de 10 prospects en production. Le nombre doit venir de ce que
 * l'utilisatrice cherche à obtenir, pas d'un chiffre d'agence : Naya est sur mesure.
 *
 * ── La formule ──────────────────────────────────────────────────────────────
 *
 *   joursOuvres   = jours de travail de l'utilisatrice dans les 14 prochains jours
 *                   (userPreferences.workDays, lun-ven à défaut)
 *
 *   parRythme     = prospectsParJour (réglage de la campagne) × joursOuvres
 *
 *   parObjectif   = pour chaque objectif ACTIF du projet qui se compte en clients ou en
 *                   chiffre d'affaires :
 *                     clientsRestants = (cible − actuel)            si l'objectif compte des clients
 *                                     = ⌈(cible − actuel) / panier⌉ si c'est un montant
 *                                       (panier moyen lu dans Brand DNA `priceRange`)
 *                     prospects       = clientsRestants ÷ tauxConversion
 *                                       (taux observé sur l'historique de l'utilisatrice,
 *                                        TAUX_CONVERSION_PAR_DEFAUT tant qu'il est trop court)
 *                     sur 14 jours    = prospects × 14 / joursAvantÉchéance
 *                                       (HORIZON_PAR_DEFAUT_JOURS sans échéance)
 *                   → on garde le plus exigeant des objectifs (ils se recouvrent souvent).
 *
 *   cible         = max(parRythme, parObjectif), bornée à PLAFOND_CIBLE (coût Bright Data)
 *                   PLANCHER_CIBLE seulement quand AUCUNE donnée n'existe (ni rythme, ni objectif).
 *
 *   prospectsParJour dérivé = ⌈cible / joursOuvres⌉ — utilisé à la création d'une campagne
 *                   à la place de l'ancien « 3 » codé en dur.
 */

export const FENETRE_JOURS = 14;
/** Repli quand ni le rythme ni les objectifs ne disent rien. */
export const PLANCHER_CIBLE = 30;
/** Borne haute : au-delà, la recherche coûterait trop cher pour un seul passage. */
export const PLAFOND_CIBLE = 200;
/**
 * Taux prospect contacté → client, utilisé tant que l'historique propre de l'utilisatrice
 * est trop court pour en dire quelque chose (voir tauxConversionObserve). Prudent exprès :
 * mieux vaut trouver un peu trop de prospects que pas assez — l'envoi reste validé à la main.
 */
export const TAUX_CONVERSION_PAR_DEFAUT = 0.05;
/** Horizon d'un objectif sans échéance : un trimestre. */
export const HORIZON_PAR_DEFAUT_JOURS = 90;
/** En dessous, l'historique ne dit rien de fiable sur le taux de conversion. */
const MIN_CONTACTES_POUR_TAUX = 20;

const ABREVIATIONS_JOURS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function joursOuvresProchains(depuis: Date, workDays: string | null | undefined, fenetre = FENETRE_JOURS): number {
  let jours = new Set(
    (workDays || "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => ABREVIATIONS_JOURS.includes(s)),
  );
  if (jours.size === 0) jours = new Set(["mon", "tue", "wed", "thu", "fri"]);
  let n = 0;
  for (let i = 1; i <= fenetre; i++) {
    const d = new Date(depuis.getTime() + i * 86400000);
    if (jours.has(ABREVIATIONS_JOURS[d.getUTCDay()])) n++;
  }
  return n;
}

/** Lit le premier nombre d'un texte libre : « 5 000 € », « 5k€ », « 3,5k », « 10 clients ». */
export function lireMontant(texte: string | null | undefined): number | null {
  if (!texte) return null;
  const m = String(texte).replace(/(\d)[\s  ](?=\d{3}\b)/g, "$1").match(/(\d+(?:[.,]\d+)?)\s*(k)?/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return m[2] ? Math.round(n * 1000) : n;
}

/** Panier moyen depuis Brand DNA `priceRange` : moyenne d'une fourchette, ou la valeur seule. */
export function panierMoyenDepuis(priceRange: string | null | undefined): number | null {
  if (!priceRange) return null;
  const compact = String(priceRange).replace(/(\d)[\s  ](?=\d{3}\b)/g, "$1");
  const nombres = Array.from(compact.matchAll(/(\d+(?:[.,]\d+)?)\s*(k)?/gi))
    .map((m) => {
      const n = parseFloat(m[1].replace(",", "."));
      return m[2] ? n * 1000 : n;
    })
    .filter((n) => Number.isFinite(n) && n > 0);
  if (nombres.length === 0) return null;
  const pris = nombres.slice(0, 2);
  return Math.round(pris.reduce((a, b) => a + b, 0) / pris.length);
}

/** Étapes où le prospect a réellement été contacté (pour le dénominateur du taux). */
const ETAPES_CONTACTEES = new Set([
  "connection_sent", "connected", "followup1_sent", "followup2_sent",
  "in_discussion", "proposal_sent", "signed",
]);

/** Taux signé / contacté sur l'historique de l'utilisatrice, ou null s'il est trop court. */
export function tauxConversionObserve(leads: { stage?: string | null }[]): number | null {
  const contactes = leads.filter((l) => l.stage && ETAPES_CONTACTEES.has(l.stage));
  if (contactes.length < MIN_CONTACTES_POUR_TAUX) return null;
  const signes = contactes.filter((l) => l.stage === "signed").length;
  if (signes === 0) return null;
  return Math.min(0.5, Math.max(0.01, signes / contactes.length));
}

export interface ObjectifProjet {
  title?: string | null;
  goalType?: string | null;
  successMode?: string | null;
  targetValue?: string | null;
  currentValue?: string | null;
  dueDate?: Date | string | null;
  status?: string | null;
}

export interface EntreeCible {
  /** Réglage de la campagne, s'il existe. */
  prospectsParJour?: number | null;
  objectifs: ObjectifProjet[];
  panierMoyen?: number | null;
  tauxConversion?: number | null;
  workDays?: string | null;
  aujourdHui: Date;
}

export interface CibleProspects {
  cible: number;
  prospectsParJour: number;
  joursOuvres: number;
  source: "objectif" | "rythme" | "plancher";
  /** Explication courte, en français, réutilisable dans un prompt ou une réponse. */
  detail: string;
}

function estMonetaire(o: ObjectifProjet): boolean {
  return /€|\$|eur\b|euros?|k€|\bca\b|chiffre/i.test(o.targetValue || "");
}

function compteDesClients(o: ObjectifProjet): boolean {
  const mode = (o.successMode || "").toLowerCase();
  const type = (o.goalType || "").toLowerCase();
  // Un objectif de visibilité (abonnés, vues…) ne se traduit pas en prospects.
  return mode === "revenue" || type === "revenue";
}

/** Prospects nécessaires sur la fenêtre de 14 jours pour UN objectif, ou null s'il ne dit rien. */
function prospectsPourObjectif(o: ObjectifProjet, e: EntreeCible): number | null {
  if (o.status && o.status !== "active") return null;
  if (!compteDesClients(o)) return null;
  const cible = lireMontant(o.targetValue);
  if (cible == null || cible <= 0) return null;
  const restant = Math.max(0, cible - (lireMontant(o.currentValue) ?? 0));

  let clients: number;
  if (estMonetaire(o)) {
    if (!e.panierMoyen || e.panierMoyen <= 0) return null; // montant sans panier : inconvertible
    clients = Math.ceil(restant / e.panierMoyen);
  } else {
    clients = restant;
  }
  if (clients <= 0) return 0;

  const taux = e.tauxConversion && e.tauxConversion > 0 ? e.tauxConversion : TAUX_CONVERSION_PAR_DEFAUT;
  const prospects = clients / taux;

  let horizon = HORIZON_PAR_DEFAUT_JOURS;
  if (o.dueDate) {
    const due = o.dueDate instanceof Date ? o.dueDate : new Date(o.dueDate);
    if (!Number.isNaN(due.getTime())) {
      horizon = Math.max(FENETRE_JOURS, Math.round((due.getTime() - e.aujourdHui.getTime()) / 86400000));
    }
  }
  return Math.ceil((prospects * FENETRE_JOURS) / horizon);
}

export function calculerCibleProspects(e: EntreeCible): CibleProspects {
  const joursOuvres = Math.max(1, joursOuvresProchains(e.aujourdHui, e.workDays));
  const ppd = e.prospectsParJour && e.prospectsParJour > 0 ? e.prospectsParJour : 0;
  const parRythme = ppd * joursOuvres;

  let parObjectif: number | null = null;
  for (const o of e.objectifs) {
    const n = prospectsPourObjectif(o, e);
    if (n == null) continue;
    parObjectif = Math.max(parObjectif ?? 0, n);
  }

  let cible: number;
  let source: CibleProspects["source"];
  let detail: string;
  if (parObjectif != null && parObjectif > 0 && parObjectif >= parRythme) {
    cible = parObjectif;
    source = "objectif";
    detail = `${parObjectif} prospects sur les ${joursOuvres} prochains jours ouvrés pour tenir les objectifs du projet`;
  } else if (parRythme > 0) {
    cible = parRythme;
    source = "rythme";
    detail = `${ppd} prospects par jour × ${joursOuvres} jours ouvrés`;
  } else {
    cible = PLANCHER_CIBLE;
    source = "plancher";
    detail = `aucun objectif chiffré ni rythme défini : ${PLANCHER_CIBLE} prospects pour démarrer`;
  }
  cible = Math.min(PLAFOND_CIBLE, cible);
  return { cible, prospectsParJour: Math.ceil(cible / joursOuvres), joursOuvres, source, detail };
}
