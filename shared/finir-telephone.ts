// « Finir sur le téléphone » (lot 10, mode notification de Metricool) : ce que les API
// officielles ne savent pas faire se termine dans l'application du réseau. La tâche « Publier — … »
// du post porte alors tout ce qu'il faut sous la main : la légende du réseau, le premier
// commentaire, les hashtags et les médias à télécharger, dans l'ordre.
//
// Quand : le post le demande (`finirSurTelephone` : story avec sticker lien, mentions ou
// musique ; Reel avec une musique sous licence…), ou Naya ne peut pas le publier seule (TikTok,
// dont la publication automatique n'est pas activée ; tout réseau sans compte connecté ou au
// compte expiré). PUR : aucun accès base.
import { formatDePublication, plateformeDe, type GenreMedia } from "./programmation";

export type RaisonTelephone = "demande" | "sans_publication_auto" | "sans_compte" | "compte_expire";

export interface MediaATelecharger { ordre: number; url: string; nom: string; genre: GenreMedia }

export interface ContenuTelephone {
  version: 1;
  reseau: string;
  format: string;
  /** La légende de ce réseau (le texte du post), hashtags compris. */
  legende: string;
  premierCommentaire: string | null;
  /** Les hashtags de la légende et du premier commentaire, sans doublon (casse ignorée). */
  hashtags: string[];
  medias: MediaATelecharger[];
  raisons: RaisonTelephone[];
}

/** Ce qu'il faut savoir du post pour la tâche. */
export interface PostTelephone {
  body?: string | null;
  platform: string;
  postFormat?: string | null;
  premierCommentaire?: string | null;
  finirSurTelephone?: boolean | null;
}

const HASHTAG = /(^|[^\p{L}\p{N}_&/#])#([\p{L}\p{N}_]+)/gu;

/** « #Paris #café et #paris » → ["#Paris", "#café"] (premier écrit gardé). */
export function extraireHashtags(...textes: Array<string | null | undefined>): string[] {
  const vus = new Set<string>();
  const res: string[] = [];
  for (const t of textes) {
    for (const m of (t ?? "").matchAll(HASHTAG)) {
      const tag = `#${m[2]}`;
      const cle = tag.toLowerCase();
      if (/^#\d+$/.test(tag) || vus.has(cle)) continue;
      vus.add(cle);
      res.push(tag);
    }
  }
  return res;
}

/**
 * Pourquoi ce post se finit sur le téléphone, d'après les problèmes de programmation
 * (shared/programmation.ts). Liste vide : Naya peut le publier seule.
 */
export function raisonsTelephone(post: Pick<PostTelephone, "finirSurTelephone">, problemes: readonly string[]): RaisonTelephone[] {
  const r: RaisonTelephone[] = [];
  if (post.finirSurTelephone === true) r.push("demande");
  if (problemes.includes("plateforme_non_supportee")) r.push("sans_publication_auto");
  if (problemes.includes("compte_absent")) r.push("sans_compte");
  if (problemes.includes("compte_expire")) r.push("compte_expire");
  return r;
}

/** Nom de fichier d'un média : son nom d'origine, sinon la fin de son adresse, sinon « media-N ». */
function nomDe(m: { url: string; nom?: string | null }, ordre: number): string {
  const brut = (m.nom ?? "").trim() || decodeURIComponent((m.url.split("?")[0].split("/").pop() ?? "").trim());
  return brut || `media-${ordre}`;
}

/** Ce que porte la tâche « Publier — … » (dans `actionData.telephone`). */
export function contenuTelephone(args: {
  post: PostTelephone;
  medias: Array<{ url: string; nom?: string | null; genre: GenreMedia }>;
  raisons: RaisonTelephone[];
}): ContenuTelephone {
  const { post, medias, raisons } = args;
  const legende = (post.body ?? "").trim();
  const premierCommentaire = (post.premierCommentaire ?? "").trim() || null;
  return {
    version: 1,
    reseau: plateformeDe(post.platform),
    format: formatDePublication(post.postFormat, medias.map((m) => m.genre)),
    legende,
    premierCommentaire,
    hashtags: extraireHashtags(legende, premierCommentaire),
    medias: medias.filter((m) => !!m.url).map((m, i) => ({ ordre: i + 1, url: m.url, nom: nomDe(m, i + 1), genre: m.genre })),
    raisons,
  };
}

/** Lit `actionData.telephone` d'une tâche ; null si absent ou illisible. */
export function lireContenuTelephone(actionData: unknown): ContenuTelephone | null {
  const t = (actionData as any)?.telephone;
  if (!t || typeof t !== "object" || t.version !== 1 || typeof t.legende !== "string" || !Array.isArray(t.medias)) return null;
  return t as ContenuTelephone;
}
