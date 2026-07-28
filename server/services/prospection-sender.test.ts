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
    claimStepSend: vi.fn(),
    markStepSendSent: vi.fn(),
    releaseStepSend: vi.fn(),
    getReservedStepOrders: vi.fn(),
  },
}));

vi.mock("./sequence-message", () => ({
  generateStepMessage: vi.fn(),
  combineInstructions: vi.fn(() => ""),
}));

vi.mock("./linkedin", () => ({
  linkedinConfigured: vi.fn(() => false),
  sendLinkedInStep: vi.fn(),
  // Recalculé à CHAQUE (ré)invocation de la factory (donc à chaque vi.resetModules())
  // pour permettre au test « plafond quotidien LinkedIn » de le stubber via l'env,
  // exactement comme LINKEDIN_DAILY_CAP est calculé dans le vrai module ./linkedin.
  LINKEDIN_DAILY_CAP: Number(process.env.LINKEDIN_DAILY_CAP) || 25,
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
    (storage.claimStepSend as any).mockResolvedValue(true);
    (storage.markStepSendSent as any).mockResolvedValue(undefined);
    (storage.releaseStepSend as any).mockResolvedValue(undefined);
    (storage.getReservedStepOrders as any).mockResolvedValue([]);
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

    it("plafond quotidien LinkedIn (LINKEDIN_DAILY_CAP) : une étape sautée (déjà réservée) ne consomme pas le plafond", async () => {
      // Même logique que le test DAILY_CAP email : LINKEDIN_DAILY_CAP est lu UNE
      // SEULE FOIS au chargement du module ./linkedin. On réinitialise le registre
      // de modules puis on stubbe l'env AVANT de réimporter dynamiquement, pour que
      // le worker relu voie bien LINKEDIN_DAILY_CAP=1.
      vi.resetModules();
      vi.stubEnv("LINKEDIN_DAILY_CAP", "1");
      try {
        const { storage: freshStorage } = await import("../storage");
        const { generateStepMessage: freshGenerateStepMessage } = await import("./sequence-message");
        const { linkedinConfigured: freshLinkedinConfigured, sendLinkedInStep: freshSendLinkedInStep } = await import(
          "./linkedin"
        );
        const { runProspectionSender: freshRunProspectionSender } = await import("./prospection-sender");

        const state1 = baseState({ id: 1, leadId: 1 });
        const state2 = baseState({ id: 2, leadId: 2 });

        (freshLinkedinConfigured as any).mockReturnValue(true);
        (freshSendLinkedInStep as any).mockResolvedValue({ ok: true, action: "invitation" });
        (freshStorage.getDueEnrollments as any).mockResolvedValue([state1, state2]);
        (freshStorage.getUserPreferences as any).mockResolvedValue(openPrefs({ linkedinUnipileAccountId: "acc1" }));
        (freshStorage.getSequenceSteps as any).mockResolvedValue([baseStep({ channel: "linkedin" })]);
        (freshStorage.getLeadSignals as any).mockResolvedValue(baseSignals());
        (freshStorage.getLeads as any).mockResolvedValue([
          baseLead({ id: 1, linkedinUrl: "https://linkedin.com/in/lead1" }),
          baseLead({ id: 2, linkedinUrl: "https://linkedin.com/in/lead2" }),
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
          .mockResolvedValueOnce(false) // prospect 1 : déjà réservée → sautée, ne doit PAS consommer le plafond LinkedIn
          .mockResolvedValueOnce(true); // prospect 2 : doit partir quand même malgré LINKEDIN_DAILY_CAP=1
        (freshGenerateStepMessage as any).mockResolvedValue({ subject: null, body: "Corps" });

        await freshRunProspectionSender();

        // Un seul prospect a réellement pu réserver (le second) ; s'il n'était pas
        // parti, ce serait la preuve que le premier (sauté) a quand même consommé
        // le plafond LinkedIn de 1.
        expect(freshSendLinkedInStep).toHaveBeenCalledTimes(1);
      } finally {
        vi.unstubAllEnvs();
      }
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
});
