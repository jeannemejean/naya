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
    getLinkedInAttemptTimestampsSince: vi.fn(),
    recordLinkedInSendAttempt: vi.fn(),
    updateUserPreferences: vi.fn(),
    claimStepSend: vi.fn(),
    markStepSendSent: vi.fn(),
    releaseStepSend: vi.fn(),
    getReservedStepOrders: vi.fn(),
    setLeadUnreachable: vi.fn(),
  },
}));

vi.mock("./sequence-message", () => ({
  generateStepMessage: vi.fn(),
  combineInstructions: vi.fn(() => ""),
}));

vi.mock("./linkedin", () => ({
  linkedinConfigured: vi.fn(() => false),
  sendLinkedInStep: vi.fn(),
}));

import {
  planNextStep,
  withinSendingWindow,
  daysBetween,
  runProspectionSender,
  nextLinkedInFailureState,
  LINKEDIN_FAILURE_BACKOFF_BASE_MIN,
  LINKEDIN_MAX_CONSECUTIVE_FAILURES,
} from "./prospection-sender";
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

// Revue post-commit 261835e, défaut Critique 2 : sur échec franc, l'ancien code ne
// bornait ni ne reculait rien — `nextRunAt` restait inchangé et le lead due était
// retenté à chaque tick (60s), indéfiniment. Recul exponentiel par lead (PAS par
// compte — le compte est protégé séparément par la garde de risque), abandon après
// `LINKEDIN_MAX_CONSECUTIVE_FAILURES`.
describe("nextLinkedInFailureState — recul exponentiel puis abandon après N échecs LinkedIn consécutifs (par lead)", () => {
  const NOW = new Date("2026-01-13T09:00:00.000Z");
  const MIN = 60_000;

  it("1er échec (0 → 1) → recul de LINKEDIN_FAILURE_BACKOFF_BASE_MIN minutes", () => {
    expect(nextLinkedInFailureState(0, NOW)).toEqual({
      abandon: false,
      consecutiveFailures: 1,
      nextRunAt: new Date(NOW.getTime() + LINKEDIN_FAILURE_BACKOFF_BASE_MIN * MIN),
    });
  });

  it("2e échec (1 → 2) → recul doublé", () => {
    expect(nextLinkedInFailureState(1, NOW)).toEqual({
      abandon: false,
      consecutiveFailures: 2,
      nextRunAt: new Date(NOW.getTime() + LINKEDIN_FAILURE_BACKOFF_BASE_MIN * 2 * MIN),
    });
  });

  it("3e échec (2 → 3) → recul quadruplé", () => {
    expect(nextLinkedInFailureState(2, NOW)).toEqual({
      abandon: false,
      consecutiveFailures: 3,
      nextRunAt: new Date(NOW.getTime() + LINKEDIN_FAILURE_BACKOFF_BASE_MIN * 4 * MIN),
    });
  });

  it("4e échec (3 → 4) → recul ×8", () => {
    expect(nextLinkedInFailureState(3, NOW)).toEqual({
      abandon: false,
      consecutiveFailures: 4,
      nextRunAt: new Date(NOW.getTime() + LINKEDIN_FAILURE_BACKOFF_BASE_MIN * 8 * MIN),
    });
  });

  it(`${LINKEDIN_MAX_CONSECUTIVE_FAILURES}e échec consécutif → abandon de la séquence pour CE lead, aucun nextRunAt`, () => {
    const got = nextLinkedInFailureState(LINKEDIN_MAX_CONSECUTIVE_FAILURES - 1, NOW);
    expect(got).toEqual({ abandon: true, consecutiveFailures: LINKEDIN_MAX_CONSECUTIVE_FAILURES, nextRunAt: null });
  });

  it("pure : mêmes entrées → même sortie, `now` entre par la signature", () => {
    expect(nextLinkedInFailureState(2, NOW)).toEqual(nextLinkedInFailureState(2, NOW));
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

  // Pays/ville par défaut : FRANCE, toujours structurellement joignable — les tests
  // qui ne portent PAS sur la fenêtre cible / les sessions (garde de risque,
  // idempotence, plafonds…) n'ont pas à s'en soucier. `LINKEDIN_TEST_NOW` (fixé par
  // fake timers ci-dessous) tombe dans la fenêtre FR ET dans une session réelle
  // calculée pour userId "u1" à cette date — voir describe "fenêtre cible & sessions"
  // pour le calcul et la preuve par mutation.
  const baseLead = (overrides: Record<string, any> = {}) => ({
    id: 1,
    userId: "u1",
    email: "lead@example.com",
    name: "Lead Test",
    linkedinUrl: null,
    outreachUnreachableReason: null,
    enrichedProfile: { linkedin: { raw: { country_code: "FR", city: null } } },
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
    // Compte connecté il y a bien plus de 15 jours : palier mature (15/jour) de la garde
    // de risque LinkedIn par défaut dans ces tests — les scénarios qui veulent tester le
    // ramp-up ou la garde le surchargent explicitement (voir tests dédiés ci-dessous).
    linkedinAccountConnectedAt: new Date(Date.now() - 60 * 86400000),
    linkedinRestrictedAt: null,
    linkedinRestrictedReason: null,
    ...overrides,
  });

  let fetchMock: ReturnType<typeof vi.fn>;

  // "Maintenant" FIGÉ pour toute cette suite. Nécessaire depuis ce lot : la fenêtre
  // cible (`targetWindowUTC`, 09:00-18:00 dans LE FUSEAU DE LA CIBLE, jour ouvré
  // compris) et les sessions (`planDailySessions`, aléa SEEDÉ par userId+date) sont
  // des bornes ABSOLUES, pas relatives à "maintenant" comme le reste de la garde —
  // les faire dépendre de l'horloge réelle du runner rendrait la suite flaky selon
  // l'heure/le jour d'exécution. Valeur calculée hors-ligne (voir describe "fenêtre
  // cible & sessions" plus bas) : le 2026-06-10 (mercredi) est un jour ouvré tant côté
  // FR que côté workDays par défaut ; 07:26:27.866Z tombe DANS la fenêtre FR
  // (07:00-16:00Z ce jour-là, France en heure d'été) ET dans la PREMIÈRE session
  // réelle produite par `planDailySessions` pour userId "u1" à cette date avec un seul
  // pays en attente (FR) — session [07:24:27.866Z, 07:39:30.747Z).
  const LINKEDIN_TEST_NOW = new Date("2026-06-10T07:26:27.866Z");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(LINKEDIN_TEST_NOW);
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
    (storage.getLinkedInAttemptTimestampsSince as any).mockResolvedValue([]);
    (storage.updateUserPreferences as any).mockResolvedValue(undefined);
    (generateStepMessage as any).mockResolvedValue({ subject: "Objet", body: "Corps du message" });
    (storage.claimStepSend as any).mockResolvedValue(true);
    (storage.markStepSendSent as any).mockResolvedValue(undefined);
    (storage.releaseStepSend as any).mockResolvedValue(undefined);
    (storage.getReservedStepOrders as any).mockResolvedValue([]);
    (storage.setLeadUnreachable as any).mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (ORIGINAL_ENABLED === undefined) delete process.env.PROSPECTION_SENDING_ENABLED;
    else process.env.PROSPECTION_SENDING_ENABLED = ORIGINAL_ENABLED;
    if (ORIGINAL_SENDGRID_KEY === undefined) delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY = ORIGINAL_SENDGRID_KEY;
    vi.unstubAllGlobals();
    vi.useRealTimers();
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

  describe("garde d'idempotence", () => {
    it("étape déjà réservée : n'envoie RIEN mais fait avancer la séquence", async () => {
      (storage.claimStepSend as any).mockResolvedValue(false);
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep(), baseStep({ id: 101, stepOrder: 2, delayDays: 3 })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead()]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (storage.countOutreachSentSince as any).mockResolvedValue(0);
      (generateStepMessage as any).mockResolvedValue({ subject: "Sujet", body: "Corps" });

      await runProspectionSender();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(storage.createOutreachMessage).not.toHaveBeenCalled();
      // La séquence avance quand même, avec lastStepSentAt renseigné pour que
      // l'étape suivante respecte son délai au lieu de partir dans la foulée.
      const advance = (storage.updateLeadSequenceState as any).mock.calls.at(-1);
      expect(advance[1]).toMatchObject({ currentStep: 1 });
      expect(advance[1].lastStepSentAt).toBeInstanceOf(Date);
    });

    it("échec franc de SendGrid : libère la réservation et n'avance pas", async () => {
      fetchMock.mockResolvedValue({ ok: false });
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep()]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead()]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (storage.countOutreachSentSince as any).mockResolvedValue(0);
      (generateStepMessage as any).mockResolvedValue({ subject: "Sujet", body: "Corps" });

      await runProspectionSender();

      expect(storage.releaseStepSend).toHaveBeenCalledTimes(1);
      expect(storage.markStepSendSent).not.toHaveBeenCalled();
      expect(storage.updateLeadSequenceState).not.toHaveBeenCalled();
    });

    it("envoi réussi : réserve AVANT d'appeler SendGrid puis marque la réservation", async () => {
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep()]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead()]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (storage.countOutreachSentSince as any).mockResolvedValue(0);
      (generateStepMessage as any).mockResolvedValue({ subject: "Sujet", body: "Corps" });

      await runProspectionSender();

      expect(storage.claimStepSend).toHaveBeenCalledWith({
        leadId: 1, campaignId: 10, stepOrder: 1, userId: "u1", channel: "email",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(storage.markStepSendSent).toHaveBeenCalledWith(expect.objectContaining({ stepOrder: 1 }), "sent");
      // Ordre réel des appels, pas seulement leur présence : la réservation doit
      // précéder l'appel réseau à SendGrid (sinon deux ticks concurrents pourraient
      // tous les deux appeler SendGrid avant que l'un des deux ne réserve).
      expect((storage.claimStepSend as any).mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
    });

    it("kill-switch désactivé : aucune réservation n'est prise", async () => {
      process.env.PROSPECTION_SENDING_ENABLED = "false";
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);

      await runProspectionSender();

      expect(storage.claimStepSend).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("échec d'écriture du journal après envoi réussi (createOutreachMessage rejette) : réservation marquée sent, la séquence avance quand même", async () => {
      // Le message EST parti (fetch a répondu ok). Seule l'écriture dans
      // outreach_messages échoue : ce n'est plus un cas « dans le doute » — on SAIT
      // que l'envoi a eu lieu, donc on marque la réservation `sent` et on avance la
      // séquence ; seule la ligne de journal manque (loggée en erreur).
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep()]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead()]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (storage.countOutreachSentSince as any).mockResolvedValue(0);
      (generateStepMessage as any).mockResolvedValue({ subject: "Sujet", body: "Corps" });
      (storage.createOutreachMessage as any).mockRejectedValue(new Error("DB down"));

      await expect(runProspectionSender()).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(storage.releaseStepSend).not.toHaveBeenCalled();
      expect(storage.markStepSendSent).toHaveBeenCalledWith(expect.objectContaining({ stepOrder: 1 }), "sent");
      expect(storage.updateLeadSequenceState).toHaveBeenCalledWith(1, expect.objectContaining({ currentStep: 1 }));
    });

    it("exception du fournisseur (fetch rejette) : la réservation N'EST PAS libérée, la séquence n'avance pas", async () => {
      // C'est désormais ce test qui porte l'invariant « dans le doute, ne jamais
      // renvoyer » : ici l'issue de l'envoi est réellement inconnue (le fournisseur
      // n'a pas répondu), donc la réservation doit rester `claimed` et rien ne doit
      // avancer. `runProspectionSender` a un try/catch PAR PROSPECT qui avale
      // l'exception et passe au suivant : elle ne rejette donc pas.
      fetchMock.mockRejectedValue(new Error("network down"));
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep()]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead()]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (storage.countOutreachSentSince as any).mockResolvedValue(0);
      (generateStepMessage as any).mockResolvedValue({ subject: "Sujet", body: "Corps" });

      await expect(runProspectionSender()).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(storage.releaseStepSend).not.toHaveBeenCalled();
      expect(storage.markStepSendSent).not.toHaveBeenCalled();
      expect(storage.createOutreachMessage).not.toHaveBeenCalled();
      expect(storage.updateLeadSequenceState).not.toHaveBeenCalled();
    });

    it("plafond quotidien (DAILY_CAP) : une étape sautée (déjà réservée) ne consomme pas le plafond", async () => {
      // DAILY_CAP = Number(process.env.PROSPECTION_DAILY_CAP) || 80 est lu UNE SEULE FOIS,
      // au chargement du module. Pour le fixer à 1 sans toucher au code de production, on
      // réinitialise le registre de modules puis on stubbe la variable d'env AVANT de
      // réimporter dynamiquement le worker. Les dépendances mockées (storage,
      // generateStepMessage) doivent elles aussi être réimportées ici : après
      // `vi.resetModules()`, les factories de `vi.mock` ci-dessus sont ré-exécutées et
      // produisent de NOUVELLES instances de mocks, distinctes de `storage`/`generateStepMessage`
      // importés en haut du fichier — c'est cette instance fraîche que le worker relu
      // utilise en interne, donc c'est elle qu'il faut configurer et interroger.
      vi.resetModules();
      vi.stubEnv("PROSPECTION_DAILY_CAP", "1");
      try {
        const { storage: freshStorage } = await import("../storage");
        const { generateStepMessage: freshGenerateStepMessage } = await import("./sequence-message");
        const { runProspectionSender: freshRunProspectionSender } = await import("./prospection-sender");

        const state1 = baseState({ id: 1, leadId: 1 });
        const state2 = baseState({ id: 2, leadId: 2 });

        (freshStorage.getDueEnrollments as any).mockResolvedValue([state1, state2]);
        (freshStorage.getUserPreferences as any).mockResolvedValue(openPrefs());
        (freshStorage.getSequenceSteps as any).mockResolvedValue([baseStep()]);
        (freshStorage.getLeadSignals as any).mockResolvedValue(baseSignals());
        (freshStorage.getLeads as any).mockResolvedValue([
          baseLead({ id: 1, email: "lead1@example.com" }),
          baseLead({ id: 2, email: "lead2@example.com" }),
        ]);
        (freshStorage.getBrandDna as any).mockResolvedValue(null);
        (freshStorage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
        (freshStorage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
        (freshStorage.countOutreachSentSince as any).mockResolvedValue(0);
        (freshStorage.updateLeadSequenceState as any).mockResolvedValue(null);
        (freshStorage.createOutreachMessage as any).mockResolvedValue({});
        (freshStorage.markStepSendSent as any).mockResolvedValue(undefined);
        (freshStorage.releaseStepSend as any).mockResolvedValue(undefined);
        (freshStorage.claimStepSend as any)
          .mockResolvedValueOnce(false) // prospect 1 : déjà réservée → sautée, ne doit PAS consommer le plafond
          .mockResolvedValueOnce(true); // prospect 2 : doit partir quand même malgré DAILY_CAP=1
        (freshGenerateStepMessage as any).mockResolvedValue({ subject: "Sujet", body: "Corps" });

        await freshRunProspectionSender();

        // Un seul prospect a réellement pu réserver (le second) ; s'il n'était pas parti,
        // ce serait la preuve que le premier (sauté) a quand même consommé le plafond de 1.
        expect(fetchMock).toHaveBeenCalledTimes(1);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("LinkedIn envoyé : réserve puis marque la réservation en sent", async () => {
      (linkedinConfigured as any).mockReturnValue(true);
      (sendLinkedInStep as any).mockResolvedValue({ ok: true, action: "invitation" });
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs({ linkedinUnipileAccountId: "acc1" }));
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead({ linkedinUrl: "https://linkedin.com/in/x" })]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (storage.countOutreachSentSince as any).mockResolvedValue(0);
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(storage.claimStepSend).toHaveBeenCalledWith(expect.objectContaining({ channel: "linkedin", stepOrder: 1 }));
      expect(sendLinkedInStep).toHaveBeenCalledTimes(1);
      expect(storage.markStepSendSent).toHaveBeenCalledWith(expect.objectContaining({ stepOrder: 1 }), "sent");
    });

    it("LinkedIn déjà réservé : ne rappelle pas Unipile", async () => {
      (storage.claimStepSend as any).mockResolvedValue(false);
      (linkedinConfigured as any).mockReturnValue(true);
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs({ linkedinUnipileAccountId: "acc1" }));
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead({ linkedinUrl: "https://linkedin.com/in/x" })]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (storage.countOutreachSentSince as any).mockResolvedValue(0);
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(sendLinkedInStep).not.toHaveBeenCalled();
      expect(storage.createOutreachMessage).not.toHaveBeenCalled();
      expect((storage.updateLeadSequenceState as any).mock.calls.at(-1)[1]).toMatchObject({ currentStep: 1 });
    });

    it("brouillon LinkedIn (compte non connecté) : réserve et marque en draft", async () => {
      (linkedinConfigured as any).mockReturnValue(false);
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead()]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(storage.claimStepSend).toHaveBeenCalledWith(expect.objectContaining({ channel: "linkedin", stepOrder: 1 }));
      expect(storage.createOutreachMessage).toHaveBeenCalledTimes(1);
      // Un brouillon n'est PAS un envoi réel : sentAt doit rester null (sinon un
      // brouillon enregistré à tort comme parti passerait ce test).
      expect(storage.createOutreachMessage).toHaveBeenCalledWith(expect.objectContaining({ sentAt: null }));
      expect(storage.markStepSendSent).toHaveBeenCalledWith(expect.objectContaining({ stepOrder: 1 }), "draft");
    });

    it("brouillon LinkedIn : createOutreachMessage rejette → réservation libérée, la séquence n'avance pas", async () => {
      // Rien n'est parti ici (c'est un brouillon) : contrairement au chemin d'envoi
      // réel, rejouer est totalement inoffensif. Une exception à la création du
      // brouillon doit donc libérer la réservation pour que l'étape soit retentée
      // au prochain tick, plutôt que de perdre le brouillon en silence.
      (linkedinConfigured as any).mockReturnValue(false);
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead()]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });
      (storage.createOutreachMessage as any).mockRejectedValue(new Error("DB down"));

      await runProspectionSender();

      expect(storage.releaseStepSend).toHaveBeenCalledTimes(1);
      expect(storage.markStepSendSent).not.toHaveBeenCalled();
      expect(storage.updateLeadSequenceState).not.toHaveBeenCalled();
    });

    it("brouillon LinkedIn déjà réservé : ne recrée PAS de brouillon, la séquence avance quand même", async () => {
      // Symétrique du test « étape déjà réservée » côté email/LinkedIn-envoi-réel :
      // preuve par mutation qu'on peut aujourd'hui réécrire le chemin brouillon pour
      // qu'il crée le brouillon puis marque `draft` SANS consulter le résultat du
      // claim — ce qui recréerait un brouillon identique à chaque tick du worker.
      (linkedinConfigured as any).mockReturnValue(false);
      (storage.claimStepSend as any).mockResolvedValue(false);
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead()]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(storage.createOutreachMessage).not.toHaveBeenCalled();
      expect(storage.markStepSendSent).not.toHaveBeenCalled();
      const advance = (storage.updateLeadSequenceState as any).mock.calls.at(-1);
      expect(advance[1]).toMatchObject({ currentStep: 1 });
    });

    it("plafond hebdomadaire LinkedIn (garde de risque) : une étape sautée (déjà réservée) ne consomme pas le plafond", async () => {
      // Même invariant que le test DAILY_CAP email, porté sur la garde de risque
      // LinkedIn : compte mature (cap quotidien 15), 79 envois DÉJÀ dans la fenêtre
      // glissante de 7 jours mais hors des dernières 24h (donc le plafond quotidien
      // n'est PAS en cause ici) — il ne reste qu'UNE place sous le plafond
      // hebdomadaire de 80. Le prospect 1 est sauté (déjà réservé) : s'il consommait
      // quand même cette place, le prospect 2 serait refusé par la garde.
      const HOUR = 60 * 60 * 1000;
      const seventyNineOldSends = Array.from({ length: 79 }, (_, i) => new Date(Date.now() - 72 * HOUR - i * HOUR));
      (linkedinConfigured as any).mockReturnValue(true);
      (sendLinkedInStep as any).mockResolvedValue({ ok: true, action: "invitation" });
      (storage.getLinkedInAttemptTimestampsSince as any).mockResolvedValue(seventyNineOldSends);

      const state1 = baseState({ id: 1, leadId: 1 });
      const state2 = baseState({ id: 2, leadId: 2 });
      (storage.getDueEnrollments as any).mockResolvedValue([state1, state2]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs({ linkedinUnipileAccountId: "acc1" }));
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([
        baseLead({ id: 1, linkedinUrl: "https://linkedin.com/in/lead1" }),
        baseLead({ id: 2, linkedinUrl: "https://linkedin.com/in/lead2" }),
      ]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (storage.countOutreachSentSince as any).mockResolvedValue(0);
      (storage.claimStepSend as any)
        .mockResolvedValueOnce(false) // prospect 1 : déjà réservée → sautée, ne doit PAS consommer le plafond
        .mockResolvedValueOnce(true); // prospect 2 : doit partir quand même
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      // Un seul prospect a réellement pu réserver (le second) ; s'il n'était pas
      // parti, ce serait la preuve que le premier (sauté) a quand même consommé
      // la dernière place sous le plafond hebdomadaire.
      expect(sendLinkedInStep).toHaveBeenCalledTimes(1);
    });

    it("plafond hebdomadaire LinkedIn atteint (80/80) → refusé par la garde, aucun appel Unipile, aucune réservation", async () => {
      const HOUR = 60 * 60 * 1000;
      const eightySends = Array.from({ length: 80 }, (_, i) => new Date(Date.now() - 72 * HOUR - i * HOUR));
      (linkedinConfigured as any).mockReturnValue(true);
      (storage.getLinkedInAttemptTimestampsSince as any).mockResolvedValue(eightySends);
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs({ linkedinUnipileAccountId: "acc1" }));
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead({ linkedinUrl: "https://linkedin.com/in/x" })]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(sendLinkedInStep).not.toHaveBeenCalled();
      expect(storage.claimStepSend).not.toHaveBeenCalled();
      expect(storage.updateLeadSequenceState).not.toHaveBeenCalled();
    });

    it("compte LinkedIn en restriction persistée → aucune retentative automatique, aucun appel Unipile, nextRunAt repoussé (pas relu à chaque minute)", async () => {
      (linkedinConfigured as any).mockReturnValue(true);
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(
        openPrefs({
          linkedinUnipileAccountId: "acc1",
          linkedinRestrictedAt: new Date(Date.now() - 86400000),
          linkedinRestrictedReason: "chat_401/invite_403 Forbidden",
        }),
      );
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead({ linkedinUrl: "https://linkedin.com/in/x" })]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(sendLinkedInStep).not.toHaveBeenCalled();
      expect(storage.claimStepSend).not.toHaveBeenCalled();
      // Revue post-commit f17af17, mineur : contrairement aux autres refus, `nextRunAt`
      // n'est plus laissé inchangé sur une restriction — sinon ce lead (et jusqu'à 99
      // autres du même compte) seraient relus en base à CHAQUE tick, pour toujours, en
      // attendant une reprise manuelle. Seul `nextRunAt` bouge (pas currentStep/status).
      expect(storage.updateLeadSequenceState).toHaveBeenCalledTimes(1);
      expect(storage.updateLeadSequenceState).toHaveBeenCalledWith(1, { nextRunAt: expect.any(Date) });
      const pushedNextRunAt = (storage.updateLeadSequenceState as any).mock.calls[0][1].nextRunAt as Date;
      expect(pushedNextRunAt.getTime()).toBeGreaterThan(Date.now() + 30 * 60_000); // repoussé d'au moins 30 min
    });

    it("signal de restriction Unipile (401/403) à l'envoi → persiste la restriction pour cet utilisateur", async () => {
      (linkedinConfigured as any).mockReturnValue(true);
      (sendLinkedInStep as any).mockResolvedValue({ ok: false, action: "none", error: "chat_401/invite_403 Forbidden" });
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs({ linkedinUnipileAccountId: "acc1" }));
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead({ linkedinUrl: "https://linkedin.com/in/x" })]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(storage.updateUserPreferences).toHaveBeenCalledWith(
        "u1",
        expect.objectContaining({ linkedinRestrictedAt: expect.any(Date), linkedinRestrictedReason: "chat_401/invite_403 Forbidden" }),
      );
      // Comme tout échec franc : la réservation est libérée, la séquence n'avance PAS
      // (currentStep/status/lastStepSentAt inchangés). Mais elle EST appelée pour le
      // recul exponentiel du 1er échec de ce lead (nextLinkedInFailureState) — la
      // distinction que ce test vérifiait avant la revue post-commit 261835e n'existe
      // plus : « ne pas avancer » et « ne jamais appeler updateLeadSequenceState »
      // n'étaient synonymes que tant que rien ne bornait les échecs (défaut Critique 2).
      expect(storage.releaseStepSend).toHaveBeenCalledTimes(1);
      expect(storage.updateLeadSequenceState).toHaveBeenCalledWith(1, {
        linkedinConsecutiveFailures: 1,
        nextRunAt: expect.any(Date),
      });
    });

    it("échec LinkedIn transitoire (5xx, pas de signal de restriction) → ne persiste RIEN", async () => {
      (linkedinConfigured as any).mockReturnValue(true);
      (sendLinkedInStep as any).mockResolvedValue({ ok: false, action: "none", error: "chat_500/invite_502 Internal Server Error" });
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs({ linkedinUnipileAccountId: "acc1" }));
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead({ linkedinUrl: "https://linkedin.com/in/x" })]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(storage.updateUserPreferences).not.toHaveBeenCalled();
    });

    it("échec LinkedIn (même transitoire) : la tentative est journalisée (ok:false) — C'EST elle qui borne les plafonds, pas le seul succès", async () => {
      (linkedinConfigured as any).mockReturnValue(true);
      (sendLinkedInStep as any).mockResolvedValue({ ok: false, action: "none", error: "profile_not_resolved" });
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs({ linkedinUnipileAccountId: "acc1" }));
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead({ linkedinUrl: "https://linkedin.com/in/x" })]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(storage.recordLinkedInSendAttempt).toHaveBeenCalledWith("u1", 1, false, "profile_not_resolved");
    });

    it("un échec (même transitoire) alimente EN DIRECT l'historique du tick : le lead suivant du même user est refusé pour délai minimum non écoulé (mineur relevé en revue)", async () => {
      // Preuve indirecte mais fiable de `hist.push` sur la branche ÉCHEC : si l'échec du
      // premier lead ne poussait pas son horodatage dans le cache en mémoire, le second
      // lead (même user, même tick) ne verrait AUCUN envoi récent et serait autorisé.
      const logSpy = vi.spyOn(console, "log");
      (linkedinConfigured as any).mockReturnValue(true);
      (sendLinkedInStep as any).mockResolvedValue({ ok: false, action: "none", error: "profile_not_resolved" });
      const state1 = baseState({ id: 1, leadId: 1 });
      const state2 = baseState({ id: 2, leadId: 2 });
      (storage.getDueEnrollments as any).mockResolvedValue([state1, state2]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs({ linkedinUnipileAccountId: "acc1" }));
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([
        baseLead({ id: 1, linkedinUrl: "https://linkedin.com/in/lead1" }),
        baseLead({ id: 2, linkedinUrl: "https://linkedin.com/in/lead2" }),
      ]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(sendLinkedInStep).toHaveBeenCalledTimes(1); // le second n'appelle jamais Unipile
      const logMessages = logSpy.mock.calls.map((c) => String(c[0]));
      expect(logMessages.some((m) => m.includes("min_delay_not_elapsed"))).toBe(true);
    });

    it("envoi LinkedIn réussi : remet à 0 le compteur d'échecs consécutifs de ce lead (mineur relevé en revue)", async () => {
      (linkedinConfigured as any).mockReturnValue(true);
      (sendLinkedInStep as any).mockResolvedValue({ ok: true, action: "invitation" });
      (storage.getDueEnrollments as any).mockResolvedValue([baseState({ linkedinConsecutiveFailures: 3 } as any)]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs({ linkedinUnipileAccountId: "acc1" }));
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead({ linkedinUrl: "https://linkedin.com/in/x" })]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(storage.updateLeadSequenceState).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ linkedinConsecutiveFailures: 0 }),
      );
    });

    it(`${LINKEDIN_MAX_CONSECUTIVE_FAILURES}e échec LinkedIn consécutif d'un lead → abandon de la séquence (status:"failed"), pas du compte (mineur relevé en revue)`, async () => {
      (linkedinConfigured as any).mockReturnValue(true);
      (sendLinkedInStep as any).mockResolvedValue({ ok: false, action: "none", error: "profile_not_resolved" });
      (storage.getDueEnrollments as any).mockResolvedValue([
        baseState({ linkedinConsecutiveFailures: LINKEDIN_MAX_CONSECUTIVE_FAILURES - 1 } as any),
      ]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs({ linkedinUnipileAccountId: "acc1" }));
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead({ linkedinUrl: "https://linkedin.com/in/x" })]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(storage.updateLeadSequenceState).toHaveBeenCalledWith(1, {
        status: "failed",
        nextRunAt: null,
        linkedinConsecutiveFailures: LINKEDIN_MAX_CONSECUTIVE_FAILURES,
      });
    });

    it("un plafond quotidien déjà épuisé par des ÉCHECS passés (pas des succès) refuse le lead suivant — la revue post-commit 261835e (défaut Critique 2) exigeait que les TENTATIVES comptent, pas les seuls succès", async () => {
      // Compte flambant neuf (connecté à l'instant), palier de départ à 5/jour. 5
      // tentatives — dont le mock ne dit rien sur leur issue passée, exactement le
      // point : le plafond ne fait AUCUNE différence entre 5 succès et 5 échecs.
      const HOUR = 60 * 60 * 1000;
      const fiveAttemptsToday = Array.from({ length: 5 }, (_, i) => new Date(Date.now() - (i + 1) * HOUR));
      (linkedinConfigured as any).mockReturnValue(true);
      (storage.getLinkedInAttemptTimestampsSince as any).mockResolvedValue(fiveAttemptsToday);
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(
        openPrefs({ linkedinUnipileAccountId: "acc1", linkedinAccountConnectedAt: new Date() }),
      );
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead({ linkedinUrl: "https://linkedin.com/in/x" })]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(sendLinkedInStep).not.toHaveBeenCalled();
      expect(storage.claimStepSend).not.toHaveBeenCalled();
      // Refusé AVANT tout coût DB/IA : la génération de message n'a pas eu lieu.
      expect(generateStepMessage).not.toHaveBeenCalled();
    });

    it("deux leads du même user, le PREMIER déclenche une restriction → le SECOND est arrêté par restrictedThisTick, PAS par le délai minimum (défaut Critique 1 — preuve par mutation, voir rapport)", async () => {
      // `getUserPreferences` est mocké pour renvoyer TOUJOURS le même objet "non
      // restreint" (comme le ferait un vrai prefsCache qui n'a lu la base qu'une fois
      // au début du tick) : si le second lead n'était protégé QUE par une relecture de
      // `linkedinRestrictedAt`, ce test échouerait.
      //
      // PIÈGE DÉMONTRÉ PAR MUTATION EN REVUE (post-commit f17af17, Important) : le
      // premier échec pousse un horodatage "maintenant" dans le MÊME historique en
      // mémoire (`hist.push`) que lit le second lead ; `decideLinkedInAction` refuserait
      // donc le second lead pour `min_delay_not_elapsed` de toute façon, MÊME si
      // `restrictedThisTick` ne le bloquait pas — `toHaveBeenCalledTimes(1)` seul passe
      // pour la MAUVAISE raison. On distingue les deux mécanismes par le contenu du log :
      // `restrictedThisTick` produit une phrase précise ("restreint plus tôt dans ce
      // passage"), jamais émise par `decideLinkedInAction` (qui, lui, logue son `reason`,
      // ex. "min_delay_not_elapsed"). Un test qui ne vérifierait que le compte d'appels
      // resterait vert si `restrictedThisTick` était neutralisé — celui-ci non (vérifié
      // manuellement par mutation, voir task-linkedin-guard-report.md).
      const logSpy = vi.spyOn(console, "log");
      (linkedinConfigured as any).mockReturnValue(true);
      (sendLinkedInStep as any).mockResolvedValue({ ok: false, action: "none", error: "chat_401/invite_403 Forbidden" });
      const state1 = baseState({ id: 1, leadId: 1 });
      const state2 = baseState({ id: 2, leadId: 2 });
      (storage.getDueEnrollments as any).mockResolvedValue([state1, state2]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs({ linkedinUnipileAccountId: "acc1" }));
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([
        baseLead({ id: 1, linkedinUrl: "https://linkedin.com/in/lead1" }),
        baseLead({ id: 2, linkedinUrl: "https://linkedin.com/in/lead2" }),
      ]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      // Unipile n'a été appelé qu'UNE fois (pour le premier lead qui déclenche la
      // restriction) — jusqu'à 99 appels supplémentaires étaient possibles avant ce
      // correctif (getDueEnrollments va jusqu'à 100 par passage).
      expect(sendLinkedInStep).toHaveBeenCalledTimes(1);
      expect(storage.updateUserPreferences).toHaveBeenCalledTimes(1);
      const logMessages = logSpy.mock.calls.map((c) => String(c[0]));
      expect(logMessages.some((m) => m.includes("restreint plus tôt dans ce passage"))).toBe(true);
      expect(logMessages.some((m) => m.includes("min_delay_not_elapsed"))).toBe(false);
    });

    it("historique des envois LinkedIn illisible (lecture échouée) → la garde refuse, aucun appel Unipile", async () => {
      (linkedinConfigured as any).mockReturnValue(true);
      (storage.getLinkedInAttemptTimestampsSince as any).mockRejectedValue(new Error("DB down"));
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs({ linkedinUnipileAccountId: "acc1" }));
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead({ linkedinUrl: "https://linkedin.com/in/x" })]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(sendLinkedInStep).not.toHaveBeenCalled();
      expect(storage.claimStepSend).not.toHaveBeenCalled();
    });

    it("échec d'écriture du journal après envoi Unipile réussi (DB down) : réservation marquée sent, la séquence avance quand même", async () => {
      // Pendant côté LinkedIn du test email équivalent : sendLinkedInStep réussit
      // (le message EST parti), puis storage.createOutreachMessage (DANS l'attempt de
      // sendOnce) rejette. On SAIT que l'envoi a eu lieu : on marque `sent` et on
      // avance, seule la ligne de journal manque.
      (linkedinConfigured as any).mockReturnValue(true);
      (sendLinkedInStep as any).mockResolvedValue({ ok: true, action: "invitation" });
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs({ linkedinUnipileAccountId: "acc1" }));
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead({ linkedinUrl: "https://linkedin.com/in/x" })]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (storage.countOutreachSentSince as any).mockResolvedValue(0);
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });
      (storage.createOutreachMessage as any).mockRejectedValue(new Error("DB down"));

      await expect(runProspectionSender()).resolves.toBeUndefined();

      expect(sendLinkedInStep).toHaveBeenCalledTimes(1);
      expect(storage.releaseStepSend).not.toHaveBeenCalled();
      expect(storage.markStepSendSent).toHaveBeenCalledWith(expect.objectContaining({ stepOrder: 1 }), "sent");
      expect(storage.updateLeadSequenceState).toHaveBeenCalledWith(1, expect.objectContaining({ currentStep: 1 }));
    });

    it("exception du fournisseur LinkedIn (sendLinkedInStep rejette) : la réservation N'EST PAS libérée, la séquence n'avance pas", async () => {
      // Invariant « dans le doute, ne jamais renvoyer » côté LinkedIn : Unipile n'a
      // pas répondu, l'issue est inconnue, la réservation doit rester `claimed`.
      (linkedinConfigured as any).mockReturnValue(true);
      (sendLinkedInStep as any).mockRejectedValue(new Error("Unipile injoignable"));
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs({ linkedinUnipileAccountId: "acc1" }));
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead({ linkedinUrl: "https://linkedin.com/in/x" })]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (storage.countOutreachSentSince as any).mockResolvedValue(0);
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await expect(runProspectionSender()).resolves.toBeUndefined();

      expect(sendLinkedInStep).toHaveBeenCalledTimes(1);
      expect(storage.releaseStepSend).not.toHaveBeenCalled();
      expect(storage.markStepSendSent).not.toHaveBeenCalled();
      expect(storage.createOutreachMessage).not.toHaveBeenCalled();
      expect(storage.updateLeadSequenceState).not.toHaveBeenCalled();
    });

    it("rattrapage : les rangs déjà réservés (relance de campagne) sont dépassés sans envoi ni génération IA", async () => {
      // Séquence de 3 étapes, rangs 1 et 2 déjà réservés (campagne relancée,
      // currentStep remis à 0). delayDays:0 sur toutes les étapes pour que la
      // décision reste `send` et que le rattrapage soit exercé dans le même tick.
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue([
        baseStep({ stepOrder: 1, delayDays: 0 }),
        baseStep({ id: 101, stepOrder: 2, delayDays: 0 }),
        baseStep({ id: 102, stepOrder: 3, delayDays: 0 }),
      ]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead()]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (storage.countOutreachSentSince as any).mockResolvedValue(0);
      (storage.getReservedStepOrders as any).mockResolvedValue([1, 2]);
      (generateStepMessage as any).mockResolvedValue({ subject: "Sujet", body: "Corps" });

      await runProspectionSender();

      // Aucun message généré (donc aucun coût IA) pour les rangs 1 et 2 : un seul
      // appel, pour l'étape 3, envoyée directement dans le même tick.
      expect(generateStepMessage).toHaveBeenCalledTimes(1);
      // L'étape générée est bien la troisième de la séquence (id 102), pas
      // n'importe laquelle : le comptage d'appels seul ne suffit pas à le garantir.
      expect(generateStepMessage).toHaveBeenCalledWith(
        "u1",
        expect.objectContaining({ step: expect.objectContaining({ id: 102 }) }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(storage.claimStepSend).toHaveBeenCalledTimes(1);
      expect(storage.claimStepSend).toHaveBeenCalledWith(expect.objectContaining({ stepOrder: 3 }));
      // La lecture des rangs réservés doit avoir lieu UNE SEULE FOIS par prospect,
      // avant la boucle de décision — pas à chaque itération de rattrapage.
      expect(storage.getReservedStepOrders).toHaveBeenCalledTimes(1);
      const advance = (storage.updateLeadSequenceState as any).mock.calls.at(-1);
      expect(advance[1]).toMatchObject({ currentStep: 3 });
    });

    it("rattrapage total : tous les rangs déjà réservés → séquence terminée sans envoi ni génération IA", async () => {
      // Cas normal d'une relance de campagne déjà terminée : les 3 rangs sont déjà
      // réservés, il ne reste donc rien à envoyer ni à générer — la séquence doit
      // simplement se conclure en `completed`.
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue([
        baseStep({ stepOrder: 1, delayDays: 0 }),
        baseStep({ id: 101, stepOrder: 2, delayDays: 0 }),
        baseStep({ id: 102, stepOrder: 3, delayDays: 0 }),
      ]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead()]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (storage.countOutreachSentSince as any).mockResolvedValue(0);
      (storage.getReservedStepOrders as any).mockResolvedValue([1, 2, 3]);
      (generateStepMessage as any).mockResolvedValue({ subject: "Sujet", body: "Corps" });

      await runProspectionSender();

      expect(generateStepMessage).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(sendLinkedInStep).not.toHaveBeenCalled();
      const advance = (storage.updateLeadSequenceState as any).mock.calls.at(-1);
      expect(advance[1]).toMatchObject({ status: "completed", nextRunAt: null });
    });

    it("rattrapage : une lecture des rangs réservés qui échoue ne fait pas tomber le prospect", async () => {
      // getReservedStepOrders().catch(() => []) : le comportement reste celui
      // d'aujourd'hui — l'étape courante est traitée normalement, la réservation en
      // aval (claimStepSend) jouant son rôle de filet contre une éventuelle course.
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(openPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ delayDays: 0 })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([baseLead()]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (storage.countOutreachSentSince as any).mockResolvedValue(0);
      (storage.getReservedStepOrders as any).mockRejectedValue(new Error("DB down"));
      (generateStepMessage as any).mockResolvedValue({ subject: "Sujet", body: "Corps" });

      await expect(runProspectionSender()).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(storage.claimStepSend).toHaveBeenCalledWith(expect.objectContaining({ stepOrder: 1 }));
      expect(storage.updateLeadSequenceState).toHaveBeenCalledWith(1, expect.objectContaining({ currentStep: 1 }));
    });
  });

  // ─── Fenêtre locale de la cible & sessions de prospection (ce lot) ───────────────
  //
  // Deux filtres NOUVEAUX, tous deux évalués AVANT `decideLinkedInAction` (jamais
  // assouplie) : (1) la cible doit être joignable MAINTENANT dans SON fuseau
  // (`isTargetReachableAt`), (2) on doit être dans une SESSION de prospection
  // (`isWithinAnySession`/`planDailySessions`). Chaque test isole un SEUL des deux
  // filtres — voir le commentaire sur `LINKEDIN_TEST_NOW` : cet instant est
  // reachable=true ET dans une session pour FR/u1/2026-06-10, donc "tout le reste"
  // passe déjà par défaut ; chaque test ne bouge qu'UNE variable (l'horloge, ou le
  // pays) pour ne faire échouer QUE le mécanisme visé — jamais un autre garde-fou en
  // amont (restriction, plafond, fenêtre de l'utilisatrice…).
  //
  // PREUVE PAR MUTATION (exigée par le brief : plusieurs tests de ce lot se sont
  // révélés creux). Procédure appliquée manuellement pour les deux tests marqués
  // "MUTATION" ci-dessous : commenter l'appel au filtre visé dans
  // `prospection-sender.ts`, relancer CE seul test, constater qu'il devient rouge,
  // restaurer. Résultat rapporté dans task-6-report.md.
  describe("fenêtre cible & sessions de prospection", () => {
    const linkedinPrefs = () => openPrefs({ linkedinUnipileAccountId: "acc1" });
    const linkedinStep = () => [baseStep({ channel: "linkedin" })];
    const linkedinLead = (overrides: Record<string, any> = {}) =>
      baseLead({ linkedinUrl: "https://linkedin.com/in/x", ...overrides });

    it("cible hors de sa fenêtre locale (outside_window, temporel) : aucun appel Unipile, PAS de signalement, séquence non avancée", async () => {
      // 03:00Z ce jour-là est bien AVANT la fenêtre FR (07:00-16:00Z) : refus
      // `outside_window`, TEMPOREL — jamais inscrit en base (voir doc de
      // `setLeadUnreachable`), sinon "pas maintenant" deviendrait "jamais". NOTE :
      // parce qu'une session ne peut jamais exister EN DEHORS de la fenêtre de sa
      // cible (elle en est un sous-ensemble, voir `planDailySessions`), ce cas ne
      // peut PAS isoler le filtre de fenêtre du filtre de session à lui seul — les
      // deux bloqueraient de toute façon. C'est le test "MUTATION 1" ci-dessous,
      // construit avec un lead à pays inconnu dans un lot où un AUTRE lead alimente
      // une session valide, qui isole réellement le filtre de fenêtre/joignabilité.
      vi.setSystemTime(new Date("2026-06-10T03:00:00.000Z"));
      (linkedinConfigured as any).mockReturnValue(true);
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(linkedinPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue(linkedinStep());
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([linkedinLead()]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(sendLinkedInStep).not.toHaveBeenCalled();
      expect(storage.claimStepSend).not.toHaveBeenCalled();
      // Refusé AVANT tout coût DB/IA (avant même l'historique LinkedIn et
      // generateStepMessage) : c'est un des deux nouveaux filtres qui doit arrêter ce lead.
      expect(generateStepMessage).not.toHaveBeenCalled();
      expect(storage.setLeadUnreachable).not.toHaveBeenCalled();
      expect(storage.updateLeadSequenceState).not.toHaveBeenCalled();
    });

    it("MUTATION 1 — pays inconnu (country_unknown) isolé de tout effet de session : dans un lot où un AUTRE lead (FR) alimente une session valide couvrant l'instant, le lead à pays inconnu reste bloqué PAR LA JOIGNABILITÉ, jamais par la session", async () => {
      // Isolation réelle du filtre `isTargetReachableAt`, indépendamment du filtre
      // de session : les sessions de ce compte sont calculées à partir des pays de
      // TOUS les leads dus de l'utilisateur (lead 1, FR, contribue une session qui
      // couvre LINKEDIN_TEST_NOW — déjà vérifié par le test témoin ci-dessus), alors
      // que la joignabilité, elle, est évaluée par lead : le lead 2 (pays inconnu)
      // doit donc être bloqué par sa PROPRE non-joignabilité, même si "une session
      // existe et couvre l'instant" pour le compte. Le lead 1 est traité en PREMIER
      // dans `due` et envoie réellement — s'il envoyait APRÈS le lead 2, un
      // hypothétique envoi du lead 2 pousserait le délai minimum et masquerait la
      // mutation par un autre garde-fou (piège documenté dans le brief).
      (linkedinConfigured as any).mockReturnValue(true);
      (sendLinkedInStep as any).mockResolvedValue({ ok: true, action: "invitation" });
      const stateFr = baseState({ id: 1, leadId: 1 });
      const stateUnknown = baseState({ id: 2, leadId: 2 });
      (storage.getDueEnrollments as any).mockResolvedValue([stateFr, stateUnknown]);
      (storage.getUserPreferences as any).mockResolvedValue(linkedinPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue(linkedinStep());
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([
        linkedinLead({ id: 1, linkedinUrl: "https://linkedin.com/in/lead1" }), // FR, reachable
        linkedinLead({
          id: 2,
          linkedinUrl: "https://linkedin.com/in/lead2",
          enrichedProfile: { linkedin: { raw: { country_code: null } } }, // pays inconnu
        }),
      ]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      // Le lead FR part normalement (preuve que la session couvre bien l'instant
      // pour ce compte — si ce n'était pas le cas, le test ne discriminerait rien).
      expect(sendLinkedInStep).toHaveBeenCalledWith(expect.objectContaining({ linkedinUrl: "https://linkedin.com/in/lead1" }));
      expect(sendLinkedInStep).toHaveBeenCalledTimes(1);
      // Le lead à pays inconnu, lui, est signalé — SANS mutation, seul le filtre de
      // joignabilité peut expliquer ce signalement (le filtre de session, lui,
      // laisserait passer : une session existe et couvre l'instant pour ce compte).
      expect(storage.setLeadUnreachable).toHaveBeenCalledTimes(1);
      expect(storage.setLeadUnreachable).toHaveBeenCalledWith(2, expect.stringContaining("country_unknown"));
    });

    it("MUTATION 2 — cible joignable chez elle mais HORS SESSION : aucun appel Unipile, aucun signalement (le lead n'y est pour rien), séquence non avancée", async () => {
      // 09:00Z ce jour-là est DANS la fenêtre FR (07:00-16:00Z) mais entre les deux
      // sessions calculées pour u1/2026-06-10/["FR"] : [07:24:27.866Z,07:39:30.747Z)
      // et [13:06:08.081Z,13:22:19.944Z). Si ce test échouait pour la fenêtre cible
      // plutôt que pour la session, `storage.setLeadUnreachable` serait quand même
      // appelé pour un motif structurel — il ne l'est jamais ici, preuve que
      // c'est bien le filtre de session qui arrête ce lead.
      vi.setSystemTime(new Date("2026-06-10T09:00:00.000Z"));
      (linkedinConfigured as any).mockReturnValue(true);
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(linkedinPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue(linkedinStep());
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([linkedinLead()]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(sendLinkedInStep).not.toHaveBeenCalled();
      expect(storage.claimStepSend).not.toHaveBeenCalled();
      expect(generateStepMessage).not.toHaveBeenCalled();
      expect(storage.setLeadUnreachable).not.toHaveBeenCalled();
      expect(storage.updateLeadSequenceState).not.toHaveBeenCalled();
    });

    it("cible reachable ET en session (LINKEDIN_TEST_NOW) : l'envoi a bien lieu — témoin positif des deux tests MUTATION ci-dessus", async () => {
      // Sans ce témoin, les deux tests MUTATION pourraient passer pour une mauvaise
      // raison (ex. un autre garde-fou bloquerait TOUJOURS ce lead, quelle que soit
      // l'horloge) : ce test prouve qu'au bon instant, le même lead part réellement.
      (linkedinConfigured as any).mockReturnValue(true);
      (sendLinkedInStep as any).mockResolvedValue({ ok: true, action: "invitation" });
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(linkedinPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue(linkedinStep());
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([linkedinLead()]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(sendLinkedInStep).toHaveBeenCalledTimes(1);
    });

    it("pays inconnu (country_unknown, STRUCTUREL) : signalé via setLeadUnreachable, aucun appel Unipile", async () => {
      (linkedinConfigured as any).mockReturnValue(true);
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(linkedinPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue(linkedinStep());
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([
        linkedinLead({ enrichedProfile: { linkedin: { raw: { country_code: null } } } }),
      ]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(sendLinkedInStep).not.toHaveBeenCalled();
      expect(storage.setLeadUnreachable).toHaveBeenCalledTimes(1);
      expect(storage.setLeadUnreachable).toHaveBeenCalledWith(1, expect.stringContaining("country_unknown"));
    });

    it("pays non-string dans le profil enrichi (ex. code numérique) : traité comme inconnu, jamais comme joignable", async () => {
      (linkedinConfigured as any).mockReturnValue(true);
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(linkedinPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue(linkedinStep());
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([
        linkedinLead({ enrichedProfile: { linkedin: { raw: { country_code: 33 } } } }),
      ]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(sendLinkedInStep).not.toHaveBeenCalled();
      expect(storage.setLeadUnreachable).toHaveBeenCalledWith(1, expect.stringContaining("country_unknown"));
    });

    it("lecture du profil enrichi impossible (enrichedProfile absent) : refus par prudence, signalé comme pays inconnu", async () => {
      (linkedinConfigured as any).mockReturnValue(true);
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(linkedinPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue(linkedinStep());
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([linkedinLead({ enrichedProfile: null })]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(sendLinkedInStep).not.toHaveBeenCalled();
      expect(storage.setLeadUnreachable).toHaveBeenCalledWith(1, expect.stringContaining("country_unknown"));
    });

    it("lead redevenu joignable (portait une raison) : la raison est effacée UNE FOIS, l'envoi part normalement", async () => {
      (linkedinConfigured as any).mockReturnValue(true);
      (sendLinkedInStep as any).mockResolvedValue({ ok: true, action: "invitation" });
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(linkedinPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue(linkedinStep());
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([
        linkedinLead({ outreachUnreachableReason: "country_unknown: pays absent — refus par prudence." }),
      ]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(storage.setLeadUnreachable).toHaveBeenCalledTimes(1);
      expect(storage.setLeadUnreachable).toHaveBeenCalledWith(1, null);
      expect(sendLinkedInStep).toHaveBeenCalledTimes(1);
    });

    it("lead jamais signalé et toujours joignable : `setLeadUnreachable` n'est JAMAIS appelé (pas d'écriture à chaque tick)", async () => {
      (linkedinConfigured as any).mockReturnValue(true);
      (sendLinkedInStep as any).mockResolvedValue({ ok: true, action: "invitation" });
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(linkedinPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue(linkedinStep());
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([linkedinLead()]); // outreachUnreachableReason: null par défaut
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(sendLinkedInStep).toHaveBeenCalledTimes(1);
      expect(storage.setLeadUnreachable).not.toHaveBeenCalled();
    });

    it("deux leads du même utilisateur, un seul pays en attente (FR ×2) : la pondération par volume ne change pas le créneau retenu — le premier part, le second est arrêté par le délai minimum (PAS par la fenêtre cible ni la session)", async () => {
      // Non-régression de la pondération par VOLUME (prospection-sessions.ts) :
      // avec un seul pays distinct présent, le poids (1 vs 2) ne doit rien changer au
      // créneau choisi ni à la session qui en résulte. Le second lead n'appelle
      // jamais Unipile ici — mais PAS à cause de nos deux nouveaux filtres (sinon ce
      // serait un signalement `setLeadUnreachable` ou aucun log de garde) : c'est le
      // délai minimum entre deux actions LinkedIn du même compte
      // (LINKEDIN_MIN_DELAY_BASE_MS) qui l'arrête, l'horloge étant figée dans ce test
      // (même mécanisme que le test "un échec... alimente EN DIRECT" plus haut).
      const logSpy = vi.spyOn(console, "log");
      (linkedinConfigured as any).mockReturnValue(true);
      (sendLinkedInStep as any).mockResolvedValue({ ok: true, action: "invitation" });
      const state1 = baseState({ id: 1, leadId: 1 });
      const state2 = baseState({ id: 2, leadId: 2 });
      (storage.getDueEnrollments as any).mockResolvedValue([state1, state2]);
      (storage.getUserPreferences as any).mockResolvedValue(linkedinPrefs());
      (storage.getSequenceSteps as any).mockResolvedValue(linkedinStep());
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([
        linkedinLead({ id: 1, linkedinUrl: "https://linkedin.com/in/lead1" }),
        linkedinLead({ id: 2, linkedinUrl: "https://linkedin.com/in/lead2" }),
      ]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      expect(sendLinkedInStep).toHaveBeenCalledTimes(1);
      expect(storage.setLeadUnreachable).not.toHaveBeenCalled();
      const logMessages = logSpy.mock.calls.map((c) => String(c[0]));
      expect(logMessages.some((m) => m.includes("min_delay_not_elapsed"))).toBe(true);
    });
  });

  // ─── Ronde de correction 1 : IMPORTANT 1 — la date civile doit venir du fuseau de
  // CHAQUE utilisateur, jamais figée sur Paris ───────────────────────────────────
  describe("todayStr par utilisateur (jamais figé sur Paris)", () => {
    it("MUTATION — utilisatrice à Pacific/Kiritimati (UTC+14, la première à changer de jour civil sur Terre) : la fenêtre/session couvre son PROPRE présent", async () => {
      // Fixture calculée hors-ligne (voir task-6-report.md) : au 2025-12-31T21:49:54.873Z,
      // le jour civil de Kiritimati est déjà "2026-01-01" alors que celui de Paris est
      // encore "2025-12-31" — les deux jours DIFFÈRENT, condition nécessaire pour que ce
      // test discrimine quoi que ce soit. Cible NZ (Pacific/Auckland, proche de
      // Kiritimati) : avec le jour civil de Kiritimati, sa fenêtre et une session réelle
      // couvrent cet instant ; avec le jour civil de Paris (bug), ni l'une ni l'autre ne
      // le couvrent (vérifié directement par calcul, voir le script de préparation).
      vi.setSystemTime(new Date("2025-12-31T21:49:54.873Z"));
      (linkedinConfigured as any).mockReturnValue(true);
      (sendLinkedInStep as any).mockResolvedValue({ ok: true, action: "invitation" });
      (storage.getDueEnrollments as any).mockResolvedValue([baseState()]);
      (storage.getUserPreferences as any).mockResolvedValue(
        openPrefs({
          timezone: "Pacific/Kiritimati",
          workDayStart: "00:00",
          workDayEnd: "23:59",
          linkedinUnipileAccountId: "acc1",
        }),
      );
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      (storage.getLeads as any).mockResolvedValue([
        baseLead({
          linkedinUrl: "https://linkedin.com/in/x",
          enrichedProfile: { linkedin: { raw: { country_code: "NZ", city: null } } },
        }),
      ]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      // Preuve par mutation appliquée manuellement (voir task-6-report.md pour le
      // chiffre) : remettre `todayStr` en dur sur `parisTodayString`/Europe-Paris fait
      // passer cette assertion de vert à rouge — ni la fenêtre NZ ni aucune session ne
      // couvrent alors cet instant, `sendLinkedInStep` ne serait jamais appelé.
      expect(sendLinkedInStep).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Ronde de correction 1 : IMPORTANT 2 — la pondération par VOLUME (pas par pays
  // présent) doit réellement déplacer le créneau retenu ───────────────────────────
  describe("pondération des sessions par volume de cibles (pas par pays présent)", () => {
    it("MUTATION — 20 leads HK contre 1 lead SN (créneaux disjoints [01:00,10:00) / [09:00,18:00) UTC) : le lead SN, minoritaire, n'obtient PAS de session dans sa région exclusive", async () => {
      // Fixture reprise de prospection-sessions.test.ts (déjà vérifiée en tâche 4) :
      // HK (Asia/Hong_Kong, UTC+8, pas d'heure d'été) et SN (Africa/Dakar, UTC+0, pas
      // d'heure d'été) ont des fenêtres disjointes sans ambiguïté à partir de 10:00 UTC
      // (HK s'arrête à 10:00 ; SN, lui, continue jusqu'à 18:00). `now` = 10:30 UTC est
      // dans la région "SN seul" (>= 10:00 UTC) — la SEULE façon d'y obtenir une session
      // est que le créneau SN ait été retenu au moins une fois. Calculé hors-ligne pour
      // userId "u1" / 2026-07-15 (voir task-6-report.md) : avec la pondération réelle
      // (20 HK, poids 20, contre 1 SN, poids 1), AUCUNE session n'atteint cette région —
      // le lead SN, bien que joignable à cet instant (09:00-18:00 UTC), n'a simplement
      // pas de session pour partir. Avec des pays dédupliqués (poids 1 contre 1, bug),
      // une session APPARAÎT dans cette région exacte et couvre `now`.
      vi.setSystemTime(new Date("2026-07-15T10:30:00.000Z"));
      (linkedinConfigured as any).mockReturnValue(true);
      (sendLinkedInStep as any).mockResolvedValue({ ok: true, action: "invitation" });

      const hkStates = Array.from({ length: 20 }, (_, i) => baseState({ id: i + 1, leadId: i + 1 }));
      const snState = baseState({ id: 21, leadId: 21 });
      (storage.getDueEnrollments as any).mockResolvedValue([...hkStates, snState]);

      (storage.getUserPreferences as any).mockResolvedValue(
        openPrefs({
          timezone: "Europe/Paris",
          workDayStart: "09:00",
          workDayEnd: "18:00",
          linkedinUnipileAccountId: "acc1",
        }),
      );
      (storage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
      (storage.getLeadSignals as any).mockResolvedValue(baseSignals());
      const hkLeads = Array.from({ length: 20 }, (_, i) =>
        baseLead({
          id: i + 1,
          linkedinUrl: `https://linkedin.com/in/hk${i + 1}`,
          enrichedProfile: { linkedin: { raw: { country_code: "HK", city: null } } },
        }),
      );
      const snLead = baseLead({
        id: 21,
        linkedinUrl: "https://linkedin.com/in/sn21",
        enrichedProfile: { linkedin: { raw: { country_code: "SN", city: null } } },
      });
      (storage.getLeads as any).mockResolvedValue([...hkLeads, snLead]);
      (storage.getBrandDna as any).mockResolvedValue(null);
      (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
      (storage.getProspectionCampaign as any).mockResolvedValue({ id: 10, name: "Campagne" });
      (generateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

      await runProspectionSender();

      // Les 20 leads HK sont hors de leur fenêtre locale à 10:30 UTC (fenêtre HK :
      // 01:00-10:00 UTC) — refus TEMPOREL, jamais signalé. Le lead SN, lui, EST
      // joignable à cet instant (fenêtre SN : 09:00-18:00 UTC) mais aucune session ne
      // couvre `now` sous la pondération réelle : aucun appel Unipile, pour personne.
      expect(sendLinkedInStep).not.toHaveBeenCalled();
      expect(storage.setLeadUnreachable).not.toHaveBeenCalled();
      // Preuve par mutation appliquée manuellement (voir task-6-report.md pour le
      // chiffre) : dédupliquer `pendingCountryCodes` (`new Set([...])`) avant de
      // construire les sessions fait passer cette assertion de vert à rouge —
      // `sendLinkedInStep` serait alors appelé pour le lead SN (session parasite dans
      // sa région exclusive, causée par l'égalisation artificielle des poids).
    });
  });
});
