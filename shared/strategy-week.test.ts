import { describe, it, expect } from "vitest";
import { strategyWeekKey, getISOWeekNumber } from "./strategy-week";

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
