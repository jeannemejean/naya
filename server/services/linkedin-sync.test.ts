import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Revue post-commit f17af17, Critique : le poller (toutes les 15 min, 24h/24) n'avait ni
// LIMIT ni plafond par compte, et ses appels n'entraient JAMAIS dans `linkedin_send_attempts`
// — un chemin par lequel le compte pouvait consulter des milliers de profils par jour, deux
// ordres de grandeur au-dessus de ce que la garde protège côté envoi, sans qu'elle le voie.
// Décision : le poller tire dans le MÊME budget que les envois (même journal, même garde
// `decideLinkedInAction`, mêmes plafonds ramp-up/hebdomadaire/délai minimum) — un seul
// compte LinkedIn a une seule surface de risque de restriction, que la requête soit une
// lecture ou une écriture. Voir la justification complète dans le rapport de tâche.
vi.mock("../storage", () => ({
  storage: {
    getLeadsAwaitingInvite: vi.fn(),
    getUserPreferences: vi.fn(),
    setLeadLinkedinConnected: vi.fn(),
    getLinkedInAttemptTimestampsSince: vi.fn(),
    recordLinkedInSendAttempt: vi.fn(),
    updateUserPreferences: vi.fn(),
  },
}));

vi.mock("./linkedin", () => ({
  linkedinConfigured: vi.fn(() => true),
  checkConnection: vi.fn(),
}));

import { syncLinkedInConnections, LINKEDIN_SYNC_BATCH_LIMIT } from "./linkedin-sync";
import { storage } from "../storage";
import { checkConnection } from "./linkedin";

const HOUR = 60 * 60 * 1000;

const openPrefs = (overrides: Record<string, any> = {}) => ({
  timezone: "UTC",
  workDayStart: "00:00",
  workDayEnd: "23:59",
  workDays: "sun,mon,tue,wed,thu,fri,sat",
  linkedinUnipileAccountId: "acc1",
  linkedinAccountConnectedAt: new Date(Date.now() - 60 * 24 * HOUR), // compte mature
  linkedinRestrictedAt: null,
  linkedinRestrictedReason: null,
  ...overrides,
});

const baseLead = (overrides: Record<string, any> = {}) => ({
  id: 1,
  userId: "u1",
  linkedinUrl: "https://linkedin.com/in/x",
  ...overrides,
});

describe("syncLinkedInConnections", () => {
  const ORIGINAL_ENABLED = process.env.PROSPECTION_SENDING_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PROSPECTION_SENDING_ENABLED = "true";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    (storage.setLeadLinkedinConnected as any).mockResolvedValue(undefined);
    (storage.getLinkedInAttemptTimestampsSince as any).mockResolvedValue([]);
    (storage.recordLinkedInSendAttempt as any).mockResolvedValue(undefined);
    (storage.updateUserPreferences as any).mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (ORIGINAL_ENABLED === undefined) delete process.env.PROSPECTION_SENDING_ENABLED;
    else process.env.PROSPECTION_SENDING_ENABLED = ORIGINAL_ENABLED;
    vi.restoreAllMocks();
  });

  it("interrupteur global désactivé → aucune lecture, aucun appel LinkedIn (défaut Critique)", async () => {
    delete process.env.PROSPECTION_SENDING_ENABLED;
    (storage.getLeadsAwaitingInvite as any).mockResolvedValue([baseLead()]);
    (storage.getUserPreferences as any).mockResolvedValue(openPrefs());

    const updated = await syncLinkedInConnections();

    expect(checkConnection).not.toHaveBeenCalled();
    expect(storage.getLeadsAwaitingInvite).not.toHaveBeenCalled();
    expect(updated).toBe(0);
  });

  it("getLeadsAwaitingInvite est appelé avec un LIMIT explicite (défaut Critique : requête non bornée)", async () => {
    (storage.getLeadsAwaitingInvite as any).mockResolvedValue([]);

    await syncLinkedInConnections();

    expect(storage.getLeadsAwaitingInvite).toHaveBeenCalledWith(LINKEDIN_SYNC_BATCH_LIMIT);
    expect(LINKEDIN_SYNC_BATCH_LIMIT).toBeGreaterThan(0);
  });

  it("compte restreint → checkConnection n'est JAMAIS appelé, même en lecture", async () => {
    (storage.getLeadsAwaitingInvite as any).mockResolvedValue([baseLead()]);
    (storage.getUserPreferences as any).mockResolvedValue(
      openPrefs({ linkedinRestrictedAt: new Date(Date.now() - 24 * HOUR) }),
    );

    const updated = await syncLinkedInConnections();

    expect(checkConnection).not.toHaveBeenCalled();
    expect(updated).toBe(0);
  });

  it("pas de compte LinkedIn connecté → checkConnection n'est pas appelé", async () => {
    (storage.getLeadsAwaitingInvite as any).mockResolvedValue([baseLead()]);
    (storage.getUserPreferences as any).mockResolvedValue(openPrefs({ linkedinUnipileAccountId: null }));

    const updated = await syncLinkedInConnections();

    expect(checkConnection).not.toHaveBeenCalled();
    expect(updated).toBe(0);
  });

  it("budget partagé avec les envois déjà épuisé (80 tentatives sur 7 jours glissants) → refusé par la garde, aucun appel LinkedIn", async () => {
    const alreadyEighty = Array.from({ length: 80 }, (_, i) => new Date(Date.now() - 72 * HOUR - i * HOUR));
    (storage.getLinkedInAttemptTimestampsSince as any).mockResolvedValue(alreadyEighty);
    (storage.getLeadsAwaitingInvite as any).mockResolvedValue([baseLead()]);
    (storage.getUserPreferences as any).mockResolvedValue(openPrefs());

    const updated = await syncLinkedInConnections();

    expect(checkConnection).not.toHaveBeenCalled();
    expect(updated).toBe(0);
  });

  it("historique illisible (lecture échouée) → refus par prudence, aucun appel LinkedIn", async () => {
    (storage.getLinkedInAttemptTimestampsSince as any).mockRejectedValue(new Error("DB down"));
    (storage.getLeadsAwaitingInvite as any).mockResolvedValue([baseLead()]);
    (storage.getUserPreferences as any).mockResolvedValue(openPrefs());

    const updated = await syncLinkedInConnections();

    expect(checkConnection).not.toHaveBeenCalled();
    expect(updated).toBe(0);
  });

  it("dans le budget, non restreint → checkConnection appelé, tentative journalisée, lead marqué connecté si en relation", async () => {
    (checkConnection as any).mockResolvedValue({ ok: true, connected: true, error: null });
    (storage.getLeadsAwaitingInvite as any).mockResolvedValue([baseLead()]);
    (storage.getUserPreferences as any).mockResolvedValue(openPrefs());

    const updated = await syncLinkedInConnections();

    expect(checkConnection).toHaveBeenCalledWith("acc1", "https://linkedin.com/in/x");
    expect(storage.recordLinkedInSendAttempt).toHaveBeenCalledWith("u1", 1, true, null);
    expect(storage.setLeadLinkedinConnected).toHaveBeenCalledWith(1, expect.any(Date));
    expect(updated).toBe(1);
  });

  it("pas encore en relation (vérification réussie) → PAS marqué connecté, PAS une restriction", async () => {
    (checkConnection as any).mockResolvedValue({ ok: true, connected: false, error: null });
    (storage.getLeadsAwaitingInvite as any).mockResolvedValue([baseLead()]);
    (storage.getUserPreferences as any).mockResolvedValue(openPrefs());

    const updated = await syncLinkedInConnections();

    expect(storage.setLeadLinkedinConnected).not.toHaveBeenCalled();
    expect(storage.updateUserPreferences).not.toHaveBeenCalled();
    expect(updated).toBe(0);
  });

  it("signal de restriction (401/403) détecté à la vérification → persiste la restriction, arrête net les leads suivants du même user dans le même passage (même défaut Critique 1 que l'envoi)", async () => {
    (checkConnection as any).mockResolvedValue({ ok: false, connected: false, error: "resolve_401" });
    const lead1 = baseLead({ id: 1, userId: "u1" });
    const lead2 = baseLead({ id: 2, userId: "u1" });
    (storage.getLeadsAwaitingInvite as any).mockResolvedValue([lead1, lead2]);
    (storage.getUserPreferences as any).mockResolvedValue(openPrefs());

    await syncLinkedInConnections();

    expect(checkConnection).toHaveBeenCalledTimes(1); // le second lead n'appelle jamais LinkedIn
    expect(storage.updateUserPreferences).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ linkedinRestrictedAt: expect.any(Date), linkedinRestrictedReason: "resolve_401" }),
    );
  });

  it("échec transitoire (pas un signal de restriction) → tentative journalisée mais rien persisté", async () => {
    (checkConnection as any).mockResolvedValue({ ok: false, connected: false, error: "check_500" });
    (storage.getLeadsAwaitingInvite as any).mockResolvedValue([baseLead()]);
    (storage.getUserPreferences as any).mockResolvedValue(openPrefs());

    await syncLinkedInConnections();

    expect(storage.recordLinkedInSendAttempt).toHaveBeenCalledWith("u1", 1, false, "check_500");
    expect(storage.updateUserPreferences).not.toHaveBeenCalled();
  });

  it("lead sans URL LinkedIn → ignoré sans aucun appel", async () => {
    (storage.getLeadsAwaitingInvite as any).mockResolvedValue([baseLead({ linkedinUrl: null })]);

    const updated = await syncLinkedInConnections();

    expect(checkConnection).not.toHaveBeenCalled();
    expect(storage.getUserPreferences).not.toHaveBeenCalled();
    expect(updated).toBe(0);
  });

  it("linkedinConfigured() faux → aucune lecture (comportement préservé)", async () => {
    const linkedinModule = await import("./linkedin");
    (linkedinModule.linkedinConfigured as any).mockReturnValue(false);
    (storage.getLeadsAwaitingInvite as any).mockResolvedValue([baseLead()]);

    const updated = await syncLinkedInConnections();

    expect(storage.getLeadsAwaitingInvite).not.toHaveBeenCalled();
    expect(updated).toBe(0);
  });
});
