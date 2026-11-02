/**
 * Désinscription par lien Naya (emails envoyés depuis le Gmail de l'utilisateur, où
 * SendGrid ne fournit pas son lien). Jeton = `{leadId}.{HMAC-SHA256}` : ni base de données
 * ni expiration (un lien de désinscription doit marcher des mois après l'envoi).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string | null {
  return process.env.UNSUBSCRIBE_SECRET || process.env.SESSION_SECRET || null;
}

function signature(leadId: number, cle: string): string {
  return createHmac("sha256", cle).update(`desinscription:${leadId}`).digest("base64url");
}

/** Lève si aucun secret n'est configuré : jamais de jeton signé avec une clé vide. */
export function jetonDesinscription(leadId: number): string {
  const cle = secret();
  if (!cle) throw new Error("UNSUBSCRIBE_SECRET / SESSION_SECRET absent");
  return `${leadId}.${signature(leadId, cle)}`;
}

/** Lead du jeton, ou null si le jeton est mal formé ou falsifié. Comparaison à temps constant. */
export function leadDuJeton(jeton: string): number | null {
  const cle = secret();
  if (!cle || typeof jeton !== "string") return null;
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]+)$/.exec(jeton);
  if (!m) return null;
  const leadId = Number(m[1]);
  const attendu = Buffer.from(signature(leadId, cle));
  const recu = Buffer.from(m[2]);
  if (attendu.length !== recu.length || !timingSafeEqual(attendu, recu)) return null;
  return leadId;
}

/**
 * Lien public de désinscription. `null` si APP_URL ou le secret manque : l'appelant ne doit
 * alors PAS envoyer (jamais d'email sans lien de désinscription, jamais de lien relatif
 * inutilisable dans la boîte d'un destinataire).
 */
export function lienDesinscription(leadId: number): string | null {
  const base = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (!base) return null;
  try {
    return `${base}/desinscription/${jetonDesinscription(leadId)}`;
  } catch {
    return null;
  }
}
