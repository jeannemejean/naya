/**
 * Envoi automatique de messages LinkedIn via Unipile.
 *
 * SÉCURITÉ / ToS LinkedIn :
 *  - L'envoi reste INERTE tant que `PROSPECTION_SENDING_ENABLED=true` (même kill-switch que l'email).
 *  - LinkedIn n'a pas d'API officielle d'envoi de DM : on passe par Unipile, qui agit via le
 *    compte LinkedIn PROPRE à chaque utilisateur (connecté côté Unipile). On n'envoie jamais
 *    depuis un autre compte que celui de l'utilisateur (`userPreferences.linkedinUnipileAccountId`).
 *  - Plafond quotidien BAS (LINKEDIN_DAILY_CAP, défaut 25) pour respecter les limites LinkedIn
 *    et éviter toute restriction du compte.
 *
 * Config requise (env) : UNIPILE_API_KEY + UNIPILE_DSN (ex: https://api49.unipile.com:17967).
 */

const DSN = (process.env.UNIPILE_DSN || "").replace(/\/+$/, "");
const API_KEY = process.env.UNIPILE_API_KEY || "";

export const LINKEDIN_DAILY_CAP = Number(process.env.LINKEDIN_DAILY_CAP) || 25;

/** Vrai si Unipile est configuré au niveau de l'app (clé + DSN). */
export function linkedinConfigured(): boolean {
  return !!API_KEY && !!DSN;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { "X-API-KEY": API_KEY, accept: "application/json", ...extra };
}

/**
 * Extrait l'identifiant public LinkedIn d'une URL de profil.
 * "https://www.linkedin.com/in/solene-jaboulet-7799b9/" → "solene-jaboulet-7799b9"
 * Pure & testable.
 */
export function publicIdFromUrl(linkedinUrl: string | null | undefined): string | null {
  if (!linkedinUrl) return null;
  const m = linkedinUrl.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Génère un lien d'authentification hébergé Unipile pour que l'utilisateur connecte SON
 * compte LinkedIn. Le compte créé est tagué `name = userId` → on le retrouve ensuite via sync.
 */
export async function generateConnectLink(userId: string): Promise<string | null> {
  if (!linkedinConfigured()) return null;
  const expiresOn = new Date(Date.now() + 7 * 86400000).toISOString();
  const res = await fetch(`${DSN}/api/v1/hosted/accounts/link`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ type: "create", providers: ["LINKEDIN"], api_url: DSN, expiresOn, name: userId }),
  });
  if (!res.ok) return null;
  const data: any = await res.json().catch(() => ({}));
  return data?.url || null;
}

/** Liste les comptes connectés côté Unipile (admin / mapping). */
export async function listUnipileAccounts(): Promise<Array<{ id: string; type?: string; name?: string }>> {
  if (!linkedinConfigured()) return [];
  const res = await fetch(`${DSN}/api/v1/accounts`, { headers: headers() });
  if (!res.ok) return [];
  const data: any = await res.json().catch(() => ({}));
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  return items.map((a: any) => ({ id: a.id, type: a.type || a.provider, name: a.name }));
}

/**
 * Résout le `provider_id` (identifiant interne LinkedIn utilisé par Unipile) d'un prospect
 * à partir de son identifiant public, vu depuis le compte de l'utilisateur.
 */
export async function resolveProviderId(accountId: string, publicId: string): Promise<string | null> {
  const res = await fetch(
    `${DSN}/api/v1/users/${encodeURIComponent(publicId)}?account_id=${encodeURIComponent(accountId)}`,
    { headers: headers() },
  );
  if (!res.ok) return null;
  const data: any = await res.json().catch(() => ({}));
  return data?.provider_id || data?.id || null;
}

/**
 * Interprète la réponse Unipile `GET /api/v1/users/:id` pour déterminer si le profil est
 * désormais une relation de 1er degré (invitation de connexion acceptée).
 * Pure & testable : isole le champ incertain du reste du fetch réseau.
 * ⚠️ Champ à confirmer sur la doc/API Unipile réelle : on accepte `network_distance ===
 * "FIRST_DEGREE"` (nom de champ documenté à date) OU `is_relationship === true` (variante
 * observée sur certaines réponses) ; sur une forme inconnue on renvoie `false` (fail closed).
 */
export function interpretConnectionResponse(data: any): boolean {
  return data?.network_distance === "FIRST_DEGREE" || data?.is_relationship === true;
}

/**
 * Vrai si le profil (résolu depuis `linkedinUrl`) est désormais une relation 1er degré du
 * compte Unipile `accountId`, càd que l'invitation de connexion a été acceptée.
 * Ne lève jamais : toute erreur réseau/API ou forme de réponse inconnue → `false` (fail closed),
 * pour ne jamais faire avancer une branche `if_invite_accepted` sur un faux positif.
 */
export async function isConnected(accountId: string, linkedinUrl: string): Promise<boolean> {
  try {
    const publicId = publicIdFromUrl(linkedinUrl);
    if (!publicId) return false;
    const providerId = await resolveProviderId(accountId, publicId).catch(() => null);
    if (!providerId) return false;
    const res = await fetch(
      `${DSN}/api/v1/users/${encodeURIComponent(providerId)}?account_id=${encodeURIComponent(accountId)}`,
      { headers: headers() },
    );
    if (!res.ok) return false;
    const data: any = await res.json().catch(() => ({}));
    return interpretConnectionResponse(data);
  } catch {
    return false;
  }
}

export interface LinkedInSendResult {
  ok: boolean;
  action: "message" | "invitation" | "none";
  error?: string;
}

/**
 * Envoie une étape LinkedIn au prospect via le compte de l'utilisateur.
 *
 * Stratégie : on tente d'abord un message (si déjà en relation). Si LinkedIn refuse parce que
 * les deux comptes ne sont pas connectés, on envoie une invitation (demande de connexion) avec
 * le texte en note (tronqué à 300 caractères, limite LinkedIn).
 */
export async function sendLinkedInStep(opts: {
  accountId: string;
  linkedinUrl: string;
  text: string;
}): Promise<LinkedInSendResult> {
  if (!linkedinConfigured()) return { ok: false, action: "none", error: "unipile_not_configured" };
  const publicId = publicIdFromUrl(opts.linkedinUrl);
  if (!publicId) return { ok: false, action: "none", error: "no_public_id" };

  const providerId = await resolveProviderId(opts.accountId, publicId);
  if (!providerId) return { ok: false, action: "none", error: "profile_not_resolved" };

  // 1) Tentative de message direct (relation existante).
  const chatForm = new FormData();
  chatForm.append("account_id", opts.accountId);
  chatForm.append("attendees_ids", providerId);
  chatForm.append("text", opts.text);
  const chatRes = await fetch(`${DSN}/api/v1/chats`, { method: "POST", headers: headers(), body: chatForm });
  if (chatRes.ok) return { ok: true, action: "message" };

  // 2) Pas en relation → invitation avec note.
  const note = opts.text.slice(0, 300);
  const inviteRes = await fetch(`${DSN}/api/v1/users/invite`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ account_id: opts.accountId, provider_id: providerId, message: note }),
  });
  if (inviteRes.ok) return { ok: true, action: "invitation" };

  const err = await inviteRes.text().catch(() => "");
  return { ok: false, action: "none", error: `chat_${chatRes.status}/invite_${inviteRes.status} ${err}`.slice(0, 200) };
}
