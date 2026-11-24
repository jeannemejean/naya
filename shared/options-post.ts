// Options de publication d'un post (API officielles seulement).
//
// Instagram (API « Instagram Login », POST /<IG_ID>/media) :
//  - alt_text : images seulement (image du fil ou image d'un carrousel), 1000 caractères ; ni Reel
//    ni story. V1 : un seul texte pour toutes les images du post.
//  - collaborators : jusqu'à 3 noms d'utilisateur (comptes publics) ; photo du fil, Reel, carrousel
//    (sur le conteneur carrousel) ; jamais en story.
//  - share_to_feed : Reels seulement (true = défaut d'Instagram, aussi dans le fil).
//  - audio_name : Reels seulement, renomme l'audio original (une seule fois).
// LinkedIn : un carrousel peut partir en document PDF (une image par page) ; titre ≤ 200.

export const ALT_TEXTE_MAX = 1000;
export const COLLABORATEURS_MAX = 3;
/** Pas de limite documentée par Instagram : on garde un nom court. */
export const NOM_AUDIO_MAX = 100;
export const TITRE_DOCUMENT_MAX = 200;
export const NOM_INSTAGRAM = /^[a-zA-Z0-9._]{1,30}$/;

export interface OptionsPost {
  texteAlternatif?: string | null;
  collaborateurs?: string[] | null;
  reelDansLeFil?: boolean | null;
  nomAudio?: string | null;
  linkedinDocument?: boolean | null;
}

const INVALIDE = Symbol("invalide");

function texte(v: unknown, max: number): string | null | typeof INVALIDE {
  if (v === null) return null;
  if (typeof v !== "string") return INVALIDE;
  const t = v.trim();
  if (t.length > max) return INVALIDE;
  return t || null;
}

function booleen(v: unknown): boolean | null | typeof INVALIDE {
  if (v === null) return null;
  return typeof v === "boolean" ? v : INVALIDE;
}

/** Noms Instagram nettoyés (« @ » retiré, minuscules, sans doublon), [] → null ; undefined si invalide. */
export function lireCollaborateurs(v: unknown): string[] | null | undefined {
  if (v === null) return null;
  if (!Array.isArray(v)) return undefined;
  const noms: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") return undefined;
    const n = x.trim().replace(/^@/, "").toLowerCase();
    if (!n) continue;
    if (!NOM_INSTAGRAM.test(n)) return undefined;
    if (!noms.includes(n)) noms.push(n);
  }
  if (noms.length > COLLABORATEURS_MAX) return undefined;
  return noms.length ? noms : null;
}

/**
 * Options présentes dans `m` (les absentes ne sont pas touchées), ou null si l'une est invalide.
 */
export function lireOptionsPost(m: Record<string, unknown>): Partial<OptionsPost> | null {
  const patch: Partial<OptionsPost> = {};
  if (m.texteAlternatif !== undefined) {
    const t = texte(m.texteAlternatif, ALT_TEXTE_MAX);
    if (t === INVALIDE) return null;
    patch.texteAlternatif = t;
  }
  if (m.collaborateurs !== undefined) {
    const c = lireCollaborateurs(m.collaborateurs);
    if (c === undefined) return null;
    patch.collaborateurs = c;
  }
  if (m.reelDansLeFil !== undefined) {
    const b = booleen(m.reelDansLeFil);
    if (b === INVALIDE) return null;
    patch.reelDansLeFil = b;
  }
  if (m.nomAudio !== undefined) {
    const t = texte(m.nomAudio, NOM_AUDIO_MAX);
    if (t === INVALIDE) return null;
    patch.nomAudio = t;
  }
  if (m.linkedinDocument !== undefined) {
    const b = booleen(m.linkedinDocument);
    if (b === INVALIDE) return null;
    patch.linkedinDocument = b;
  }
  return patch;
}

/** Ne garde que les options utiles au réseau et au format d'un post. */
export function optionsPourReseau(o: Partial<OptionsPost>, plateforme: string, format: string): Partial<OptionsPost> {
  const r: Partial<OptionsPost> = {};
  if (plateforme === "instagram") {
    if (format !== "story") {
      r.texteAlternatif = o.texteAlternatif ?? null;
      r.collaborateurs = o.collaborateurs ?? null;
    }
    if (format === "reel" || format === "feed_video") {
      r.reelDansLeFil = o.reelDansLeFil ?? null;
      r.nomAudio = o.nomAudio ?? null;
    }
  }
  if (plateforme === "linkedin" && format === "carousel") r.linkedinDocument = o.linkedinDocument ?? null;
  return r;
}
