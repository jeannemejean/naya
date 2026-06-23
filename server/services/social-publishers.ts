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

const GRAPH = "https://graph.facebook.com/v23.0";          // Facebook (Pages)
const IG_GRAPH = "https://graph.instagram.com/v23.0";      // Instagram (API « Instagram Login »)

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

/** POST sur graph.instagram.com (API Instagram Login). */
async function igPost(path: string, body: Record<string, any>, accessToken: string): Promise<any> {
  const res = await fetch(`${IG_GRAPH}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: accessToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ig_${res.status}: ${data?.error?.message || JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function igCreateContainer(creds: PubCredentials, params: Record<string, any>): Promise<string> {
  const d = await igPost(`${creds.accountId}/media`, params, creds.accessToken);
  return d.id;
}

async function igPublish(creds: PubCredentials, creationId: string): Promise<string> {
  const d = await igPost(`${creds.accountId}/media_publish`, { creation_id: creationId }, creds.accessToken);
  return d.id;
}

/** Statut d'un conteneur vidéo : FINISHED | IN_PROGRESS | ERROR | EXPIRED | PUBLISHED. */
export async function igContainerStatus(creds: PubCredentials, containerId: string): Promise<string> {
  const res = await fetch(`${IG_GRAPH}/${containerId}?fields=status_code&access_token=${encodeURIComponent(creds.accessToken)}`);
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

/** Attend qu'un conteneur soit prêt (FINISHED). Renvoie FINISHED | PENDING | ERROR. */
async function igWaitReady(creds: PubCredentials, containerId: string, maxTries = 8, delayMs = 1500): Promise<"FINISHED" | "PENDING" | "ERROR"> {
  for (let i = 0; i < maxTries; i++) {
    const s = await igContainerStatus(creds, containerId).catch(() => "UNKNOWN");
    if (s === "FINISHED") return "FINISHED";
    if (s === "ERROR" || s === "EXPIRED") return "ERROR";
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return "PENDING";
}

async function publishInstagram(input: PubInput): Promise<PubResult> {
  const { credentials: creds, format, media, caption } = input;

  if (format === "carousel") {
    const childIds: string[] = [];
    for (const m of media) {
      const childId = await igCreateContainer(creds, igContainerParams(format, m, caption, true));
      await igWaitReady(creds, childId); // chaque enfant doit être prêt avant le conteneur carrousel
      childIds.push(childId);
    }
    const carouselId = await igCreateContainer(creds, { media_type: "CAROUSEL", children: childIds.join(","), caption });
    const ready = await igWaitReady(creds, carouselId);
    if (ready === "ERROR") return { state: "failed", error: "carousel_container_error" };
    if (ready === "PENDING") return { state: "processing", containerId: carouselId };
    return { state: "posted", platformPostId: await igPublish(creds, carouselId) };
  }

  const item = media[0];
  if (!item) return { state: "failed", error: "no_media" };
  const containerId = await igCreateContainer(creds, igContainerParams(format, item, caption));

  if (igIsAsync(format, media)) {
    // Vidéo : traitement long → le worker poll le statut puis publie.
    return { state: "processing", containerId };
  }
  // Image : on attend que le conteneur soit prêt (évite « Media ID is not available »).
  const ready = await igWaitReady(creds, containerId);
  if (ready === "ERROR") return { state: "failed", error: "container_error" };
  if (ready === "PENDING") return { state: "processing", containerId };
  return { state: "posted", platformPostId: await igPublish(creds, containerId) };
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

/** Upload réel d'une vidéo vers LinkedIn (Videos API : init → upload parts → finalize). */
async function liUploadVideo(token: string, owner: string, mediaUrl: string): Promise<string> {
  const bytes = Buffer.from(await (await fetch(mediaUrl)).arrayBuffer());
  const init = await fetch(`${LI_API}/videos?action=initializeUpload`, {
    method: "POST",
    headers: liHeaders(token),
    body: JSON.stringify({ initializeUploadRequest: { owner, fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false } }),
  });
  const ij: any = await init.json().catch(() => ({}));
  if (!init.ok) throw new Error(`li_vid_init_${init.status}: ${JSON.stringify(ij).slice(0, 150)}`);
  const video = ij?.value?.video;
  const instructions = ij?.value?.uploadInstructions || [];
  const uploadToken = ij?.value?.uploadToken || "";
  if (!video || instructions.length === 0) throw new Error("li_vid_init_no_instructions");
  const etags: string[] = [];
  for (const ins of instructions) {
    const part = bytes.subarray(ins.firstByte, (ins.lastByte ?? bytes.length - 1) + 1);
    const up = await fetch(ins.uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: part });
    if (!up.ok) throw new Error(`li_vid_part_${up.status}`);
    etags.push(up.headers.get("etag") || "");
  }
  const fin = await fetch(`${LI_API}/videos?action=finalizeUpload`, {
    method: "POST",
    headers: liHeaders(token),
    body: JSON.stringify({ finalizeUploadRequest: { video, uploadToken, uploadedPartIds: etags } }),
  });
  if (!fin.ok) throw new Error(`li_vid_finalize_${fin.status}`);
  return video;
}

async function publishLinkedIn(input: PubInput): Promise<PubResult> {
  const token = input.credentials.accessToken;
  const author = linkedinAuthorUrn(input.credentials.accountPlatform, input.credentials.accountId);

  let content: any;
  const video = input.media.find((m) => m.kind === "video");
  const images = input.media.filter((m) => m.kind === "image");
  if (video) {
    content = { media: { id: await liUploadVideo(token, author, video.url) } };
  } else if (images.length === 1) {
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

// ─────────────────────────── Facebook (Page) ───────────────────────────

async function publishFacebook(input: PubInput): Promise<PubResult> {
  const { credentials: c, format, media, caption } = input;
  const pageId = c.accountId;
  const token = c.accessToken;

  // Texte seul
  if (media.length === 0) {
    const d = await graphPost(`${pageId}/feed`, { message: caption }, token);
    return { state: "posted", platformPostId: d.id };
  }

  // Carrousel : photos non publiées → post feed avec attached_media
  if (format === "carousel") {
    const ids: string[] = [];
    for (const m of media.filter((x) => x.kind === "image")) {
      const ph = await graphPost(`${pageId}/photos`, { url: m.url, published: false }, token);
      ids.push(ph.id);
    }
    const d = await graphPost(`${pageId}/feed`, { message: caption, attached_media: ids.map((media_fbid) => ({ media_fbid })) }, token);
    return { state: "posted", platformPostId: d.id };
  }

  const item = media[0];
  if (item.kind === "video") {
    if (format === "story" || format === "reel") return { state: "failed", error: "fb_video_story_reel_not_yet" };
    const d = await graphPost(`${pageId}/videos`, { file_url: item.url, description: caption }, token);
    return { state: "posted", platformPostId: d.id };
  }

  // Image
  if (format === "story") {
    const ph = await graphPost(`${pageId}/photos`, { url: item.url, published: false }, token);
    const d = await graphPost(`${pageId}/photo_stories`, { photo_id: ph.id }, token);
    return { state: "posted", platformPostId: d.post_id || d.id || "posted" };
  }
  const d = await graphPost(`${pageId}/photos`, { url: item.url, caption, published: true }, token);
  return { state: "posted", platformPostId: d.post_id || d.id };
}

// ─────────────────────────── TikTok (Content Posting API) ───────────────────────────

const TIKTOK_API = "https://open.tiktokapis.com/v2";
// Apps non auditées : publication en privé (SELF_ONLY) tant que l'audit TikTok n'est pas validé.
const TIKTOK_PRIVACY = process.env.TIKTOK_PRIVACY_LEVEL || "SELF_ONLY";

async function publishTikTok(input: PubInput): Promise<PubResult> {
  const token = input.credentials.accessToken;
  const item = input.media.find((m) => m.kind === "video");
  if (!item) return { state: "failed", error: "tiktok_requires_video" };

  // Upload direct du fichier (FILE_UPLOAD) → pas de vérification de domaine requise.
  const bytes = Buffer.from(await (await fetch(item.url)).arrayBuffer());
  const init = await fetch(`${TIKTOK_API}/post/publish/video/init/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      post_info: { title: (input.caption || "").slice(0, 2200), privacy_level: TIKTOK_PRIVACY, disable_comment: false, disable_duet: false, disable_stitch: false },
      source_info: { source: "FILE_UPLOAD", video_size: bytes.length, chunk_size: bytes.length, total_chunk_count: 1 },
    }),
  });
  const ij: any = await init.json().catch(() => ({}));
  if (!init.ok || ij?.error?.code !== "ok") throw new Error(`tiktok_init: ${JSON.stringify(ij?.error || ij).slice(0, 200)}`);
  const publishId = ij.data.publish_id;
  const uploadUrl = ij.data.upload_url;

  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}` },
    body: bytes,
  });
  if (!put.ok) throw new Error(`tiktok_upload_${put.status}`);

  return { state: "processing", containerId: publishId };
}

/** Worker : vérifie le statut d'une publication TikTok et conclut. */
export async function tiktokFinishAsync(creds: PubCredentials, publishId: string): Promise<PubResult> {
  const res = await fetch(`${TIKTOK_API}/post/publish/status/fetch/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ publish_id: publishId }),
  });
  const j: any = await res.json().catch(() => ({}));
  const status = j?.data?.status;
  if (status === "PUBLISH_COMPLETE") return { state: "posted", platformPostId: publishId };
  if (status === "FAILED") return { state: "failed", error: `tiktok_${j?.data?.fail_reason || "failed"}` };
  return { state: "processing", containerId: publishId };
}

// ─────────────────────────── Dispatcher ───────────────────────────

/** Publie un post selon le réseau + format. */
export async function publishPost(input: PubInput): Promise<PubResult> {
  try {
    if (input.platform === "instagram") return await publishInstagram(input);
    if (input.platform === "linkedin") return await publishLinkedIn(input);
    if (input.platform === "facebook") return await publishFacebook(input);
    if (input.platform === "tiktok") return await publishTikTok(input);

    // Twitter : ancien chemin (texte) — hors périmètre de la refonte.
    const legacy = { platform: input.platform, content: input.caption, imageUrl: input.media[0]?.url } as any;
    const platformPostId = await socialMediaService.postToTwitter(input.credentials as any, legacy);
    return { state: "posted", platformPostId };
  } catch (e: any) {
    return { state: "failed", error: e?.message || String(e) };
  }
}
