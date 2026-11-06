// Annotation de l'historique : sources injectées, aucun accès base.
import { describe, it, expect, vi } from "vitest";
import { annoterHistorique } from "./historique";

const sauv = [
  { role: "user", content: "Rappelle Camille" },
  { role: "assistant", content: "C'est noté.", actions: { faites: [{ actionId: 7, resume: "Tâche « Rappeler Camille Fictive »" }, { actionId: 8, resume: "x" }] } },
  { role: "assistant", content: "Autre", actions: { faites: [] } },
];
const hist = [
  { role: "user" as const, content: "Rappelle Camille" },
  { role: "assistant" as const, content: "C'est noté." },
  { role: "user" as const, content: "Décale tout" },
];

describe("annoterHistorique", () => {
  it("ajoute une note pour les actions annulées, en une seule requête bornée à l'utilisatrice", async () => {
    const annulees = vi.fn(async () => [{ id: 7, resume: "Tâche « Rappeler Camille Fictive »" }]);
    const r = await annoterHistorique("u1", hist, { sauvegardes: async () => sauv, annulees });
    expect(annulees).toHaveBeenCalledTimes(1);
    expect(annulees).toHaveBeenCalledWith("u1", [7, 8]);
    expect(r[1].content).toBe("C'est noté.\n(Annulé ensuite par l'utilisatrice : Tâche « Rappeler Camille Fictive »)");
    expect(r[0]).toEqual(hist[0]);
    expect(r[2]).toEqual(hist[2]);
  });
  it("rien d'annulé : historique inchangé", async () => {
    const r = await annoterHistorique("u1", hist, { sauvegardes: async () => sauv, annulees: async () => [] });
    expect(r).toEqual(hist);
  });
  it("pas de message sauvegardé correspondant : aucune requête d'annulation", async () => {
    const annulees = vi.fn(async () => []);
    const r = await annoterHistorique("u1", [{ role: "assistant", content: "Inconnu" }], { sauvegardes: async () => sauv, annulees });
    expect(annulees).not.toHaveBeenCalled();
    expect(r[0].content).toBe("Inconnu");
  });
});
