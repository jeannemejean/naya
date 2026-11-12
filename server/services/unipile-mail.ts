/**
 * Client Unipile — email (Gmail de l'utilisateur), réponses dans un chat LinkedIn, webhooks.
 * Même convention que linkedin.ts : jamais d'exception sur erreur HTTP/réseau, on renvoie
 * `{ ok:false, error }`. On ne journalise JAMAIS le sujet ni le corps des messages.
 *
 * Champs vérifiés sur la doc Unipile :
 *  - POST /api/v1/emails : https://developer.unipile.com/reference/mailscontroller_sendmail.md
 *  - POST /api/v1/chats/{id}/messages : .../chatscontroller_sendmessageinchat.md
 *  - POST|GET /api/v1/webhooks : .../webhookscontroller_createwebhook.md / _listwebhooks.md
 *  - GET /api/v1/emails (lecture) : https://developer.unipile.com/reference/mailscontroller_listmails.md
 */
import { unipileDsn, unipileHeaders, linkedinConfigured } from "./linkedin";

export interface EmailSendResult { ok: boolean; providerId?: string; threadId?: string; error?: string }

/** "Re: " sauf si le sujet commence déjà par Re: / RE: / Re :. */
export function subjectReponse(sujet: string): string {
  return /^\s*re\s*:/i.test(sujet) ? sujet : `Re: ${sujet}`;
}

async function errText(res: Response): Promise<string> {
  const t = await res.text().catch(() => "");
  return `http_${res.status} ${t}`.slice(0, 200);
}

export async function sendEmailUnipile(o: {
  accountId: string; to: string; toName: string; subject: string; body: string;
  replyToProviderId?: string; trackingLabel?: string; headers?: Record<string, string>;
}): Promise<EmailSendResult> {
  if (!linkedinConfigured()) return { ok: false, error: "unipile_not_configured" };
  // Doc : la requête peut être envoyée en application/json (tracking_options objet imbriqué).
  const payload: Record<string, unknown> = {
    account_id: o.accountId,
    to: [{ identifier: o.to, display_name: o.toName }],
    subject: o.subject,
    body: o.body,
  };
  if (o.replyToProviderId) payload.reply_to = o.replyToProviderId;
  // Liens non réécrits : le suivi les ferait passer par un domaine tiers (lnk-fllw.com), lien de
  // désinscription compris, ce qui nuit à la délivrabilité et à la confiance du destinataire.
  if (o.trackingLabel) payload.tracking_options = { opens: true, links: false, label: o.trackingLabel };
  if (o.headers && Object.keys(o.headers).length) {
    payload.custom_headers = Object.entries(o.headers).map(([name, value]) => ({ name, value }));
  }
  try {
    const res = await fetch(`${unipileDsn}/api/v1/emails`, {
      method: "POST",
      headers: unipileHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, error: await errText(res) };
    const data: any = await res.json().catch(() => ({}));
    // à confirmer : la réponse documentée ne contient pas de thread id ; on tolère thread_id s'il existe.
    return { ok: true, providerId: data?.provider_id || undefined, threadId: data?.thread_id || undefined };
  } catch (e: any) {
    return { ok: false, error: `network ${String(e?.message || e)}`.slice(0, 200) };
  }
}

// ─── Lecture des mails reçus (fil conducteur, « mails qui attendent une réponse ») ──────
//
// GET /api/v1/emails, lu dans la doc le 12 nov. 2026 (forme figée dans
// server/services/fil/__fixtures__/unipile-emails.json) :
//  - `account_id` (requis) ; `after` / `before` en ISO 8601 UTC, bornes EXCLUSIVES ; `limit` de 1 à
//    250 ; `cursor` pour la page suivante ; `include_headers=true` (exige `meta_only` à faux, donc
//    des mails complets : le corps arrive, on ne le garde pas) ;
//  - réponse `{ object: "EmailList", items, cursor }` ; un mail porte `id`, `thread_id`, `date`,
//    `role` (inbox | sent | drafts | trash | spam | …), `folders`, `from_attendee` et
//    `to_attendees` / `cc_attendees` (`{ display_name, identifier, identifier_type }`), `subject`,
//    `in_reply_to`, `message_id` et, mail complet seulement, `headers: [{ name, value }]`.
// Rien n'est journalisé du sujet, du corps ni des adresses.

export interface EmailUnipile {
  id: string;
  threadId: string | null;
  date: string;
  role: string | null;
  folders: string[];
  from: { email: string; nom: string | null } | null;
  to: string[];
  sujet: string;
  /** En-têtes en minuscules ; null quand Unipile ne les a pas renvoyés (mail « meta » ou « ref »). */
  headers: Record<string, string> | null;
}

export const EMAILS_PAR_PAGE = 100;
export const EMAILS_PAGES_MAX = 30;

const chaine = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const adresseDe = (a: any): string | null => {
  const id = chaine(a?.identifier);
  return id && id.includes("@") ? id.toLowerCase() : null;
};

/** Un élément de la liste Unipile → EmailUnipile (sans corps), ou null s'il est illisible. */
export function versEmailUnipile(item: any): EmailUnipile | null {
  const id = chaine(item?.id) ?? chaine(item?.provider_id);
  const date = chaine(item?.date);
  if (!id || !date || Number.isNaN(Date.parse(date))) return null;
  const email = adresseDe(item?.from_attendee);
  let headers: Record<string, string> | null = null;
  if (Array.isArray(item?.headers)) {
    headers = {};
    for (const h of item.headers) {
      const k = chaine(h?.name ?? h?.key);
      if (k) headers[k.toLowerCase()] = String(h?.value ?? "");
    }
  }
  const destinataires = [
    ...(Array.isArray(item?.to_attendees) ? item.to_attendees : []),
    ...(Array.isArray(item?.cc_attendees) ? item.cc_attendees : []),
  ].map(adresseDe).filter((x): x is string => !!x);
  return {
    id,
    threadId: chaine(item?.thread_id),
    date,
    role: chaine(item?.role)?.toLowerCase() ?? null,
    folders: Array.isArray(item?.folders) ? item.folders.map(String) : [],
    from: email ? { email, nom: chaine(item?.from_attendee?.display_name) } : null,
    to: destinataires,
    sujet: typeof item?.subject === "string" ? item.subject : "",
    headers,
  };
}

/**
 * Les mails du compte depuis `depuis` (tous dossiers), page après page (au plus
 * EMAILS_PAGES_MAX pages de EMAILS_PAR_PAGE). Contrairement aux envois, une erreur HTTP ou
 * réseau LÈVE : l'appelant (le passage du matin) la consigne, et on ne conclut jamais « aucun
 * mail en attente » d'une boîte qu'on n'a pas pu lire.
 */
export async function listerEmailsRecus(accountId: string, depuis: Date): Promise<EmailUnipile[]> {
  if (!linkedinConfigured()) throw new Error("unipile_not_configured");
  const mails: EmailUnipile[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < EMAILS_PAGES_MAX; page++) {
    const q = new URLSearchParams({
      account_id: accountId,
      after: depuis.toISOString(),
      limit: String(EMAILS_PAR_PAGE),
      include_headers: "true",
    });
    if (cursor) q.set("cursor", cursor);
    let res: Response;
    try {
      res = await fetch(`${unipileDsn}/api/v1/emails?${q}`, { headers: unipileHeaders() });
    } catch (e: any) {
      throw new Error(`network ${String(e?.message || e)}`.slice(0, 200));
    }
    if (!res.ok) throw new Error(`liste des mails : http_${res.status}`);
    const data: any = await res.json().catch(() => ({}));
    for (const item of Array.isArray(data?.items) ? data.items : []) {
      const m = versEmailUnipile(item);
      if (m) mails.push(m);
    }
    cursor = chaine(data?.cursor);
    if (!cursor) break;
  }
  return mails;
}

export async function sendLinkedInChatMessage(o: {
  accountId: string; chatId: string; text: string;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  if (!linkedinConfigured()) return { ok: false, error: "unipile_not_configured" };
  // Doc : multipart/form-data.
  const form = new FormData();
  form.append("account_id", o.accountId);
  form.append("text", o.text);
  try {
    const res = await fetch(`${unipileDsn}/api/v1/chats/${encodeURIComponent(o.chatId)}/messages`, {
      method: "POST", headers: unipileHeaders(), body: form,
    });
    if (!res.ok) return { ok: false, error: await errText(res) };
    const data: any = await res.json().catch(() => ({}));
    return { ok: true, messageId: data?.message_id || undefined };
  } catch (e: any) {
    return { ok: false, error: `network ${String(e?.message || e)}`.slice(0, 200) };
  }
}

/** source Unipile -> événement par défaut qui l'identifie (la liste ne renvoie pas `source`). */
const WEBHOOK_SOURCES: Array<{ source: string; event: string }> = [
  { source: "messaging", event: "message_received" },
  { source: "email", event: "mail_received" },
  { source: "email_tracking", event: "mail_opened" },
  { source: "users", event: "new_relation" },
  { source: "account_status", event: "error" },
];

/** Valeur de l'en-tête Unipile-Auth d'un webhook listé ; undefined si la liste ne donne pas ses en-têtes. */
function enTeteAuth(w: any): string | null | undefined {
  const h = w?.headers;
  if (Array.isArray(h)) {
    const x = h.find((e: any) => String(e?.key ?? e?.name ?? "").toLowerCase() === "unipile-auth");
    return x ? String(x.value ?? "") : null;
  }
  if (h && typeof h === "object") {
    const k = Object.keys(h).find((c) => c.toLowerCase() === "unipile-auth");
    return k ? String(h[k] ?? "") : null;
  }
  return undefined;
}

export async function ensureWebhooks(baseUrl: string, secret: string): Promise<void> {
  if (!linkedinConfigured()) return;
  // Le secret voyage en en-tête : jamais vers une adresse en clair (M5).
  if (!/^https:\/\//i.test(baseUrl.trim())) {
    console.warn("[unipile] APP_URL n'est pas en https:// : webhooks non créés (les réponses des prospects ne seront pas reçues)");
    return;
  }
  const requestUrl = baseUrl.trim().replace(/\/+$/, "") + "/api/unipile/webhook";
  const creer = async (source: string, name: string) => {
    const res = await fetch(`${unipileDsn}/api/v1/webhooks`, {
      method: "POST",
      headers: unipileHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        request_url: requestUrl,
        source,
        name,
        format: "json",
        enabled: true,
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "Unipile-Auth", value: secret },
        ],
      }),
    });
    if (!res.ok) console.warn(`[unipile] création du webhook ${source} échouée (http_${res.status})`);
  };
  try {
    const items: any[] = [];
    let cursor: string | null | undefined;
    for (let page = 0; page < 10; page++) {
      const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const res = await fetch(`${unipileDsn}/api/v1/webhooks${q}`, { headers: unipileHeaders() });
      if (!res.ok) {
        // Liste illisible : on ne crée rien (risque de doublons).
        console.warn(`[unipile] liste des webhooks impossible (http_${res.status})`);
        return;
      }
      const data: any = await res.json().catch(() => ({}));
      if (Array.isArray(data?.items)) items.push(...data.items);
      cursor = data?.cursor;
      if (!cursor) break;
    }
    let secretInverifiable = false;
    for (const { source, event } of WEBHOOK_SOURCES) {
      const name = `naya-${source}`;
      const existant = items.find((w) =>
        w?.request_url === requestUrl && (w?.name === name || (Array.isArray(w?.events) && w.events.includes(event))));
      if (existant) {
        const auth = enTeteAuth(existant);
        if (auth === undefined) { secretInverifiable = true; continue; }
        if (auth === secret) continue;
        // Secret tourné : l'ancien webhook serait refusé (401) à chaque livraison → recréé.
        const id = String(existant.id ?? existant.webhook_id ?? "");
        if (!id) { secretInverifiable = true; continue; }
        const del = await fetch(`${unipileDsn}/api/v1/webhooks/${encodeURIComponent(id)}`, { method: "DELETE", headers: unipileHeaders() });
        if (!del.ok) {
          console.warn(`[unipile] webhook ${source} : secret périmé, suppression échouée (http_${del.status}) — à supprimer dans le tableau de bord Unipile`);
          continue;
        }
        console.warn(`[unipile] webhook ${source} : secret périmé, recréé`);
      }
      await creer(source, name);
    }
    if (secretInverifiable) {
      console.warn("[unipile] webhooks existants gardés sans pouvoir vérifier leur secret : si UNIPILE_WEBHOOK_SECRET a changé, supprimer les webhooks naya-* dans le tableau de bord Unipile (ils seront recréés au démarrage)");
    }
  } catch (e: any) {
    console.warn(`[unipile] ensureWebhooks : ${String(e?.message || e).slice(0, 120)}`);
  }
}
