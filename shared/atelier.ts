// L'atelier de contenu — règles PURES, partagées par le serveur et le client.
// Spec : docs/superpowers/specs/2026-10-14-atelier-contenu-design.md
//
// Une semaine de posts se produit en UNE session (l'atelier), pas en 3 à 5 petites tâches
// par post éparpillées sur les jours : Naya pré-rédige, l'utilisatrice corrige et valide.
import type { GenreMedia } from "./programmation";
import { MARGE_MINUTES } from "./programmation";

export type GenreAtelier = "image" | "texte" | "carrousel" | "video" | "story" | "long";

const VIDEO = ["feed_video", "reel", "short"];
const LONG = ["article", "email", "newsletter", "blog"];

/** Genre de production d'un post, d'après son format (même lecture que la production historique). */
export function genreDuPost(post: { postFormat?: string | null; contentType?: string | null }): GenreAtelier {
  const pf = (post.postFormat || "").trim().toLowerCase();
  const ct = (post.contentType || "").trim().toLowerCase();
  if (pf === "carousel" || ct === "carousel") return "carrousel";
  if (VIDEO.includes(pf)) return "video";
  if (LONG.includes(ct)) return "long";
  if (pf === "story" || ct === "story") return "story";
  if (pf === "text") return "texte";
  return "image";
}

/** Minutes d'atelier par post : relire le texte pré-rédigé et préparer le visuel. */
export const DUREE_ATELIER: Record<GenreAtelier, number> = { image: 15, texte: 10, carrousel: 30, video: 15, story: 10, long: 45 };
/** Une session de création au-delà de 90 min s'épuise : on la coupe en parties. */
export const PLAFOND_ATELIER = 90;
/** Jours travaillés entre l'atelier et le premier post (validation à froid, tournage). */
export const JOURS_AVANT_PREMIER_POST = 3;

export const TYPE_ATELIER = "atelier_contenu";
export const TYPE_VALIDATION = "atelier_validation";

// ─── Dates (jours YYYY-MM-DD, calcul en UTC : aucun fuseau ne s'en mêle) ─────────────────

export function plusJours(jour: string, n: number): string {
  const [y, m, d] = jour.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Lundi de la semaine du jour (une semaine va du lundi au dimanche). */
export function lundiDe(jour: string): string {
  const [y, m, d] = jour.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = dimanche
  return plusJours(jour, -((js + 6) % 7));
}

const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** « 19 oct. » : le lundi d'une semaine, pour les titres des tâches (toujours en français). */
export function libelleSemaine(lundi: string): string {
  const [, m, d] = lundi.split("-").map(Number);
  return `${d} ${MOIS_COURTS[m - 1]}`;
}

// ─── Durées et découpage ─────────────────────────────────────────────────────────────────

/** Parties d'atelier (minutes), chacune ≤ plafond sans jamais couper un post. */
export function decouperAtelier(durees: number[], plafond = PLAFOND_ATELIER): number[] {
  const parties: number[] = [];
  let courante = 0;
  for (const d of durees) {
    if (courante > 0 && courante + d > plafond) { parties.push(courante); courante = 0; }
    courante += d;
  }
  if (courante > 0) parties.push(courante);
  return parties;
}

/** Relecture à froid : 5 min + 2 min par post, 20 min au plus. */
export function dureeValidation(nbPosts: number): number {
  return Math.min(20, 5 + 2 * nbPosts);
}

export interface PlanAtelier {
  parties: Array<{ jour: string; duree: number }>;
  validation: { jour: string; duree: number } | null;
  /** Dernier jour où l'atelier peut se faire : la veille travaillée du premier post. */
  echeance: string;
}

/**
 * Jours de l'atelier d'une semaine. L'atelier : 3 jours travaillés avant le premier post,
 * jamais avant aujourd'hui, jamais après l'échéance. Ses parties suivantes : les jours
 * travaillés d'après (sans dépasser l'échéance). La validation : le jour travaillé après la
 * dernière partie, s'il reste avant l'échéance ; sinon aucune (l'atelier vaut validation).
 */
export function planAtelier({ joursPosts, durees, aujourdhui, estTravaille }: {
  joursPosts: string[]; durees: number[]; aujourdhui: string; estTravaille: (d: string) => boolean;
}): PlanAtelier {
  const premier = [...joursPosts].sort()[0];
  const parties = decouperAtelier(durees);

  let echeance = premier;
  for (let d = plusJours(premier, -1); d >= aujourdhui; d = plusJours(d, -1)) {
    if (estTravaille(d)) { echeance = d; break; }
  }

  let cible = premier;
  for (let n = 0, garde = 0; n < JOURS_AVANT_PREMIER_POST && garde < 60; garde++) {
    cible = plusJours(cible, -1);
    if (estTravaille(cible)) n++;
  }
  let jour = cible < aujourdhui ? aujourdhui : cible;
  if (jour > echeance) jour = echeance;
  while (!estTravaille(jour) && jour < echeance) jour = plusJours(jour, 1);

  const suivantTravaille = (d: string): string | null => {
    for (let x = plusJours(d, 1); x <= echeance; x = plusJours(x, 1)) if (estTravaille(x)) return x;
    return null;
  };

  const placees: PlanAtelier["parties"] = [];
  for (const duree of parties) {
    if (placees.length > 0) jour = suivantTravaille(jour) ?? jour;
    placees.push({ jour, duree });
  }
  const jourValidation = placees.length ? suivantTravaille(placees[placees.length - 1].jour) : null;
  return {
    parties: placees,
    validation: jourValidation ? { jour: jourValidation, duree: dureeValidation(durees.length) } : null,
    echeance,
  };
}

// ─── État d'un post et ce qui manque pour le valider ────────────────────────────────────

export type EtatPost = "publie" | "valide" | "brouillon" | "a_rediger";

export function etatPost(p: {
  publishedAt?: unknown; postStatus?: string | null; contentStatus?: string | null;
  autoPost?: boolean | null; consigne?: string | null; campaignId?: number | null; body?: string | null;
}): EtatPost {
  if ((p.publishedAt !== null && p.publishedAt !== undefined) || p.postStatus === "posted") return "publie";
  if (p.contentStatus === "ready" || p.autoPost === true) return "valide";
  if (p.consigne || p.contentStatus === "draft") return "brouillon";
  // Un post manuel : son texte est celui de l'utilisatrice, pas une consigne à rédiger.
  if (p.campaignId === null && (p.body ?? "").trim()) return "brouillon";
  return "a_rediger";
}

export type Manque = "texte" | "date" | "visuel" | "visuels" | "video";

/**
 * Ce qui empêche de valider un post : le post publié ne serait pas celui prévu. Le compte
 * social n'y est pas : sans compte, le post est validé et l'on publie soi-même.
 */
export function manquesPourValider({ genre, body, scheduledFor, medias, maintenant }: {
  genre: GenreAtelier; body: string | null | undefined; scheduledFor: string | Date | null | undefined;
  medias: GenreMedia[]; maintenant: Date;
}): Manque[] {
  const manques: Manque[] = [];
  if (!(body ?? "").trim()) manques.push("texte");
  if (!scheduledFor || new Date(scheduledFor).getTime() < maintenant.getTime() + MARGE_MINUTES * 60_000) manques.push("date");
  if ((genre === "image" || genre === "story") && medias.length === 0) manques.push("visuel");
  if (genre === "carrousel" && medias.length < 2) manques.push("visuels");
  if (genre === "video" && !medias.includes("video")) manques.push("video");
  return manques;
}

/** Échéance d'une tâche d'atelier (le re-tassage ne la repousse pas au-delà), sinon null. */
export function echeanceAtelier(t: { taskType?: string | null; actionData?: unknown }): string | null {
  if (t.taskType !== TYPE_ATELIER && t.taskType !== TYPE_VALIDATION) return null;
  const e = (t.actionData as { echeance?: unknown } | null)?.echeance;
  return typeof e === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e) ? e : null;
}
