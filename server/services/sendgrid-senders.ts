/**
 * Gestion des expéditeurs vérifiés SendGrid (Single Sender Verification).
 * Permet l'auto-vérification : quand un utilisateur saisit son adresse d'envoi,
 * on déclenche la vérification → il reçoit un email avec un lien à cliquer.
 *
 * Utilise la clé fournie (perso de l'utilisateur si présente, sinon clé partagée).
 */

export type SenderStatus = "verified" | "pending" | "none" | "unknown";

const BASE = "https://api.sendgrid.com/v3/verified_senders";

/**
 * Statut de vérification d'une adresse expéditrice.
 * 1) Si le DOMAINE de l'adresse est authentifié (Domain Authentication valide), l'adresse
 *    est utilisable sans Single Sender → 'verified'.
 * 2) Sinon on regarde les Single Senders du compte.
 */
export async function getSenderStatus(apiKey: string | undefined, email: string): Promise<SenderStatus> {
  if (!apiKey || !email) return "none";
  const domain = email.split("@")[1]?.toLowerCase();
  try {
    // 1) Domain Authentication — couvre toutes les adresses du domaine.
    if (domain) {
      const dRes = await fetch("https://api.sendgrid.com/v3/whitelabel/domains", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (dRes.ok) {
        const domains: any = await dRes.json();
        if (Array.isArray(domains) && domains.some((d) => d?.valid && (d?.domain || "").toLowerCase() === domain)) {
          return "verified";
        }
      }
    }
    // 2) Single Sender Verification.
    const res = await fetch(BASE, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return "unknown";
    const data: any = await res.json();
    const results: any[] = data?.results || [];
    const match = results.find((r) => (r.from_email || "").toLowerCase() === email.toLowerCase());
    if (!match) return "none";
    return match.verified ? "verified" : "pending";
  } catch {
    return "unknown";
  }
}

export interface CreateSenderInput {
  email: string;
  name: string;
  address: string;
  city: string;
  country: string;
}

/**
 * Crée une demande de Single Sender Verification → SendGrid envoie l'email de validation.
 * Idempotent côté appelant : ne pas appeler si déjà 'verified'/'pending'.
 */
export async function createSingleSender(
  apiKey: string | undefined,
  input: CreateSenderInput,
): Promise<{ ok: boolean; error?: string }> {
  if (!apiKey) return { ok: false, error: "no_api_key" };
  if (!input.email || !input.address || !input.city || !input.country) {
    return { ok: false, error: "missing_fields" };
  }
  try {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: input.email,
        from_email: input.email,
        from_name: input.name || input.email,
        reply_to: input.email,
        address: input.address,
        city: input.city,
        country: input.country,
      }),
    });
    if (res.ok) return { ok: true };
    const err: any = await res.json().catch(() => ({}));
    return { ok: false, error: err?.errors?.[0]?.message || `http_${res.status}` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
