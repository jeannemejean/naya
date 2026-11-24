// shared/apercu-instagram.ts — Aperçu de la grille Instagram d'une marque (lot 4, inspiré de
// Metricool « instagramFeed ») : les prochains posts du fil, du plus lointain au plus proche
// (comme Instagram les empilera), puis ceux déjà publiés depuis Naya. Règles pures, sans base.
import { etatPost, type EtatPost } from "./atelier";

export const APERCU_LIMITE = 30;
/** Formats qui apparaissent dans la grille du profil (jamais les stories). */
export const FORMATS_FIL = ["feed_image", "carousel", "reel", "feed_video"] as const;
/** Un post non publié dont la date est passée depuis plus longtemps n'est plus « à venir ». */
const RETARD_TOLERE_MS = 24 * 3_600_000;

export type GenreTuile = "image" | "carrousel" | "video";

export interface TuileInstagram {
  id: number;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  kind: GenreTuile;
  etat: EtatPost;
  /** Programmé pour partir seul (autoPost) à sa date. */
  programme: boolean;
  scheduledFor: string | null;
  publishedAt: string | null;
  format: string;
}

export interface MediaApercu { url?: string | null; thumbnailUrl?: string | null; mimeType?: string | null }

const instant = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const t = new Date(v as any).getTime();
  return Number.isNaN(t) ? null : t;
};
const iso = (t: number | null) => (t == null ? null : new Date(t).toISOString());

/** Ce post a-t-il sa place dans la grille du profil Instagram ? */
export function dansLaGrille(p: Record<string, any>): boolean {
  if (p.supprimeLe) return false;
  if (String(p.platform ?? "").trim().toLowerCase() !== "instagram") return false;
  const format = String(p.postFormat ?? "feed_image");
  if (!(FORMATS_FIL as readonly string[]).includes(format)) return false;
  // Un Reel que l'on a choisi de ne pas montrer dans le fil n'apparaît pas dans la grille.
  if (format === "reel" && p.reelDansLeFil === false) return false;
  return true;
}

/**
 * Les tuiles de la grille, dans l'ordre d'Instagram : en tête le post prévu le plus tard, puis
 * les autres posts à venir, puis les publiés du plus récent au plus ancien. Un post non publié
 * sans date, ou daté de plus d'un jour dans le passé, n'y figure pas.
 */
export function tuilesInstagram(
  posts: Array<Record<string, any>>,
  medias: Map<number, MediaApercu>,
  maintenant: Date,
  limite = APERCU_LIMITE,
): TuileInstagram[] {
  const aVenir: Array<{ t: number; tuile: TuileInstagram }> = [];
  const publies: Array<{ t: number; tuile: TuileInstagram }> = [];
  const seuil = maintenant.getTime() - RETARD_TOLERE_MS;
  for (const p of posts) {
    if (!dansLaGrille(p)) continue;
    const etat = etatPost(p);
    const publie = etat === "publie";
    const date = publie ? (instant(p.publishedAt) ?? instant(p.scheduledFor) ?? instant(p.updatedAt)) : instant(p.scheduledFor);
    if (date == null) continue;
    if (!publie && date < seuil) continue;
    const tuile = tuileDe(p, etat, medias);
    (publie ? publies : aVenir).push({ t: date, tuile });
  }
  const recentDabord = (a: { t: number; tuile: TuileInstagram }, b: { t: number; tuile: TuileInstagram }) => b.t - a.t || b.tuile.id - a.tuile.id;
  return [...aVenir.sort(recentDabord), ...publies.sort(recentDabord)].slice(0, limite).map((x) => x.tuile);
}

function tuileDe(p: Record<string, any>, etat: EtatPost, medias: Map<number, MediaApercu>): TuileInstagram {
  const ids: number[] = Array.isArray(p.mediaIds) ? p.mediaIds.map(Number).filter((n: number) => Number.isInteger(n)) : [];
  const premier = ids.length ? medias.get(ids[0]) : undefined;
  const format = String(p.postFormat ?? "feed_image");
  const mime = String(premier?.mimeType ?? "").toLowerCase();
  const estVideo = mime.startsWith("video/") || (!premier && (format === "reel" || format === "feed_video"));
  const kind: GenreTuile = ids.length > 1 || format === "carousel" ? "carrousel" : estVideo ? "video" : "image";
  const mediaUrl = premier?.url ?? p.mediaUrl ?? null;
  // Une vidéo s'affiche par sa couverture (choisie pour le Reel), sinon sa vignette ; une image par elle-même.
  const thumbnailUrl = estVideo
    ? (p.couvertureUrl ?? premier?.thumbnailUrl ?? p.videoMeta?.thumbnailUrl ?? null)
    : (premier?.thumbnailUrl ?? mediaUrl);
  return {
    id: p.id,
    mediaUrl,
    thumbnailUrl,
    kind,
    etat,
    programme: etat !== "publie" && p.autoPost === true && instant(p.scheduledFor) != null,
    scheduledFor: iso(instant(p.scheduledFor)),
    publishedAt: iso(instant(p.publishedAt)),
    format,
  };
}

/** Une tuile pâle : le post n'est pas encore validé (brouillon, à rédiger). */
export function tuilePale(t: Pick<TuileInstagram, "etat">): boolean {
  return t.etat === "brouillon" || t.etat === "a_rediger";
}
