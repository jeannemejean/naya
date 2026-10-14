// Adaptateur Instagram (dataset Bright Data « instagram profiles ») → posts normalisés.
// Les noms de champs varient selon les versions du dataset : on lit les variantes connues.
// Vérifié sur un échantillon réel (scripts/capturer-instagram.ts) — voir Task 4, Step 6.
import type { Metriques, TypeMedia } from "@shared/profils-veille";
import { anonymiser } from "../../veille/texte";

export interface PostCollecte { url: string; publieLe: Date | null; typeMedia: TypeMedia; legende: string | null; metriques: Metriques }
export interface ProfilCollecte { compte: string | null; abonnes: number | null; erreur: string | null; posts: PostCollecte[] }

const nombre = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

function date(p: any): Date | null {
  const v = p?.datetime ?? p?.date_time ?? p?.date ?? p?.timestamp ?? p?.taken_at;
  if (v == null) return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

function typeMedia(p: any): TypeMedia {
  const t = String(p?.content_type ?? p?.type ?? "").toLowerCase();
  const produit = String(p?.product_type ?? "").toLowerCase();
  if (t.includes("carousel") || t.includes("sidecar") || produit === "carousel_container") return "carrousel";
  if (produit === "clips" || t.includes("reel") || t.includes("clip")) return "reel";
  if (t.includes("video") || p?.is_video === true) return "video";
  return "image";
}

export function lireProfilInstagram(raw: any): ProfilCollecte {
  if (!raw || typeof raw !== "object") return { compte: null, abonnes: null, erreur: "vide", posts: [] };
  if (raw.error) return { compte: null, abonnes: null, erreur: String(raw.error).slice(0, 200), posts: [] };
  const compte = typeof (raw.account ?? raw.username) === "string" ? String(raw.account ?? raw.username).toLowerCase() : null;
  if (raw.is_private === true) return { compte, abonnes: null, erreur: "prive", posts: [] };
  const posts: PostCollecte[] = [];
  for (const p of Array.isArray(raw.posts) ? raw.posts : []) {
    if (!p?.url) continue;
    const legende = typeof p.caption === "string" ? anonymiser(p.caption).slice(0, 600) || null : null;
    posts.push({
      url: String(p.url),
      publieLe: date(p),
      typeMedia: typeMedia(p),
      legende,
      metriques: {
        likes: nombre(p.likes) ?? nombre(p.likes_count),
        commentaires: nombre(p.comments) ?? nombre(p.num_comments),
        vues: nombre(p.video_view_count) ?? nombre(p.views) ?? nombre(p.video_play_count),
      },
    });
  }
  return { compte, abonnes: nombre(raw.followers), erreur: null, posts };
}
