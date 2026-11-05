// Mode test de la prospection (« Envoyer un test ») — logique pure du client.
export { estLeadTest } from "@shared/mode-test";

/** Codes de refus connus du serveur (server/services/prospection-mode-test.ts). */
export const CODES_REFUS_TEST = [
  "email_invalide", "introuvable", "envoi_desactive", "signature_client_manquante",
  "gmail_deconnecte", "pas_d_expediteur", "reception_hors_ligne", "adresse_propre",
  "quota_illisible", "quota_atteint", "desinscrit", "lien_desinscription_manquant", "echec_envoi",
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
