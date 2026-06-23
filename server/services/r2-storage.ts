/**
 * Stockage des médias sur Cloudflare R2 (S3-compatible) — remplace l'ancien objectStorage
 * couplé au sidecar Replit (qui ne marche pas sur Railway).
 *
 * Flux : le client demande une URL présignée (PUT) → upload DIRECT navigateur/mobile → R2
 * (supporte les gros fichiers vidéo) → le média est servi via l'URL publique R2.
 *
 * Env requis : R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL.
 */
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const BUCKET = process.env.R2_BUCKET || "naya-media";
const PUBLIC_BASE = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");

const client =
  ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY
    ? new S3Client({
        region: "auto",
        endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
        forcePathStyle: true,
      })
    : null;

/** Vrai si R2 est configuré (clés + URL publique). */
export function r2Configured(): boolean {
  return !!client && !!PUBLIC_BASE;
}

/** URL publique de lecture d'un objet (sert le média en prod). */
export function publicUrl(key: string): string {
  return `${PUBLIC_BASE}/${key.replace(/^\/+/, "")}`;
}

/** Extension de fichier nettoyée (sans le point). */
function safeExt(filename: string): string {
  const ext = (filename.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext.slice(0, 8);
}

/**
 * Génère une URL présignée pour l'upload direct (PUT) + l'URL publique finale.
 * `kind` ('image' | 'video' | 'other') ne sert qu'au rangement.
 */
export async function createUploadUrl(opts: {
  userId: string;
  filename: string;
  contentType: string;
}): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
  if (!client) throw new Error("r2_not_configured");
  const ext = safeExt(opts.filename);
  const kind = opts.contentType.startsWith("video/")
    ? "videos"
    : opts.contentType.startsWith("image/")
      ? "images"
      : "files";
  const key = `uploads/${opts.userId}/${kind}/${randomUUID()}${ext ? "." + ext : ""}`;
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: opts.contentType }),
    { expiresIn: 3600 }, // 1h — laisse le temps d'uploader une grosse vidéo
  );
  return { uploadUrl, publicUrl: publicUrl(key), key };
}

/** Déduit la clé R2 d'une URL publique (pour suppression). */
export function keyFromPublicUrl(url: string): string | null {
  if (!PUBLIC_BASE || !url.startsWith(PUBLIC_BASE)) return null;
  return url.slice(PUBLIC_BASE.length).replace(/^\/+/, "");
}

/** Supprime un objet du bucket. */
export async function deleteObject(key: string): Promise<void> {
  if (!client) return;
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
