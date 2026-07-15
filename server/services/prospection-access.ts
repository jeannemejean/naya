/**
 * Contrôle d'accès à l'enrichissement de prospection + plafond LinkedIn hebdomadaire.
 *
 * Deux niveaux d'abonnement prospection (extension du système d'accès Naya existant) :
 *  - 'base'          : recherche + pré-filtrage + import CRM brut
 *  - 'enrichissement': base + enrichissement complet + audit IA + messages perso (+15€/mois)
 *
 * La logique métier est PURE (testable sans DB) ; les wrappers DB délèguent au storage.
 */

import { storage } from "../storage";
import { hasNayaAccess, type AccessUser, type AccessSubscription } from "./access";
import {
  LINKEDIN_WEEKLY_LIMIT,
  LINKEDIN_REQUEST_OPERATIONS,
  OPERATION_COST_CENTS,
  PROSPECTION_TIMEZONE,
  PROSPECTION_WEEK_RESET_DAY,
  type ProspectionOperationType,
} from "./prospection-config";

export type ProspectionPlan = "base" | "enrichissement";

/** Abonnement enrichi du flag de plan prospection. */
export type ProspectionSubscription =
  | (AccessSubscription & { prospectionPlan?: string | null })
  | null;

// ─── Erreurs typées (messages explicites à chaque étape) ───────────────────────

export class ProspectionAccessError extends Error {
  code = "prospection_enrichment_required";
  constructor(
    message = "Cette fonctionnalité nécessite l'option Enrichissement (+15€/mois) : audit IA et messages personnalisés.",
  ) {
    super(message);
    this.name = "ProspectionAccessError";
  }
}

export class LinkedInWeeklyLimitError extends Error {
  code = "linkedin_weekly_limit_reached";
  constructor(message: string) {
    super(message);
    this.name = "LinkedInWeeklyLimitError";
  }
}

// ─── Logique pure ──────────────────────────────────────────────────────────────

/**
 * Résout le plan prospection effectif.
 * owner/comped → enrichissement d'office ; sinon flag 'enrichissement' ET accès Naya actif.
 */
export function resolveProspectionPlan(
  user: AccessUser,
  sub: ProspectionSubscription,
  now: Date = new Date(),
): ProspectionPlan {
  if (user.role === "owner" || user.role === "comped") return "enrichissement";
  if (sub?.prospectionPlan === "enrichissement" && hasNayaAccess(user, sub, now)) {
    return "enrichissement";
  }
  return "base";
}

/** Lève une erreur claire si le plan n'inclut pas l'enrichissement. */
export function assertPlanHasEnrichment(plan: ProspectionPlan): void {
  if (plan !== "enrichissement") throw new ProspectionAccessError();
}

/** Lève une erreur si le plafond LinkedIn hebdomadaire est atteint. */
export function assertWithinLinkedInWeeklyLimit(
  count: number,
  limit: number = LINKEDIN_WEEKLY_LIMIT,
): void {
  if (count >= limit) {
    throw new LinkedInWeeklyLimitError(
      `Limite LinkedIn atteinte cette semaine (${count}/${limit}) — recommence lundi.`,
    );
  }
}

/** Décalage (ms) du fuseau à l'instant donné : (heure murale lue comme UTC) − instant réel. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  const asUTC = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
  return asUTC - date.getTime();
}

/**
 * Début de la semaine courante (lundi 00:00 dans le fuseau de référence), en instant UTC.
 * Sert de borne basse au comptage LinkedIn hebdomadaire.
 */
export function linkedInWeekStart(
  now: Date = new Date(),
  timeZone: string = PROSPECTION_TIMEZONE,
): Date {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(now)) map[p.type] = p.value;
  const y = Number(map.year);
  const mo = Number(map.month);
  const d = Number(map.day);
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const wd = weekdays.indexOf(map.weekday); // 0 (dim) .. 6 (sam)
  const daysSinceMonday = (wd + 6) % 7; // lundi = 0
  const mondayWallAsUTC = Date.UTC(y, mo - 1, d - daysSinceMonday, 0, 0, 0);
  const offset = tzOffsetMs(new Date(mondayWallAsUTC), timeZone);
  return new Date(mondayWallAsUTC - offset);
}

export interface ProspectionStatus {
  plan: ProspectionPlan;
  enrichment_available: boolean;
  linkedin_requests_this_week: number;
  linkedin_weekly_limit: number;
  reset_day: typeof PROSPECTION_WEEK_RESET_DAY;
}

/** Construit le payload de /api/prospection/status (pur). */
export function buildProspectionStatus(input: {
  plan: ProspectionPlan;
  linkedinRequestsThisWeek: number;
}): ProspectionStatus {
  return {
    plan: input.plan,
    enrichment_available: input.plan === "enrichissement",
    linkedin_requests_this_week: input.linkedinRequestsThisWeek,
    linkedin_weekly_limit: LINKEDIN_WEEKLY_LIMIT,
    reset_day: PROSPECTION_WEEK_RESET_DAY,
  };
}

// ─── Wrappers DB ───────────────────────────────────────────────────────────────

/** Plan prospection effectif de l'utilisateur (lit user + abonnement). */
export async function getProspectionPlan(userId: string): Promise<ProspectionPlan> {
  const [user, sub] = await Promise.all([
    storage.getUser(userId),
    storage.getSubscription(userId),
  ]);
  return resolveProspectionPlan(
    { role: user?.role ?? null },
    (sub ?? null) as ProspectionSubscription,
  );
}

/** True si l'utilisateur a le plan enrichissement actif. */
export async function hasProspectionEnrichment(userId: string): Promise<boolean> {
  return (await getProspectionPlan(userId)) === "enrichissement";
}

/** Nombre de demandes LinkedIn effectuées cette semaine (dérivé de prospection_usage). */
export async function getLinkedInRequestsThisWeek(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  return storage.countProspectionOperationsSince(
    userId,
    LINKEDIN_REQUEST_OPERATIONS,
    linkedInWeekStart(now),
  );
}

/** Lève LinkedInWeeklyLimitError si l'utilisateur a atteint le plafond hebdomadaire. */
export async function checkLinkedInWeeklyLimit(
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const count = await getLinkedInRequestsThisWeek(userId, now);
  assertWithinLinkedInWeeklyLimit(count);
}

/**
 * Enregistre un coût de prospection dans le tracking interne (jamais exposé user).
 * Le coût est figé par la config (source de vérité unique). Ne throw jamais.
 */
export async function logProspectionUsage(
  userId: string,
  operationType: ProspectionOperationType,
  refs: { prospectId?: number | null; campaignId?: number | null } = {},
): Promise<void> {
  try {
    await storage.recordProspectionUsage({
      userId,
      operationType,
      costCents: OPERATION_COST_CENTS[operationType] ?? 0,
      prospectId: refs.prospectId ?? undefined,
      campaignId: refs.campaignId ?? undefined,
    });
  } catch (e: any) {
    console.error("[prospection] logProspectionUsage:", e?.message || e);
  }
}

/**
 * Garde d'accès à appeler AVANT chaque opération d'enrichissement.
 * 1) plan enrichissement requis → sinon ProspectionAccessError
 * 2) sous le plafond LinkedIn hebdomadaire → sinon LinkedInWeeklyLimitError
 */
export async function assertEnrichmentAccess(
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const plan = await getProspectionPlan(userId);
  assertPlanHasEnrichment(plan);
  await checkLinkedInWeeklyLimit(userId, now);
}
