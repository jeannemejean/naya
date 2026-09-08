/**
 * Envoi automatique de messages LinkedIn via Unipile.
 *
 * SÉCURITÉ / ToS LinkedIn :
 *  - L'envoi reste INERTE tant que `PROSPECTION_SENDING_ENABLED=true` (même kill-switch que l'email).
 *  - LinkedIn n'a pas d'API officielle d'envoi de DM : on passe par Unipile, qui agit via le
 *    compte LinkedIn PROPRE à chaque utilisateur (connecté côté Unipile). On n'envoie jamais
 *    depuis un autre compte que celui de l'utilisateur (`userPreferences.linkedinUnipileAccountId`).
 *  - Les plafonds, la montée en charge, la fenêtre ouvrée, le délai minimum entre actions et
 *    la pause automatique sur restriction vivent dans `prospection-linkedin-guard.ts`
 *    (`decideLinkedInAction`, appelée par `prospection-sender.ts`) — PAS ici. Cette ancienne
 *    variable `LINKEDIN_DAILY_CAP` a été retirée : un plafond quotidien plat, unique, ne
 *    protège ni un compte neuf (montée en charge) ni un compte mature sur la durée (plafond
 *    hebdomadaire glissant).
 *
 * Config requise (env) : UNIPILE_API_KEY + UNIPILE_DSN (ex: https://api49.unipile.com:17967).
 */

const DSN = (process.env.UNIPILE_DSN || "").replace(/\/+$/, "");
const API_KEY = process.env.UNIPILE_API_KEY || "";

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

export interface ProviderIdResolution {
  providerId: string | null;
  /**
   * Code HTTP renvoyé par Unipile quand la résolution échoue à cause d'une réponse en
   * erreur (401/403/5xx…) — `null` si la requête a réussi (200), que le profil soit
   * résolu ou non. Distinction volontaire : une réponse 200 sans `provider_id` est un
   * profil introuvable (rien d'anormal), une réponse 401/403 est potentiellement un
   * signal de restriction du compte LinkedIn — voir la revue post-commit 261835e,
   * défaut Critique 3. `sendLinkedInStep` s'appuie sur cette distinction pour composer
   * `resolve_401`/`resolve_403` (classés par `isLinkedInRestrictionSignal`) au lieu du
   * générique `profile_not_resolved` qui les rendait indiscernables d'un profil absent.
   */
  httpStatus: number | null;
}

/**
 * Résout le `provider_id` (identifiant interne LinkedIn utilisé par Unipile) d'un prospect
 * à partir de son identifiant public, vu depuis le compte de l'utilisateur. Ne JETTE
 * jamais le code HTTP en cas d'échec (cf. `ProviderIdResolution`) : c'est le PREMIER appel
 * du parcours d'envoi, donc celui qui reçoit en premier un 401/403 quand LinkedIn
 * restreint le compte.
 */
export async function resolveProviderId(accountId: string, publicId: string): Promise<ProviderIdResolution> {
  const res = await fetch(
    `${DSN}/api/v1/users/${encodeURIComponent(publicId)}?account_id=${encodeURIComponent(accountId)}`,
    { headers: headers() },
  );
  if (!res.ok) return { providerId: null, httpStatus: res.status };
  const data: any = await res.json().catch(() => ({}));
  return { providerId: data?.provider_id || data?.id || null, httpStatus: null };
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
    const resolution = await resolveProviderId(accountId, publicId).catch(() => null);
    const providerId = resolution?.providerId;
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
 *
 * ⚠️ COÛT RÉEL EN REQUÊTES : jusqu'à TROIS appels côté LinkedIn par action autorisée par
 * la garde (`resolveProviderId` + `/chats` + `/invite` si le message échoue faute de
 * relation). Le "5 actions/jour" d'un compte neuf (`LINKEDIN_RAMP_UP_START_CAP`) vaut
 * donc jusqu'à 15 requêtes LinkedIn vues côté plateforme, pas 5. Position retenue :
 * PAS d'ajustement des plafonds pour ce facteur ×3, pour deux raisons — (1)
 * `resolveProviderId` est une simple consultation de profil (GET), un comportement
 * organique extrêmement courant (un humain consulte largement plus de profils qu'il
 * n'envoie de messages), donc la compter au même niveau qu'un message/une invitation
 * (les actions d'ÉCRITURE, les seules qui engagent réellement le compte) est déjà une
 * convention prudente, pas laxiste ; (2) même multiplié par 3, le haut de la courbe
 * (15 actions/jour mature → 45 requêtes/jour) reste très en dessous d'un usage humain
 * normal. À REVISITER si un signal de restriction survient malgré tout : resserrer
 * d'abord les plafonds de `prospection-linkedin-guard.ts`, pas ce commentaire.
 */
export async function sendLinkedInStep(opts: {
  accountId: string;
  linkedinUrl: string;
  text: string;
}): Promise<LinkedInSendResult> {
  if (!linkedinConfigured()) return { ok: false, action: "none", error: "unipile_not_configured" };
  const publicId = publicIdFromUrl(opts.linkedinUrl);
  if (!publicId) return { ok: false, action: "none", error: "no_public_id" };

  const resolution = await resolveProviderId(opts.accountId, publicId);
  if (!resolution.providerId) {
    // 200 OK sans provider_id → profil introuvable (rien d'anormal). 401/403/5xx → on le
    // dit EXPLICITEMENT (`resolve_<status>`) plutôt que le générique `profile_not_resolved`,
    // pour que `isLinkedInRestrictionSignal` puisse voir un 401/403 qui arrive ICI — c'est
    // le premier appel du parcours, donc le premier à recevoir la restriction de LinkedIn.
    const error = resolution.httpStatus != null ? `resolve_${resolution.httpStatus}` : "profile_not_resolved";
    return { ok: false, action: "none", error };
  }
  const providerId = resolution.providerId;

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
