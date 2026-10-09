// Visuels d'un post du calendrier de contenu. Les visuels déposés sur les tâches de
// production (« Préparer le visuel », « Designer les slides »…) sont rangés dans la
// médiathèque et rattachés au post par `mediaIds`, dans l'ordre de dépôt — c'est aussi
// l'ordre de publication. L'ancien champ `mediaUrl` (un seul média, ajouté à la main
// depuis le calendrier) ne sert que lorsqu'aucun visuel n'est rattaché, comme à la publication.

export interface MediaDuPost {
  id: number;
  url: string;
  mimeType: string;
}

interface ElementMediatheque {
  id: number;
  url: string;
  mimeType?: string | null;
  thumbnailUrl?: string | null;
}

export function mediasDuPost(
  post: { mediaIds?: unknown; mediaUrl?: string | null },
  mediatheque: ElementMediatheque[],
): MediaDuPost[] {
  const parId = new Map(mediatheque.map((m) => [Number(m.id), m]));
  const ids = Array.isArray(post.mediaIds) ? post.mediaIds.map(Number) : [];
  const medias: MediaDuPost[] = [];
  for (const id of ids) {
    const m = parId.get(id);
    if (m && !medias.some((x) => x.id === id)) medias.push({ id, url: m.url, mimeType: m.mimeType ?? "image/*" });
  }
  if (medias.length === 0 && post.mediaUrl) medias.push({ id: 0, url: post.mediaUrl, mimeType: "image/*" });
  return medias;
}

export const estVideo = (m: MediaDuPost) => m.mimeType.startsWith("video/");

/** La liste avec l'élément `de` déplacé à la place `vers` (glisser-déposer). */
export function deplacer<T>(liste: T[], de: number, vers: number): T[] {
  if (de === vers || de < 0 || vers < 0 || de >= liste.length || vers >= liste.length) return liste;
  const copie = [...liste];
  const [x] = copie.splice(de, 1);
  copie.splice(vers, 0, x);
  return copie;
}
