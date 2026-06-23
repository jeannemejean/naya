/**
 * Capacités & règles de publication par réseau social — module PUR, partagé client ↔ serveur.
 *
 * Sert à : (1) afficher les formats disponibles par réseau dans le composer,
 * (2) valider un post AVANT publication (format, médias, durée vidéo, légende),
 * (3) mapper format → appel API côté backend.
 *
 * Réseaux : instagram, facebook (Page), linkedin (profil ET page entreprise), tiktok.
 */

export type Platform = "instagram" | "facebook" | "linkedin" | "tiktok";

export type PostFormat =
  | "text"        // texte seul (LinkedIn)
  | "feed_image"  // 1 image en feed
  | "feed_video"  // 1 vidéo en feed
  | "carousel"    // 2-N médias
  | "story"       // story plein écran 9:16 (IG/FB)
  | "reel"        // reel vidéo 9:16 (IG/FB)
  | "short";      // vidéo TikTok 9:16

export type MediaKind = "image" | "video";

export interface MediaInput {
  kind: MediaKind;
  durationSec?: number; // vidéos
  width?: number;
  height?: number;
}

export interface FormatRule {
  /** Type de média attendu. */
  media: "none" | "image" | "video" | "image_or_video" | "multi";
  minMedia: number;
  maxMedia: number;
  /** Bornes de durée vidéo (secondes). */
  minVideoSec?: number;
  maxVideoSec?: number;
  /** Ratio recommandé (indice UI). */
  ratioHint?: string;
  label: string;
}

export interface PlatformCaps {
  label: string;
  captionMax: number;
  formats: Partial<Record<PostFormat, FormatRule>>;
}

const IMG_OR_VID = "image_or_video" as const;

export const CAPABILITIES: Record<Platform, PlatformCaps> = {
  instagram: {
    label: "Instagram",
    captionMax: 2200,
    formats: {
      feed_image: { media: "image", minMedia: 1, maxMedia: 1, ratioHint: "1:1 ou 4:5", label: "Post photo" },
      feed_video: { media: "video", minMedia: 1, maxMedia: 1, maxVideoSec: 60, ratioHint: "1:1 ou 4:5", label: "Post vidéo" },
      carousel: { media: "multi", minMedia: 2, maxMedia: 10, ratioHint: "1:1 ou 4:5", label: "Carrousel" },
      story: { media: IMG_OR_VID, minMedia: 1, maxMedia: 1, maxVideoSec: 60, ratioHint: "9:16", label: "Story" },
      reel: { media: "video", minMedia: 1, maxMedia: 1, minVideoSec: 3, maxVideoSec: 90, ratioHint: "9:16", label: "Reel" },
    },
  },
  facebook: {
    label: "Facebook (Page)",
    captionMax: 63206,
    formats: {
      feed_image: { media: "image", minMedia: 1, maxMedia: 1, label: "Post photo" },
      feed_video: { media: "video", minMedia: 1, maxMedia: 1, maxVideoSec: 1200, label: "Post vidéo" },
      carousel: { media: "multi", minMedia: 2, maxMedia: 10, label: "Carrousel" },
      story: { media: IMG_OR_VID, minMedia: 1, maxMedia: 1, maxVideoSec: 60, ratioHint: "9:16", label: "Story" },
      reel: { media: "video", minMedia: 1, maxMedia: 1, minVideoSec: 3, maxVideoSec: 90, ratioHint: "9:16", label: "Reel" },
    },
  },
  linkedin: {
    label: "LinkedIn",
    captionMax: 3000,
    formats: {
      text: { media: "none", minMedia: 0, maxMedia: 0, label: "Texte" },
      feed_image: { media: "image", minMedia: 1, maxMedia: 1, label: "Post photo" },
      feed_video: { media: "video", minMedia: 1, maxMedia: 1, maxVideoSec: 600, label: "Post vidéo" },
      carousel: { media: "multi", minMedia: 2, maxMedia: 20, label: "Multi-images" },
      // Pas de story / reel sur LinkedIn.
    },
  },
  tiktok: {
    label: "TikTok",
    captionMax: 2200,
    formats: {
      short: { media: "video", minMedia: 1, maxMedia: 1, minVideoSec: 3, maxVideoSec: 600, ratioHint: "9:16", label: "Vidéo" },
    },
  },
};

/** Capacités d'un réseau. */
export function capabilitiesFor(platform: Platform): PlatformCaps {
  return CAPABILITIES[platform];
}

/** Formats disponibles pour un réseau (clé + label). */
export function formatsFor(platform: Platform): { format: PostFormat; label: string }[] {
  const caps = CAPABILITIES[platform];
  return Object.entries(caps.formats).map(([format, rule]) => ({ format: format as PostFormat, label: rule!.label }));
}

export interface ValidateInput {
  platform: Platform;
  format: PostFormat;
  media: MediaInput[];
  caption: string;
}

/** Valide un post. Renvoie la liste d'erreurs lisibles (vide si OK). */
export function validatePost(input: ValidateInput): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const caps = CAPABILITIES[input.platform];
  if (!caps) return { ok: false, errors: [`Réseau inconnu : ${input.platform}`] };

  const rule = caps.formats[input.format];
  if (!rule) {
    errors.push(`Le format « ${input.format} » n'est pas disponible sur ${caps.label}.`);
    return { ok: false, errors };
  }

  // Légende
  if (input.caption && input.caption.length > caps.captionMax) {
    errors.push(`Légende trop longue (${input.caption.length}/${caps.captionMax} caractères pour ${caps.label}).`);
  }

  // Nombre de médias
  const n = input.media.length;
  if (n < rule.minMedia) errors.push(`${rule.label} : au moins ${rule.minMedia} média(s) requis.`);
  if (n > rule.maxMedia) errors.push(`${rule.label} : ${rule.maxMedia} média(s) maximum (${n} fournis).`);

  // Types de média
  for (const m of input.media) {
    if (rule.media === "image" && m.kind !== "image") errors.push(`${rule.label} : seules les images sont acceptées.`);
    if (rule.media === "video" && m.kind !== "video") errors.push(`${rule.label} : une vidéo est requise.`);
    // "image_or_video" et "multi" acceptent les deux ; "none" est géré par minMedia=0
  }

  // Durée vidéo
  for (const m of input.media) {
    if (m.kind === "video" && m.durationSec != null) {
      if (rule.maxVideoSec != null && m.durationSec > rule.maxVideoSec)
        errors.push(`${rule.label} : vidéo trop longue (${Math.round(m.durationSec)}s, max ${rule.maxVideoSec}s).`);
      if (rule.minVideoSec != null && m.durationSec < rule.minVideoSec)
        errors.push(`${rule.label} : vidéo trop courte (${Math.round(m.durationSec)}s, min ${rule.minVideoSec}s).`);
    }
  }

  return { ok: errors.length === 0, errors };
}
