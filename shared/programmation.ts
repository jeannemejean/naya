// Programmer un post : Naya le publie seule à l'heure prévue (worker social-publisher).
// Ici, les règles pures : quel format part, et ce qui empêche de programmer. Rien ne
// part sans que l'utilisatrice l'ait demandé (autoPost passe à true par son clic).

export const PLATEFORMES_PUBLIABLES = ["instagram", "linkedin", "facebook"] as const;
/** Instagram refuse un carrousel de plus de 10 éléments. */
export const MAX_CARROUSEL = 10;
/** Marge minimale avant l'heure de publication, pour que le worker (chaque minute) la voie. */
export const MARGE_MINUTES = 2;

export type GenreMedia = "image" | "video";

/** Plateforme normalisée (« Instagram » → « instagram »). */
export function plateformeDe(platform: string | null | undefined): string {
  return (platform ?? "").trim().toLowerCase();
}

/**
 * Format réellement publié. Un format explicite (story, reel, short) est respecté ; sinon
 * il se déduit des visuels : plusieurs → carrousel, une vidéo → vidéo, sinon image, aucun → texte.
 */
export function formatDePublication(postFormat: string | null | undefined, medias: GenreMedia[]): string {
  if (postFormat && ["story", "reel", "short"].includes(postFormat)) return postFormat;
  if (medias.length === 0) return "text";
  if (medias.length > 1) return "carousel";
  return medias[0] === "video" ? "feed_video" : "feed_image";
}

export type ProblemeProgrammation =
  | "deja_publie"
  | "texte_vide"
  | "date_manquante"
  | "date_passee"
  | "plateforme_non_supportee"
  | "compte_absent"
  | "compte_expire"
  | "visuel_requis"
  | "trop_de_visuels";

export interface CompteSocial {
  id: number;
  platform: string;
  accountName?: string | null;
  isActive?: boolean | null;
  expiresAt?: string | Date | null;
}

/** Le compte qui publiera ce post : celui lié au post, sinon le compte actif de la plateforme. */
export function compteDuPost(
  post: { platform: string; socialAccountId?: number | null },
  comptes: CompteSocial[],
): CompteSocial | null {
  if (post.socialAccountId != null) {
    const lie = comptes.find((c) => c.id === post.socialAccountId);
    if (lie) return lie;
  }
  const p = plateformeDe(post.platform);
  return comptes.find((c) => plateformeDe(c.platform) === p && c.isActive !== false) ?? null;
}

export function problemesProgrammation(args: {
  post: { body?: string | null; platform: string; scheduledFor?: string | Date | null; postStatus?: string | null; publishedAt?: string | Date | null };
  medias: GenreMedia[];
  compte: CompteSocial | null;
  maintenant: Date;
}): ProblemeProgrammation[] {
  const { post, medias, compte, maintenant } = args;
  if (post.publishedAt || post.postStatus === "posted") return ["deja_publie"];
  const problemes: ProblemeProgrammation[] = [];
  if (!(post.body ?? "").trim()) problemes.push("texte_vide");
  if (!post.scheduledFor) problemes.push("date_manquante");
  else if (new Date(post.scheduledFor).getTime() < maintenant.getTime() + MARGE_MINUTES * 60_000) problemes.push("date_passee");
  const plateforme = plateformeDe(post.platform);
  if (!(PLATEFORMES_PUBLIABLES as readonly string[]).includes(plateforme)) {
    problemes.push("plateforme_non_supportee");
    return problemes;
  }
  if (!compte) problemes.push("compte_absent");
  else if (compte.expiresAt && new Date(compte.expiresAt).getTime() <= maintenant.getTime()) problemes.push("compte_expire");
  if (plateforme !== "linkedin" && medias.length === 0) problemes.push("visuel_requis");
  if (medias.length > MAX_CARROUSEL) problemes.push("trop_de_visuels");
  return problemes;
}
