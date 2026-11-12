/**
 * Worker d'envoi des séquences de prospection (style lemlist).
 *
 * SÉCURITÉ (cf. incident des 14 posts) : le worker est TOTALEMENT INERTE tant que
 * `PROSPECTION_SENDING_ENABLED=true` (kill-switch global).
 *
 * MULTI-UTILISATEUR : chaque email part de l'adresse expéditrice PROPRE À L'UTILISATEUR
 * (`userPreferences.prospectionSenderEmail`) — jamais l'adresse de l'app. La clé SendGrid
 * utilisée est celle de l'utilisateur si elle est configurée (`prospectionSendgridApiKey`,
 * chiffrée), sinon la clé partagée `SENDGRID_API_KEY`. Si un utilisateur n'a pas d'adresse
 * expéditrice configurée, ses étapes restent EN ATTENTE (rien n'est envoyé en son nom).
 *
 * Stop-on-reply : le worker ne traite que les enrôlements `status='active'` ;
 * une réponse fait passer le statut à `stopped_replied`.
 */

import { storage } from "../storage";
import { decryptToken } from "./token-crypto";
import { linkedinConfigured, sendLinkedInStep, checkConnection } from "./linkedin";
import { decisionPublic, normaliserPublic, RAISON_EXCLUSION } from "./campagne-public";
import { decideNextStep, planAfterStep } from "./sequence-engine";
import { nextTropProcheState, lireGarde, RAISON_TROP_PROCHE, MAX_TROP_PROCHE_CONSECUTIFS } from "./sequence-distinct";
import { raisonDeRetenue, RAISON_VALIDATION_MANQUANTE } from "./prospection-validation";
import { BriefIncompletError, generateStepMessage, combineInstructions } from "./sequence-message";
import { resolveFounderName } from "./prospection-pipeline";
import { identiteCampagne } from "./connexions/resolution";
import type { IdentiteEnvoi } from "./connexions/portee";
import { sendEmailUnipile } from "./unipile-mail";
import { persisterRestrictionLinkedIn } from "./linkedin-restriction";
import { lienDesinscription, avertirSecretDeSecours } from "./desinscription";
import { sendOnce, type ClaimStore, type StepSendKey } from "./prospection-idempotence";
import {
  decideLinkedInAction,
  isLinkedInRestrictionSignal,
  LINKEDIN_WEEKLY_WINDOW_MS,
} from "./prospection-linkedin-guard";
import { LINKEDIN_FENETRE, linkedinGapMs } from "./linkedin-rythme";
import { isTargetReachableAt } from "./prospection-target-hours";
// Fonctions PURES déjà exportées par les fichiers validés de ce lot — jamais
// modifiées ici, seulement consommées (même statut que `isTargetReachableAt`
// elle-même). Utilisées uniquement pour déterminer le JOUR CIVIL de la cible
// (voir `targetDateStr` plus bas) : `isTargetReachableAt`/`targetWindowUTC`
// résolvent déjà ces mêmes fuseaux en interne pour construire la fenêtre — on
// répète ici cette seule résolution, jamais le calcul de la fenêtre elle-même.
import { zonesForCountry } from "./prospection-target-zones";
import { zoneForCity } from "./prospection-target-cities";
import { estContrainteLead } from "./prospection-suppression";
import { suivrePassage } from "./fil/etat-taches-fond";

const POLL_MS = 60_000;
let running = false;

// Repli UNIQUE pour "le fuseau de l'utilisatrice" quand `prefs?.timezone` est absent.
// Revue post-commit d95c42a, mineur : trois valeurs différentes cohabitaient pour ce
// même concept — "Europe/Paris" dans le calcul du jour civil (todayStr), "UTC" dans
// `localNow` (fenêtre d'envoi) et dans `sessionsDe` (bornes de session). Un
// utilisateur SANS AUCUNE préférence, dans la bande 22h-00h UTC (où le jour civil de
// Paris et celui de l'UTC diffèrent), obtenait donc une fenêtre de session construite
// pour le jour de Paris mais bornée dans le fuseau UTC — deux jours différents pour
// une même fenêtre. UTC choisi (pas Europe/Paris, repli initial de la ronde
// précédente) : c'est déjà la convention préexistante de `localNow` et de
// `decideLinkedInAction` (toutes deux antérieures à ce lot), et c'est le fuseau réel
// du serveur de production (voir server/utils/timezone.ts, tête de fichier) — le
// choix le plus neutre quand on ne sait strictement rien de l'utilisatrice.
const DEFAULT_USER_TIMEZONE = "UTC";

export interface PlanResult {
  sendIndex: number | null;
  done: boolean;
  nextDelayDays: number | null;
}

/**
 * Décide l'étape à envoyer maintenant et la suite. Pure & testable.
 * `currentStep` = nombre d'étapes déjà envoyées (0 = aucune). L'étape à envoyer
 * est donc `steps[currentStep]`.
 */
export function planNextStep(currentStep: number, steps: { delayDays: number }[]): PlanResult {
  if (currentStep >= steps.length) {
    return { sendIndex: null, done: true, nextDelayDays: null };
  }
  const after = currentStep + 1;
  const willComplete = after >= steps.length;
  return {
    sendIndex: currentStep,
    done: willComplete,
    nextDelayDays: willComplete ? null : steps[after].delayDays || 0,
  };
}

/** Nombre de jours PLEINS écoulés entre deux dates. Pure & testable. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

// Kill-switch global. L'envoi effectif dépend AUSSI de la config expéditeur de chaque user.
// Exporté : `linkedin-sync.ts` (poller de lecture) le consulte aussi — revue post-commit
// f17af17, défaut Critique. « L'envoi reste inerte » ne doit pas laisser le POLLER
// continuer d'interroger LinkedIn quand la prospection est globalement désactivée.
export function masterSendingEnabled(): boolean {
  return process.env.PROSPECTION_SENDING_ENABLED === "true";
}

/**
 * La détection des réponses (webhooks Unipile) est-elle en ligne ? Condition des envois
 * AUTOMATIQUES par Unipile (Gmail, LinkedIn) — spec §8 : sans réception, un prospect qui
 * répond ne serait jamais vu et recevrait la relance suivante. Exige le secret du webhook
 * et APP_URL ; en production, APP_URL en https:// (le secret voyage en en-tête). Pure.
 */
export function receptionReponsesEnLigne(env: Record<string, string | undefined> = process.env): boolean {
  const secret = env.UNIPILE_WEBHOOK_SECRET?.trim();
  const appUrl = env.APP_URL?.trim();
  if (!secret || !appUrl) return false;
  if (env.NODE_ENV === "production" && !/^https:\/\//i.test(appUrl)) return false;
  return true;
}

// Plafond d'emails / utilisateur / jour (délivrabilité). Configurable via env.
// Ne compte QUE les emails : les messages LinkedIn ont leurs propres plafonds (garde de risque).
export const DAILY_CAP = Number(process.env.PROSPECTION_DAILY_CAP) || 80;

// Écart minimum entre deux emails du même expéditeur : sans lui, tous les emails dus
// partaient dans la même minute (jusqu'à 100 par passage), un rythme qu'aucun humain n'a.
// Entre 3 et 8 minutes selon l'envoi précédent. Le tirage est DÉRIVÉ de l'instant du
// dernier envoi (pas un nouveau Math.random à chaque passage) : retirer au sort chaque
// minute ferait passer l'envoi dès le premier tirage court, soit presque toujours à 3 min.
export const EMAIL_MIN_GAP_BASE_MS = 3 * 60_000;
export const EMAIL_MIN_GAP_JITTER_MS = 5 * 60_000;

/** Écart exigé après un email parti à `lastSentAt`, entre 3 et 8 minutes. Pure. */
export function emailGapMs(lastSentAt: Date): number {
  const graine = Math.abs(Math.sin(lastSentAt.getTime() / 1000)) % 1;
  return EMAIL_MIN_GAP_BASE_MS + Math.floor(graine * EMAIL_MIN_GAP_JITTER_MS);
}

/** Un nouvel email peut-il partir ? `null` = aucun email encore envoyé. Pure. */
export function emailGapElapsed(lastSentAt: Date | null, now: Date): boolean {
  if (!lastSentAt) return true;
  return now.getTime() - lastSentAt.getTime() >= emailGapMs(lastSentAt);
}

// Délai minimum ALÉATOIRE entre deux consultations de statut du poller LinkedIn
// (`linkedin-sync.ts`). Les ENVOIS suivent désormais le rythme de `linkedin-rythme.ts`
// (≈ 20 min, pauses) ; ces constantes ne servent plus qu'au poller (3 à 7 min).
export const LINKEDIN_SYNC_MIN_DELAY_BASE_MS = 3 * 60_000;
export const LINKEDIN_SYNC_MIN_DELAY_JITTER_MS = 4 * 60_000;

// Recul + abandon sur échec LinkedIn franc, PAR LEAD (pas par compte — le compte est
// protégé séparément par la garde de risque, qui peut décider indépendamment de mettre
// TOUT le compte en pause). Sans ceci, un lead dont le profil ne se résout jamais (ex.
// URL LinkedIn périmée) était retenté à chaque tick du worker, sans borne — revue
// post-commit 261835e, défaut Critique 2 : 20 leads dans cet état ≈ 86 000 requêtes/jour.
//
// Recul EXPONENTIEL, base 5 min : 5, 10, 20, 40 minutes — assez large pour laisser
// passer un hoquet réseau ou une panne Unipile transitoire de quelques dizaines de
// minutes sans abandonner prématurément, sans non plus laisser un lead irrésolvable
// consommer indéfiniment le quota d'un compte humain.
//
// ABANDON après 5 échecs consécutifs : au-delà, ce n'est plus un incident, c'est un lead
// que Naya ne sait pas atteindre par ce canal (URL invalide, profil supprimé, etc.).
// 5 tentatives (sur plusieurs heures grâce au recul ci-dessus) suffisent à distinguer
// une panne transitoire d'un problème structurel, pour un coût dérisoire au regard des
// plafonds quotidiens (5 tentatives ≤ le plafond du jour 0 d'un compte flambant neuf).
export const LINKEDIN_FAILURE_BACKOFF_BASE_MIN = 5;
export const LINKEDIN_MAX_CONSECUTIVE_FAILURES = 5;

// Revue post-commit f17af17, mineur : un lead refusé pour cause de RESTRICTION du compte
// gardait son `nextRunAt` inchangé → sur un compte restreint avec de nombreux leads dus,
// jusqu'à 100 lignes de séquence étaient relues (getSequenceSteps/getLeadSignals/
// getReservedStepOrders/getLeads) à CHAQUE tick (60s), pour toujours — coût base pur,
// aucun appel Unipile (déjà bloqué), mais inutile pendant potentiellement des heures/jours
// en attendant une reprise MANUELLE. Une restriction ne se résout jamais toute seule en
// quelques minutes (contrairement à la fenêtre ouvrée, au délai minimum ou aux plafonds,
// qui expirent naturellement) : 1h est un compromis délibéré entre « ne pas marteler la
// base pour rien » et « reprendre vite après une levée manuelle ».
export const LINKEDIN_RESTRICTED_RETRY_BACKOFF_MS = 60 * 60_000;

// Délai avant de retenter une étape dont le message généré reste TROP PROCHE d'un message
// antérieur au même prospect (generateStepMessage → `tropProche: true`, après une
// régénération ratée). L'étape n'est PAS envoyée et reste en attente ; sans ce recul, le
// moteur paierait deux appels IA à chaque minute pour le même lead.
export const TROP_PROCHE_RETRY_BACKOFF_MS = 60 * 60_000;

function stepForMessage(s: any) {
  return {
    id: s.id, channel: s.channel, intention: s.intention ?? null,
    condition: s.condition ?? "always", bodyTemplate: s.bodyTemplate ?? null,
    role: s.role ?? null,
  };
}

export interface LinkedInFailureOutcome {
  abandon: boolean;
  consecutiveFailures: number;
  /** `null` quand `abandon` est vrai — plus rien à programmer, la séquence s'arrête pour ce lead. */
  nextRunAt: Date | null;
}

/**
 * Décide la suite après un échec d'envoi LinkedIn franc pour UN lead. Pure & testable :
 * `now` entre par la signature, aucune horloge implicite.
 */
export function nextLinkedInFailureState(previousConsecutiveFailures: number, now: Date): LinkedInFailureOutcome {
  const consecutiveFailures = previousConsecutiveFailures + 1;
  if (consecutiveFailures >= LINKEDIN_MAX_CONSECUTIVE_FAILURES) {
    return { abandon: true, consecutiveFailures, nextRunAt: null };
  }
  const backoffMin = LINKEDIN_FAILURE_BACKOFF_BASE_MIN * Math.pow(2, consecutiveFailures - 1);
  return { abandon: false, consecutiveFailures, nextRunAt: new Date(now.getTime() + backoffMin * 60_000) };
}

/** Vrai si on est dans la fenêtre d'envoi (jour ouvré + heures de travail). Pure & testable. */
export function withinSendingWindow(
  nowMin: number,
  dayAbbr: string,
  opts: { startMin: number; endMin: number; workDays: Set<string> },
): boolean {
  if (!opts.workDays.has(dayAbbr)) return false;
  return nowMin >= opts.startMin && nowMin < opts.endMin;
}

const DAY_ABBRS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Adaptateur du protocole d'idempotence sur le storage. Le worker ne parle jamais
// directement aux trois méthodes : il passe par `sendOnce`, qui garantit l'ordre
// réserver → envoyer → marquer/libérer.
export const claimStore: ClaimStore = {
  claim: (key) => storage.claimStepSend(key),
  markSent: (key, status) => storage.markStepSendSent(key, status),
  release: (key) => storage.releaseStepSend(key),
};

// "Maintenant" dans le fuseau de l'utilisateur → { nowMin, dayAbbr }.
export function localNow(timezone: string): { nowMin: number; dayAbbr: string } {
  const tz = timezone || "UTC";
  try {
    // hourCycle:'h23' (pas hour12:false seul) : même piège ICU documenté dans
    // server/utils/timezone.ts (minuit peut rendre "24" au lieu de "00" selon la
    // version d'ICU du runtime avec hour12:false seul).
    const hm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
    const [h, m] = hm.split(":").map(Number);
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date()).toLowerCase().slice(0, 3);
    return { nowMin: h * 60 + m, dayAbbr: wd };
  } catch {
    const d = new Date();
    return { nowMin: d.getUTCHours() * 60 + d.getUTCMinutes(), dayAbbr: DAY_ABBRS[d.getUTCDay()] };
  }
}

export function hhmmToMin(hhmm: string | null | undefined, fallback: number): number {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return fallback;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * "YYYY-MM-DD" du jour civil d'un instant, dans UN FUSEAU ARBITRAIRE — jamais figé
 * sur Paris. Revue post-commit b97a0b6, défaut Important : la date civile qui nourrit
 * `targetWindowUTC`/`planDailySessions` était dérivée de `parisTodayString`, quel que
 * soit le fuseau de l'UTILISATRICE. Pour une utilisatrice loin de Paris (ex.
 * Pacific/Kiritimati, UTC+14, la première à changer de jour civil sur Terre), le jour
 * calculé pouvait être celui de la veille ou du lendemain de son propre jour réel : la
 * fenêtre et les sessions ne recouvraient alors JAMAIS son "maintenant" — la
 * prospection LinkedIn ne partait plus, en silence, dès le deuxième fuseau non-Paris.
 * Implémentation calquée sur `parisTodayString` (server/utils/timezone.ts, fichier
 * validé de ce lot, non modifié) mais paramétrée par fuseau — ce module ne peut
 * qu'appeler `wallClockToInstant`/les fonctions déjà exportées, pas les dupliquer.
 */
function todayStringIn(timeZone: string, now: Date): string {
  // Locale en-CA : le seul format standard dont Intl garantit la sortie en YYYY-MM-DD
  // (même choix que `parisTodayString`).
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

// Le pays et la ville d'un lead ne sont PAS des colonnes : ils vivent dans le profil
// enrichi (JSON), sous la forme brute renvoyée par le fournisseur d'enrichissement
// LinkedIn. Une lecture qui échoue ou qui ne rend pas une chaîne est traitée comme
// pays/ville inconnu — jamais comme joignable (voir `isTargetReachableAt`, qui refuse
// et signale un pays `null`).
function leadCountryCode(lead: any): string | null {
  try {
    const cc = lead?.enrichedProfile?.linkedin?.raw?.country_code;
    return typeof cc === "string" ? cc : null;
  } catch {
    return null;
  }
}
function leadCity(lead: any): string | null {
  try {
    const city = lead?.enrichedProfile?.linkedin?.raw?.city;
    return typeof city === "string" ? city : null;
  } catch {
    return null;
  }
}

/**
 * Jour civil PROPRE à une cible (pays/ville), résolu dans SON fuseau — jamais celui
 * de l'utilisatrice, jamais un jour partagé. Réutilisée à DEUX endroits qui doivent
 * s'accorder sur la même résolution de fuseau (revue post-commit 3acac93, puis
 * post-commit de cette ronde : la même erreur — réutiliser le jour de
 * l'utilisatrice pour une cible — s'était déjà glissée une première fois côté
 * vérification par lead, puis une seconde fois côté placement des sessions ; ce
 * helper existe pour qu'elle ne puisse plus se reproduire une troisième fois) :
 * la vérification de joignabilité PAR LEAD (`isTargetReachableAt`) et la
 * construction de `pendingTargets` pour `planDailySessions` (`sessionsDe`).
 * `zoneForCity`/`zonesForCountry` : mêmes fonctions, déjà exportées par les
 * fichiers validés `-cities.ts`/`-zones.ts`, que celles que `targetWindowUTC`
 * utilise en interne pour construire sa fenêtre — on ne duplique que ce choix de
 * fuseau représentatif, jamais le calcul de la fenêtre elle-même. Pays inconnu ou
 * zone introuvable → repli sur `fallbackDateStr` (le jour de l'utilisatrice) :
 * sans conséquence, `targetWindowUTC`/`isTargetReachableAt` refuseront de toute
 * façon (`country_unknown`) quel que soit le jour transmis.
 */
function targetDateStrFor(countryCode: string | null, city: string | null, now: Date, fallbackDateStr: string): string {
  if (!countryCode) return fallbackDateStr;
  const zone = zoneForCity(countryCode, city) ?? zonesForCountry(countryCode)?.[0] ?? null;
  return zone ? todayStringIn(zone, now) : fallbackDateStr;
}

// Config d'envoi du périmètre de la campagne (l'utilisatrice, ou le client d'un projet
// client) : adresse + clé. Jamais l'adresse de l'app ; jamais celle de l'utilisatrice pour
// un client (voir connexions/portee.ts).
export type SenderConfig =
  | { via: "unipile"; accountId: string; fromEmail: string; fromName: string; footerAddress: string }
  | { via: "sendgrid"; apiKey: string; fromEmail: string; fromName: string; footerAddress: string };

// Gmail relié (Unipile) d'abord : l'email part de la vraie boîte de l'utilisateur, sans clé
// SendGrid. Sinon SendGrid comme avant (clé propre ou partagée).
export function resolveSenderConfig(identite: IdentiteEnvoi): SenderConfig | null {
  const e = identite.email;
  if (!e) return null; // pas d'adresse expéditrice → on n'envoie jamais en son nom
  if (e.unipileAccountId) {
    return { via: "unipile", accountId: e.unipileAccountId, fromEmail: e.fromEmail, fromName: e.fromName, footerAddress: e.footerAddress };
  }
  const cle = e.apiKeyChiffree ? decryptToken(e.apiKeyChiffree) : null;
  const apiKey = cle || process.env.SENDGRID_API_KEY;
  if (!apiKey) return null; // ni clé propre ni clé partagée
  return { via: "sendgrid", apiKey, fromEmail: e.fromEmail, fromName: e.fromName, footerAddress: e.footerAddress };
}

const echapperHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Corps HTML d'un email Gmail : paragraphes (séparés par une ligne vide dans le texte),
 * pied de mail (nom complet de l'expéditrice, adresse) puis une petite ligne grise
 * « Se désinscrire » cliquable — jamais l'URL brute, jamais de tiret.
 */
export function corpsEmailGmail(body: string, fromName: string, footerAddress: string, lien: string): string {
  const html = (t: string) => echapperHtml(t.trim()).replace(/\n/g, "<br>");
  const paragraphes = (body || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px">${html(p)}</p>`);
  const pied = [fromName, footerAddress].map((x) => (x || "").trim()).filter(Boolean).join("\n");
  if (pied) paragraphes.push(`<p style="margin:24px 0 12px">${html(pied)}</p>`);
  paragraphes.push(`<p style="font-size:12px;color:#888"><a href="${echapperHtml(lien)}" style="color:#888">Se désinscrire</a></p>`);
  return paragraphes.join("");
}

/**
 * Retire d'un email DÉJÀ rédigé la signature finale écrite par le modèle (« … ? Jeanne, Test. »,
 * « … ? Jeanne. ») : le pied de mail signe désormais, elle ferait doublon. Prudent : seulement
 * le prénom exact de l'expéditrice de la campagne, tout à la fin, juste après une fin de
 * phrase, suivi au plus d'un court libellé sans ponctuation (« , Test »). Uniquement sur un
 * corps SANS retour à la ligne (anciennes générations à plat, les seules signées) : un texte en
 * paragraphes n'est jamais signé par le modèle, et un texte édité à la main part tel quel. Pure.
 */
export function retirerSignatureFinale(body: string, prenom: string | null | undefined): string {
  const nom = (prenom || "").trim();
  if (!nom || !body || /[\r\n]/.test(body)) return body;
  const echappe = nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`([.!?…])\\s+${echappe}(?:\\s*,\\s*[^\\s.,;:!?…][^.,;:!?…\\n]{0,40})?\\s*\\.?\\s*$`, "u");
  const m = body.match(re);
  if (!m || m.index == null) return body;
  const reste = body.slice(0, m.index) + m[1];
  return reste.trim() ? reste : body;
}

async function sendEmail(opts: {
  apiKey: string; fromEmail: string; fromName: string; footerAddress: string;
  to: string; toName: string; subject: string; body: string; leadId: number; userId?: string;
}): Promise<boolean> {
  // Conformité anti-spam (CAN-SPAM / RGPD) : adresse postale + lien de désinscription.
  // SendGrid remplace <%unsubscribe%> par l'URL de désinscription et supprime automatiquement
  // les désinscrits des envois suivants (subscription_tracking).
  const footer =
    `\n\n${opts.fromName || ""}` +
    (opts.footerAddress ? `\n${opts.footerAddress}` : "") +
    `\n\nSe désinscrire : <%unsubscribe%>`;
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: opts.to, name: opts.toName || undefined }], subject: opts.subject }],
      from: { email: opts.fromEmail, name: opts.fromName || undefined },
      content: [{ type: "text/plain", value: opts.body + footer }],
      tracking_settings: {
        click_tracking: { enable: true },
        open_tracking: { enable: true },
        subscription_tracking: { enable: true, substitution_tag: "<%unsubscribe%>" },
      },
      // Corrélation webhook. `userId` : une désinscription arrivée après la suppression du
      // prospect reste rattachable à l'utilisatrice (avec l'adresse de l'événement).
      custom_args: { leadId: String(opts.leadId), ...(opts.userId ? { userId: opts.userId } : {}) },
    }),
  });
  return res.ok;
}

/**
 * Envoie UN email de prospection par la configuration d'envoi résolue : Gmail relié (Unipile,
 * corps HTML `corpsEmailGmail`, en-têtes List-Unsubscribe, suivi `lead:N:step:K`) ou SendGrid.
 * Seul chemin d'envoi d'un email de séquence, partagé par le worker et le mode test.
 * `lienDesinscription` est obligatoire pour Gmail : sans lui, rien ne part.
 */
export async function envoyerEmailProspect(
  sender: SenderConfig,
  o: { to: string; toName: string; subject: string; body: string; leadId: number; stepOrder: number; lienDesinscription: string | null; userId?: string },
): Promise<{ ok: boolean; providerId: string | null; threadId: string | null }> {
  if (sender.via === "unipile") {
    if (!o.lienDesinscription) return { ok: false, providerId: null, threadId: null };
    const res = await sendEmailUnipile({
      accountId: sender.accountId, to: o.to, toName: o.toName, subject: o.subject,
      body: corpsEmailGmail(o.body, sender.fromName, sender.footerAddress, o.lienDesinscription),
      trackingLabel: `lead:${o.leadId}:step:${o.stepOrder}`,
      headers: { "List-Unsubscribe": `<${o.lienDesinscription}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    return { ok: res.ok, providerId: res.providerId ?? null, threadId: res.threadId ?? null };
  }
  const ok = await sendEmail({
    apiKey: sender.apiKey, fromEmail: sender.fromEmail, fromName: sender.fromName, footerAddress: sender.footerAddress,
    to: o.to, toName: o.toName, subject: o.subject, body: o.body, leadId: o.leadId, userId: o.userId,
  });
  return { ok, providerId: null, threadId: null };
}

/** Raison visible dans l'aperçu quand un doublon du prospect a déjà répondu (M3). */
export const RAISON_DOUBLON_A_REPONDU =
  "Cette personne a déjà répondu depuis une autre fiche : séquence en pause, rien n'est envoyé.";

/** Met la séquence en pause, raison visible dans l'aperçu. */
async function retenir(lead: any, stepId: number, raison: string): Promise<void> {
  console.warn(`[ProspectionSender] lead ${lead.id} retenu — séquence en pause, rien envoyé : ${raison}`);
  await storage.setLeadSequenceGuard(lead.id, { tropProcheConsecutifs: lireGarde(lead)?.tropProcheConsecutifs ?? 0, stepId, attention: raison })
    .catch((e: any) => console.error("[ProspectionSender] écriture de la raison échouée", e.message));
  await storage.updateLeadSequenceState(lead.id, { status: "paused", nextRunAt: null } as any)
    .catch((e: any) => console.error("[ProspectionSender] mise en pause échouée", e.message));
}

export async function runProspectionSender(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Suivi seulement d'un vrai passage (jamais d'un tour bloqué par `running`) ; l'erreur est
    // notée puis relancée, l'intervalle la journalise et continue.
    await suivrePassage("envoi_prospection", passerProspection);
  } finally {
    running = false;
  }
}

async function passerProspection(): Promise<void> {
  {
    // Une lecture ratée lève : le suivi note l'erreur (plus de faux succès sur base en panne).
    const due = await storage.getDueEnrollments(new Date(), 100);
    if (due.length === 0) return;

    if (!masterSendingEnabled()) {
      console.log(
        `[ProspectionSender] DRY-RUN : ${due.length} étape(s) due(s) — envoi GLOBALEMENT DÉSACTIVÉ, aucune action. ` +
          `(Activer : PROSPECTION_SENDING_ENABLED=true)`,
      );
      return; // aucune écriture, aucun envoi
    }

    const prefsCache = new Map<string, any>();
    // Emails envoyés sur 24h glissantes, par user. `null` = lecture du plafond échouée —
    // revue post-commit f17af17, mineur : `.catch(() => 0)` traitait un plafond ILLISIBLE
    // comme "zéro envoi aujourd'hui", donc fail-OPEN (le contraire de la prudence attendue
    // partout ailleurs dans ce chantier) ; une lecture ratée refuse désormais d'envoyer,
    // au lieu de l'autoriser à tort.
    const sentCount = new Map<string, number | null>();
    // Dernier email RÉEL par user (écart minimum entre deux emails). `undefined` dans la Map
    // = pas encore lu ; lecture ratée = refus par prudence pour ce passage.
    const lastEmailAt = new Map<string, Date | null>();
    // Historique des TENTATIVES d'envoi LinkedIn (succès ET échecs) sur les 7 derniers
    // jours glissants, par user — alimente à la fois le plafond quotidien de montée en
    // charge ET le plafond hebdomadaire de `prospection-linkedin-guard.ts`. Compter les
    // tentatives et non les seuls succès est délibéré (revue post-commit 261835e, défaut
    // Critique 2) : LinkedIn voit une REQUÊTE qu'elle réussisse ou échoue. `null` = lecture
    // échouée (fail-closed, jamais traité comme "aucune tentative") ; mis à jour EN DIRECT
    // après chaque appel Unipile réel de ce tick, pour que le délai minimum et les
    // plafonds s'appliquent aussi entre deux leads du même passage du worker.
    const liHistoryCache = new Map<string, Date[] | null>();
    // Comptes LinkedIn dont la restriction vient d'être détectée PENDANT ce tick.
    // `prefsCache` fige le même objet `prefs` pour tous les leads d'un user sur toute la
    // durée du tick : persister la restriction en base (l.~400 plus bas) ne met PAS à
    // jour cet objet déjà en cache, donc les leads suivants du même user relisent un
    // `linkedinRestrictedAt` périmé (`null`) et la garde les autoriserait quand même.
    // Ce Set, consulté AVANT tout appel Unipile, est l'arrêt dur pour le reste du tick —
    // y compris si la persistance en base échoue (revue post-commit 261835e, défaut
    // Critique 1 : jusqu'à 99 tentatives supplémentaires observées dans une même passe).
    const restrictedThisTick = new Set<string>();
    // Qui envoie pour chaque campagne (mode agence : périmètre utilisatrice ou client),
    // résolu UNE fois par campagne et par passage.
    const identites = new Map<string, ReturnType<typeof identiteCampagne>>();
    const identiteDe = (uid: string, campaignId: number, prefs: any) => {
      const cle = `${uid}:${campaignId}`;
      if (!identites.has(cle)) identites.set(cle, identiteCampagne(uid, campaignId, prefs));
      return identites.get(cle)!;
    };
    const getPrefs = async (uid: string) => {
      if (!prefsCache.has(uid)) prefsCache.set(uid, await storage.getUserPreferences(uid));
      return prefsCache.get(uid);
    };

    // Garde de risque LinkedIn d'un compte : MÊME chemin pour l'envoi d'une étape et pour
    // la vérification de relation (public de campagne) — même cache d'historique, même
    // `cleCompte`, même délai minimum. Lecture d'historique échouée = `null` (fail-closed).
    const evaluerGardeLinkedIn = async (a: {
      userId: string; portee: string | number | null; cleCompte: string; identite: any; now: Date; timezone: string;
    }) => {
      if (!liHistoryCache.has(a.cleCompte)) {
        const since = new Date(a.now.getTime() - LINKEDIN_WEEKLY_WINDOW_MS);
        const ts = await storage.getLinkedInAttemptTimestampsSince(a.userId, since, a.portee as any).catch(() => null);
        liHistoryCache.set(a.cleCompte, ts);
      }
      const historique = liHistoryCache.get(a.cleCompte);
      const derniereTentative = historique && historique.length
        ? new Date(Math.max(...historique.map((d) => new Date(d).getTime())))
        : null;
      return decideLinkedInAction({
        now: a.now,
        timezone: a.timezone,
        workDayStartMin: LINKEDIN_FENETRE.startMin,
        workDayEndMin: LINKEDIN_FENETRE.endMin,
        workDays: LINKEDIN_FENETRE.workDays,
        accountConnectedAt: a.identite.linkedin?.connectedAt ?? null,
        recentSendTimestamps: liHistoryCache.get(a.cleCompte)!,
        restriction: a.identite.linkedin?.restriction ?? null,
        minDelayMs: derniereTentative ? linkedinGapMs(derniereTentative, a.cleCompte) : 0,
      });
    };
    // Signal de restriction : arrêt dur immédiat pour ce compte, pour le reste du tick, puis
    // persistance de la pause (là où vit le compte : chez l'utilisatrice, ou chez le client).
    const traiterRestriction = async (userId: string, portee: string | number | null, cleCompte: string, error: string | null | undefined) => {
      restrictedThisTick.add(cleCompte);
      try {
        await persisterRestrictionLinkedIn(userId, portee as number | null, error);
        console.error(
          `[ProspectionSender] compte LinkedIn de l'utilisateur ${userId} mis EN PAUSE (signal de restriction Unipile) — reprise manuelle requise.`,
        );
      } catch (e: any) {
        console.error(
          `[ProspectionSender] ÉCHEC DE PERSISTANCE de la restriction LinkedIn (user ${userId}) — l'arrêt en mémoire reste actif pour ce passage, nouvelle tentative de persistance dès le prochain lead concerné : ${String(e?.message ?? e)}`,
        );
      }
    };

    // ── Fenêtre locale de la cible + sessions de prospection (ce lot) ──────────────
    //
    // Revues post-commit b97a0b6 puis d95c42a, défauts Importants successifs, même
    // cause : un jour civil calculé dans le MAUVAIS fuseau pour l'usage qu'on en fait.
    // D'abord `parisTodayString`, fixe, servait de date à la fois pour l'utilisatrice
    // ET pour la cible ; puis, une fois corrigé pour l'utilisatrice (son fuseau à
    // elle), cette MÊME date continuait de servir pour la cible — deux fuseaux qui
    // n'ont aucune raison de coïncider. Il y a donc désormais DEUX dates civiles
    // distinctes, calculées chacune PAR LEAD, au point d'appel dans la boucle (voir
    // plus bas) — jamais ici, en tête de passage, puisqu'elles dépendent de données
    // (prefs de l'utilisatrice, pays/ville du lead) qui varient par lead :
    // `todayUserDateStr` (fuseau de l'utilisatrice, repli `DEFAULT_USER_TIMEZONE`) pour
    // les sessions ; `targetDateStr` (fuseau de la cible) pour `isTargetReachableAt`.
    //
    // Cache des leads par utilisateur : `storage.getLeads` était appelé À CHAQUE LEAD
    // sans mise en cache (une fois par lead dû, pas une fois par utilisateur) — la
    // Map ci-dessous sert à la fois à réduire ce coût et à construire, pour un
    // utilisateur donné, la liste des pays des leads dus (poids de session par VOLUME
    // de cibles, jamais par pays présent — voir `prospection-sessions.ts`).
    // Réception des réponses en ligne ? Lue UNE fois par passage. Hors ligne : aucun envoi
    // automatique par Unipile (Gmail attend, LinkedIn passe par le brouillon manuel).
    const receptionActive = receptionReponsesEnLigne();
    const gmailEnAttenteSignale = new Set<string>(); // un seul log par utilisatrice et par passage
    const leadsCache = new Map<string, Promise<any[]>>();
    const getUserLeads = (uid: string): Promise<any[]> => {
      if (!leadsCache.has(uid)) leadsCache.set(uid, storage.getLeads(uid));
      return leadsCache.get(uid)!;
    };
    for (const state of due) {
      try {
        const prefs = await getPrefs(state.userId);
        const now = new Date();

        const steps = await storage.getSequenceSteps(state.campaignId);
        const engineSteps = steps.map((s) => ({ delayDays: s.delayDays, condition: (s as any).condition || "always" }));

        // Signaux du prospect → règles de stop globales AVANT toute décision/génération.
        const signals = await storage.getLeadSignals(state.leadId);
        if (signals.bounced) {
          await storage.updateLeadSequenceState(state.leadId, { status: "bounced", nextRunAt: null });
          continue;
        }
        if (signals.replied) {
          await storage.updateLeadSequenceState(state.leadId, { status: "stopped_replied", nextRunAt: null });
          await Promise.resolve().then(() => storage.markFeedbackReplied(state.userId, state.leadId)).catch(() => {});
          continue;
        }

        // Le délai d'une étape court depuis l'ancre : fin de l'attente d'acceptation expirée,
        // sinon dernier ENVOI réel (jamais depuis un skip simple).
        let anchorAt = new Date(
          state.delayAnchorAt ?? state.lastStepSentAt ?? state.enrolledAt ?? Date.now(),
        );

        // Rattrapage : quand une campagne est relancée, `enrollLead` remet currentStep
        // à 0 et toutes les étapes déjà envoyées seraient reparcourues une par une,
        // espacées du délai complet de chaque étape — et chacune coûterait quand même
        // une génération de message par IA. Chargé UNE SEULE fois avant la boucle de
        // décision ; `.catch(() => [])` pour qu'une lecture qui échoue ne fasse pas
        // tomber le prospect (la réservation en aval de sendOnce joue alors son rôle
        // de filet de sécurité).
        const reservedOrders = new Set(await storage.getReservedStepOrders(state.leadId, state.campaignId).catch(() => []));

        // Sélection conditionnelle : sauter les étapes dont la condition est fausse
        // (un skip avance currentStep mais ne consomme PAS de délai), dépasser celles
        // déjà réservées (déjà parties, donc sans envoi ni génération IA), attendre,
        // terminer ou envoyer.
        let decision = decideNextStep(state.currentStep, engineSteps, signals, { anchorAt, now });
        while (
          decision.action === "skip" ||
          (decision.action === "send" && reservedOrders.has(decision.index + 1))
        ) {
          if (decision.action === "send") {
            console.log(`[ProspectionSender] étape ${decision.index + 1} déjà réservée pour le lead ${state.leadId} — rattrapage sans envoi ni génération IA`);
          }
          const newAnchorAt = decision.action === "skip" ? decision.newAnchorAt : undefined;
          await storage.updateLeadSequenceState(
            state.leadId,
            { currentStep: decision.index + 1, ...(newAnchorAt ? { delayAnchorAt: newAnchorAt } : {}) },
          );
          state.currentStep = decision.index + 1;
          if (newAnchorAt) anchorAt = newAnchorAt;
          decision = decideNextStep(state.currentStep, engineSteps, signals, { anchorAt, now });
        }
        if (decision.action === "done") {
          await storage.updateLeadSequenceState(state.leadId, { status: "completed", nextRunAt: null });
          continue;
        }
        if (decision.action === "wait") {
          // Pas encore dû : on cale nextRunAt sur l'instant prêt (sans réécrire à chaque tick).
          const until = decision.until;
          if (until && (!state.nextRunAt || new Date(state.nextRunAt).getTime() !== until.getTime())) {
            await storage.updateLeadSequenceState(state.leadId, { nextRunAt: until });
          }
          continue;
        }

        const step = steps[decision.index];

        // Fenêtre d'envoi, selon le canal de l'étape (connu seulement ici) : email → heures
        // ouvrées de l'utilisatrice ; LinkedIn → fenêtre fixe 8 h-18 h en semaine
        // (`LINKEDIN_FENETRE`), dans le fuseau de l'utilisatrice, sans tenir compte de ses
        // horaires de travail.
        const userTz = prefs?.timezone || DEFAULT_USER_TIMEZONE;
        const { nowMin, dayAbbr } = localNow(userTz);
        const inWindow = step.channel === "linkedin"
          ? withinSendingWindow(nowMin, dayAbbr, LINKEDIN_FENETRE)
          : withinSendingWindow(nowMin, dayAbbr, {
              startMin: hhmmToMin(prefs?.workDayStart, 9 * 60),
              endMin: hhmmToMin(prefs?.workDayEnd, 18 * 60),
              workDays: new Set<string>((prefs?.workDays || "mon,tue,wed,thu,fri").split(",").map((d: string) => d.trim().toLowerCase())),
            });
        if (!inWindow) continue; // hors fenêtre → on réessaiera (nextRunAt inchangé)

        const lead = (await getUserLeads(state.userId)).find((l) => l.id === state.leadId);
        if (!lead) {
          await storage.updateLeadSequenceState(state.leadId, { status: "failed", nextRunAt: null });
          continue;
        }
        // La validation vaut aussi après l'entrée en séquence : retirée, effacée par une nouvelle
        // rédaction, ou prospect passé en « Sans suite », rien ne part. Vérifié ici pour ne rien
        // payer en rédaction IA.
        const retenue = raisonDeRetenue(lead);
        if (retenue) {
          await retenir(lead, step.id, retenue);
          continue;
        }
        // Étape email pour un prospect sans adresse connue : elle est SAUTÉE (comme une
        // condition fausse, sans consommer de délai), la séquence continue sur LinkedIn.
        // Auparavant toute la séquence passait en échec.
        if (step.channel === "email" && !lead.email) {
          await storage.updateLeadSequenceState(state.leadId, { currentStep: decision.index + 1 });
          continue;
        }

        // Clé de réservation : le RANG de l'étape, stable à travers les rééditions
        // de séquence (replaceSequenceSteps recrée les lignes et change leurs ids).
        const sendKey: StepSendKey = {
          leadId: lead.id,
          campaignId: state.campaignId,
          stepOrder: decision.index + 1,
          userId: state.userId,
          channel: step.channel === "email" ? "email" : "linkedin",
        };

        // Capturés ICI (pas dans la branche LinkedIn plus bas) : la pré-vérification de
        // la garde de risque doit avoir lieu AVANT le coût DB (brandDna/user/campagne) et
        // IA (generateStepMessage) — sur un compte restreint avec de nombreux leads dus,
        // l'ancien code payait cette génération à chaque minute pour un message qui ne
        // partirait jamais (revue post-commit 261835e, dernier point mineur).
        // Périmètre de la campagne : un projet client n'envoie qu'avec SES connexions et SA
        // signature ; sans signature, rien ne se rédige (jamais celle de l'utilisatrice).
        const { portee, identite } = await identiteDe(state.userId, state.campaignId, prefs);
        if (portee != null && !identite.signature) {
          console.log(`[ProspectionSender] campagne ${state.campaignId} (projet client ${portee}) sans signature configurée — étape EN ATTENTE (rien rédigé ni envoyé)`);
          continue;
        }
        // Le budget, la montée en charge et la restriction LinkedIn sont ceux DU COMPTE.
        const cleCompte = `${state.userId}|${portee ?? "utilisatrice"}`;
        // Compte LinkedIn déconnecté (webhook de statut Unipile) : traité comme non relié —
        // aucune requête LinkedIn, l'étape passe par le brouillon manuel. L'identifiant reste
        // en place pour que la réception continue de rattacher les réponses.
        const linkedinDeconnecte = !!identite.linkedin?.deconnecte;
        // Réception des réponses hors ligne : même traitement (ni vérification ni envoi
        // Unipile, brouillon manuel) — jamais d'envoi automatique qu'aucune réponse n'arrêterait.
        const liAccountId = linkedinDeconnecte || !receptionActive ? undefined : identite.linkedin?.accountId;
        // ── Public de la campagne (à froid / relations) ───────────────────────────────
        // Avant toute génération ou envoi, une seule fois par prospect (`relationVerifieeAt`),
        // à l'entrée de la séquence : une campagne à froid ne contacte JAMAIS une relation
        // LinkedIn existante ; une campagne « relations » ne s'adresse qu'à elles. Même garde
        // de risque que l'envoi (la vérification est une requête LinkedIn comptée). Sans
        // compte relié ni URL, aucune vérification : la séquence continue. Une erreur de
        // vérification n'exclut JAMAIS (5xx/réseau : réessai ; erreur permanente : non vérifiable, la séquence continue ;
        // compte restreint : non vérifiable, l'étape suit sa propre garde).
        if (
          state.currentStep === 0 &&
          !(lead as any).relationVerifieeAt &&
          linkedinConfigured() &&
          liAccountId &&
          lead.linkedinUrl
        ) {
          const accountId = liAccountId;
          const urlRelation = lead.linkedinUrl;
          // Compte restreint : prospect NON vérifiable pour l'instant (ni vérifié, ni exclu) ;
          // l'étape suit son cours (un email part, une étape LinkedIn est arrêtée par sa
          // propre garde). Refus transitoire (fenêtre, écart, plafonds) : on attend.
          let verifiable = !restrictedThisTick.has(cleCompte);
          if (verifiable) {
            const garde = await evaluerGardeLinkedIn({ userId: state.userId, portee, cleCompte, identite, now, timezone: userTz });
            if (!garde.allowed) {
              if (garde.reason === "restricted") {
                verifiable = false;
              } else {
                console.log(
                  `[ProspectionSender] vérification de relation lead ${lead.id} refusée par la garde de risque (${garde.reason}) : ${garde.detail}`,
                );
                continue;
              }
            }
          }
          if (verifiable) {
          const verif = await checkConnection(accountId, urlRelation);
          try {
            await storage.recordLinkedInSendAttempt(state.userId, lead.id, verif.ok, verif.ok ? null : "verif_relation", portee);
          } catch (e: any) {
            console.error(`[ProspectionSender] échec d'enregistrement de la vérification de relation (lead ${lead.id}) : ${String(e?.message ?? e)}`);
          }
          const hist = liHistoryCache.get(cleCompte);
          if (hist) hist.push(new Date());
          if (!verif.ok) {
            console.error(`[ProspectionSender] vérification de relation lead ${lead.id} en erreur (${verif.error}) — rien envoyé, réessai au prochain passage.`);
            if (isLinkedInRestrictionSignal(verif.error)) {
              await traiterRestriction(state.userId, portee, cleCompte, verif.error);
              continue;
            }
            // Erreur PERMANENTE (profil sans identifiant public, 4xx hors restriction) : non
            // vérifiable, jamais exclu ; marqué vérifié pour ne pas boucler, la séquence continue.
            if (verif.error === "no_public_id" || /^resolve_4\d\d$/.test(verif.error ?? "")) {
              await storage.markRelationVerifiee(lead.id, false, false);
              (lead as any).relationVerifieeAt = now;
            } else {
              continue; // 5xx / réseau : réessai au prochain passage
            }
          } else {
          const campagnePublic = await storage.getProspectionCampaign(state.campaignId);
          const audience = normaliserPublic((campagnePublic as any)?.audience);
          if (decisionPublic(audience, verif.connected) === "exclure") {
            await storage.excludeLeadFromCampaign(lead.id, RAISON_EXCLUSION[audience]);
            console.log(`[ProspectionSender] lead ${lead.id} retiré de la campagne ${state.campaignId} (${RAISON_EXCLUSION[audience]}).`);
            continue;
          }
          await storage.markRelationVerifiee(lead.id, verif.connected, audience === "relations");
          (lead as any).relationVerifieeAt = now; // le cache de leads du tick ne revérifie pas
          }
          }
        }
        // Capturé après la garde : le narrowing `lead.linkedinUrl` ne survit pas à la
        // fermeture `async` de `sendOnce` plus bas (TS le retypera en nullable).
        const linkedinUrl = lead.linkedinUrl;
        const willAttemptRealLinkedInSend =
          step.channel === "linkedin" && linkedinConfigured() && !!liAccountId && !!linkedinUrl;

        if (willAttemptRealLinkedInSend) {
          if (restrictedThisTick.has(cleCompte)) {
            console.log(
              `[ProspectionSender] LinkedIn lead ${lead.id} — compte de l'utilisateur ${state.userId} restreint plus tôt dans ce passage : refus immédiat, aucun coût DB/IA, aucun appel Unipile.`,
            );
            // Repousse nextRunAt : voir LINKEDIN_RESTRICTED_RETRY_BACKOFF_MS. `.catch` :
            // une écriture ratée ici n'a qu'un coût de performance (le lead sera relu au
            // prochain tick), jamais un risque LinkedIn — ne fait pas tomber le prospect.
            await storage.updateLeadSequenceState(state.leadId, {
              nextRunAt: new Date(now.getTime() + LINKEDIN_RESTRICTED_RETRY_BACKOFF_MS),
            } as any).catch(() => {});
            continue;
          }

          // ── Fenêtre locale de LA CIBLE (pas celle de l'utilisatrice, déjà vérifiée
          // plus haut) — pure, aucun coût DB/IA. Évaluée AVANT toute lecture évitable
          // (historique LinkedIn, brandDna/user/campagne) et avant `decideLinkedInAction`,
          // que cette vérification ne remplace ni n'assouplit : elle ne peut que
          // restreindre davantage.
          //
          // DEUX jours civils DISTINCTS, chacun dans SON PROPRE fuseau — même bug que
          // celui corrigé pour l'utilisatrice (revue post-commit b97a0b6), reproduit à
          // l'autre bout (revue post-commit d95c42a, défaut Important) : `todayUserDateStr`
          // (fuseau de l'UTILISATRICE) sert de `dateStr` aux sessions (`sessionsDe` plus
          // bas) ; `targetDateStr` (fuseau de LA CIBLE) sert de `dateStr` à
          // `isTargetReachableAt`. Les deux n'ont AUCUNE raison de coïncider — une
          // utilisatrice à Kiritimati (UTC+14) visant une cible française voit son propre
          // jour civil basculer ~14h avant celui de la cible ; leur confondre a fait
          // disparaître silencieusement des fenêtres pourtant valides côté cible pour
          // exactement le public que ce chantier vise à activer (voir le test dédié et
          // task-6-report.md pour la reproduction chiffrée).
          //
          // Choix délibéré : la date de la cible est dérivée ICI, côté appelant, plutôt
          // que dans `targetWindowUTC`/`isTargetReachableAt` (fichier validé, hors
          // périmètre) — via `targetDateStrFor`, qui réutilise la MÊME résolution de
          // fuseau (`zoneForCity`/`zonesForCountry`, fonctions déjà exportées) que
          // celle employée en interne par ces fonctions pour construire la fenêtre. On
          // ne duplique QUE ce choix de fuseau représentatif, jamais le calcul de la
          // fenêtre elle-même (toujours entièrement délégué à `isTargetReachableAt`) —
          // et cette MÊME fonction `targetDateStrFor` est réutilisée telle quelle par
          // `sessionsDe` (voir plus haut) pour que les DEUX endroits qui ont besoin du
          // jour civil d'une cible s'accordent sur une seule et même résolution.
          const todayUserDateStr = todayStringIn(prefs?.timezone || DEFAULT_USER_TIMEZONE, now);
          const pays = leadCountryCode(lead);
          const ville = leadCity(lead);
          const targetDateStr = targetDateStrFor(pays, ville, now, todayUserDateStr);
          const joignable = isTargetReachableAt(pays, ville, now, targetDateStr);
          if (!joignable.reachable) {
            // DISTINCTION ESSENTIELLE (voir doc de `setLeadUnreachable` et
            // `prospection-target-hours.ts`) : `country_unknown`/`no_common_window`
            // sont STRUCTURELS (ce lead ne sera jamais joignable en l'état, à signaler) ;
            // `not_a_workday`/`outside_window` sont TEMPORELS (vrais la majeure partie du
            // temps, ne disent rien sur le lead) — les inscrire écraserait la base à
            // chaque tick et transformerait « pas maintenant » en « jamais ». Le log est
            // réservé aux refus STRUCTURELS (revue post-commit b97a0b6, mineur) : un refus
            // temporel est le cas normal (un lead dû le reste tant qu'on n'est pas dans sa
            // fenêtre) et se reproduit à chaque minute pour chaque lead — le journaliser
            // produirait de l'ordre de 20 000 lignes/jour sur une liste réelle, sans rien
            // apprendre de nouveau.
            if (joignable.reason === "country_unknown" || joignable.reason === "no_common_window") {
              console.log(
                `[ProspectionSender] LinkedIn lead ${lead.id} refusé : cible non joignable (${joignable.reason}) : ${joignable.detail}`,
              );
              await storage.setLeadUnreachable(lead.id, `${joignable.reason}: ${joignable.detail}`)
                .catch((e: any) => console.error("[ProspectionSender] signalement non joignable échoué", e.message));
            }
            continue; // temporel ou structurel : pas d'envoi maintenant, jamais de coût DB/IA au-delà
          }
          // Redevenu joignable (ex. pays enrichi depuis) : efface la raison — une seule
          // fois, seulement s'il en portait une (jamais d'écriture à chaque tick).
          if ((lead as any).outreachUnreachableReason) {
            await storage.setLeadUnreachable(lead.id, null)
              .catch((e: any) => console.error("[ProspectionSender] effacement non joignable échoué", e.message));
          }

          const guardDecision = await evaluerGardeLinkedIn({
            userId: state.userId, portee, cleCompte, identite, now, timezone: userTz,
          });
          if (!guardDecision.allowed) {
            console.log(
              `[ProspectionSender] LinkedIn lead ${lead.id} refusé par la garde de risque (${guardDecision.reason}) : ${guardDecision.detail} — avant tout coût DB/IA.`,
            );
            if (guardDecision.reason === "restricted") {
              // Contrairement aux autres refus (fenêtre, délai minimum, plafonds — qui se
              // résolvent seuls en quelques minutes/heures), une restriction ne se lève que
              // manuellement : voir LINKEDIN_RESTRICTED_RETRY_BACKOFF_MS.
              await storage.updateLeadSequenceState(state.leadId, {
                nextRunAt: new Date(now.getTime() + LINKEDIN_RESTRICTED_RETRY_BACKOFF_MS),
              } as any).catch(() => {});
            }
            continue; // retry plus tard (nextRunAt inchangé pour les autres motifs)
          }
        }

        // Email : expéditeur, plafond du jour et écart minimum vérifiés AVANT la génération
        // IA — un email qui ne peut pas partir maintenant ne coûte rien.
        let sender: SenderConfig | null = null;
        let lienDesinsc: string | null = null;
        if (step.channel === "email") {
          // Gmail déconnecté : l'étape attend la reconnexion. Jamais de repli silencieux sur
          // SendGrid, qui enverrait depuis une autre adresse que celle du fil.
          if (identite.email?.deconnecte) {
            console.log(`[ProspectionSender] Gmail déconnecté (user ${state.userId}${portee != null ? `, projet ${portee}` : ""}) — étape email EN ATTENTE pour le lead ${lead.id}`);
            continue;
          }
          // Config expéditeur PROPRE à l'utilisateur (adresse + clé). Jamais l'adresse de l'app.
          sender = resolveSenderConfig(identite);
          if (!sender) {
            console.log(`[ProspectionSender] user ${state.userId} sans adresse expéditrice configurée — étape EN ATTENTE (rien envoyé)`);
            continue; // on n'avance pas : l'utilisateur doit configurer son email d'envoi
          }
          if (sender.via === "unipile" && !receptionActive) {
            if (!gmailEnAttenteSignale.has(state.userId)) {
              gmailEnAttenteSignale.add(state.userId);
              console.warn(`[ProspectionSender] réception des réponses hors ligne (UNIPILE_WEBHOOK_SECRET / APP_URL https) — étapes Gmail EN ATTENTE pour l'utilisateur ${state.userId}`);
            }
            continue;
          }
          if (sender.via === "unipile") {
            // Jamais d'email Gmail sans lien de désinscription (APP_URL / secret manquant → on n'envoie pas).
            lienDesinsc = lienDesinscription(lead.id);
            if (!lienDesinsc) {
              console.error(`[ProspectionSender] APP_URL ou UNSUBSCRIBE_SECRET/SESSION_SECRET manquant — envoi Gmail suspendu pour le lead ${lead.id} (jamais d'email sans lien de désinscription)`);
              continue;
            }
          }
          if (sender.via === "unipile") {
            // Pas de suppression globale côté Gmail (SendGrid en avait une) : on applique ici celle
            // de Naya — désinscription du lead OU d'un autre lead de même adresse. Échec de lecture
            // → on n'envoie rien (jamais écrire à quelqu'un qui s'est peut-être désinscrit).
            let desinscrit: boolean;
            try {
              desinscrit = await storage.isLeadUnsubscribed(lead.id, state.userId);
            } catch (e: any) {
              console.error(`[ProspectionSender] lecture des désinscriptions impossible (lead ${lead.id}) — rien envoyé : ${String(e?.message ?? e)}`);
              continue;
            }
            if (desinscrit) {
              await storage.updateLeadSequenceState(state.leadId, { status: "unsubscribed", nextRunAt: null } as any).catch(() => {});
              continue;
            }
          }
          // Plafond d'envoi / jour (24h glissantes) pour préserver la délivrabilité — emails seulement.
          if (!sentCount.has(state.userId)) {
            const count = await storage.countOutreachSentSince(state.userId, new Date(Date.now() - 86400000), "email").catch(() => null);
            sentCount.set(state.userId, count);
          }
          const currentSentCount = sentCount.get(state.userId);
          if (currentSentCount === null || currentSentCount === undefined) {
            console.log(`[ProspectionSender] plafond email illisible pour l'utilisateur ${state.userId} — refus par prudence (jamais traité comme 0 envoi).`);
            continue; // lecture ratée : refus par prudence, jamais "0 envoi aujourd'hui"
          }
          if (currentSentCount >= DAILY_CAP) {
            continue; // plafond atteint → on réessaiera plus tard (nextRunAt inchangé)
          }
          if (!lastEmailAt.has(state.userId)) {
            const last = await storage.getLastOutreachSentAt(state.userId, "email").catch(() => undefined);
            if (last === undefined) {
              console.log(`[ProspectionSender] dernier envoi email illisible pour l'utilisateur ${state.userId} — refus par prudence.`);
              continue;
            }
            lastEmailAt.set(state.userId, last);
          }
          if (!emailGapElapsed(lastEmailAt.get(state.userId) ?? null, now)) {
            continue; // trop tôt après le dernier email → on réessaiera au prochain passage
          }
        }

        // Texte SUR-MESURE au dernier moment. useCache:true → réutilise EXACTEMENT le message
        // déjà généré/mis en cache par l'aperçu (parité aperçu ↔ envoi). generateStepMessage
        // LÈVE une exception si le corps est vide : le lead reste alors non avancé (retry via le
        // try/catch par lead). On ne fabrique JAMAIS de corps vide ici.
        const dna = await storage.getBrandDna(state.userId);
        const user = await storage.getUser(state.userId);
        const founderName = identite.signature ?? resolveFounderName(user, dna as any);
        const campaign = await storage.getProspectionCampaign(state.campaignId);
        const instructions = combineInstructions((prefs as any)?.messageInstructions, (campaign as any)?.messageInstructions);
        let gen;
        try {
          gen = await generateStepMessage(state.userId, {
            lead,
            campaign: { ...campaign, founderName },
            step: stepForMessage(step),
            steps: steps.map(stepForMessage),
            senderLastName: (user as any)?.lastName ?? null,
            useCache: true, instructions,
          });
        } catch (e: any) {
          if (!(e instanceof BriefIncompletError)) throw e;
          // Pas de déclencheur réel pour ce prospect : rien n'est rédigé ni envoyé. L'étape
          // reste en attente ; on réessaie plus tard (une note ajoutée sur la fiche suffit).
          console.warn(`[prospection] brief incomplet — lead ${lead.id}, étape ${step.id} : rien envoyé, nouvel essai dans ${TROP_PROCHE_RETRY_BACKOFF_MS / 60_000} min`);
          await storage.updateLeadSequenceState(state.leadId, { nextRunAt: new Date(now.getTime() + TROP_PROCHE_RETRY_BACKOFF_MS) } as any).catch(() => {});
          continue;
        }
        if (gen.redige && !state.lastStepSentAt) {
          // Premier contact : ce qui part est ce qui a été relu. Séquence modifiée, brief changé,
          // cache vidé : ce texte vient d'être écrit, la validation précédente ne vaut pas pour
          // lui. Il prend sa place dans la fiche pour que Jeanne valide bien ce qui partira.
          const champ = step.channel === "email" ? "emailMessage" : "linkedinMessage";
          await storage.updateLead(lead.id, state.userId, { validatedAt: null, [champ]: gen.body } as any)
            .catch((e: any) => console.error("[ProspectionSender] retrait de la validation échoué", e.message));
          await retenir(lead, step.id, RAISON_VALIDATION_MANQUANTE);
          continue;
        }
        if (gen.aRevoir) {
          // Le contrôle qualité a encore trouvé des défauts après réécriture : ce message ne
          // part pas tant que l'utilisatrice ne l'a pas corrigé (une édition lève le blocage).
          // Jamais le contenu du message dans les logs.
          console.warn(`[prospection] message à revoir — lead ${lead.id}, étape ${step.id} : rien envoyé (${(gen.defauts || []).map((d) => d.code).join(", ")}), nouvel essai dans ${TROP_PROCHE_RETRY_BACKOFF_MS / 60_000} min`);
          await storage.updateLeadSequenceState(state.leadId, { nextRunAt: new Date(now.getTime() + TROP_PROCHE_RETRY_BACKOFF_MS) } as any).catch(() => {});
          continue;
        }
        const garde = lireGarde(lead);
        if (gen.tropProche) {
          // Message trop proche d'un message déjà rédigé/envoyé à ce prospect (même après une
          // régénération) : on n'envoie RIEN, l'étape reste en attente (currentStep inchangé).
          // Compteur de blocages CONSÉCUTIFS par prospect (même logique que
          // linkedinConsecutiveFailures) : après MAX_TROP_PROCHE_CONSECUTIFS, le moteur renonce
          // (séquence en pause, raison visible dans l'aperçu) au lieu de réessayer sans fin
          // en silence. Jamais le contenu du message dans les logs.
          const suite = nextTropProcheState(garde?.tropProcheConsecutifs ?? 0, now, TROP_PROCHE_RETRY_BACKOFF_MS);
          await storage.setLeadSequenceGuard(lead.id, {
            tropProcheConsecutifs: suite.consecutifs,
            stepId: step.id,
            attention: suite.abandon ? RAISON_TROP_PROCHE : null,
          }).catch((e: any) => console.error("[ProspectionSender] écriture garde trop proche échouée", e.message));
          if (suite.abandon) {
            console.warn(
              `[prospection] message trop proche d'un message antérieur — lead ${lead.id}, étape ${step.id} : ${suite.consecutifs} blocages consécutifs (max ${MAX_TROP_PROCHE_CONSECUTIFS}), séquence mise en pause, à rédiger à la main`,
            );
            await storage.updateLeadSequenceState(state.leadId, { status: "paused", nextRunAt: null } as any)
              .catch((e: any) => console.error("[ProspectionSender] mise en pause échouée", e.message));
          } else {
            console.warn(
              `[prospection] message trop proche d'un message antérieur — lead ${lead.id}, étape ${step.id} : non envoyé (blocage ${suite.consecutifs}/${MAX_TROP_PROCHE_CONSECUTIFS}), nouvel essai dans ${TROP_PROCHE_RETRY_BACKOFF_MS / 60_000} min`,
            );
            await storage.updateLeadSequenceState(state.leadId, { nextRunAt: suite.nextRunAt } as any).catch(() => {});
          }
          continue;
        }
        const subject = gen.subject || "";
        const body = gen.body;

        // La rédaction IA prend du temps : une réponse (webhook) a pu arrêter ce prospect
        // entre-temps. On relit son état JUSTE avant d'envoyer ou de créer un brouillon —
        // un prospect qui a répondu ne reçoit plus rien (anti-objectif n° 1). Lecture ratée :
        // rien ne part, on réessaie au prochain passage.
        let etatFrais;
        try {
          etatFrais = await storage.getLeadSequenceState(state.leadId);
        } catch (e: any) {
          console.error(`[ProspectionSender] état du lead ${state.leadId} illisible avant envoi — rien envoyé : ${String(e?.message ?? e)}`);
          continue;
        }
        if (!etatFrais || etatFrais.status !== "active") {
          console.log(`[ProspectionSender] lead ${state.leadId} n'est plus actif (${etatFrais?.status ?? "absent"}) — rien envoyé`);
          continue;
        }
        // « Ne plus contacter » (désinscrit puis supprimé, puis réimporté) : tous canaux, juste
        // avant l'envoi. Lecture ratée : rien ne part (jamais écrire à quelqu'un peut-être désinscrit).
        let bloque: boolean;
        try {
          bloque = await storage.estProspectBloque(state.userId, lead);
        } catch (e: any) {
          console.error(`[ProspectionSender] liste « ne plus contacter » illisible (lead ${state.leadId}) — rien envoyé : ${String(e?.message ?? e)}`);
          continue;
        }
        if (bloque) {
          console.warn(`[ProspectionSender] lead ${state.leadId} : personne sur la liste « ne plus contacter » — séquence arrêtée, rien envoyé`);
          await storage.updateLeadSequenceState(state.leadId, { status: "unsubscribed", nextRunAt: null } as any).catch(() => {});
          continue;
        }
        // Même raison que l'état ci-dessus : « Retirer la validation » ou « Sans suite » a pu être
        // cliqué pendant la rédaction, et le prospect lu en début de passage ne le sait pas. Lecture ratée :
        // rien ne part, on réessaie au prochain passage.
        let prospectFrais;
        try {
          prospectFrais = await storage.getLead(state.leadId, state.userId);
        } catch (e: any) {
          console.error(`[ProspectionSender] validation du lead ${state.leadId} illisible avant envoi — rien envoyé : ${String(e?.message ?? e)}`);
          continue;
        }
        const retenueFraiche = raisonDeRetenue({ stage: prospectFrais?.stage, validatedAt: prospectFrais?.validatedAt });
        if (retenueFraiche) {
          await retenir(lead, step.id, retenueFraiche);
          continue;
        }
        // Même personne sur une AUTRE fiche (même email, même identifiant ou profil LinkedIn)
        // qui a déjà répondu : rien ne part, ni envoi ni brouillon. La séquence est mise en
        // `paused` (pas `stopped_replied` : CE lead n'a pas répondu, rien à défaire si la
        // réponse est requalifiée — Jeanne relance à la main), avec la raison visible dans
        // l'aperçu. Lecture ratée : rien ne part, réessai au prochain passage.
        let doublonARepondu: boolean;
        try {
          doublonARepondu = await storage.memePersonneARepondu(state.leadId, state.userId);
        } catch (e: any) {
          console.error(`[ProspectionSender] doublons du lead ${state.leadId} illisibles avant envoi — rien envoyé : ${String(e?.message ?? e)}`);
          continue;
        }
        if (doublonARepondu) {
          console.warn(`[ProspectionSender] lead ${state.leadId} : la même personne a déjà répondu via une autre fiche — séquence en pause, rien envoyé`);
          await storage.setLeadSequenceGuard(lead.id, { tropProcheConsecutifs: garde?.tropProcheConsecutifs ?? 0, stepId: step.id, attention: RAISON_DOUBLON_A_REPONDU })
            .catch((e: any) => console.error("[ProspectionSender] écriture de la raison (doublon) échouée", e.message));
          await storage.updateLeadSequenceState(state.leadId, { status: "paused", nextRunAt: null } as any)
            .catch((e: any) => console.error("[ProspectionSender] mise en pause (doublon) échouée", e.message));
          continue;
        }

        // Repeuplé sur un envoi LinkedIn réussi (remet `linkedinConsecutiveFailures` à 0) ;
        // vide (aucun changement) pour l'email, un skip, ou un brouillon.
        let linkedinFailurePatch: Record<string, any> = {};
        // Un message est réellement parti : le suivi du prospect doit le dire.
        let contacte = false;

        if (step.channel === "email") {
          if (!lead.email) continue; // inatteignable (sauté plus haut) ; garde le narrowing de type
          if (!sender) continue; // vérifié plus haut ; garde le narrowing de type
          // Capturé après la garde : le narrowing `lead.email` ne survit pas à la
          // fermeture `async` de `sendOnce` ci-dessous (TS le retypera en nullable).
          const toEmail = lead.email;
          const emailSender = sender;
          // Le pied de mail signe : une signature finale déjà rédigée (textes antérieurs au
          // 2 nov. 2026, « … Jeanne, Test. ») est retirée. Le texte journalisé est celui envoyé.
          const bodyEmail = retirerSignatureFinale(body, founderName);
          // Réservation AVANT tout appel à SendGrid. Réservation refusée = l'étape est
          // déjà partie (ou son sort est inconnu) : on n'envoie rien et on laisse la
          // séquence avancer plus bas.
          const lienEmail = lienDesinsc;
          const outcome = await sendOnce(claimStore, sendKey, async () => {
            // Même chemin d'envoi que le mode test (envoyerEmailProspect) : HTML, pied de mail,
            // en-têtes de désinscription et suivi définis à un seul endroit.
            const envoi = await envoyerEmailProspect(emailSender, {
              to: toEmail, toName: lead.name || "", subject, body: bodyEmail,
              leadId: lead.id, stepOrder: decision.index + 1, lienDesinscription: lienEmail, userId: state.userId,
            });
            const ok = envoi.ok;
            const providerId = envoi.providerId;
            const threadId = envoi.threadId;
            if (!ok) return { ok: false };
            // À partir d'ici le message EST parti (SendGrid a répondu positivement) :
            // une exception d'écriture du journal n'est plus « dans le doute » — on SAIT
            // que l'envoi a eu lieu. On logge et on continue au lieu de laisser
            // l'exception se propager, pour que l'étape soit quand même marquée envoyée
            // et la séquence avancée ; seule la ligne de journal manque.
            try {
              const created = await storage.createOutreachMessage({
                userId: state.userId, leadId: lead.id, platform: "email",
                messageType: `step_${decision.index + 1}`, subject, body: bodyEmail, sentAt: new Date(),
              } as any);
              if (providerId || threadId) await storage.setOutreachProviderIds(created.id, providerId, threadId);
            } catch (e: any) {
              console.error(
                `[ProspectionSender] email PARTI mais NON journalisé (lead ${lead.id}, étape ${decision.index + 1}) : ${String(e?.message ?? e)}`,
              );
            }
            return { ok: true, status: "sent" as const };
          });
          if (outcome.action === "failed") {
            console.error(`[ProspectionSender] échec envoi lead ${lead.id} — retry au prochain tick`);
            continue; // on n'avance pas → retry
          }
          contacte = true;
          if (outcome.action === "skipped") {
            console.log(`[ProspectionSender] étape ${sendKey.stepOrder} déjà envoyée au lead ${lead.id} — avancement sans envoi`);
          } else {
            sentCount.set(state.userId, (sentCount.get(state.userId) || 0) + 1);
            lastEmailAt.set(state.userId, new Date());
          }
        } else {
          // LinkedIn : auto-envoi via Unipile depuis le compte de l'utilisateur, SI configuré.
          // La garde de risque (montée en charge, plafond hebdomadaire glissant, fenêtre
          // ouvrée, délai minimum, restriction) a déjà été évaluée plus haut — AVANT le
          // coût DB/IA — et a laissé passer ce lead (`willAttemptRealLinkedInSend`) ;
          // pas de second appel à `decideLinkedInAction` ici, pour ne pas retirer un
          // second tirage aléatoire de `minDelayMs` incohérent avec le premier.
          if (willAttemptRealLinkedInSend) {
            const outcome = await sendOnce(claimStore, sendKey, async () => {
              const result = await sendLinkedInStep({ accountId: liAccountId!, linkedinUrl: linkedinUrl!, text: body });
              const attemptAt = new Date();
              // Journal de TOUTE tentative (succès ou échec) — source de vérité des
              // plafonds de la garde (revue post-commit 261835e, défaut Critique 2 :
              // LinkedIn voit une requête qu'elle réussisse ou non). Écrit AVANT toute
              // autre logique pour ne perdre la trace de rien derrière.
              try {
                await storage.recordLinkedInSendAttempt(state.userId, lead.id, result.ok, result.ok ? null : (result.error ?? null), portee);
              } catch (e: any) {
                console.error(
                  `[ProspectionSender] échec d'enregistrement de la tentative LinkedIn (lead ${lead.id}) : ${String(e?.message ?? e)} — la garde risque de sous-compter ce compte pour ce tick.`,
                );
              }
              // Alimente le cache EN DIRECT, même si la persistance ci-dessus a échoué :
              // au moins CE tick reste correctement borné localement.
              const hist = liHistoryCache.get(cleCompte);
              if (hist) hist.push(attemptAt);

              if (!result.ok) {
                console.error(`[ProspectionSender] LinkedIn lead ${lead.id} — détail échec : ${result.error}`);
                if (isLinkedInRestrictionSignal(result.error)) {
                  // Signal d'authentification/restriction/challenge de sécurité : arrêt dur
                  // IMMÉDIAT pour ce compte, pour le reste de CE tick — indépendant du
                  // succès de la persistance ci-dessous (revue post-commit 261835e, défaut
                  // Critique 1).
                  await traiterRestriction(state.userId, portee, cleCompte, result.error);
                }
                return { ok: false };
              }
              // Le message EST parti (Unipile a répondu positivement) : une exception de
              // journalisation ne doit plus faire perdre la trace de l'envoi (cf. chemin
              // email). On logge et on continue ; seule la ligne de journal manque.
              try {
                await storage.createOutreachMessage({
                  userId: state.userId, leadId: lead.id, platform: "linkedin",
                  messageType: `step_${decision.index + 1}_${result.action}`, subject: null, body, sentAt: new Date(),
                } as any);
              } catch (e: any) {
                console.error(
                  `[ProspectionSender] LinkedIn PARTI mais NON journalisé (lead ${lead.id}, étape ${decision.index + 1}) : ${String(e?.message ?? e)}`,
                );
              }
              // Identifiant LinkedIn interne du prospect : c'est par lui que le webhook Unipile
              // rattache sa réponse ou son acceptation (spec §6.5).
              if (result.providerId && (lead as any).linkedinProviderId !== result.providerId) {
                try {
                  await storage.updateLead(lead.id, state.userId, { linkedinProviderId: result.providerId });
                } catch (e: any) {
                  console.error(`[ProspectionSender] linkedinProviderId non mémorisé (lead ${lead.id}) : ${String(e?.message ?? e)}`);
                }
              }
              return { ok: true, status: "sent" as const };
            });
            if (outcome.action === "failed") {
              console.error(`[ProspectionSender] LinkedIn lead ${lead.id} échec — retry au prochain tick`);
              // Recul exponentiel + abandon après N échecs consécutifs POUR CE LEAD (le
              // compte, lui, est protégé séparément par la garde) — revue post-commit
              // 261835e, défaut Critique 2 : l'ancien code laissait `nextRunAt` inchangé,
              // donc retentait sans borne à chaque tick.
              const backoff = nextLinkedInFailureState(state.linkedinConsecutiveFailures || 0, now);
              if (backoff.abandon) {
                console.error(
                  `[ProspectionSender] LinkedIn lead ${lead.id} — ${backoff.consecutiveFailures} échecs consécutifs : abandon de la séquence pour CE lead.`,
                );
                await storage.updateLeadSequenceState(state.leadId, {
                  status: "failed",
                  nextRunAt: null,
                  linkedinConsecutiveFailures: backoff.consecutiveFailures,
                } as any);
              } else {
                await storage.updateLeadSequenceState(state.leadId, {
                  linkedinConsecutiveFailures: backoff.consecutiveFailures,
                  nextRunAt: backoff.nextRunAt,
                } as any);
              }
              continue; // on n'avance pas → retry plus tard, borné (ou plus du tout si abandonné)
            }
            contacte = true;
            if (outcome.action === "skipped") {
              console.log(`[ProspectionSender] étape ${sendKey.stepOrder} déjà envoyée au lead ${lead.id} (LinkedIn) — avancement sans envoi`);
            } else {
              // Envoi réussi : remet à 0 le compteur d'échecs consécutifs de CE lead.
              linkedinFailurePatch = { linkedinConsecutiveFailures: 0 };
            }
          } else {
            // Non configuré (ou lead sans URL LinkedIn) → brouillon à envoyer manuellement.
            // Le brouillon réserve lui aussi : une étape ne produit qu'UNE seule sortie,
            // jamais trois brouillons identiques pour le même prospect.
            const outcome = await sendOnce(claimStore, sendKey, async () => {
              // Rien n'est parti ici (brouillon) : rejouer est totalement inoffensif.
              // Une exception à la création renvoie donc { ok: false } plutôt que de se
              // propager, pour que sendOnce libère la réservation et retente au tick
              // suivant — au lieu de perdre le brouillon en silence.
              try {
                await storage.createOutreachMessage({
                  userId: state.userId, leadId: lead.id, platform: "linkedin",
                  messageType: `step_${decision.index + 1}`, subject: null, body, sentAt: null,
                } as any);
              } catch (e: any) {
                console.error(`[ProspectionSender] échec création brouillon LinkedIn lead ${lead.id} — retry au prochain tick : ${String(e?.message ?? e)}`);
                return { ok: false };
              }
              return { ok: true, status: "draft" as const };
            });
            if (outcome.action === "failed") {
              console.error(`[ProspectionSender] brouillon LinkedIn lead ${lead.id} échec — retry au prochain tick`);
              continue; // on n'avance pas → retry
            }
            if (outcome.action === "skipped") {
              console.log(`[ProspectionSender] étape ${sendKey.stepOrder} déjà traitée pour le lead ${lead.id} — pas de nouveau brouillon`);
            } else {
              // Brouillon prêt : la séquence ATTEND que l'utilisatrice l'envoie (comme une
              // tâche manuelle chez lemlist). Avant, elle avançait comme si le message était
              // parti — et le délai de l'étape suivante courait depuis un envoi qui n'avait
              // jamais eu lieu. Le bouton « Envoyé » reprend la séquence à partir de ce moment-là.
              await storage.updateLeadSequenceState(state.leadId, { status: "awaiting_linkedin", nextRunAt: null } as any);
              if (garde) {
                await storage.setLeadSequenceGuard(lead.id, null)
                  .catch((e: any) => console.error("[ProspectionSender] remise à zéro garde trop proche échouée", e.message));
              }
              continue;
            }
          }
        }

        if (contacte) {
          await storage.marquerPremierContact(lead.id, state.userId)
            .catch((e: any) => console.error(`[ProspectionSender] suivi du lead ${lead.id} non mis à jour`, e.message));
        }
        // Étape envoyée : programmer la suite via la décision (le délai de l'étape suivante
        // court à partir de maintenant, ce dernier envoi étant la nouvelle référence).
        await storage.updateLeadSequenceState(state.leadId, {
          ...planAfterStep(decision.index, engineSteps, signals, new Date()),
          ...linkedinFailurePatch,
        });
        // Étape traitée (envoyée, brouillon ou déjà partie) : remet à zéro la garde « trop proche ».
        if (garde) {
          await storage.setLeadSequenceGuard(lead.id, null)
            .catch((e: any) => console.error("[ProspectionSender] remise à zéro garde trop proche échouée", e.message));
        }
      } catch (e: any) {
        // 23503 (clé étrangère) : le prospect a été SUPPRIMÉ pendant le passage (la réservation
        // d'envoi ne peut plus le référencer) — rien n'est parti, rien à faire.
        if (estContrainteLead(e)) {
          console.log(`[ProspectionSender] lead ${state.leadId} supprimé pendant le passage — ignoré, rien envoyé`);
          continue;
        }
        console.error(`[ProspectionSender] lead ${state.leadId}:`, e.message);
      }
    }
  }
}

export function scheduleProspectionSender(): void {
  avertirSecretDeSecours();
  console.log(
    `[ProspectionSender] Worker démarré (chaque minute) — envoi global ${masterSendingEnabled() ? "ACTIVÉ" : "DÉSACTIVÉ (dry-run)"} ; chaque user envoie depuis SA propre adresse`,
  );
  setInterval(() => {
    runProspectionSender().catch((e) => console.error("[ProspectionSender]", e.message));
  }, POLL_MS);
}
