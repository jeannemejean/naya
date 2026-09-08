import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Revue post-commit 261835e, Important 1 : le poller (toutes les 15 min, 24h/24,
// week-end compris) appelait `isConnected` (2 requêtes LinkedIn par lead) pour TOUS les
// leads en attente, SANS jamais lire `linkedinRestrictedAt` ni respecter la fenêtre
// ouvrée. Après une restriction, le compte continuait d'être interrogé indéfiniment —
// l'invariant « arrêt total » du reste de ce chantier ne valait que pour l'ENVOI.
vi.mock("../storage", () => ({
  storage: {
    getLeadsAwaitingInvite: vi.fn(),
    getUserPreferences: vi.fn(),
    setLeadLinkedinConnected: vi.fn(),
  },
}));

vi.mock("./linkedin", () => ({
  linkedinConfigured: vi.fn(() => true),
  isConnected: vi.fn(),
}));

import { syncLinkedInConnections, shouldPollLinkedIn } from "./linkedin-sync";
import { storage } from "../storage";
import { isConnected } from "./linkedin";

const openPrefs = (overrides: Record<string, any> = {}) => ({
  timezone: "Europe/Paris",
  workDayStart: "09:00",
  workDayEnd: "18:00",
  workDays: "mon,tue,wed,thu,fri",
  linkedinUnipileAccountId: "acc1",
  linkedinRestrictedAt: null,
  ...overrides,
});

// Instant de référence : mardi 13 janvier 2026, 10:00 à Paris (09:00 UTC, hiver UTC+1) —
// dans la fenêtre 9h-18h, jour ouvré. Même date que prospection-linkedin-guard.test.ts.
const IN_WINDOW_NOW = new Date("2026-01-13T09:00:00.000Z");

describe("shouldPollLinkedIn — pure, `now` explicite (jamais d'horloge implicite)", () => {
  it("dans la fenêtre ouvrée, non restreint, compte connecté → true", () => {
    expect(shouldPollLinkedIn(openPrefs(), IN_WINDOW_NOW)).toBe(true);
  });

  it("compte restreint → false, même en pleine fenêtre ouvrée", () => {
    const prefs = openPrefs({ linkedinRestrictedAt: new Date("2026-01-12T00:00:00.000Z") });
    expect(shouldPollLinkedIn(prefs, IN_WINDOW_NOW)).toBe(false);
  });

  it("nuit (03:00 à Paris, même mardi) → false", () => {
    const nightNow = new Date("2026-01-13T02:00:00.000Z"); // 03:00 Paris
    expect(shouldPollLinkedIn(openPrefs(), nightNow)).toBe(false);
  });

  it("week-end (samedi 10:00 à Paris) → false même en pleine journée", () => {
    const saturdayNow = new Date("2026-01-17T09:00:00.000Z"); // 10:00 Paris, samedi
    expect(shouldPollLinkedIn(openPrefs(), saturdayNow)).toBe(false);
  });

  it("pas de compte LinkedIn connecté → false", () => {
    expect(shouldPollLinkedIn(openPrefs({ linkedinUnipileAccountId: null }), IN_WINDOW_NOW)).toBe(false);
  });

  it("préférences absentes (lecture échouée) → false, refus par prudence", () => {
    expect(shouldPollLinkedIn(null, IN_WINDOW_NOW)).toBe(false);
    expect(shouldPollLinkedIn(undefined, IN_WINDOW_NOW)).toBe(false);
  });
});

describe("syncLinkedInConnections — intégration (storage/isConnected mockés)", () => {
  const baseLead = (overrides: Record<string, any> = {}) => ({
    id: 1,
    userId: "u1",
    linkedinUrl: "https://linkedin.com/in/x",
    ...overrides,
  });

  // Fenêtre volontairement large (00:00-23:59, 7j/7) pour que ces tests d'intégration
  // passent déterministement quel que soit le moment réel d'exécution — la fenêtre
  // ouvrée elle-même est déjà couverte, de façon déterministe, par `shouldPollLinkedIn`
  // ci-dessus (qui prend `now` en paramètre).
  const openWideAllTheTimePrefs = (overrides: Record<string, any> = {}) => ({
    timezone: "UTC",
    workDayStart: "00:00",
    workDayEnd: "23:59",
    workDays: "sun,mon,tue,wed,thu,fri,sat",
    linkedinUnipileAccountId: "acc1",
    linkedinRestrictedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (storage.setLeadLinkedinConnected as any).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("compte restreint → isConnected n'est JAMAIS appelé, même en lecture", async () => {
    (storage.getLeadsAwaitingInvite as any).mockResolvedValue([baseLead()]);
    (storage.getUserPreferences as any).mockResolvedValue(
      openWideAllTheTimePrefs({ linkedinRestrictedAt: new Date(Date.now() - 86400000) }),
    );

    const updated = await syncLinkedInConnections();

    expect(isConnected).not.toHaveBeenCalled();
    expect(updated).toBe(0);
  });

  // La fenêtre ouvrée elle-même (nuit, week-end) dépend de l'instant réel d'exécution du
  // test si on ne fige pas `now` — `syncLinkedInConnections` ne le prend pas en
  // paramètre. Elle est déjà couverte de façon déterministe par les tests
  // `shouldPollLinkedIn` ci-dessus (qui prennent `now` en paramètre) ; ce test
  // d'intégration se limite donc à l'invariant qui NE dépend PAS de l'heure : la
  // restriction.

  it("dans la fenêtre ouvrée, non restreint → isConnected est appelé normalement (comportement préservé)", async () => {
    (storage.getLeadsAwaitingInvite as any).mockResolvedValue([baseLead()]);
    (storage.getUserPreferences as any).mockResolvedValue(openWideAllTheTimePrefs());
    (isConnected as any).mockResolvedValue(true);

    const updated = await syncLinkedInConnections();

    expect(isConnected).toHaveBeenCalledWith("acc1", "https://linkedin.com/in/x");
    expect(storage.setLeadLinkedinConnected).toHaveBeenCalledWith(1, expect.any(Date));
    expect(updated).toBe(1);
  });

  it("pas de compte LinkedIn connecté → isConnected n'est pas appelé (comportement préservé)", async () => {
    (storage.getLeadsAwaitingInvite as any).mockResolvedValue([baseLead()]);
    (storage.getUserPreferences as any).mockResolvedValue(openWideAllTheTimePrefs({ linkedinUnipileAccountId: null }));

    const updated = await syncLinkedInConnections();

    expect(isConnected).not.toHaveBeenCalled();
    expect(updated).toBe(0);
  });
});
