// server/services/livrables/post.ts — un livrable déposé sur une tâche de production
// nourrit le post auquel la tâche est rattachée (`tasks.content_id`).
//
// Règles dans @shared/livrables (`effetSurPost`) : le texte d'une étape d'écriture devient
// le texte du post, la photo ou la vidéo d'une étape visuelle y est jointe. Un post publié
// ou en cours de publication n'est jamais modifié. Best-effort : le livrable est déjà
// enregistré, un échec ici ne doit pas le faire échouer.
import { effetSurPost, postModifiable } from "@shared/livrables";

export interface PostDeps {
  lirePost(id: number, userId: string): Promise<{ id: number; userId?: string; postStatus?: string | null; mediaIds?: unknown } | undefined>;
  majPost(id: number, patch: Record<string, unknown>): Promise<unknown>;
  /** Ajoute un média au post en une seule écriture (sans doublon). Atomique : plusieurs
   *  visuels déposés d'un coup arrivent en parallèle, une lecture-puis-écriture en perdrait. */
  ajouterMedia(id: number, mediaId: number): Promise<unknown>;
}

export interface ResultatPost {
  contentId: number;
  texte?: boolean;
  media?: boolean;
}

export async function nourrirLePost(
  deps: PostDeps,
  args: {
    userId: string;
    tache: { title?: string | null; contentId?: number | null } | null | undefined;
    livrable: { kind: string; content?: string | null; mediaId?: number | null };
  },
): Promise<ResultatPost | null> {
  const contentId = args.tache?.contentId;
  if (contentId == null) return null;
  const effet = effetSurPost(args.tache?.title);
  const texte = args.livrable.kind === "texte" && effet.texte ? (args.livrable.content ?? "").trim() : "";
  const mediaId = args.livrable.kind === "media" && effet.media ? args.livrable.mediaId ?? null : null;
  if (!texte && mediaId == null) return null;

  try {
    const post = await deps.lirePost(contentId, args.userId);
    if (!post || !postModifiable(post.postStatus)) return null;

    if (texte) {
      await deps.majPost(contentId, { body: texte });
      return { contentId, texte: true };
    }
    await deps.ajouterMedia(contentId, mediaId!);
    return { contentId, media: true };
  } catch (e: any) {
    console.error(`[Livrables] post ${contentId} non mis à jour:`, e?.message ?? e);
    return null;
  }
}

/**
 * Nouvel ordre des visuels d'un post, demandé par un glisser-déposer. Seuls les visuels
 * déjà rattachés comptent : un id inconnu est ignoré, et un visuel arrivé entre-temps
 * (dépôt pendant que l'écran était ouvert) n'est jamais perdu, il reste en fin de liste.
 */
export function nouvelOrdreMedias(actuels: number[], demande: unknown[]): number[] {
  const restants = new Set(actuels);
  const ordre: number[] = [];
  for (const brut of demande) {
    const id = Number(brut);
    if (restants.delete(id)) ordre.push(id);
  }
  return [...ordre, ...actuels.filter((id) => restants.has(id))];
}
