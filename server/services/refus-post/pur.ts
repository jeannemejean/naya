// Fonctions pures du refus de post (aucune dépendance base / réseau).
import { contenuEstPublie } from "../campaign-reject/rejeter";

export const RAISONS_REFUS_POST = ["wrong_tone", "wrong_angle", "not_for_brand", "too_many", "inaccurate", "other"] as const;
export type RaisonRefusPost = typeof RAISONS_REFUS_POST[number];

export function estRaisonRefusPost(x: unknown): x is RaisonRefusPost {
  return typeof x === "string" && (RAISONS_REFUS_POST as readonly string[]).includes(x);
}

const LIBELLES: Record<RaisonRefusPost, string> = {
  wrong_tone: "pas le bon ton",
  wrong_angle: "mauvais angle",
  not_for_brand: "pas pour cette marque",
  too_many: "trop de posts",
  inaccurate: "inexact",
  other: "autre",
};

export function libelleRaisonPost(r: RaisonRefusPost): string {
  return LIBELLES[r];
}

function tronquer(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// Souvenir : seulement s'il y a quelque chose à apprendre (explication, ou raison précise).
export function texteSouvenirPost(
  p: { platform?: string | null; pillar?: string | null; title?: string | null },
  raison: RaisonRefusPost,
  explication?: string | null,
): string | null {
  const texte = (explication ?? "").trim();
  if (!texte && raison === "other") return null;
  const base = `Post refusé (${p.platform || "?"}, ${p.pillar || "?"}) « ${tronquer((p.title ?? "").trim(), 80)} » — ${libelleRaisonPost(raison)}`;
  return texte ? `${base} : ${tronquer(texte, 1500)}` : base;
}

const STATUTS_EN_COURS = ["uploading", "processing", "posting"];

// Publié (n'importe quel signal) ou publication en cours : le post ne se refuse plus.
export function estPublieOuEnCours(c: { publishedAt?: unknown; postStatus?: string | null; contentStatus?: string | null }): boolean {
  if (contenuEstPublie({
    id: 0,
    publishedAt: (c.publishedAt ?? null) as Date | null,
    postStatus: c.postStatus ?? null,
    contentStatus: c.contentStatus ?? null,
  })) return true;
  return STATUTS_EN_COURS.includes((c.postStatus || "").trim().toLowerCase());
}

export interface PostRemplacement {
  title: string;
  body: string;
}

export function validerPostRemplacement(brut: unknown): PostRemplacement | null {
  if (!brut || typeof brut !== "object") return null;
  const o = brut as Record<string, unknown>;
  if (typeof o.title !== "string" || !o.title.trim()) return null;
  if (typeof o.body !== "string" || !o.body.trim()) return null;
  return { title: o.title.trim().slice(0, 200), body: o.body.trim().slice(0, 5000) };
}
