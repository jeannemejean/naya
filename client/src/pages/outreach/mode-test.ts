// Mode test de la prospection (« Envoyer un test ») — logique pure du client.
import { estLeadTest } from "@shared/mode-test";
export { estLeadTest };

/** Prospects proposés dans l'Aperçu : ceux de la campagne, hors archivés et hors prospects test. */
export function prospectsApercu<T extends { prospectionCampaignId?: number | null; archivedAt?: unknown; tags?: string[] | null }>(
  leads: T[], campaignId: number,
): T[] {
  return leads.filter((l) => l.prospectionCampaignId === campaignId && !l.archivedAt && !estLeadTest(l));
}

/** Codes de refus connus du serveur (server/services/prospection-mode-test.ts). */
export const CODES_REFUS_TEST = [
  "email_invalide", "introuvable", "envoi_desactive", "signature_client_manquante",
  "gmail_deconnecte", "pas_d_expediteur", "reception_hors_ligne", "adresse_propre",
  "quota_illisible", "quota_atteint", "desinscrit", "lien_desinscription_manquant", "echec_envoi",
  "adresse_prospect", "quota_test_atteint",
] as const;
export type CodeRefusTest = (typeof CODES_REFUS_TEST)[number];

const EMAIL_VALIDE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Même règle que le serveur : l'adresse est obligatoire et doit avoir l'air d'une adresse. */
export function emailTestValide(email: string): boolean {
  const e = email.trim();
  return !!e && e.length <= 254 && EMAIL_VALIDE.test(e);
}

/**
 * Code de refus lu dans l'erreur d'apiRequest (« 409: {"message":"gmail_deconnecte"} ») ;
 * toute erreur inconnue retombe sur « echec_envoi ».
 */
export function codeRefusTest(err: unknown): CodeRefusTest {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const json = msg.replace(/^\d{3}:\s*/, "");
  try {
    const code = JSON.parse(json)?.message;
    if ((CODES_REFUS_TEST as readonly string[]).includes(code)) return code;
  } catch { /* corps non JSON */ }
  return "echec_envoi";
}
