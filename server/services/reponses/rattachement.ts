/**
 * Rattacher un événement Unipile à un prospect (spec §6.5).
 *
 * Ordre : fil (fil/chat/message auquel on répond) → identifiant LinkedIn interne →
 * identifiant public LinkedIn → adresse email (minuscules, sans espaces).
 *
 * Les dépendances sont déjà liées à l'utilisatrice du compte Unipile, et portent le filtre
 * « déjà contacté par Naya ou déjà en conversation » (un lead seulement identifié ou archivé
 * ne déclenche rien, et aucun email personnel n'est stocké).
 */
import type { EvenementNormalise } from "./ingestion";

export interface DepsRattachement {
  leadParFil: (ids: string[]) => Promise<number | null>;
  leadParProviderId: (providerId: string) => Promise<number | null>;
  leadParPublicId: (publicId: string) => Promise<number | null>;
  leadContacteParEmail: (email: string) => Promise<number | null>;
}

export const normaliserEmail = (e: string) => e.replace(/\s+/g, "").toLowerCase();

export type ViaRattachement = "fil" | "providerId" | "publicId" | "email";

export async function rattacherLead(
  evt: EvenementNormalise, deps: DepsRattachement,
): Promise<{ leadId: number; via: ViaRattachement } | null> {
  const fil = [evt.threadId, evt.chatId, ...(evt.inReplyTo ?? [])].filter((x): x is string => !!x);
  if (fil.length) {
    const id = await deps.leadParFil(fil);
    if (id != null) return { leadId: id, via: "fil" };
  }
  if (evt.senderProviderId) {
    const id = await deps.leadParProviderId(evt.senderProviderId);
    if (id != null) return { leadId: id, via: "providerId" };
  }
  if (evt.senderPublicId) {
    const id = await deps.leadParPublicId(evt.senderPublicId);
    if (id != null) return { leadId: id, via: "publicId" };
  }
  if (evt.senderEmail) {
    const email = normaliserEmail(evt.senderEmail);
    if (email) {
      const id = await deps.leadContacteParEmail(email);
      if (id != null) return { leadId: id, via: "email" };
    }
  }
  return null;
}
