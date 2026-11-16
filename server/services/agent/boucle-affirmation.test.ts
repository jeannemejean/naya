import { describe, expect, it } from "vitest";
import { corrigerAffirmation } from "./boucle";

const prop = { id: 5, resume: "Supprimer 11 tâches", changements: [], expireA: "2026-11-16T09:56:00Z" };
const faite = { actionId: 1, resume: "x", annulableJusqua: "2026-11-17T09:00:00Z" };

describe("corrigerAffirmation", () => {
  it("remplace « supprimées » quand rien n'est fait mais une proposition attend", () => {
    const t = corrigerAffirmation("11 tâches supprimées. Planning nettoyé.", [], [prop]);
    expect(t).toContain("Rien n'est encore appliqué");
    expect(t).toContain("Supprimer 11 tâches");
  });
  it("laisse une vraie proposition telle quelle", () => {
    const t = "11 tâches à supprimer — confirme et c'est fait :";
    expect(corrigerAffirmation(t, [], [prop])).toBe(t);
  });
  it("laisse le texte quand une action a vraiment été faite", () => {
    expect(corrigerAffirmation("C'est fait.", [faite], [prop])).toBe("C'est fait.");
  });
  it("laisse le texte sans proposition", () => {
    expect(corrigerAffirmation("C'est fait.", [], [])).toBe("C'est fait.");
  });
});
