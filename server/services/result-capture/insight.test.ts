import { describe, it, expect } from "vitest";
import { buildImmediateInsight, type TaskAnswer } from "./insight";

const rep = (n: number, category: string, done: boolean, hour = 10): TaskAnswer[] =>
  Array.from({ length: n }, () => ({ category, scheduledHour: hour, done }));

describe("buildImmediateInsight", () => {
  it("se tait quand il n'y a pas assez d'observations", () => {
    expect(buildImmediateInsight(rep(4, "admin", false))).toBeNull();
  });

  it("se tait quand rien ne se dégage", () => {
    const melange = [...rep(5, "admin", true), ...rep(5, "admin", false)];
    expect(buildImmediateInsight(melange)).toBeNull();
  });

  it("nomme une catégorie qui ne passe jamais", () => {
    const r = buildImmediateInsight(rep(6, "admin", false));
    expect(r).not.toBeNull();
    expect(r!.toLowerCase()).toContain("admin");
  });

  it("nomme l'écart matin / après-midi quand il est net", () => {
    const r = buildImmediateInsight([
      ...rep(5, "contenu", true, 9),
      ...rep(5, "contenu", false, 16),
    ]);
    expect(r).not.toBeNull();
    expect(r!.toLowerCase()).toMatch(/matin|après-midi/);
  });

  // Interdit de la spec : jamais de compteur, jamais de palmarès.
  it("ne produit jamais un compteur du type « 4/6 »", () => {
    const r = buildImmediateInsight(rep(6, "admin", false)) ?? "";
    expect(r).not.toMatch(/\d+\s*\/\s*\d+/);
  });

  it("ne classe jamais les catégories entre elles", () => {
    const r = buildImmediateInsight([
      ...rep(6, "admin", false),
      ...rep(6, "contenu", true),
    ]) ?? "";
    expect(r.toLowerCase()).not.toMatch(/meilleur|pire|classement|mieux que/);
  });

  it("une catégorie sans nom n'est jamais citée", () => {
    const sansNom: TaskAnswer[] = Array.from({ length: 6 }, () => ({
      category: null, scheduledHour: 10, done: false,
    }));
    expect(buildImmediateInsight(sansNom)).toBeNull();
  });
});
