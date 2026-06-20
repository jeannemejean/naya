/**
 * Compteur de dépense IA par utilisateur + plafond.
 * Mesure le coût des appels Claude (tokens) et du scraping Bright Data (par requête),
 * accumule par utilisateur, et bloque l'IA au-delà du plafond.
 */

import { db } from "../db";
import { userPreferences, users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

export const AI_BUDGET_EUR = 2;
const USD_TO_EUR = 0.92;

// Prix Claude approximatifs (USD / million de tokens) — garde-fou, pas comptabilité exacte.
const CLAUDE_PRICES: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
};
const DEFAULT_PRICE = { in: 3, out: 15 };

export function estimateClaudeCostEur(model: string, inputTokens: number, outputTokens: number): number {
  const p = CLAUDE_PRICES[model] || DEFAULT_PRICE;
  const usd = (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out;
  return usd * USD_TO_EUR;
}

// Bright Data SERP API : ~$1.50 / 1000 requêtes.
export const SERP_COST_EUR = (1.5 / 1000) * USD_TO_EUR;

/** Ajoute une dépense (EUR) au compteur de l'utilisateur (atomique). Non bloquant en cas d'erreur. */
export async function recordSpend(userId: string, eur: number): Promise<void> {
  if (!userId || !(eur > 0)) return;
  try {
    await db.insert(userPreferences)
      .values({ userId, aiSpendEur: eur })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { aiSpendEur: sql`${userPreferences.aiSpendEur} + ${eur}` },
      });
  } catch (e: any) {
    console.error("[usage] recordSpend:", e.message);
  }
}

export async function getSpend(userId: string): Promise<number> {
  const [p] = await db.select({ s: userPreferences.aiSpendEur }).from(userPreferences).where(eq(userPreferences.userId, userId));
  return p?.s ?? 0;
}

/** Vrai si l'utilisateur a dépassé le plafond IA (l'owner n'est jamais bloqué). */
export async function isAiBlocked(userId: string): Promise<boolean> {
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  if (u?.role === "owner") return false;
  return (await getSpend(userId)) >= AI_BUDGET_EUR;
}

/** Erreur typée levée quand le plafond est atteint. */
export class AiBudgetError extends Error {
  constructor() {
    super("ai_budget_exceeded");
    this.name = "AiBudgetError";
  }
}
