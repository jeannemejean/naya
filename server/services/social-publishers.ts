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
import { PDFDocument } from "pdf-lib";
import { socialMediaService } from "./social-integrations";
import { TITRE_DOCUMENT_MAX, type OptionsPost } from "@shared/options-post";

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
  /** Couverture d'une vidéo (Reel Instagram) : image, ou instant de la vidéo en ms. */
  couverture?: { url?: string | null; offsetMs?: number | null };
  /** Options du post (alt, collaborateurs, Reel, document LinkedIn) et titre du post. */
  options?: OptionsPub;
}
export type OptionsPub = Partial<OptionsPost> & { titre?: string | null };
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
  couverture?: PubInput["couverture"],
  options?: OptionsPub,
): Record<string, any> {
  const params: Record<string, any> = {};
  const type = igMediaType(format, item.kind);
  if (item.kind === "video") {
    params.video_url = item.url;
    // Élément de carrousel : VIDEO (doc Instagram) ; sinon REELS / STORIES.
    if (asChild) params.media_type = "VIDEO";
    else if (type !== "IMAGE") params.media_type = type;
    // Couverture d'un Reel : une image (cover_url) prime sur l'instant choisi (thumb_offset, ms).
    if (type === "REELS" && !asChild) {
      if (couverture?.url) params.cover_url = couverture.url;
      else if (couverture?.offsetMs != null && couverture.offsetMs >= 0) params.thumb_offset = Math.round(couverture.offsetMs);
    }
  } else {
    params.image_url = item.url;
    if (format === "story") params.media_type = "STORIES";
  }
  if (asChild) params.is_carousel_item = true;
  else if (caption && format !== "story") params.caption = caption;

  // Options (doc Instagram) : jamais en story.
  if (format === "story" || type === "STORIES") return params;
  const alt = options?.texteAlternatif?.trim();
  if (alt && item.kind === "image") params.alt_text = alt; // image du fil ou image de carrousel
  if (asChild) return params; // collaborateurs : sur le conteneur carrousel ; Reel : pas d'enfant
  const collab = collaborateursDe(options);
  if (collab) params.collaborators = collab;
  if (type === "REELS") {
    if (options?.reelDansLeFil != null) params.share_to_feed = options.reelDansLeFil;
    const audio = options?.nomAudio?.trim();
    if (audio) params.audio_name = audio;
  }
  return params;
}

function collaborateursDe(options?: OptionsPub): string[] | null {
  const c = (options?.collaborateurs ?? []).filter((x) => typeof x === "string" && x.trim());
  return c.length ? c.slice(0, 3) : null;
}

/** Conteneur carrousel Instagram : enfants, légende, collaborateurs. */
export function igCarouselParams(childIds: string[], caption: string, options?: OptionsPub): Record<string, any> {
  const params: Record<string, any> = { media_type: "CAROUSEL", children: childIds.join(","), caption };
  const collab = collaborateursDe(options);
  if (collab) params.collaborators = collab;
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
      const childId = await igCreateContainer(creds, igContainerParams(format, m, caption, true, undefined, input.options));
      await igWaitReady(creds, childId); // chaque enfant doit être prêt avant le conteneur carrousel
      childIds.push(childId);
    }
    const carouselId = await igCreateContainer(creds, igCarouselParams(childIds, caption, input.options));
    const ready = await igWaitReady(creds, carouselId);
    if (ready === "ERROR") return { state: "failed", error: "carousel_container_error" };
    if (ready === "PENDING") return { state: "processing", containerId: carouselId };
    return { state: "posted", platformPostId: await igPublish(creds, carouselId) };
  }

  const item = media[0];
  if (!item) return { state: "failed", error: "no_media" };
  const containerId = await igCreateContainer(creds, igContainerParams(format, item, caption, false, input.couverture, input.options));

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

/** Genre d'image d'après ses premiers octets (pdf-lib ne lit que JPEG et PNG). */
function genreImage(b: Uint8Array): "jpg" | "png" | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  return null;
}

/** PDF d'un carrousel : une page par image, à la taille de l'image, dans l'ordre. */
export async function imagesVersPdf(images: Uint8Array[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const b of images) {
    const genre = genreImage(b);
    if (!genre) throw new Error("li_document_image_non_supportee");
    const img = genre === "jpg" ? await pdf.embedJpg(b) : await pdf.embedPng(b);
    const page = pdf.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  return pdf.save();
}

/**
 * Le serveur ne télécharge lui-même (carrousel en PDF) que les images de la médiathèque : https,
 * sur l'hôte public du stockage des envois (R2_PUBLIC_BASE_URL, celui de /api/media/upload-url).
 * Toute autre adresse (autre site, réseau interne, http) est refusée.
 */
export function estMediaDeLaMediatheque(url: string, base: string = process.env.R2_PUBLIC_BASE_URL || ""): boolean {
  try {
    const u = new URL(url);
    const hote = base ? new URL(base).host : "";
    return u.protocol === "https:" && !!hote && u.host === hote && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Carrousel LinkedIn en document : PDF → Documents API → URN document. */
async function liUploadDocument(token: string, owner: string, pdf: Uint8Array): Promise<string> {
  const init = await fetch(`${LI_API}/documents?action=initializeUpload`, {
    method: "POST",
    headers: liHeaders(token),
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  const ij: any = await init.json().catch(() => ({}));
  if (!init.ok) throw new Error(`li_doc_init_${init.status}: ${JSON.stringify(ij).slice(0, 150)}`);
  const uploadUrl = ij?.value?.uploadUrl;
  const documentUrn = ij?.value?.document;
  if (!uploadUrl || !documentUrn) throw new Error("li_doc_init_no_url");
  const up = await fetch(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: Buffer.from(pdf) });
  if (!up.ok) throw new Error(`li_doc_upload_${up.status}`);
  return documentUrn;
}

/** Titre du document : le titre du post, sinon la première ligne de la légende (≤ 200). */
function titreDocument(input: PubInput): string {
  const t = (input.options?.titre ?? "").trim() || (input.caption ?? "").split("\n")[0].trim() || "Carrousel";
  return t.slice(0, TITRE_DOCUMENT_MAX);
}

async function publishLinkedIn(input: PubInput): Promise<PubResult> {
  const token = input.credentials.accessToken;
  const author = linkedinAuthorUrn(input.credentials.accountPlatform, input.credentials.accountId);

  let content: any;
  const video = input.media.find((m) => m.kind === "video");
  const images = input.media.filter((m) => m.kind === "image");
  if (!video && images.length > 0 && input.format === "carousel" && input.options?.linkedinDocument === true) {
    const octets: Uint8Array[] = [];
    for (const m of images) {
      if (!estMediaDeLaMediatheque(m.url)) throw new Error("li_document_media_hors_mediatheque : image hors de la médiathèque de Naya");
      const r = await fetch(m.url);
      if (!r.ok) throw new Error(`li_doc_image_${r.status}`);
      octets.push(new Uint8Array(await r.arrayBuffer()));
    }
    const doc = await liUploadDocument(token, author, await imagesVersPdf(octets));
    content = { media: { id: doc, title: titreDocument(input) } };
  } else if (video) {
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

// ─────────────────────────── Audience (indicateurs du fil conducteur) ───────────────────────────

/** Compte relié dont on lit le nombre d'abonnés. Le jeton ne sort JAMAIS de cette fonction. */
export interface CompteAudience {
  platform: string; // instagram | linkedin | linkedin_page_<id>
  accountId: string;
  accessToken: string;
  expiresAt?: Date | null;
}

/** Erreur d'audience : `message` est une raison courte, montrable telle quelle (sans jeton). */
export class AudienceIndisponible extends Error {}

const DELAI_AUDIENCE_MS = 8000;

/** Raison courte d'un refus d'API, sans rien recopier de la réponse (qui peut citer la requête). */
function raisonRefus(reseau: string, status: number, code: unknown): string {
  if (status === 401 || code === 190) return `jeton ${reseau} expiré ou révoqué`;
  if (status === 403 || code === 10 || code === 200) return `l'API ${reseau} ne donne pas ce chiffre`;
  if (status === 429 || code === 4 || code === 17 || code === 32) return `${reseau} limite les lectures`;
  return `${reseau} ne répond pas (${status})`;
}

/**
 * Nombre d'abonnés d'un compte relié, quand l'API du réseau le permet.
 * - Instagram (API « Instagram Login ») : `followers_count` du compte.
 * - Page LinkedIn : `networkSizes` de l'organisation (abonnés de la page). Si l'application n'a
 *   pas le droit de le lire, LinkedIn répond 403 → indisponible.
 * - Profil LinkedIn personnel : les droits reliés (`r_basicprofile`) ne donnent pas les abonnés →
 *   indisponible, sans appel.
 * Jamais d'exception autre que `AudienceIndisponible` ; jamais le jeton dans un message.
 */
export async function lireAbonnes(compte: CompteAudience, maintenant: Date = new Date(), fetchFn: typeof fetch = fetch): Promise<number> {
  const linkedin = compte.platform === "linkedin" || compte.platform.startsWith("linkedin_page");
  const reseau = linkedin ? "LinkedIn" : compte.platform === "instagram" ? "Instagram" : compte.platform;
  if (compte.platform === "linkedin") throw new AudienceIndisponible("l'API LinkedIn ne donne pas les abonnés d'un profil");
  if (!linkedin && compte.platform !== "instagram") throw new AudienceIndisponible(`abonnés ${reseau} non lus`);
  if (!compte.accessToken) throw new AudienceIndisponible(`compte ${reseau} sans jeton`);
  if (compte.expiresAt && compte.expiresAt.getTime() <= maintenant.getTime()) throw new AudienceIndisponible(`jeton ${reseau} expiré`);

  let res: Response;
  try {
    res = linkedin
      ? await fetchFn(`${LI_API}/networkSizes/${encodeURIComponent(`urn:li:organization:${compte.accountId}`)}?edgeType=COMPANY_FOLLOWED_BY_COMPANY`,
        { headers: liHeaders(compte.accessToken, false), signal: AbortSignal.timeout(DELAI_AUDIENCE_MS) })
      // Même forme que igContainerStatus (jeton en paramètre) : l'URL n'est jamais journalisée.
      : await fetchFn(`${IG_GRAPH}/${encodeURIComponent(compte.accountId)}?fields=followers_count&access_token=${encodeURIComponent(compte.accessToken)}`,
        { signal: AbortSignal.timeout(DELAI_AUDIENCE_MS) });
  } catch {
    // Le message d'une erreur réseau peut citer l'URL : il n'est pas repris.
    throw new AudienceIndisponible(`${reseau} ne répond pas`);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new AudienceIndisponible(raisonRefus(reseau, res.status, data?.error?.code ?? data?.serviceErrorCode));
  const n = linkedin ? data?.firstDegreeSize : data?.followers_count;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) throw new AudienceIndisponible(`${reseau} ne donne pas ce chiffre`);
  return n;
}

// ─────────────────────────── Dispatcher ───────────────────────────

/** Publie un post selon le réseau + format. */
// ─────────────────────────── Premier commentaire ───────────────────────────

/**
 * Poste le premier commentaire sous un post publié. Jamais réessayé seul ni bloquant : le post
 * est parti, un commentaire raté devient une tâche (le texte à coller). Instagram demande la
 * permission instagram_business_manage_comments (reconnexion après son ajout).
 */
export async function publierPremierCommentaire(o: {
  platform: string; credentials: PubCredentials; platformPostId: string; texte: string;
}): Promise<{ ok: true } | { ok: false; erreur: string }> {
  const texte = o.texte.trim();
  if (!texte || !o.platformPostId || o.platformPostId === "posted") return { ok: false, erreur: "commentaire_impossible" };
  try {
    if (o.platform === "instagram") {
      await igPost(`${o.platformPostId}/comments`, { message: texte }, o.credentials.accessToken);
      return { ok: true };
    }
    if (o.platform === "facebook") {
      await graphPost(`${o.platformPostId}/comments`, { message: texte }, o.credentials.accessToken);
      return { ok: true };
    }
    if (o.platform === "linkedin") {
      const actor = linkedinAuthorUrn(o.credentials.accountPlatform, o.credentials.accountId);
      const res = await fetch(`${LI_API}/socialActions/${encodeURIComponent(o.platformPostId)}/comments`, {
        method: "POST", headers: liHeaders(o.credentials.accessToken),
        body: JSON.stringify({ actor, object: o.platformPostId, message: { text: texte } }),
      });
      if (!res.ok) return { ok: false, erreur: `li_comment_${res.status}: ${(await res.text()).slice(0, 150)}` };
      return { ok: true };
    }
    return { ok: false, erreur: "commentaire_non_supporte" };
  } catch (e: any) {
    return { ok: false, erreur: String(e?.message || e).slice(0, 200) };
  }
}

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
