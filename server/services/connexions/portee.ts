// server/services/connexions/portee.ts — le périmètre d'une connexion (mode agence).
// Un projet CLIENT n'utilise que ses propres connexions ; un projet perso, ou rien, utilise
// celles de l'utilisatrice. Fonctions pures : la règle de sécurité tient ici, testée seule.
import { compteDuPost, type CompteSocial } from "@shared/programmation";

/** null = périmètre de l'utilisatrice ; sinon l'id du projet client. */
export type Portee = number | null;

export function porteeDe(projet: { id: number; projectKind?: string | null } | null | undefined): Portee {
  return projet && projet.projectKind === "client" ? projet.id : null;
}

export function dansPortee(compte: { projectId?: number | null }, portee: Portee): boolean {
  return (compte.projectId ?? null) === portee;
}

export type ChoixCompte<C> = { compte: C } | { erreur: "compte_hors_projet" | "compte_absent" };

/**
 * Le compte qui publiera ce post, dans le périmètre seulement. Un compte lié au post mais
 * hors périmètre (ou disparu) est refusé, jamais remplacé. Aucun compte → `compte_absent`,
 * même si l'utilisatrice en a un pour la plateforme.
 */
export function choisirCompte<C extends CompteSocial & { projectId?: number | null }>(
  comptes: C[],
  post: { platform: string; socialAccountId?: number | null },
  portee: Portee,
): ChoixCompte<C> {
  const permis = comptes.filter((c) => dansPortee(c, portee));
  const compte = compteDuPost(post, permis);
  if (compte) return { compte };
  return { erreur: post.socialAccountId != null ? "compte_hors_projet" : "compte_absent" };
}

export interface IdentiteEnvoi {
  email: { fromEmail: string; fromName: string; apiKeyChiffree: string | null; footerAddress: string } | null;
  linkedin: { accountId: string; connectedAt: Date | null; restriction: { restrictedAt: Date; reason?: string } | null } | null;
  /** Signature imposée des messages (client) ; null = signature habituelle de l'utilisatrice. */
  signature: string | null;
}

const texte = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const date = (v: unknown): Date | null => (v ? new Date(v as any) : null);

function depuis(c: {
  email?: unknown; nom?: unknown; cle?: unknown; adresse?: unknown[];
  li?: unknown; liLe?: unknown; restreintLe?: unknown; raison?: unknown;
}): Omit<IdentiteEnvoi, "signature"> {
  const fromEmail = texte(c.email);
  const accountId = texte(c.li);
  const restreintLe = date(c.restreintLe);
  return {
    email: fromEmail
      ? {
          fromEmail, fromName: texte(c.nom) ?? "", apiKeyChiffree: texte(c.cle),
          footerAddress: (c.adresse ?? []).map(texte).filter(Boolean).join(", "),
        }
      : null,
    linkedin: accountId
      ? {
          accountId, connectedAt: date(c.liLe),
          restriction: restreintLe ? { restrictedAt: restreintLe, reason: texte(c.raison) ?? undefined } : null,
        }
      : null,
  };
}

/**
 * Qui envoie, dans ce périmètre. Utilisatrice → ses préférences (comportement historique).
 * Client → la connexion du client SEULEMENT : un champ absent reste absent, jamais complété
 * par ceux de l'utilisatrice.
 */
export function identiteEnvoi(portee: Portee, prefs: any, connexion: any): IdentiteEnvoi {
  if (portee == null) {
    const p = prefs ?? {};
    return {
      ...depuis({
        email: p.prospectionSenderEmail, nom: p.prospectionSenderName, cle: p.prospectionSendgridApiKey,
        adresse: [p.prospectionSenderAddress, p.prospectionSenderCity, p.prospectionSenderCountry],
        li: p.linkedinUnipileAccountId, liLe: p.linkedinAccountConnectedAt,
        restreintLe: p.linkedinRestrictedAt, raison: p.linkedinRestrictedReason,
      }),
      signature: null,
    };
  }
  const c = connexion ?? {};
  return {
    ...depuis({
      email: c.senderEmail, nom: c.senderName, cle: c.sendgridApiKey,
      adresse: [c.senderAddress, c.senderCity, c.senderCountry],
      li: c.linkedinUnipileAccountId, liLe: c.linkedinAccountConnectedAt,
      restreintLe: c.linkedinRestrictedAt, raison: c.linkedinRestrictedReason,
    }),
    signature: texte(c.senderName),
  };
}
