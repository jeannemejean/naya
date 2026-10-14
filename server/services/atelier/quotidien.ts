// L'atelier de contenu, chaque matin (passage quotidien de l'auto-planner, 06:00 UTC) :
//   1. bascule — les posts des campagnes déjà lancées dont aucune étape n'est faite quittent
//      l'ancien parcours (3 à 5 tâches) pour l'atelier de leur semaine ;
//   2. rappel — des posts de demain ne sont pas validés : ils ne partiront pas ;
//   3. pré-rédaction — les posts des ateliers d'aujourd'hui et du prochain jour travaillé sont
//      rédigés d'avance, pour que l'atelier s'ouvre sur des brouillons.
// Spec : docs/superpowers/specs/2026-10-14-atelier-contenu-design.md, partie 4.
import { doitRedigerAutomatiquement, etatPost, lundiDe, plusJours, TYPE_ATELIER } from "@shared/atelier";
import { estEtapeEcran, jourDuPost, postAProduire } from "../campagne/production";
import { jourHeureParis } from "./validation";
import type { ResultatRedaction } from "./redaction";

export interface DepsQuotidien {
  postsEntre(userId: string, debut: Date, fin: Date): Promise<any[]>;
  tachesDesPosts(userId: string, ids: number[]): Promise<any[]>;
  archiverTaches(userId: string, ids: number[]): Promise<void>;
  desarchiverTaches(userId: string, ids: number[]): Promise<void>;
  /** Pose les ateliers de ces posts (placement idempotent). */
  placer(userId: string, posts: any[]): Promise<{ creees: number }>;
  tachesAtelier(userId: string, semaine: string): Promise<any[]>;
  rediger(userId: string, id: number): Promise<ResultatRedaction>;
  notifier(userId: string, message: string, lien: string): Promise<void>;
}

const debutJour = (j: string) => new Date(`${j}T00:00:00Z`);
const aProduire = (p: any) => ["a_rediger", "brouillon"].includes(etatPost(p));

/** Bascule des campagnes en cours vers l'atelier. Ne touche jamais un post dont une étape est faite. */
export async function basculerVersAteliers(
  deps: DepsQuotidien, userId: string, { aujourdhui, appliquer }: { aujourdhui: string; appliquer: boolean },
): Promise<{ convertis: number[]; archivees: number[]; creees: number }> {
  const demain = plusJours(aujourdhui, 1);
  const posts = (await deps.postsEntre(userId, debutJour(plusJours(demain, -1)), debutJour(plusJours(demain, 120))))
    .filter((p) => p.campaignId != null && p.scheduledFor && jourDuPost(p.scheduledFor) >= demain && postAProduire(p, aujourdhui) && aProduire(p));
  if (!posts.length) return { convertis: [], archivees: [], creees: 0 };
  const liees = (await deps.tachesDesPosts(userId, posts.map((p) => p.id))).filter((t) => !t.archivedAt);

  const convertis: any[] = [];
  const archivees: number[] = [];
  for (const p of posts) {
    const toutes = liees.filter((t) => t.contentId === p.id);
    // Aucune étape faite, quelle qu'elle soit (écrire, tourner…) : sinon l'ancien parcours continue.
    if (toutes.some((t) => t.completed)) continue;
    const ecran = toutes.filter((t) => estEtapeEcran(t.title));
    if (ecran.length === 0) continue;
    convertis.push(p);
    archivees.push(...ecran.map((t) => t.id));
  }
  if (!appliquer || convertis.length === 0) return { convertis: convertis.map((p) => p.id), archivees, creees: 0 };
  // Archivées d'abord (sinon le placement les voit encore sur l'ancien parcours) ; rendues si la
  // pose échoue : un post n'est jamais laissé sans aucune tâche.
  await deps.archiverTaches(userId, archivees);
  let creees: number;
  try {
    ({ creees } = await deps.placer(userId, convertis));
  } catch (e) {
    await deps.desarchiverTaches(userId, archivees).catch(() => {});
    throw e;
  }
  return { convertis: convertis.map((p) => p.id), archivees, creees };
}

const MESSAGES = {
  fr: (n: number) => n > 1
    ? `${n} posts de demain ne sont pas validés : ils ne partiront pas. Ouvre l'atelier pour les valider.`
    : "1 post de demain n'est pas validé : il ne partira pas. Ouvre l'atelier pour le valider.",
  en: (n: number) => n > 1
    ? `${n} posts scheduled for tomorrow aren't approved: they won't go out. Open the workshop to approve them.`
    : "1 post scheduled for tomorrow isn't approved: it won't go out. Open the workshop to approve it.",
};

/** La veille : prévient si des posts de demain ne sont pas validés. Renvoie leur nombre. */
export async function rappelVeille(deps: DepsQuotidien, userId: string, maintenant: Date, langue: "fr" | "en"): Promise<number> {
  const demain = plusJours(jourHeureParis(maintenant).jour, 1);
  const posts = (await deps.postsEntre(userId, debutJour(plusJours(demain, -1)), debutJour(plusJours(demain, 2))))
    .filter((p) => p.scheduledFor && jourHeureParis(new Date(p.scheduledFor)).jour === demain && aProduire(p));
  if (!posts.length) return 0;
  await deps.notifier(userId, MESSAGES[langue](posts.length), `/atelier?semaine=${lundiDe(demain)}`);
  return posts.length;
}

/**
 * Rédige d'avance les posts des ateliers prévus aujourd'hui et au prochain jour travaillé.
 * Un à la fois ; s'arrête au premier refus de dépense. Renvoie le nombre de posts rédigés.
 */
export async function preRediger(deps: DepsQuotidien, userId: string, aujourdhui: string, estTravaille: (d: string) => boolean): Promise<number> {
  let prochain = plusJours(aujourdhui, 1);
  for (let i = 0; i < 14 && !estTravaille(prochain); i++) prochain = plusJours(prochain, 1);
  const lundi = lundiDe(aujourdhui);
  const semaines: string[] = [];
  for (const s of [lundi, plusJours(lundi, 7), plusJours(lundi, 14)]) {
    const ateliers = (await deps.tachesAtelier(userId, s)).filter((t) =>
      t.taskType === TYPE_ATELIER && !t.completed && t.scheduledDate >= aujourdhui && t.scheduledDate <= prochain);
    if (ateliers.length) semaines.push(s);
  }
  let rediges = 0;
  for (const s of semaines) {
    const posts = (await deps.postsEntre(userId, debutJour(plusJours(s, -1)), debutJour(plusJours(s, 8))))
      .filter((p) => doitRedigerAutomatiquement(p) && p.scheduledFor && lundiDe(jourDuPost(p.scheduledFor)) === s && etatPost(p) === "a_rediger")
      .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
    for (const p of posts) {
      const r = await deps.rediger(userId, p.id);
      if (r.statut === "refus") return rediges;
      if (r.statut === "redige") rediges++;
    }
  }
  return rediges;
}
