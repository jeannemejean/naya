/**
 * Mode test de la prospection : « Envoyer un test » depuis une campagne.
 *
 * Un clic crée un prospect TEST dans la campagne, rédige sa première touche email avec le
 * rédacteur réel des séquences (`redigerTouche`, contexte de la campagne, sans audit), et
 * l'envoie TOUT DE SUITE par le même chemin que les vrais envois (`envoyerEmailProspect` :
 * Gmail relié via Unipile, pied de mail, désinscription ; sinon SendGrid). Pas d'audit, pas
 * de contrôle qualité bloquant, pas de validation, pas de file d'attente, ni fenêtre horaire
 * ni écart de 20 min.
 *
 * Garde-fous :
 *  - Marquage SANS migration : `leads.tags` contient `TAG_LEAD_TEST` (colonne inutilisée
 *    jusqu'ici). `estLeadTest` est la seule lecture de ce marquage.
 *  - Étape 1 seulement : l'état de séquence est créé directement en `completed`
 *    (`getDueEnrollments` ne lit que `active`) et l'étape 1 est réservée dans
 *    outreach_step_sends. `enrollLead` refuse en plus tout prospect test.
 *  - Le message est journalisé dans outreach_messages (avec les identifiants Unipile) : une
 *    réponse se rattache par le fil, sinon par l'adresse, exactement comme un vrai prospect.
 *    Le même journal le compte dans le plafond quotidien d'emails.
 *  - Exclu des statistiques de campagne et de l'apprentissage (voir les appelants de
 *    `estLeadTest`).
 *
 * Toutes les dépendances sont injectées : la logique se teste sans base ni réseau.
 */
import type { BriefProspect } from "./prospection/brief";
import type { RoleTouche } from "./prospection/doctrine";
import type { SenderConfig } from "./prospection-sender";
import type { IdentiteEnvoi } from "./connexions/portee";
import type { ClaimStore } from "./prospection-idempotence";
import { sendOnce } from "./prospection-idempotence";
import { normaliserEmail } from "./reponses/rattachement";

import { TAG_LEAD_TEST, estLeadTest } from "@shared/mode-test";
export { TAG_LEAD_TEST, estLeadTest };

/** Retire les prospects test d'une liste (statistiques, taux observés). Pure. */
export function sansLeadsTest<T extends { tags?: string[] | null }>(leads: T[]): T[] {
  return leads.filter((l) => !estLeadTest(l));
}

export const NOM_TEST_PAR_DEFAUT = "Test";
const EMAIL_VALIDE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type DemandeTest = { nom: string; email: string };

/** Corps de la requête → demande valide, ou code d'erreur. Pure. */
export function lireDemandeTest(corps: any): { ok: true; demande: DemandeTest } | { ok: false; code: "email_invalide" } {
  const email = typeof corps?.email === "string" ? corps.email.trim() : "";
  if (!email || email.length > 254 || !EMAIL_VALIDE.test(email)) return { ok: false, code: "email_invalide" };
  const brut = typeof corps?.nom === "string" ? corps.nom.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  return { ok: true, demande: { nom: brut || NOM_TEST_PAR_DEFAUT, email } };
}

/**
 * Brief de la touche test, tiré de la campagne seule (aucun audit, aucun appel IA). Le
 * « déclencheur » est l'angle de la campagne : le rédacteur exige un déclencheur réel, et
 * c'est le seul fait que l'on connaisse. Pure.
 */
export function briefDeTest(campagne: any): BriefProspect {
  const t = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const angle = t(campagne?.messageAngle);
  const proposition = t(campagne?.campaignBrief) || t(campagne?.offer);
  const fait = angle || proposition || t(campagne?.targetSector) || "Premier contact";
  return {
    declencheur: { fait: fait.slice(0, 400), source: "mode_test" },
    preuveId: null,
    raison: (proposition || angle || fait).slice(0, 400),
    proposition: { type: "echange", contenu: (t(campagne?.offer) || proposition || fait).slice(0, 400) },
    angles: angle ? [angle.slice(0, 200)] : [],
    langue: "fr",
    registre: "vous",
    genereLe: new Date().toISOString(),
    edite: false,
  };
}

/** Texte de secours quand la rédaction échoue : le test aboutit toujours. Pure. */
export function texteDeSecours(nom: string, nomCampagne: string): { subject: string; body: string } {
  const prenom = nom.trim().split(/\s+/)[0] || NOM_TEST_PAR_DEFAUT;
  const campagne = nomCampagne.trim() ? ` « ${nomCampagne.trim()} »` : "";
  return {
    subject: "Email de test de ta prospection",
    body:
      `Bonjour ${prenom},\n\n` +
      `Cet email est un test envoyé depuis ta campagne${campagne}. Il part par le même chemin que tes vrais emails : même boîte, même pied de mail, même lien de désinscription.\n\n` +
      `Naya n'a pas pu rédiger le message de la campagne cette fois, d'où ce texte de secours.\n\n` +
      `Réponds-lui : ta réponse doit arriver dans l'onglet Réponses. Tu la vois passer ?`,
  };
}

export type CodeRefusTest =
  | "email_invalide" | "introuvable" | "envoi_desactive" | "signature_client_manquante"
  | "gmail_deconnecte" | "pas_d_expediteur" | "reception_hors_ligne" | "adresse_propre"
  | "quota_illisible" | "quota_atteint" | "desinscrit" | "lien_desinscription_manquant" | "echec_envoi"
  | "adresse_prospect" | "quota_test_atteint";

/** Au plus ce nombre de prospects test par utilisatrice sur 24 h glissantes. */
export const PLAFOND_TESTS_24H = 5;

const STATUT: Record<CodeRefusTest, number> = {
  email_invalide: 400, adresse_propre: 400, introuvable: 404,
  envoi_desactive: 409, signature_client_manquante: 409, gmail_deconnecte: 409, pas_d_expediteur: 409,
  reception_hors_ligne: 409, desinscrit: 409, quota_atteint: 429,
  quota_illisible: 503, lien_desinscription_manquant: 503, echec_envoi: 502,
  adresse_prospect: 409, quota_test_atteint: 429,
};

export type ResultatTest =
  | { ok: true; leadId: number; subject: string; body: string; secours: boolean }
  | { ok: false; status: number; code: CodeRefusTest };

const refus = (code: CodeRefusTest): ResultatTest => ({ ok: false, status: STATUT[code], code });

export interface DepsModeTest {
  now: () => Date;
  getCampaign: (id: number) => Promise<any>;
  getSteps: (campaignId: number) => Promise<any[]>;
  envoiActif: () => boolean;
  receptionActive: () => boolean;
  identite: (userId: string, campagne: any) => Promise<{ portee: number | null; identite: IdentiteEnvoi }>;
  resolveSender: (identite: IdentiteEnvoi) => SenderConfig | null;
  /** Adresses de l'utilisatrice (ou du client) : une réponse venant de l'une d'elles est prise pour la sienne. */
  adressesPropres: (userId: string, portee: number | null, sender: SenderConfig) => Promise<string[]>;
  emailsEnvoyesDepuis: (userId: string, depuis: Date) => Promise<number>;
  /** Un VRAI prospect (non test) de l'utilisatrice porte-t-il cette adresse (normalisée) ? */
  adresseDeVraiProspect: (userId: string, emailNormalise: string) => Promise<boolean>;
  /** Prospects test créés par l'utilisatrice depuis cet instant. */
  testsCreesDepuis: (userId: string, depuis: Date) => Promise<number>;
  plafondQuotidien: number;
  signature: (userId: string, identite: IdentiteEnvoi) => Promise<string>;
  createLead: (row: any) => Promise<{ id: number }>;
  archiverLead: (leadId: number, userId: string) => Promise<unknown>;
  estDesinscrit: (leadId: number, userId: string) => Promise<boolean>;
  lienDesinscription: (leadId: number) => string | null;
  iaBloquee: (userId: string) => Promise<boolean>;
  rediger: (userId: string, a: {
    lead: any; campaign: any; role: RoleTouche; canal: "email"; brief: BriefProspect; rang: number;
    intention: string; previousTexts: string[]; instructions: string; founderName: string;
  }) => Promise<{ subject: string | null; body: string }>;
  consignes: (userId: string, campagne: any) => Promise<string>;
  roleTouche: (steps: any[], index: number) => RoleTouche;
  retirerSignature: (body: string, prenom: string) => string;
  envoyer: (sender: SenderConfig, o: {
    to: string; toName: string; subject: string; body: string; leadId: number; stepOrder: number; lienDesinscription: string | null;
  }) => Promise<{ ok: boolean; providerId: string | null; threadId: string | null }>;
  claimStore: ClaimStore;
  journaliser: (row: any) => Promise<{ id: number }>;
  setProviderIds: (outreachId: number, providerId: string | null, threadId: string | null) => Promise<unknown>;
  terminerSequence: (leadId: number, campaignId: number, userId: string, at: Date) => Promise<unknown>;
}

/** Envoie l'email test d'une campagne. Jamais d'exception sur un refus attendu : un code. */
export async function envoyerEmailTest(
  deps: DepsModeTest, userId: string, campaignId: number, corps: any,
): Promise<ResultatTest> {
  const lu = lireDemandeTest(corps);
  if (!lu.ok) return refus(lu.code);
  const { nom, email } = lu.demande;

  const campagne = Number.isInteger(campaignId) && campaignId > 0 ? await deps.getCampaign(campaignId) : null;
  if (!campagne || campagne.userId !== userId) return refus("introuvable");

  // Mêmes conditions que le worker pour un email ; jamais de repli silencieux.
  if (!deps.envoiActif()) return refus("envoi_desactive");
  const { portee, identite } = await deps.identite(userId, campagne);
  if (portee != null && !identite.signature) return refus("signature_client_manquante");
  if (identite.email?.deconnecte) return refus("gmail_deconnecte");
  const sender = deps.resolveSender(identite);
  if (!sender) return refus("pas_d_expediteur");
  if (sender.via === "unipile" && !deps.receptionActive()) return refus("reception_hors_ligne");

  // Une réponse venant d'une de NOS adresses est classée « de chez nous », jamais « réponse » :
  // le test serait invisible dans Réponses.
  const cible = normaliserEmail(email);
  const propres = [sender.fromEmail, ...(await deps.adressesPropres(userId, portee, sender).catch(() => []))]
    .filter((a): a is string => typeof a === "string" && !!a.trim()).map(normaliserEmail);
  if (propres.includes(cible)) return refus("adresse_propre");

  // Jamais l'adresse d'un vrai prospect : le test contournerait validation, contrôle qualité et
  // doublons, et rendrait le rattachement des réponses ambigu (même adresse, deux fiches).
  // Lecture ratée : refus par prudence.
  try {
    if (await deps.adresseDeVraiProspect(userId, cible)) return refus("adresse_prospect");
  } catch {
    return refus("adresse_prospect");
  }
  const depuis24h = new Date(deps.now().getTime() - 86_400_000);
  try {
    if ((await deps.testsCreesDepuis(userId, depuis24h)) >= PLAFOND_TESTS_24H) return refus("quota_test_atteint");
  } catch {
    return refus("quota_illisible");
  }

  // Plafond quotidien : même compte que le worker (outreach_messages email, 24 h glissantes).
  let envoyes: number;
  try {
    envoyes = await deps.emailsEnvoyesDepuis(userId, depuis24h);
  } catch {
    return refus("quota_illisible");
  }
  if (envoyes >= deps.plafondQuotidien) return refus("quota_atteint");

  const lead = await deps.createLead({
    userId, projectId: campagne.projectId ?? null, prospectionCampaignId: campagne.id,
    name: nom, email, stage: "connection_sent", tags: [TAG_LEAD_TEST],
    notes: "Prospect test : créé par « Envoyer un test », ne reçoit que la première touche.",
  });
  const abandonner = async (code: CodeRefusTest) => {
    await Promise.resolve(deps.archiverLead(lead.id, userId)).catch(() => {});
    return refus(code);
  };

  try {
    if (await deps.estDesinscrit(lead.id, userId)) return abandonner("desinscrit");
  } catch {
    return abandonner("desinscrit"); // lecture ratée : jamais écrire à quelqu'un peut-être désinscrit
  }
  const lien = deps.lienDesinscription(lead.id);
  if (sender.via === "unipile" && !lien) return abandonner("lien_desinscription_manquant");

  // Rédaction réelle (première touche email de la campagne), sinon texte de secours.
  const founderName = await deps.signature(userId, identite).catch(() => "");
  let subject = "";
  let body = "";
  let secours = false;
  try {
    if (await deps.iaBloquee(userId)) throw new Error("ia_bloquee");
    const steps = await deps.getSteps(campagne.id).catch(() => []);
    const iEmail = steps.findIndex((s: any) => s?.channel === "email");
    const r = await deps.rediger(userId, {
      lead: { id: lead.id, name: nom, email, company: null, role: null },
      campaign: campagne,
      role: iEmail >= 0 ? deps.roleTouche(steps, iEmail) : "email_ouverture",
      canal: "email", brief: briefDeTest(campagne), rang: 0,
      intention: iEmail >= 0 ? steps[iEmail]?.intention || "" : "",
      previousTexts: [], instructions: await deps.consignes(userId, campagne).catch(() => ""), founderName,
    });
    if (!r.body?.trim()) throw new Error("corps_vide");
    subject = r.subject?.trim() || "";
    body = r.body;
  } catch (e: any) {
    console.warn(`[mode-test] rédaction impossible (lead ${lead.id}) : ${String(e?.message ?? e).slice(0, 120)} — texte de secours`);
    secours = true;
  }
  if (secours || !subject) {
    const s = texteDeSecours(nom, String(campagne.name || ""));
    if (secours) body = s.body;
    if (!subject) subject = s.subject;
  }
  body = deps.retirerSignature(body, founderName);

  const sentAt = deps.now();
  let issue: Awaited<ReturnType<typeof sendOnce>>;
  // Exception pendant l'envoi : issue inconnue, la réservation est GARDÉE (jamais renvoyer dans
  // le doute) ; le prospect test orphelin est archivé.
  try {
    issue = await sendOnce(deps.claimStore, {
      leadId: lead.id, campaignId: campagne.id, stepOrder: 1, userId, channel: "email",
    }, async () => {
      const envoi = await deps.envoyer(sender, {
        to: email, toName: nom, subject, body, leadId: lead.id, stepOrder: 1, lienDesinscription: lien,
      });
      if (!envoi.ok) return { ok: false };
      // Parti : le journal (rattachement des réponses, plafond) est écrit au mieux.
      try {
        const cree = await deps.journaliser({
          userId, projectId: campagne.projectId ?? null, leadId: lead.id, platform: "email",
          messageType: "step_1", subject, body, sentAt,
        });
        if (envoi.providerId || envoi.threadId) await deps.setProviderIds(cree.id, envoi.providerId, envoi.threadId);
      } catch (e: any) {
        console.error(`[mode-test] email PARTI mais NON journalisé (lead ${lead.id}) : ${String(e?.message ?? e).slice(0, 160)}`);
      }
      return { ok: true, status: "sent" as const };
    });
  } catch (e: any) {
    console.error(`[mode-test] envoi en exception (lead ${lead.id}) : ${String(e?.message ?? e).slice(0, 160)} — réservation gardée, prospect test archivé`);
    return abandonner("echec_envoi");
  }
  if (issue.action !== "sent") return abandonner("echec_envoi");

  // Étape 1 seulement : la séquence du prospect test est terminée d'emblée.
  await Promise.resolve(deps.terminerSequence(lead.id, campagne.id, userId, sentAt))
    .catch((e: any) => console.error(`[mode-test] état de séquence non écrit (lead ${lead.id}) : ${String(e?.message ?? e).slice(0, 160)}`));

  return { ok: true, leadId: lead.id, subject, body, secours };
}
