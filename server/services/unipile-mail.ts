/**
 * Client Unipile — email (Gmail de l'utilisateur), réponses dans un chat LinkedIn, webhooks.
 * Même convention que linkedin.ts : jamais d'exception sur erreur HTTP/réseau, on renvoie
 * `{ ok:false, error }`. On ne journalise JAMAIS le sujet ni le corps des messages.
 *
 * Champs vérifiés sur la doc Unipile :
 *  - POST /api/v1/emails : https://developer.unipile.com/reference/mailscontroller_sendmail.md
 *  - POST /api/v1/chats/{id}/messages : .../chatscontroller_sendmessageinchat.md
 *  - POST|GET /api/v1/webhooks : .../webhookscontroller_createwebhook.md / _listwebhooks.md
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
  if (o.trackingLabel) payload.tracking_options = { opens: true, links: true, label: o.trackingLabel };
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

export async function ensureWebhooks(baseUrl: string, secret: string): Promise<void> {
  if (!linkedinConfigured()) return;
  const requestUrl = baseUrl.replace(/\/+$/, "") + "/api/unipile/webhook";
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
    for (const { source, event } of WEBHOOK_SOURCES) {
      const name = `naya-${source}`;
      const exists = items.some((w) =>
        w?.request_url === requestUrl && (w?.name === name || (Array.isArray(w?.events) && w.events.includes(event))));
      if (exists) continue;
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
    }
  } catch (e: any) {
    console.warn(`[unipile] ensureWebhooks : ${String(e?.message || e).slice(0, 120)}`);
  }
}
