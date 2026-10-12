/** Concurrents : engagement normalisé des posts Instagram, résumé d'un changement d'offre. PUR. */
import { parseJsonObject } from "../prospection/textes";
import { LIMITES } from "./types";

export interface PostEngagement { url: string; taux: number; legende?: string }

const nombre = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Taux d'engagement de chaque post (likes + commentaires) / abonnés. Données agrégées
 * seulement : le nombre d'abonnés sert au calcul, il n'est ni stocké ni comparé.
 */
export function engagementPosts(raw: any): PostEngagement[] {
  const abonnes = nombre(raw?.followers);
  if (!abonnes || abonnes <= 0 || !Array.isArray(raw?.posts)) return [];
  const out: PostEngagement[] = [];
  for (const p of raw.posts) {
    const likes = nombre(p?.likes) ?? nombre(p?.likes_count);
    if (likes == null || !p?.url) continue;
    const coms = nombre(p?.comments) ?? nombre(p?.num_comments) ?? 0;
    const legende = typeof p?.caption === "string" ? p.caption.slice(0, 160) : undefined;
    out.push({ url: String(p.url), taux: (likes + coms) / abonnes, ...(legende ? { legende } : {}) });
  }
  return out;
}

/** Posts à plus de deux fois l'engagement médian du compte (au plus 3). */
export function contenusForts(posts: PostEngagement[]): PostEngagement[] {
  if (posts.length < LIMITES.instagramPostsMin) return [];
  const tri = [...posts].map((p) => p.taux).sort((a, b) => a - b);
  const mediane = tri.length % 2 ? tri[(tri.length - 1) / 2] : (tri[tri.length / 2 - 1] + tri[tri.length / 2]) / 2;
  return posts.filter((p) => p.taux > 2 * mediane).sort((a, b) => b.taux - a.taux).slice(0, 3);
}

/** Réponse de l'IA sur le changement d'une page concurrente. */
export function lireResumeOffre(raw: string): { changement: boolean; resume: string } | null {
  const o = parseJsonObject(raw || "");
  if (typeof o?.changement_commercial !== "boolean") return null;
  return { changement: o.changement_commercial, resume: typeof o.resume === "string" ? o.resume.trim().slice(0, 400) : "" };
}
