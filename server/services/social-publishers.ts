/**
 * Couche de publication format-aware (refonte Metricool/Later).
 *
 * Dispatch par réseau + format. Instagram est implémenté à fond (image, carrousel,
 * vidéo/reel/story avec traitement vidéo ASYNCHRONE via conteneurs Graph). Facebook,
 * LinkedIn et Twitter passent encore par l'ancien service (image/texte) — upgradés ensuite.
 *
 * Modèle async (vidéo IG) : on crée le conteneur → l'API renvoie un container id en cours de
 * traitement → le worker re-vérifie le statut puis publie quand FINISHED.
 */
import { socialMediaService } from "./social-integrations";

const GRAPH = "https://graph.facebook.com/v23.0";

export type MediaKind = "image" | "video";
export interface PubMedia {
  url: string;
  kind: MediaKind;
  durationSec?: number;
}
export interface PubCredentials {
  accessToken: string;
  accountId: string;
  /** Plateforme du compte (ex. "linkedin" ou "linkedin_page_123") → auteur profil vs page. */
  accountPlatform?: string;
}
export interface PubInput {
  platform: string; // instagram|facebook|linkedin|tiktok
  format: string; // feed_image|feed_video|carousel|story|reel|short|text
  caption: string;
  media: PubMedia[];
  credentials: PubCredentials;
}
export interface PubResult {
  state: "posted" | "processing" | "failed";
  platformPostId?: string;
  containerId?: string;
  error?: string;
}

// ─────────────────────────── Helpers PURS (testables) ───────────────────────────

/** Type de conteneur Instagram pour un format + média donné. */
export function igMediaType(format: string, kind: MediaKind): "IMAGE" | "VIDEO" | "REELS" | "STORIES" {
  if (format === "story") return "STORIES";
  if (format === "reel" || format === "feed_video") return "REELS";
  return kind === "video" ? "REELS" : "IMAGE";
}

/** Un format implique-t-il un traitement vidéo asynchrone ? */
export function igIsAsync(format: string, media: PubMedia[]): boolean {
  if (format === "reel" || format === "feed_video") return true;
  if ((format === "story") && media[0]?.kind === "video") return true;
  if (format === "carousel" && media.some((m) => m.kind === "video")) return true;
  return false;
}

/**
 * Paramètres de création d'un conteneur Instagram (hors access_token).
 * `asChild` = élément de carrousel.
 */
export function igContainerParams(
  format: string,
  item: PubMedia,
  caption: string,
  asChild = false,
): Record<string, any> {
  const params: Record<string, any> = {};
  const type = igMediaType(format, item.kind);
  if (item.kind === "video") {
    params.video_url = item.url;
    if (type !== "IMAGE") params.media_type = type; // REELS / STORIES
  } else {
    params.image_url = item.url;
    if (format === "story") params.media_type = "STORIES";
  }
  if (asChild) params.is_carousel_item = true;
  else if (caption && format !== "story") params.caption = caption;
  return params;
}

// ─────────────────────────── Appels Graph (Instagram) ───────────────────────────

async function graphPost(path: string, body: Record<string, any>, accessToken: string): Promise<any> {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: accessToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`graph_${res.status}: ${data?.error?.message || JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function igCreateContainer(creds: PubCredentials, params: Record<string, any>): Promise<string> {
  const d = await graphPost(`${creds.accountId}/media`, params, creds.accessToken);
  return d.id;
}

async function igPublish(creds: PubCredentials, creationId: string): Promise<string> {
  const d = await graphPost(`${creds.accountId}/media_publish`, { creation_id: creationId }, creds.accessToken);
  return d.id;
}

/** Statut d'un conteneur vidéo : FINISHED | IN_PROGRESS | ERROR | EXPIRED | PUBLISHED. */
export async function igContainerStatus(creds: PubCredentials, containerId: string): Promise<string> {
  const res = await fetch(`${GRAPH}/${containerId}?fields=status_code&access_token=${encodeURIComponent(creds.accessToken)}`);
  const d = await res.json().catch(() => ({}));
  return d?.status_code || "UNKNOWN";
}

/** Worker : vérifie un conteneur en cours et publie s'il est prêt. */
export async function igFinishAsync(creds: PubCredentials, containerId: string): Promise<PubResult> {
  const status = await igContainerStatus(creds, containerId).catch(() => "UNKNOWN");
  if (status === "FINISHED") {
    const id = await igPublish(creds, containerId);
    return { state: "posted", platformPostId: id };
  }
  if (status === "ERROR" || status === "EXPIRED") return { state: "failed", error: `container_${status}` };
  return { state: "processing", containerId }; // IN_PROGRESS / UNKNOWN → réessayer
}

async function publishInstagram(input: PubInput): Promise<PubResult> {
  const { credentials: creds, format, media, caption } = input;

  if (format === "carousel") {
    const childIds: string[] = [];
    for (const m of media) {
      const childId = await igCreateContainer(creds, igContainerParams(format, m, caption, true));
      childIds.push(childId);
    }
    const carouselId = await igCreateContainer(creds, { media_type: "CAROUSEL", children: childIds.join(","), caption });
    const id = await igPublish(creds, carouselId);
    return { state: "posted", platformPostId: id };
  }

  const item = media[0];
  if (!item) return { state: "failed", error: "no_media" };
  const containerId = await igCreateContainer(creds, igContainerParams(format, item, caption));

  if (igIsAsync(format, media)) {
    // Vidéo : laisser le worker poller le statut puis publier.
    return { state: "processing", containerId };
  }
  const id = await igPublish(creds, containerId);
  return { state: "posted", platformPostId: id };
}

// ─────────────────────────── LinkedIn (profil + page entreprise) ───────────────────────────

const LI_API = "https://api.linkedin.com/rest";
const LI_VERSION = "202405";

function liHeaders(token: string, json = true): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "X-Restli-Protocol-Version": "2.0.0",
    "LinkedIn-Version": LI_VERSION,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

/** URN auteur LinkedIn : organisation (page) ou personne (profil). Pur & testable. */
export function linkedinAuthorUrn(accountPlatform: string | undefined, accountId: string): string {
  if (accountPlatform && accountPlatform.startsWith("linkedin_page")) return `urn:li:organization:${accountId}`;
  return `urn:li:person:${accountId}`;
}

/** Upload réel d'une image vers LinkedIn (Assets API) → renvoie l'URN image. */
async function liUploadImage(token: string, owner: string, mediaUrl: string): Promise<string> {
  const init = await fetch(`${LI_API}/images?action=initializeUpload`, {
    method: "POST",
    headers: liHeaders(token),
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  const ij: any = await init.json().catch(() => ({}));
  if (!init.ok) throw new Error(`li_img_init_${init.status}: ${JSON.stringify(ij).slice(0, 150)}`);
  const uploadUrl = ij?.value?.uploadUrl;
  const imageUrn = ij?.value?.image;
  if (!uploadUrl || !imageUrn) throw new Error("li_img_init_no_url");
  const bytes = Buffer.from(await (await fetch(mediaUrl)).arrayBuffer());
  const up = await fetch(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: bytes });
  if (!up.ok) throw new Error(`li_img_upload_${up.status}`);
  return imageUrn;
}

async function publishLinkedIn(input: PubInput): Promise<PubResult> {
  const token = input.credentials.accessToken;
  const author = linkedinAuthorUrn(input.credentials.accountPlatform, input.credentials.accountId);

  if (input.media.some((m) => m.kind === "video")) {
    // Vidéo LinkedIn : itération suivante (upload vidéo multipart + finalize).
    return { state: "failed", error: "linkedin_video_not_yet" };
  }

  let content: any;
  const images = input.media.filter((m) => m.kind === "image");
  if (images.length === 1) {
    content = { media: { id: await liUploadImage(token, author, images[0].url) } };
  } else if (images.length > 1) {
    const urns: string[] = [];
    for (const m of images) urns.push(await liUploadImage(token, author, m.url));
    content = { multiImage: { images: urns.map((id) => ({ id })) } };
  }

  const body: any = {
    author,
    commentary: input.caption || "",
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (content) body.content = content;

  const res = await fetch(`${LI_API}/posts`, { method: "POST", headers: liHeaders(token), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`li_post_${res.status}: ${(await res.text()).slice(0, 150)}`);
  return { state: "posted", platformPostId: res.headers.get("x-restli-id") || "posted" };
}

// ─────────────────────────── Dispatcher ───────────────────────────

/** Publie un post selon le réseau + format. */
export async function publishPost(input: PubInput): Promise<PubResult> {
  try {
    if (input.platform === "instagram") return await publishInstagram(input);
    if (input.platform === "linkedin") return await publishLinkedIn(input);

    // FB / Twitter : ancien chemin (image/texte) en attendant l'upgrade format-aware.
    const legacy = { platform: input.platform, content: input.caption, imageUrl: input.media[0]?.url } as any;
    let platformPostId: string;
    if (input.platform === "twitter") platformPostId = await socialMediaService.postToTwitter(input.credentials as any, legacy);
    else platformPostId = await socialMediaService.postToFacebook(input.credentials as any, legacy);
    return { state: "posted", platformPostId };
  } catch (e: any) {
    return { state: "failed", error: e?.message || String(e) };
  }
}
