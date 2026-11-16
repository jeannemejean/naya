import { describe, expect, it, vi } from "vitest";
import { propositionsDuDernierTour, repondreAuConsentement } from "./consentement";

const maintenant = new Date("2026-11-16T09:00:00Z");
const tourAvecProposition = (id: number) => ({
  role: "assistant",
  actions: { faites: [], recherches: [], propositions: [{ id, resume: "Supprimer 11 tâches", changements: [], expireA: "2026-11-16T09:56:00Z" }] },
});
const opts = (message: string, historique: any[]) => ({ userId: "u1", message, historique, maintenant, fuseau: "Europe/Paris" });

describe("propositionsDuDernierTour", () => {
  it("lit les propositions de la dernière réponse de Naya", () => {
    expect(propositionsDuDernierTour([tourAvecProposition(4), { role: "user" }, tourAvecProposition(5)])).toEqual([{ id: 5, resume: "Supprimer 11 tâches" }]);
  });
  it("ignore une proposition d'un tour plus ancien", () => {
    expect(propositionsDuDernierTour([tourAvecProposition(4), { role: "assistant", actions: { propositions: [] } }])).toEqual([]);
  });
  it("tolère des actions absentes ou mal formées", () => {
    expect(propositionsDuDernierTour([{ role: "assistant", actions: null }])).toEqual([]);
    expect(propositionsDuDernierTour([{ role: "assistant", actions: { propositions: [{ id: "x" }] } }])).toEqual([]);
  });
});

describe("repondreAuConsentement", () => {
  it("« oui » valide la proposition en attente et le dit, sans repasser par le modèle", async () => {
    const valider = vi.fn().mockResolvedValue({ ok: true, reussis: ["« Atelier » supprimée"], echecs: [], actionId: 42 });
    const r = await repondreAuConsentement(opts("oui", [tourAvecProposition(5)]), { valider });
    expect(valider).toHaveBeenCalledWith("u1", 5, maintenant, { fuseau: "Europe/Paris" });
    expect(r?.message).toContain("C'est fait");
    expect(r?.message).toContain("« Atelier » supprimée");
    expect(r?.faites).toEqual([{ actionId: 42, resume: "Supprimer 11 tâches", annulableJusqua: "2026-11-17T09:00:00.000Z" }]);
    expect(r?.propositions).toEqual([]);
  });

  it("dit ce qui n'a pas pu être fait", async () => {
    const valider = vi.fn().mockResolvedValue({ ok: true, reussis: [], echecs: ["« B » : introuvable"] });
    const r = await repondreAuConsentement(opts("ok go", [tourAvecProposition(5)]), { valider });
    expect(r?.message).toContain("Pas pu le faire");
  });

  it("un « oui mais… » n'est pas un consentement : la conversation suit son cours", async () => {
    const valider = vi.fn();
    expect(await repondreAuConsentement(opts("oui mais garde l'atelier", [tourAvecProposition(5)]), { valider })).toBeNull();
    expect(valider).not.toHaveBeenCalled();
  });

  it("sans proposition au dernier tour : null", async () => {
    const valider = vi.fn();
    expect(await repondreAuConsentement(opts("oui", [{ role: "assistant", actions: { propositions: [] } }]), { valider })).toBeNull();
    expect(valider).not.toHaveBeenCalled();
  });

  it("proposition déjà traitée : null (le modèle reprend la main)", async () => {
    const valider = vi.fn().mockResolvedValue({ ok: false, raison: "deja_traitee" });
    expect(await repondreAuConsentement(opts("oui", [tourAvecProposition(5)]), { valider })).toBeNull();
  });

  it("proposition expirée : rien d'appliqué, et on le dit", async () => {
    const valider = vi.fn().mockResolvedValue({ ok: false, raison: "expiree" });
    const r = await repondreAuConsentement(opts("oui", [tourAvecProposition(5)]), { valider });
    expect(r?.message).toMatch(/Rien n'a été appliqué/);
    expect(r?.faites).toEqual([]);
  });
});
