import { describe, it, expect, vi } from "vitest";
import { marquerLinkedInEnvoye, passerLinkedIn, type DepsLinkedInManuel } from "./prospection-linkedin-manuel";

const NOW = new Date("2026-10-30T10:00:00Z");
const JOUR = 86_400_000;

function deps(over: { msg?: any; state?: any; steps?: any[] } = {}) {
  const msg = over.msg === undefined
    ? { id: 7, userId: "u1", leadId: 3, platform: "linkedin", messageType: "step_1", sentAt: null }
    : over.msg;
  const state = over.state === undefined
    ? { leadId: 3, campaignId: 10, status: "awaiting_linkedin", currentStep: 0 }
    : over.state;
  const steps = over.steps ?? [
    { delayDays: 0, condition: "always" },
    { delayDays: 2, condition: "always" },
  ];
  const d: DepsLinkedInManuel = {
    getMessage: vi.fn(async () => msg),
    updateMessage: vi.fn(async () => undefined),
    deleteMessage: vi.fn(async () => undefined),
    getState: vi.fn(async () => state),
    updateState: vi.fn(async () => undefined),
    getSteps: vi.fn(async () => steps as any),
    getSignals: vi.fn(async () => ({ opened: false, clicked: false, bounced: false, replied: false, inviteAccepted: false })),
    markClaimSent: vi.fn(async () => undefined),
  };
  return d;
}

describe("marquerLinkedInEnvoye", () => {
  it("le délai de l'étape suivante court à partir du clic « Envoyé »", async () => {
    const d = deps();
    const r = await marquerLinkedInEnvoye(d, "u1", 7, NOW);
    expect(r).toEqual({ ok: true, sequenceReprise: true });
    expect(d.updateMessage).toHaveBeenCalledWith(7, { sentAt: NOW });
    expect(d.markClaimSent).toHaveBeenCalledWith({ leadId: 3, campaignId: 10, stepOrder: 1, userId: "u1", channel: "linkedin" });
    expect(d.updateState).toHaveBeenCalledWith(3, {
      currentStep: 1, lastStepSentAt: NOW, status: "active", nextRunAt: new Date(NOW.getTime() + 2 * JOUR),
    });
  });

  it("dernière étape : la séquence se termine", async () => {
    const d = deps({ steps: [{ delayDays: 0, condition: "always" }] });
    await marquerLinkedInEnvoye(d, "u1", 7, NOW);
    expect(d.updateState).toHaveBeenCalledWith(3, expect.objectContaining({ status: "completed", nextRunAt: null }));
  });

  it("ancien brouillon (séquence déjà avancée) : marqué envoyé, séquence intacte", async () => {
    const d = deps({ state: { leadId: 3, campaignId: 10, status: "active", currentStep: 3 } });
    const r = await marquerLinkedInEnvoye(d, "u1", 7, NOW);
    expect(r).toEqual({ ok: true, sequenceReprise: false });
    expect(d.updateMessage).toHaveBeenCalledWith(7, { sentAt: NOW });
    expect(d.updateState).not.toHaveBeenCalled();
    expect(d.markClaimSent).not.toHaveBeenCalled();
  });

  it("brouillon d'une autre utilisatrice : introuvable, rien n'est touché", async () => {
    const d = deps();
    const r = await marquerLinkedInEnvoye(d, "u2", 7, NOW);
    expect(r).toEqual({ ok: false, raison: "introuvable" });
    expect(d.updateMessage).not.toHaveBeenCalled();
  });

  it("message déjà envoyé : refus", async () => {
    const d = deps({ msg: { id: 7, userId: "u1", leadId: 3, platform: "linkedin", messageType: "step_1", sentAt: NOW } });
    expect(await marquerLinkedInEnvoye(d, "u1", 7, NOW)).toEqual({ ok: false, raison: "deja_envoye" });
  });

  it("un email n'est jamais un brouillon LinkedIn", async () => {
    const d = deps({ msg: { id: 7, userId: "u1", leadId: 3, platform: "email", messageType: "step_1", sentAt: null } });
    expect(await marquerLinkedInEnvoye(d, "u1", 7, NOW)).toEqual({ ok: false, raison: "introuvable" });
  });
});

describe("passerLinkedIn", () => {
  it("supprime le brouillon et relance la séquence sans toucher au dernier envoi réel", async () => {
    const d = deps();
    const r = await passerLinkedIn(d, "u1", 7, NOW);
    expect(r).toEqual({ ok: true, sequenceReprise: true });
    expect(d.deleteMessage).toHaveBeenCalledWith(7);
    expect(d.updateState).toHaveBeenCalledWith(3, { currentStep: 1, status: "active", nextRunAt: NOW });
  });

  it("ancien brouillon : supprimé, séquence intacte", async () => {
    const d = deps({ state: { leadId: 3, campaignId: 10, status: "completed", currentStep: 3 } });
    expect(await passerLinkedIn(d, "u1", 7, NOW)).toEqual({ ok: true, sequenceReprise: false });
    expect(d.deleteMessage).toHaveBeenCalledWith(7);
    expect(d.updateState).not.toHaveBeenCalled();
  });
});
