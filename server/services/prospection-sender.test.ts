import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocks pour les tests d'intégration de runProspectionSender : DB, génération de
// message et LinkedIn sont mockés ; fetch (envoi email via SendGrid) est stubé
// globalement dans chaque test. Les helpers purs (daysBetween, withinSendingWindow,
// planNextStep) ci-dessous n'utilisent aucune de ces dépendances.
vi.mock("../storage", () => ({
  storage: {
    getDueEnrollments: vi.fn(),
    getLeadSignals: vi.fn(),
    getSequenceSteps: vi.fn(),
    getLeads: vi.fn(),
    getBrandDna: vi.fn(),
    getUser: vi.fn(),
    getProspectionCampaign: vi.fn(),
    updateLeadSequenceState: vi.fn(),
    getUserPreferences: vi.fn(),
    createOutreachMessage: vi.fn(),
    countOutreachSentSince: vi.fn(),
  },
}));

vi.mock("./sequence-message", () => ({
  generateStepMessage: vi.fn(),
}));

vi.mock("./linkedin", () => ({
  linkedinConfigured: vi.fn(() => false),
  sendLinkedInStep: vi.fn(),
  LINKEDIN_DAILY_CAP: 25,
}));

import { planNextStep, withinSendingWindow, daysBetween, runProspectionSender } from "./prospection-sender";
import { storage } from "../storage";
import { generateStepMessage } from "./sequence-message";
import { linkedinConfigured, sendLinkedInStep } from "./linkedin";

describe("daysBetween", () => {
  it("compte les jours pleins écoulés", () => {
    expect(daysBetween(new Date("2026-07-01T09:00:00Z"), new Date("2026-07-04T09:00:00Z"))).toBe(3);
    expect(daysBetween(new Date("2026-07-01T09:00:00Z"), new Date("2026-07-01T20:00:00Z"))).toBe(0);
  });
});

describe("withinSendingWindow", () => {
  const opts = { startMin: 9 * 60, endMin: 18 * 60, workDays: new Set(["mon", "tue", "wed", "thu", "fri"]) };
  it("jour ouvré + dans les heures → true", () => {
    expect(withinSendingWindow(10 * 60, "tue", opts)).toBe(true);
  });
  it("avant l'ouverture → false", () => {
    expect(withinSendingWindow(8 * 60, "tue", opts)).toBe(false);
  });
  it("après la fermeture → false", () => {
    expect(withinSendingWindow(18 * 60, "tue", opts)).toBe(false);
  });
  it("week-end → false même en pleine journée", () => {
    expect(withinSendingWindow(11 * 60, "sat", opts)).toBe(false);
    expect(withinSendingWindow(11 * 60, "sun", opts)).toBe(false);
  });
});

const steps = [
  { delayDays: 0 }, // étape 1 (index 0)
  { delayDays: 3 }, // étape 2
  { delayDays: 4 }, // étape 3
];

describe("planNextStep", () => {
  it("currentStep=0 → envoie l'étape 0, programme l'étape 1 à +3j", () => {
    expect(planNextStep(0, steps)).toEqual({ sendIndex: 0, done: false, nextDelayDays: 3 });
  });
  it("currentStep=1 → envoie l'étape 1, programme l'étape 2 à +4j", () => {
    expect(planNextStep(1, steps)).toEqual({ sendIndex: 1, done: false, nextDelayDays: 4 });
  });
  it("currentStep=2 (dernière) → envoie l'étape 2 puis termine", () => {
    expect(planNextStep(2, steps)).toEqual({ sendIndex: 2, done: true, nextDelayDays: null });
  });
  it("currentStep au-delà → plus rien à envoyer (terminé)", () => {
    expect(planNextStep(3, steps)).toEqual({ sendIndex: null, done: true, nextDelayDays: null });
  });
  it("séquence vide → terminé", () => {
    expect(planNextStep(0, [])).toEqual({ sendIndex: null, done: true, nextDelayDays: null });
  });
});

describe("runProspectionSender — worker loop (intégration)", () => {
  const ORIGINAL_ENABLED = process.env.PROSPECTION_SENDING_ENABLED;
  const ORIGINAL_SENDGRID_KEY = process.env.SENDGRID_API_KEY;

  const baseState = (overrides: Record<string, any> = {}) => ({
    id: 1,
    leadId: 1,
    campaignId: 10,
    userId: "u1",
    status: "active",
    currentStep: 0,
    nextRunAt: new Date(Date.now() - 1000),
    enrolledAt: new Date(Date.now() - 1000),
    lastStepSentAt: null,
    repliedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const baseStep = (overrides: Record<string, any> = {}) => ({
    id: 100,
    campaignId: 10,
    userId: "u1",
    stepOrder: 1,
    channel: "email",
    delayDays: 0,
    subjectTemplate: null,
    bodyTemplate: null,
    intention: "opening",
    condition: "always",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const baseLead = (overrides: Record<string, any> = {}) => ({
    id: 1,
    userId: "u1",
    email: "lead@example.com",
    name: "Lead Test",
    linkedinUrl: null,
    ...overrides,
  });

  const baseSignals = (overrides: Record<string, any> = {}) => ({
    opened: false,
    clicked: false,
    bounced: false,
    replied: false,
    inviteAccepted: false,
    ...overrides,
  });

  // Fenêtre d'envoi volontairement large (00:00–23:59, 7j/7) : le check de fenêtre
  // passe déterministement quel que soit le fuseau/jour d'exécution réel des tests.
  const openPrefs = (overrides: Record<string, any> = {}) => ({
    timezone: "UTC",
    workDayStart: "00:00",
    workDayEnd: "23:59",
    workDays: "sun,mon,tue,wed,thu,fri,sat",
    prospectionSenderEmail: "sender@example.com",
    prospectionSenderName: "Jeanne",
    prospectionSenderAddress: null,
    prospectionSenderCity: null,
    prospectionSenderCountry: null,
    prospectionSendgridApiKey: null,
    linkedinUnipileAccountId: null,
    ...overrides,
  });

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PROSPECTION_SENDING_ENABLED = "true";
    process.env.SENDGRID_API_KEY = "test-sendgrid-key";

    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    (linkedinConfigured as any).mockReturnValue(false);

    (storage.getUserPreferences as any).mockResolvedValue(openPrefs());
    (storage.getSequenceSteps as any).mockResolvedValue([baseStep()]);
    (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
    (storage.getLeads as any).mockResolvedValue([baseLead()]);
    (storage.getBrandDna as any).mockResolvedValue({});
    (storage.getUser as any).mockResolvedValue({ firstName: "Jeanne" });
    (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne test" });
    (storage.updateLeadSequenceState as any).mockResolvedValue(null);
    (storage.createOutreachMessage as any).mockResolvedValue({});
    (storage.countOutreachSentSince as any).mockResolvedValue(0);
    (generateStepMessage as any).mockResolvedValue({ subject: "Objet", body: "Corps du message" });
  });

  afterEach(() => {
    if (ORIGINAL_ENABLED === undefined) delete process.env.PROSPECTION_SENDING_ENABLED;
    else process.env.PROSPECTION_SENDING_ENABLED = ORIGINAL_ENABLED;
    if (ORIGINAL_SENDGRID_KEY === undefined) delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY = ORIGINAL_SENDGRID_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("dry-run : kill-switch désactivé → aucune écriture, aucun envoi", async () => {
    delete process.env.PROSPECTION_SENDING_ENABLED;
    (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);

    await runProspectionSender();

    expect(storage.updateLeadSequenceState).not.toHaveBeenCalled();
    expect(storage.createOutreachMessage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendLinkedInStep).not.toHaveBeenCalled();
  });

  it("stop rule — replied : passe en stopped_replied, aucun envoi", async () => {
    (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
    (storage.getLeadSignals as any).mockResolvedValue(baseSignals({ replied: true }));

    await runProspectionSender();

    expect(storage.updateLeadSequenceState).toHaveBeenCalledWith(1, { status: "stopped_replied", nextRunAt: null });
    expect(storage.createOutreachMessage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendLinkedInStep).not.toHaveBeenCalled();
  });

  it("stop rule — bounced : passe en bounced, aucun envoi", async () => {
    (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
    (storage.getLeadSignals as any).mockResolvedValue(baseSignals({ bounced: true }));

    await runProspectionSender();

    expect(storage.updateLeadSequenceState).toHaveBeenCalledWith(1, { status: "bounced", nextRunAt: null });
    expect(storage.createOutreachMessage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendLinkedInStep).not.toHaveBeenCalled();
  });

  it("envoi email : condition vraie + corps généré → fetch appelé, message enregistré, currentStep avancé", async () => {
    (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);

    await runProspectionSender();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    const payload = JSON.parse(init.body);
    expect(payload.personalizations[0].to[0].email).toBe("lead@example.com");
    expect(payload.content[0].value).toContain("Corps du message");

    expect(storage.createOutreachMessage).toHaveBeenCalledTimes(1);
    expect(storage.createOutreachMessage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", leadId: 1, platform: "email", subject: "Objet" }),
    );
    expect(storage.updateLeadSequenceState).toHaveBeenCalledWith(1, expect.objectContaining({ currentStep: 1 }));
    expect(sendLinkedInStep).not.toHaveBeenCalled();
  });

  it("skip : condition if_opened fausse → étape sautée sans envoi, currentStep avancé", async () => {
    (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
    (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ condition: "if_opened" })]);
    (storage.getLeadSignals as any).mockResolvedValue(baseSignals({ opened: false }));

    await runProspectionSender();

    expect(storage.updateLeadSequenceState).toHaveBeenCalledWith(1, { currentStep: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.createOutreachMessage).not.toHaveBeenCalled();
    expect(generateStepMessage).not.toHaveBeenCalled();
  });

  it("corps vide : generateStepMessage lève → le lead n'est PAS avancé, aucun envoi", async () => {
    (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
    (generateStepMessage as any).mockRejectedValue(
      new Error("generateStepMessage: corps vide pour lead 1, étape 100 (réponse IA non parsable) — non mis en cache"),
    );

    await runProspectionSender();

    expect(storage.updateLeadSequenceState).not.toHaveBeenCalled();
    expect(storage.createOutreachMessage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendLinkedInStep).not.toHaveBeenCalled();
  });
});
