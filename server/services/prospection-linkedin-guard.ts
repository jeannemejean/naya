/**
 * Garde de risque pour l'automatisation LinkedIn (envoi d'invitations/messages via
 * Unipile, cf. `linkedin.ts` et `prospection-sender.ts`).
 *
 * CONTEXTE — LE VRAI ENJEU. L'envoi automatisé de messages LinkedIn depuis le compte
 * PROPRE d'une utilisatrice est contraire aux conditions d'utilisation de LinkedIn.
 * LinkedIn documente lui-même une escalade de sanctions contre les comptes qui se
 * comportent comme des bots : quelques heures de restriction, puis quelques jours,
 * puis une semaine, puis un mois, puis une restriction PERMANENTE. Ce qui est en jeu
 * n'est pas une question de conformité abstraite : c'est le réseau professionnel de
 * l'utilisatrice, l'actif le plus difficile à reconstituer qui soit. Ce module existe
 * pour que Naya reste très en dessous des seuils qui déclenchent cette escalade —
 * il est écrit comme un garde-fou qui protège un compte, pas comme un optimiseur de
 * débit d'envoi.
 *
 * `decideLinkedInAction` est une FONCTION PURE : aucun accès base de données, aucune
 * horloge implicite (`Date.now()` / `new Date()` sans argument), aucun aléa tiré en
 * interne. Tout entre par les paramètres — c'est la seule façon de la tester de façon
 * déterministe (voir `prospection-linkedin-guard.test.ts`, y compris sous TZ=UTC ET
 * TZ=Europe/Paris pour prouver l'indépendance du fuseau du runner).
 *
 * RÈGLE DE PRUDENCE TRANSVERSALE À CE DÉPÔT : « absence de mesure ≠ mesure nulle ».
 * Un historique d'envois qu'on n'a PAS PU LIRE (`recentSendTimestamps === null`)
 * n'est jamais traité comme un historique vide (`[]`) — dans le doute, on refuse.
 * Même logique pour la date de connexion du compte (`accountConnectedAt === null`) :
 * sans elle, impossible de calculer la position sur la courbe de montée en charge,
 * donc refus.
 */

import { localWallClock } from "../utils/timezone";

// ─── Montée en charge (ramp-up) ─────────────────────────────────────────────────
//
// Un compte LinkedIn fraîchement connecté à Naya n'a AUCUN historique d'activité
// automatisée aux yeux de LinkedIn : envoyer d'emblée au plafond mature ressemblerait
// à un bot dès le premier jour. On démarre bas et on monte par paliers réguliers.
//
// Courbe retenue : +2 actions/jour tous les 3 jours, de 5 à 15.
//   jours 0-2   : 5   (palier de départ)
//   jours 3-5   : 7
//   jours 6-8   : 9
//   jours 9-11  : 11
//   jours 12-14 : 13
//   jours 15+   : 15  (palier mature, plafond)
//
// EMPIRIQUE, PAS UNE RÈGLE LINKEDIN PUBLIÉE — comme le plafond hebdomadaire plus bas,
// cette courbe est une extrapolation prudente des pratiques usuelles de "warm-up"
// progressif des outils d'automatisation LinkedIn du marché ; LinkedIn ne publie
// AUCUN seuil précis. Le pas de 3 jours et l'incrément de 2 sont un choix délibérément
// LENT : mieux vaut sous-utiliser un compte neuf pendant deux semaines que le griller
// en quelques jours. Révisable à la hausse si l'expérience le confirme — jamais sans
// données.
export const LINKEDIN_RAMP_UP_START_CAP = 5;
export const LINKEDIN_RAMP_UP_STEP = 2;
export const LINKEDIN_RAMP_UP_STEP_DAYS = 3;
export const LINKEDIN_MATURE_DAILY_CAP = 15;

/**
 * Plafond quotidien (fenêtre glissante de 24h) pour un compte connecté depuis
 * `daysSinceConnected` jours. Pure & testable indépendamment de `decideLinkedInAction`.
 * `daysSinceConnected` négatif (horloge en doute, date de connexion dans le futur) →
 * palier le plus prudent, jamais plus haut.
 */
export function linkedInRampCapForDay(daysSinceConnected: number): number {
  if (daysSinceConnected < 0) return LINKEDIN_RAMP_UP_START_CAP;
  const steps = Math.floor(daysSinceConnected / LINKEDIN_RAMP_UP_STEP_DAYS);
  const cap = LINKEDIN_RAMP_UP_START_CAP + steps * LINKEDIN_RAMP_UP_STEP;
  return Math.min(cap, LINKEDIN_MATURE_DAILY_CAP);
}

// ─── Plafond hebdomadaire — fenêtre GLISSANTE de 7 jours ────────────────────────
//
// Glissante, JAMAIS une semaine calendaire : une semaine calendaire se remet à zéro
// d'un coup (ex. lundi 00:00) et autoriserait une rafale à cheval sur deux semaines
// (80 le dimanche soir + 80 le lundi matin = 160 en quelques heures). La fenêtre
// glissante empêche ce contournement mécaniquement.
//
// ⚠️ EMPIRIQUE, PAS UNE RÈGLE LINKEDIN PUBLIÉE. Le chiffre de « ~100 invitations par
// semaine » qui circule comme seuil de sécurité communautaire n'est PUBLIÉ NULLE PART
// par LinkedIn — c'est un consensus de facto rapporté par les éditeurs d'outils
// d'automatisation et la communauté growth, jamais confirmé officiellement. La preuve
// que ce chiffre est incertain : au moins un éditeur d'outil annonce un seuil de
// sécurité de 200/semaine — le double du consensus courant. Personne en dehors de
// LinkedIn ne connaît le vrai seuil de déclenchement, et il varie probablement par
// compte (ancienneté, taille de réseau, comportement historique). 80 est un choix
// VOLONTAIREMENT prudent — nettement sous le consensus de 100 — pas une vérité gravée
// dans le marbre. Révisable à la baisse si un signal de restriction est observé en
// dessous ; à la hausse seulement avec des données qui le justifient.
export const LINKEDIN_WEEKLY_CAP = 80;
export const LINKEDIN_WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface LinkedInGuardRestriction {
  /** Instant où le signal de restriction a été détecté (persistant tant qu'aucune action humaine ne le lève). */
  restrictedAt: Date;
  /** Détail exploitable en log (ex. le message d'erreur Unipile qui a déclenché la pause). */
  reason?: string;
}

export type LinkedInGuardRefusalReason =
  | "restricted"
  | "send_history_unreadable"
  | "account_connection_unknown"
  | "outside_business_days"
  | "outside_business_hours"
  | "min_delay_not_elapsed"
  | "daily_ramp_cap_reached"
  | "weekly_cap_reached";

export type LinkedInGuardDecision =
  | { allowed: true }
  | { allowed: false; reason: LinkedInGuardRefusalReason; detail: string };

export interface LinkedInGuardInput {
  /** Instant présent. Aucune horloge implicite : toujours fourni par l'appelant. */
  now: Date;
  /** Fuseau IANA de l'utilisatrice (ex. "Europe/Paris"), pour la fenêtre ouvrée. */
  timezone: string;
  /** Début de la fenêtre ouvrée, en minutes depuis minuit, heure locale (ex. 9*60). */
  workDayStartMin: number;
  /** Fin EXCLUSIVE de la fenêtre ouvrée, en minutes depuis minuit, heure locale (ex. 18*60). */
  workDayEndMin: number;
  /** Jours ouvrés autorisés, abréviations "mon".."sun" (même convention que `prospection-sender.ts`). */
  workDays: Set<string>;
  /**
   * Date de connexion du compte LinkedIn (Unipile) — point de départ de la montée en
   * charge. `null` = inconnue → refus par prudence (impossible de situer le compte
   * sur la courbe de ramp-up sans elle).
   */
  accountConnectedAt: Date | null;
  /**
   * Instants des envois LinkedIn réussis récents, couvrant AU MOINS les 7 derniers
   * jours (nécessaire au plafond hebdomadaire glissant). `null` = l'historique n'a
   * PAS PU être lu — jamais traité comme `[]` (aucun envoi) : refus par prudence.
   */
  recentSendTimestamps: Date[] | null;
  /**
   * État de restriction du compte, s'il y en a un. Non-null → refus inconditionnel,
   * quel que soit le reste des entrées. Persiste jusqu'à levée MANUELLE (jamais de
   * retentative automatique après un refus de LinkedIn : c'est précisément ce qui
   * transforme une restriction temporaire en permanente).
   */
  restriction: LinkedInGuardRestriction | null;
  /**
   * Délai minimum (ms) devant s'être écoulé depuis le dernier envoi avant d'en
   * autoriser un nouveau. Tiré par l'APPELANT (aléa avec vraie dispersion, de l'ordre
   * de quelques minutes) — jamais par cette fonction, qui doit rester pure et
   * déterministe pour être testable.
   */
  minDelayMs: number;
}

/**
 * Décide si une action LinkedIn (invitation ou message) est autorisée MAINTENANT
 * pour ce compte. Fonction pure : mêmes entrées → même sortie, toujours.
 *
 * Ordre des vérifications, du plus critique (sécurité du compte) au plus fin
 * (cadence) : restriction active → données manquantes (fail-closed) → jour ouvré →
 * heure ouvrée → délai minimum depuis le dernier envoi → plafond quotidien de
 * montée en charge → plafond hebdomadaire glissant.
 */
export function decideLinkedInAction(input: LinkedInGuardInput): LinkedInGuardDecision {
  // 1) Restriction active : arrêt total, priorité absolue. Ne JAMAIS retenter
  // automatiquement après un refus de LinkedIn — c'est exactement ce qui transforme
  // une restriction temporaire en permanente. Seule une action humaine (hors de
  // cette fonction) peut effacer cet état.
  if (input.restriction) {
    const reasonDetail = input.restriction.reason ? ` — ${input.restriction.reason}` : "";
    return {
      allowed: false,
      reason: "restricted",
      detail:
        `compte LinkedIn en restriction depuis ${input.restriction.restrictedAt.toISOString()}${reasonDetail} : ` +
        `reprise MANUELLE requise, aucune retentative automatique.`,
    };
  }

  // 2) Historique d'envois illisible ≠ historique vide. Sans lui, aucun des plafonds
  // ci-dessous n'est calculable en confiance → refus par prudence.
  if (input.recentSendTimestamps === null) {
    return {
      allowed: false,
      reason: "send_history_unreadable",
      detail: "historique des envois LinkedIn illisible (échec de lecture) — refus par prudence, jamais traité comme 0 envoi.",
    };
  }

  // 3) Date de connexion du compte inconnue → impossible de situer le compte sur la
  // courbe de montée en charge → refus par prudence.
  if (input.accountConnectedAt === null) {
    return {
      allowed: false,
      reason: "account_connection_unknown",
      detail: "date de connexion du compte LinkedIn inconnue — montée en charge non calculable, refus par prudence.",
    };
  }

  // 4) Jour ouvré + heure de bureau, dans le fuseau de l'utilisatrice. Un compte qui
  // envoie à 3h du matin ou le dimanche ne ressemble pas à un humain.
  const { minuteOfDay, dayAbbr } = localWallClock(input.timezone, input.now);
  if (!input.workDays.has(dayAbbr)) {
    return {
      allowed: false,
      reason: "outside_business_days",
      detail: `jour non ouvré ("${dayAbbr}", fuseau ${input.timezone}) — un compte humain n'agit pas le week-end.`,
    };
  }
  if (minuteOfDay < input.workDayStartMin || minuteOfDay >= input.workDayEndMin) {
    return {
      allowed: false,
      reason: "outside_business_hours",
      detail:
        `hors heures de bureau (${fmtHM(minuteOfDay)}, fenêtre ${fmtHM(input.workDayStartMin)}-${fmtHM(input.workDayEndMin)}, ` +
        `fuseau ${input.timezone}).`,
    };
  }

  // 5) Délai minimum aléatoire entre deux actions — le worker est réveillé chaque
  // minute et enverrait sinon en rafale. `lastSendAt` dérive du même historique que
  // les plafonds ci-dessous (une seule source de vérité, pas deux entrées qui
  // pourraient diverger).
  const lastSendAt = latestOf(input.recentSendTimestamps);
  if (lastSendAt) {
    const elapsedMs = input.now.getTime() - lastSendAt.getTime();
    if (elapsedMs < input.minDelayMs) {
      return {
        allowed: false,
        reason: "min_delay_not_elapsed",
        detail:
          `délai minimum non écoulé depuis le dernier envoi (${Math.round(elapsedMs / 1000)}s ` +
          `< ${Math.round(input.minDelayMs / 1000)}s requis) — évite la rafale d'un worker réveillé chaque minute.`,
      };
    }
  }

  // 6) Plafond quotidien de montée en charge (fenêtre glissante de 24h).
  const daysSinceConnected = Math.floor((input.now.getTime() - input.accountConnectedAt.getTime()) / DAILY_WINDOW_MS);
  const rampCap = linkedInRampCapForDay(daysSinceConnected);
  const sentLast24h = countSince(input.recentSendTimestamps, input.now, DAILY_WINDOW_MS);
  if (sentLast24h >= rampCap) {
    return {
      allowed: false,
      reason: "daily_ramp_cap_reached",
      detail:
        `plafond quotidien de montée en charge atteint : ${sentLast24h}/${rampCap} sur les dernières 24h ` +
        `(jour ${daysSinceConnected} depuis la connexion du compte).`,
    };
  }

  // 7) Plafond hebdomadaire FERME, fenêtre glissante de 7 jours (voir commentaire de
  // LINKEDIN_WEEKLY_CAP : seuil empirique et prudent, jamais publié par LinkedIn).
  const sentLast7d = countSince(input.recentSendTimestamps, input.now, LINKEDIN_WEEKLY_WINDOW_MS);
  if (sentLast7d >= LINKEDIN_WEEKLY_CAP) {
    return {
      allowed: false,
      reason: "weekly_cap_reached",
      detail: `plafond hebdomadaire glissant atteint : ${sentLast7d}/${LINKEDIN_WEEKLY_CAP} sur les 7 derniers jours.`,
    };
  }

  return { allowed: true };
}

/** Instant le plus récent d'une liste (ou `null` si vide). Pure, aucun tri en place. */
function latestOf(timestamps: Date[]): Date | null {
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps.map((d) => d.getTime())));
}

/** Nombre d'instants dans la fenêtre [now - windowMs, now]. Bornes inclusives. */
function countSince(timestamps: Date[], now: Date, windowMs: number): number {
  const start = now.getTime() - windowMs;
  const end = now.getTime();
  return timestamps.filter((d) => d.getTime() >= start && d.getTime() <= end).length;
}

/** "HH:MM" à partir de minutes depuis minuit — pour des messages de log lisibles. */
function fmtHM(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60)
    .toString()
    .padStart(2, "0");
  const m = (minuteOfDay % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

// ─── Signal de restriction Unipile ───────────────────────────────────────────────
//
// ⚠️ Formes à confirmer sur la doc/API Unipile réelle (même réserve que
// `interpretConnectionResponse` dans `linkedin.ts`) : `sendLinkedInStep` compose son
// `error` à partir des codes HTTP renvoyés par `/api/v1/chats` et `/api/v1/users/invite`
// (ex. `"chat_401/invite_403 Forbidden"`), ou d'un texte fixe pour les échecs de
// configuration/résolution (`"unipile_not_configured"`, `"no_public_id"`,
// `"profile_not_resolved"`). 401 (authentification) et 403 (interdit) sont traités
// comme des signaux de restriction, de même que toute mention explicite d'un
// challenge/vérification de sécurité. Décision délibérée : 429 (trop de requêtes)
// N'EST PAS inclus seul — un simple rate-limit ponctuel n'est pas nécessairement un
// signal de santé du compte, contrairement à un refus d'authentification ou un
// challenge. Sur toute forme inconnue → `false` (ne PAS mettre le compte en pause à
// tort sur un texte d'erreur non reconnu ; c'est `daily_ramp_cap_reached`/
// `weekly_cap_reached` qui protègent déjà le compte en régime normal).
// (?<!\d)401(?!\d) plutôt que \b401\b : dans "chat_401/invite_403", le "_" qui précède
// "401" est un caractère de mot (comme les chiffres) — \b ne marque donc PAS de
// frontière entre "_" et "4", et \b401\b ne matcherait jamais cette forme réelle.
const RESTRICTION_SIGNAL_PATTERN =
  /(?<!\d)(401|403)(?!\d)|checkpoint|challenge|captcha|restrict|unauthori[sz]ed|security[_ ]verification/i;

/**
 * Vrai si `error` (le champ `error` d'un `LinkedInSendResult` en échec) ressemble à
 * une erreur d'authentification, de restriction, ou de challenge de sécurité —
 * jamais une simple panne réseau/serveur transitoire (5xx sans 401/403).
 * Pure & testable.
 */
export function isLinkedInRestrictionSignal(error: string | null | undefined): boolean {
  if (!error) return false;
  return RESTRICTION_SIGNAL_PATTERN.test(error);
}
