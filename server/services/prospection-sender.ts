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
import { linkedinConfigured, sendLinkedInStep } from "./linkedin";
import { decideNextStep } from "./sequence-engine";
import { generateStepMessage, combineInstructions } from "./sequence-message";
import { resolveFounderName } from "./prospection-pipeline";
import { sendOnce, type ClaimStore, type StepSendKey } from "./prospection-idempotence";
import {
  decideLinkedInAction,
  isLinkedInRestrictionSignal,
  LINKEDIN_WEEKLY_WINDOW_MS,
} from "./prospection-linkedin-guard";
import { wallClockToInstant } from "../utils/timezone";
import { planDailySessions, isWithinAnySession, type Session } from "./prospection-sessions";
import { isTargetReachableAt } from "./prospection-target-hours";
// Fonctions PURES déjà exportées par les fichiers validés de ce lot — jamais
// modifiées ici, seulement consommées (même statut que `isTargetReachableAt`
// elle-même). Utilisées uniquement pour déterminer le JOUR CIVIL de la cible
// (voir `targetDateStr` plus bas) : `isTargetReachableAt`/`targetWindowUTC`
// résolvent déjà ces mêmes fuseaux en interne pour construire la fenêtre — on
// répète ici cette seule résolution, jamais le calcul de la fenêtre elle-même.
import { zonesForCountry } from "./prospection-target-zones";
import { zoneForCity } from "./prospection-target-cities";

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

// Plafond d'emails / utilisateur / jour (délivrabilité). Configurable via env.
const DAILY_CAP = Number(process.env.PROSPECTION_DAILY_CAP) || 80;

// Délai minimum ALÉATOIRE entre deux actions LinkedIn du même compte. Le worker est
// réveillé CHAQUE MINUTE (POLL_MS) et enverrait sinon en rafale — un rythme mécanique
// est exactement ce qui distingue un bot d'un humain aux yeux de LinkedIn. Le tirage
// (impur, Math.random) vit ICI, jamais dans `decideLinkedInAction` qui doit rester
// pure et déterministe. Base 3 min + dispersion 0-4 min → délai réel entre 3 et 7 min
// selon le tirage : assez pour casser tout motif régulier, sans geler tout le débit
// sur une fenêtre ouvrée de plusieurs heures.
// Exportées : `linkedin-sync.ts` tire dans le MÊME budget (voir sa doc de tête) — un seul
// jeu de constantes pour « à quel point une action LinkedIn répétée a l'air mécanique »,
// que ce soit un envoi ou une consultation de statut.
export const LINKEDIN_MIN_DELAY_BASE_MS = 3 * 60_000;
export const LINKEDIN_MIN_DELAY_JITTER_MS = 4 * 60_000;

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
const claimStore: ClaimStore = {
  claim: (key) => storage.claimStepSend(key),
  markSent: (key, status) => storage.markStepSendSent(key, status),
  release: (key) => storage.releaseStepSend(key),
};

// "Maintenant" dans le fuseau de l'utilisateur → { nowMin, dayAbbr }.
function localNow(timezone: string): { nowMin: number; dayAbbr: string } {
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

/** Inverse de `hhmmToMin` : minutes depuis minuit → "HH:MM". Pure. */
function minToHHMM(min: number): string {
  const h = Math.floor(min / 60).toString().padStart(2, "0");
  const m = (min % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Graine stable sur la journée, différente le lendemain et d'un utilisateur à
 * l'autre — jamais `Math.random()` (les sessions doivent être reproductibles à
 * l'intérieur d'un même jour civil pour un même utilisateur, cf. `sessionsDe` ci-dessous).
 */
function graineDuJour(userId: string, dateStr: string): number {
  let h = 2166136261;
  for (const ch of `${userId}:${dateStr}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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

// Résout la config d'envoi PROPRE à l'utilisateur (adresse + clé) depuis ses préférences.
function resolveSenderConfig(prefs: any): { apiKey: string; fromEmail: string; fromName: string } | null {
  const fromEmail = prefs?.prospectionSenderEmail?.trim();
  if (!fromEmail) return null; // pas d'adresse expéditrice → on n'envoie jamais en son nom
  const userKey = prefs?.prospectionSendgridApiKey ? decryptToken(prefs.prospectionSendgridApiKey) : null;
  const apiKey = userKey || process.env.SENDGRID_API_KEY;
  if (!apiKey) return null; // ni clé perso ni clé partagée
  return { apiKey, fromEmail, fromName: prefs?.prospectionSenderName?.trim() || "" };
}

async function sendEmail(opts: {
  apiKey: string; fromEmail: string; fromName: string; footerAddress: string;
  to: string; toName: string; subject: string; body: string; leadId: number;
}): Promise<boolean> {
  // Conformité anti-spam (CAN-SPAM / RGPD) : adresse postale + lien de désinscription.
  // SendGrid remplace <%unsubscribe%> par l'URL de désinscription et supprime automatiquement
  // les désinscrits des envois suivants (subscription_tracking).
  const footer =
    `\n\n—\n${opts.fromName || ""}` +
    (opts.footerAddress ? `\n${opts.footerAddress}` : "") +
    `\nSe désinscrire : <%unsubscribe%>`;
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
      custom_args: { leadId: String(opts.leadId) }, // corrélation webhook tracking
    }),
  });
  return res.ok;
}

export async function runProspectionSender(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const due = await storage.getDueEnrollments(new Date(), 100).catch(() => []);
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
    const getPrefs = async (uid: string) => {
      if (!prefsCache.has(uid)) prefsCache.set(uid, await storage.getUserPreferences(uid));
      return prefsCache.get(uid);
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
    const leadsCache = new Map<string, Promise<any[]>>();
    const getUserLeads = (uid: string): Promise<any[]> => {
      if (!leadsCache.has(uid)) leadsCache.set(uid, storage.getLeads(uid));
      return leadsCache.get(uid)!;
    };
    // Cache des étapes de séquence PAR CAMPAGNE — réutilisé pour restreindre
    // `pendingCountryCodes` (ci-dessous) aux leads réellement candidats à un envoi
    // LinkedIn. Distinct du chargement (non mis en cache) des étapes de la campagne
    // du lead COURANT plus bas dans la boucle : celui-ci reste inchangé.
    const stepsCache = new Map<number, Promise<any[]>>();
    const getCampaignSteps = (campaignId: number): Promise<any[]> => {
      if (!stepsCache.has(campaignId)) stepsCache.set(campaignId, storage.getSequenceSteps(campaignId));
      return stepsCache.get(campaignId)!;
    };
    // Sessions calculées UNE SEULE FOIS par utilisateur pour ce passage — jamais une
    // fois par lead (le worker tourne chaque minute ; recalculer par lead ferait
    // dériver la fenêtre choisie entre deux leads du même utilisateur au même tick).
    const sessionsParUser = new Map<string, Session[]>();
    const sessionsDe = async (
      uid: string,
      prefs: any,
      workDayStartMin: number,
      workDayEndMin: number,
      todayUserDateStr: string,
      now: Date,
    ): Promise<Session[]> => {
      const cached = sessionsParUser.get(uid);
      if (cached) return cached;
      // Cibles DUES de cet utilisateur, UNE ENTRÉE PAR LEAD (doublons attendus,
      // jamais dédupliquées) : `planDailySessions` pondère le choix du créneau par
      // le VOLUME de cibles qu'il dessert, pas par la simple présence d'un pays.
      // Restreint aux leads RÉELLEMENT CANDIDATS à un envoi LinkedIn — sans quoi un
      // lead sans `linkedinUrl`, ou dont l'étape actuellement due est de canal
      // email, pondérerait quand même le placement des sessions LinkedIn (revue
      // post-commit b97a0b6, mineur). Approximation délibérée et peu coûteuse :
      // `state.currentStep` (déjà en mémoire, aucune lecture supplémentaire) plutôt
      // que la machinerie complète de décision (skip/condition/signaux), qui
      // exigerait de lire les signaux de CHAQUE AUTRE lead dû de l'utilisateur —
      // coût jugé disproportionné pour une simple pondération.
      //
      // CHAQUE cible porte SA PROPRE date civile (`targetDateStrFor`, résolue dans
      // SON fuseau à elle) — jamais `todayUserDateStr` (revue post-commit 3acac93,
      // défaut Important : réutiliser le jour de l'utilisatrice pour calculer la
      // fenêtre de CHAQUE pays de la file masquait 56 % des créneaux pourtant
      // valides, en silence, pour une utilisatrice très décalée de ses cibles —
      // voir task-6-report.md). `todayUserDateStr` ne sert plus ici qu'à borner la
      // fenêtre PROPRE de l'utilisatrice (ci-dessous) et à dériver la graine — plus
      // du tout à évaluer la fenêtre d'un pays.
      const leads = await getUserLeads(uid).catch(() => [] as any[]);
      const pendingTargets: { countryCode: string; dateStr: string }[] = [];
      for (const s of due) {
        if (s.userId !== uid) continue;
        const l = leads.find((x: any) => x.id === s.leadId);
        if (!l?.linkedinUrl) continue; // jamais un envoi LinkedIn réel sans URL
        const campaignSteps = await getCampaignSteps(s.campaignId).catch(() => [] as any[]);
        if (campaignSteps[s.currentStep]?.channel !== "linkedin") continue; // étape due actuellement autre que LinkedIn
        const cc = leadCountryCode(l);
        if (!cc) continue;
        // `city: null` — même convention documentée dans `planDailySessions` :
        // résoudre par ville exigerait de faire remonter la ville de CHAQUE cible
        // en attente jusqu'à la fenêtre elle-même (pas seulement pour la date),
        // hors périmètre de ce correctif.
        pendingTargets.push({ countryCode: cc, dateStr: targetDateStrFor(cc, null, now, todayUserDateStr) });
      }
      const tz = prefs?.timezone || DEFAULT_USER_TIMEZONE;
      const plan = planDailySessions({
        userWindowStart: wallClockToInstant(tz, todayUserDateStr, minToHHMM(workDayStartMin)),
        userWindowEnd: wallClockToInstant(tz, todayUserDateStr, minToHHMM(workDayEndMin)),
        pendingTargets,
        seed: graineDuJour(uid, todayUserDateStr),
      });
      sessionsParUser.set(uid, plan);
      return plan;
    };

    for (const state of due) {
      try {
        const prefs = await getPrefs(state.userId);
        const now = new Date();

        // Fenêtre d'envoi : uniquement pendant les heures ouvrées de l'utilisateur (fuseau inclus).
        const workDayStartMin = hhmmToMin(prefs?.workDayStart, 9 * 60);
        const workDayEndMin = hhmmToMin(prefs?.workDayEnd, 18 * 60);
        const workDaysSet = new Set<string>((prefs?.workDays || "mon,tue,wed,thu,fri").split(",").map((d: string) => d.trim().toLowerCase()));
        const { nowMin, dayAbbr } = localNow(prefs?.timezone || DEFAULT_USER_TIMEZONE);
        const inWindow = withinSendingWindow(nowMin, dayAbbr, {
          startMin: workDayStartMin,
          endMin: workDayEndMin,
          workDays: workDaysSet,
        });
        if (!inWindow) continue; // hors fenêtre → on réessaiera (nextRunAt inchangé)

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
          continue;
        }

        // Le délai d'une étape court depuis le DERNIER ENVOI réel (jamais depuis un skip).
        const lastSend = state.lastStepSentAt ? new Date(state.lastStepSentAt) : new Date(state.enrolledAt || Date.now());
        const daysSince = daysBetween(lastSend, now);

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
        let decision = decideNextStep(state.currentStep, engineSteps, signals, daysSince);
        while (
          decision.action === "skip" ||
          (decision.action === "send" && reservedOrders.has(decision.index + 1))
        ) {
          if (decision.action === "send") {
            console.log(`[ProspectionSender] étape ${decision.index + 1} déjà réservée pour le lead ${state.leadId} — rattrapage sans envoi ni génération IA`);
          }
          await storage.updateLeadSequenceState(state.leadId, { currentStep: decision.index + 1 });
          state.currentStep = decision.index + 1;
          decision = decideNextStep(state.currentStep, engineSteps, signals, daysSince);
        }
        if (decision.action === "done") {
          await storage.updateLeadSequenceState(state.leadId, { status: "completed", nextRunAt: null });
          continue;
        }
        if (decision.action === "wait") {
          continue; // pas encore dû → nextRunAt inchangé, on réessaiera
        }

        const step = steps[decision.index];
        const lead = (await getUserLeads(state.userId)).find((l) => l.id === state.leadId);
        if (!lead) {
          await storage.updateLeadSequenceState(state.leadId, { status: "failed", nextRunAt: null });
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
        const liAccountId = prefs?.linkedinUnipileAccountId?.trim();
        // Capturé après la garde : le narrowing `lead.linkedinUrl` ne survit pas à la
        // fermeture `async` de `sendOnce` plus bas (TS le retypera en nullable).
        const linkedinUrl = lead.linkedinUrl;
        const willAttemptRealLinkedInSend =
          step.channel === "linkedin" && linkedinConfigured() && !!liAccountId && !!linkedinUrl;

        if (willAttemptRealLinkedInSend) {
          if (restrictedThisTick.has(state.userId)) {
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

          // ── Sessions de prospection : un humain ouvre LinkedIn, traite quelques
          // personnes, referme — calculées UNE FOIS par utilisateur pour ce passage
          // (voir `sessionsDe` plus haut), jamais par lead.
          const sessions = await sessionsDe(state.userId, prefs, workDayStartMin, workDayEndMin, todayUserDateStr, now);
          if (!isWithinAnySession(sessions, now)) {
            continue; // hors session : rien à signaler sur le lead, on réessaiera plus tard
          }

          if (!liHistoryCache.has(state.userId)) {
            const since = new Date(now.getTime() - LINKEDIN_WEEKLY_WINDOW_MS);
            const ts = await storage.getLinkedInAttemptTimestampsSince(state.userId, since).catch(() => null);
            liHistoryCache.set(state.userId, ts);
          }
          const accountConnectedAt = prefs?.linkedinAccountConnectedAt ? new Date(prefs.linkedinAccountConnectedAt) : null;
          const restriction = prefs?.linkedinRestrictedAt
            ? { restrictedAt: new Date(prefs.linkedinRestrictedAt), reason: prefs?.linkedinRestrictedReason ?? undefined }
            : null;
          const guardDecision = decideLinkedInAction({
            now,
            timezone: prefs?.timezone || DEFAULT_USER_TIMEZONE,
            workDayStartMin, workDayEndMin, workDays: workDaysSet,
            accountConnectedAt,
            recentSendTimestamps: liHistoryCache.get(state.userId)!,
            restriction,
            minDelayMs: LINKEDIN_MIN_DELAY_BASE_MS + Math.random() * LINKEDIN_MIN_DELAY_JITTER_MS,
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

        // Texte SUR-MESURE au dernier moment. useCache:true → réutilise EXACTEMENT le message
        // déjà généré/mis en cache par l'aperçu (parité aperçu ↔ envoi). generateStepMessage
        // LÈVE une exception si le corps est vide : le lead reste alors non avancé (retry via le
        // try/catch par lead). On ne fabrique JAMAIS de corps vide ici.
        const dna = await storage.getBrandDna(state.userId);
        const user = await storage.getUser(state.userId);
        const founderName = resolveFounderName(user, dna as any);
        const campaign = await storage.getProspectionCampaign(state.campaignId);
        const instructions = combineInstructions((prefs as any)?.messageInstructions, (campaign as any)?.messageInstructions);
        const gen = await generateStepMessage(state.userId, {
          lead,
          campaign: { ...campaign, founderName },
          step: { id: step.id, channel: step.channel, intention: (step as any).intention ?? null },
          useCache: true, instructions,
        });
        const subject = gen.subject || "";
        const body = gen.body;

        // Repeuplé sur un envoi LinkedIn réussi (remet `linkedinConsecutiveFailures` à 0) ;
        // vide (aucun changement) pour l'email, un skip, ou un brouillon.
        let linkedinFailurePatch: Record<string, any> = {};

        if (step.channel === "email") {
          if (!lead.email) {
            await storage.updateLeadSequenceState(state.leadId, { status: "failed", nextRunAt: null });
            continue;
          }
          // Capturé après la garde : le narrowing `lead.email` ne survit pas à la
          // fermeture `async` de `sendOnce` ci-dessous (TS le retypera en nullable).
          const toEmail = lead.email;
          // Config expéditeur PROPRE à l'utilisateur (adresse + clé). Jamais l'adresse de l'app.
          const sender = resolveSenderConfig(prefs);
          if (!sender) {
            console.log(`[ProspectionSender] user ${state.userId} sans adresse expéditrice configurée — étape EN ATTENTE (rien envoyé)`);
            continue; // on n'avance pas : l'utilisateur doit configurer son email d'envoi
          }
          // Plafond d'envoi / jour (24h glissantes) pour préserver la délivrabilité.
          if (!sentCount.has(state.userId)) {
            const count = await storage.countOutreachSentSince(state.userId, new Date(Date.now() - 86400000)).catch(() => null);
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
          const footerAddress = [prefs?.prospectionSenderAddress, prefs?.prospectionSenderCity, prefs?.prospectionSenderCountry]
            .filter(Boolean).join(", ");
          // Réservation AVANT tout appel à SendGrid. Réservation refusée = l'étape est
          // déjà partie (ou son sort est inconnu) : on n'envoie rien et on laisse la
          // séquence avancer plus bas.
          const outcome = await sendOnce(claimStore, sendKey, async () => {
            const ok = await sendEmail({
              apiKey: sender.apiKey, fromEmail: sender.fromEmail, fromName: sender.fromName, footerAddress,
              to: toEmail, toName: lead.name || "", subject, body, leadId: lead.id,
            });
            if (!ok) return { ok: false };
            // À partir d'ici le message EST parti (SendGrid a répondu positivement) :
            // une exception d'écriture du journal n'est plus « dans le doute » — on SAIT
            // que l'envoi a eu lieu. On logge et on continue au lieu de laisser
            // l'exception se propager, pour que l'étape soit quand même marquée envoyée
            // et la séquence avancée ; seule la ligne de journal manque.
            try {
              await storage.createOutreachMessage({
                userId: state.userId, leadId: lead.id, platform: "email",
                messageType: `step_${decision.index + 1}`, subject, body, sentAt: new Date(),
              } as any);
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
          if (outcome.action === "skipped") {
            console.log(`[ProspectionSender] étape ${sendKey.stepOrder} déjà envoyée au lead ${lead.id} — avancement sans envoi`);
          } else {
            sentCount.set(state.userId, (sentCount.get(state.userId) || 0) + 1);
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
                await storage.recordLinkedInSendAttempt(state.userId, lead.id, result.ok, result.ok ? null : (result.error ?? null));
              } catch (e: any) {
                console.error(
                  `[ProspectionSender] échec d'enregistrement de la tentative LinkedIn (lead ${lead.id}) : ${String(e?.message ?? e)} — la garde risque de sous-compter ce compte pour ce tick.`,
                );
              }
              // Alimente le cache EN DIRECT, même si la persistance ci-dessus a échoué :
              // au moins CE tick reste correctement borné localement.
              const hist = liHistoryCache.get(state.userId);
              if (hist) hist.push(attemptAt);

              if (!result.ok) {
                console.error(`[ProspectionSender] LinkedIn lead ${lead.id} — détail échec : ${result.error}`);
                if (isLinkedInRestrictionSignal(result.error)) {
                  // Signal d'authentification/restriction/challenge de sécurité : arrêt dur
                  // IMMÉDIAT pour ce compte, pour le reste de CE tick — indépendant du
                  // succès de la persistance ci-dessous (revue post-commit 261835e, défaut
                  // Critique 1).
                  restrictedThisTick.add(state.userId);
                  try {
                    await storage.updateUserPreferences(state.userId, {
                      linkedinRestrictedAt: new Date(),
                      linkedinRestrictedReason: result.error ?? null,
                    } as any);
                    console.error(
                      `[ProspectionSender] compte LinkedIn de l'utilisateur ${state.userId} mis EN PAUSE (signal de restriction Unipile) — reprise manuelle requise.`,
                    );
                  } catch (e: any) {
                    console.error(
                      `[ProspectionSender] ÉCHEC DE PERSISTANCE de la restriction LinkedIn (user ${state.userId}) — l'arrêt en mémoire reste actif pour ce passage, nouvelle tentative de persistance dès le prochain lead concerné : ${String(e?.message ?? e)}`,
                    );
                  }
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
            }
          }
        }

        // Étape envoyée : programmer la suite via la décision (le délai de l'étape suivante
        // court à partir de maintenant, ce dernier envoi étant la nouvelle référence).
        const after = decideNextStep(decision.index + 1, engineSteps, signals, 0);
        const nextDelay = after.action === "send" ? 0 : after.action === "wait" ? (steps[decision.index + 1]?.delayDays || 1) : null;
        await storage.updateLeadSequenceState(state.leadId, {
          currentStep: decision.index + 1,
          lastStepSentAt: new Date(),
          status: decision.done ? "completed" : "active",
          nextRunAt: decision.done ? null : new Date(Date.now() + (nextDelay || 0) * 86_400_000),
          ...linkedinFailurePatch,
        });
      } catch (e: any) {
        console.error(`[ProspectionSender] lead ${state.leadId}:`, e.message);
      }
    }
  } finally {
    running = false;
  }
}

export function scheduleProspectionSender(): void {
  console.log(
    `[ProspectionSender] Worker démarré (chaque minute) — envoi global ${masterSendingEnabled() ? "ACTIVÉ" : "DÉSACTIVÉ (dry-run)"} ; chaque user envoie depuis SA propre adresse`,
  );
  setInterval(() => {
    runProspectionSender().catch((e) => console.error("[ProspectionSender]", e.message));
  }, POLL_MS);
}
