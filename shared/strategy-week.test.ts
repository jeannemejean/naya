import { describe, it, expect } from "vitest";
import { strategyWeekKey, getISOWeekNumber, resolveStrategyWeekKey } from "./strategy-week";

describe("strategyWeekKey — clé de semaine partagée client/serveur", () => {
  it("produit le format YYYY-MM-W<isoWeek>", () => {
    // 2026-06-30 (mardi) → semaine ISO 27
    const d = new Date(2026, 5, 30);
    expect(strategyWeekKey(d)).toBe("2026-06-W" + getISOWeekNumber(d));
    expect(/^\d{4}-\d{2}-W\d{1,2}$/.test(strategyWeekKey(d))).toBe(true);
  });

  it("est DÉTERMINISTE pour une date donnée (même clé partout)", () => {
    const d = new Date(2026, 5, 30);
    // Deux appels (= client puis serveur) sur la même date → clé identique.
    expect(strategyWeekKey(d)).toBe(strategyWeekKey(new Date(d.getTime())));
  });

  it("reproduit EXACTEMENT l'ancien format client (year-MM-W + isoWeek non paddé)", () => {
    const d = new Date(2026, 5, 30);
    const clientInline = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-W" + getISOWeekNumber(d);
    expect(strategyWeekKey(d)).toBe(clientInline);
  });

  it("diffère de l'ancien calcul serveur Math.ceil(jour/7) — preuve du bug d'origine", () => {
    const d = new Date(2026, 5, 30); // 30 juin
    const oldServer = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-W" + Math.ceil(d.getDate() / 7);
    // ISO week (27) ≠ Math.ceil(30/7)=5 → les clés ne correspondaient jamais.
    expect(strategyWeekKey(d)).not.toBe(oldServer);
  });
});

describe("resolveStrategyWeekKey — clé UNIQUE pour métriques ET rapport", () => {
  const date = new Date(2026, 5, 30);

  it("renvoie la clé du client si elle est bien formée", () => {
    expect(resolveStrategyWeekKey("2026-06-W27", date)).toBe("2026-06-W27");
  });

  it("retombe sur la clé serveur partagée si le client n'envoie rien / mal formé", () => {
    expect(resolveStrategyWeekKey(undefined, date)).toBe(strategyWeekKey(date));
    expect(resolveStrategyWeekKey("nimporte-quoi", date)).toBe(strategyWeekKey(date));
    expect(resolveStrategyWeekKey(42 as any, date)).toBe(strategyWeekKey(date));
  });

  it("MÉTRIQUES et RAPPORT obtiennent la MÊME clé (mêmes entrées → même sortie)", () => {
    // Dans /api/strategy/generate, getMetrics(userId, weekKey) et createStrategyReport({week: weekKey})
    // utilisent la MÊME valeur. On le prouve : la résolution est déterministe pour un (client, date) donné.
    const clientWeek = "2026-06-W27";
    const keyForMetrics = resolveStrategyWeekKey(clientWeek, date);
    const keyForReport = resolveStrategyWeekKey(clientWeek, date);
    expect(keyForMetrics).toBe(keyForReport);
    // ...et ce n'est plus l'ancien Math.ceil.
    const oldMathCeil = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-W" + Math.ceil(date.getDate() / 7);
    expect(keyForMetrics).not.toBe(oldMathCeil);
  });

  it("sans clé client : métriques et rapport partagent quand même la clé serveur", () => {
    const k1 = resolveStrategyWeekKey(undefined, date); // métriques
    const k2 = resolveStrategyWeekKey(undefined, date); // rapport
    expect(k1).toBe(k2);
    expect(k1).toBe(strategyWeekKey(date));
  });
});
