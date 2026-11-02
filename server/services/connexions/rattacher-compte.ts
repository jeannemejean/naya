// server/services/connexions/rattacher-compte.ts — ranger un compte Unipile (LinkedIn ou Gmail)
// chez la bonne personne, au bon périmètre (utilisatrice ou projet client).
//
// Unipile ne garde PAS le `name` passé au lien hébergé sur le compte (constaté en prod le
// 2 nov. 2026 : le compte Google s'appelle d'après son adresse). Il le renvoie seulement à
// `notify_url` quand la connexion aboutit. Le rattachement se fait donc à ce moment-là, et
// le bouton « Terminé » ne fait plus que retrouver le compte déjà rangé.
import { createHmac, timingSafeEqual } from "node:crypto";
import { storage } from "../../storage";
import { profilDejaUtilise, gmailDejaUtilise, sansDeconnexion } from "./unipile";

export type CanalUnipile = "linkedin" | "gmail";
export type CompteListe = { id: string; type?: string; name?: string; profil?: string | null; adresse?: string | null };
export type IssueRattachement =
  | { ok: true; connexion: any }
  | { ok: false; status: number; message: string };

const signer = (nom: string, canal: CanalUnipile, secret: string) =>
  createHmac("sha256", secret).update(`unipile-notification:${canal}:${nom}`).digest("base64url");

/**
 * Adresse que Unipile appelle quand la connexion aboutit, signée pour ce nom et ce canal :
 * personne ne peut s'en servir pour ranger un compte chez quelqu'un d'autre. undefined sans
 * APP_URL en https ou sans secret (le lien marche quand même, le rattachement non).
 */
export function urlNotification(nom: string, canal: CanalUnipile): string | undefined {
  const base = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  const secret = process.env.UNIPILE_WEBHOOK_SECRET;
  if (!secret || !/^https:\/\//i.test(base)) return undefined;
  const q = new URLSearchParams({ canal, sig: signer(nom, canal, secret) });
  return `${base}/api/unipile/compte-relie?${q}`;
}

export function notificationValide(nom: string, canal: string, sig: string | undefined, secret: string): canal is CanalUnipile {
  if ((canal !== "linkedin" && canal !== "gmail") || !sig) return false;
  const a = Buffer.from(signer(nom, canal, secret)), b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Inverse de `nomUnipile` : `<userId>` ou `<userId>:projet:<n>`. */
export function lireNomUnipile(nom: string): { userId: string; projectId: number | null } | null {
  const m = /^(.+?)(?::projet:(\d+))?$/.exec(nom || "");
  if (!m || !m[1]) return null;
  return { userId: m[1], projectId: m[2] ? Number(m[2]) : null };
}

/** Id du compte déjà rangé pour ce canal et ce périmètre (null s'il n'y en a pas). */
export async function compteDejaRange(userId: string, projectId: number | null, canal: CanalUnipile): Promise<string | null> {
  const c: any = projectId == null ? await storage.getUserPreferences(userId) : await storage.getConnexionProjet(userId, projectId);
  return (canal === "linkedin" ? c?.linkedinUnipileAccountId : c?.emailUnipileAccountId) ?? null;
}

/**
 * Range le compte `compte` : même règle d'unicité qu'avant (un profil LinkedIn ou un Gmail ne
 * sert qu'à un périmètre), date de connexion posée pour un compte NOUVEAU seulement (départ de
 * la montée en charge), alerte de déconnexion du canal effacée. Idempotent.
 */
export async function rattacherCompte(
  userId: string, projectId: number | null, canal: CanalUnipile, compte: CompteListe, comptes: CompteListe[],
): Promise<IssueRattachement> {
  const prefs: any = await storage.getUserPreferences(userId);
  const projets: any[] = await storage.getConnexionsProjetDe(userId);
  const autresProjets = projets.filter((x) => x.projectId !== projectId);

  if (canal === "linkedin") {
    const ailleurs = [...(projectId == null ? [] : [prefs?.linkedinUnipileAccountId]), ...autresProjets.map((x) => x.linkedinUnipileAccountId)];
    if (profilDejaUtilise(comptes, compte.id, ailleurs)) return { ok: false, status: 409, message: "linkedin_deja_utilise" };
    const avant: any = projectId == null ? prefs : await storage.getConnexionProjet(userId, projectId);
    // Compte nouveau, ou date manquante (compte relié avant ce champ) : la montée en charge
    // repart de zéro — plus lent, jamais plus risqué.
    const nouveau = avant?.linkedinUnipileAccountId !== compte.id || !avant?.linkedinAccountConnectedAt;
    const patch: any = {
      linkedinUnipileAccountId: compte.id,
      ...(nouveau ? { linkedinAccountConnectedAt: new Date() } : {}),
      comptesDeconnectes: sansDeconnexion(avant?.comptesDeconnectes, "linkedin"),
    };
    const connexion = projectId == null
      ? await storage.updateUserPreferences(userId, patch)
      : await storage.upsertConnexionProjet(userId, projectId, patch);
    return { ok: true, connexion };
  }

  const ailleurs = [...(projectId == null ? [] : [prefs?.emailUnipileAccountId]), ...autresProjets.map((x) => x.emailUnipileAccountId)];
  if (gmailDejaUtilise(comptes, compte.id, ailleurs)) return { ok: false, status: 409, message: "gmail_deja_utilise" };
  const avant: any = projectId == null ? prefs : await storage.getConnexionProjet(userId, projectId);
  const nouveau = avant?.emailUnipileAccountId !== compte.id || !avant?.emailAccountConnectedAt;
  // Adresse d'envoi : celle du compte, seulement si rien n'est déjà réglé.
  const cleExpediteur = projectId == null ? "prospectionSenderEmail" : "senderEmail";
  const patch: any = {
    emailUnipileAccountId: compte.id,
    ...(nouveau ? { emailAccountConnectedAt: new Date() } : {}),
    ...(!avant?.[cleExpediteur] && compte.adresse ? { [cleExpediteur]: compte.adresse } : {}),
    comptesDeconnectes: sansDeconnexion(avant?.comptesDeconnectes, "email"),
  };
  const connexion = projectId == null
    ? await storage.updateUserPreferences(userId, patch)
    : await storage.upsertConnexionProjet(userId, projectId, patch);
  return { ok: true, connexion };
}
