import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks : DB, provider Bright Data, Claude, garde d'accès. On garde la logique PURE
// (strategy/audit/priority) réelle.
vi.mock("../storage", () => ({
  storage: {
    getLead: vi.fn(),
    getProject: vi.fn(),
    getBrandDnaForProject: vi.fn(),
    getBrandDna: vi.fn(),
    getUser: vi.fn(),
    updateLead: vi.fn(),
    // Depuis le 18 septembre, la redaction des messages passe par callClaudeWithContext :
    // le generateur recevait auparavant DEUX lignes d'audit et aucun Brand DNA, d'ou des
    // messages qui ne disaient jamais ce que propose l'utilisatrice. buildNayaContext
    // reclame donc ces lectures supplementaires. Elles rendent du vide ici : ce test verifie
    // l'enrichissement et les couts, pas le contenu du contexte.
    getActiveGoalsForProject: vi.fn(async () => []),
    getGoalProgress: vi.fn(async () => null),
    getLatestPersonaAnalysis: vi.fn(async () => null),
    getMilestones: vi.fn(async () => []),
    getProjectStrategyProfile: vi.fn(async () => null),
    getTargetPersonas: vi.fn(async () => []),
    getUserPreferences: vi.fn(async () => null),
    // Depuis le 12 octobre : brief (preuves validées), rédaction unique (séquence, exemples,
    // règles apprises) et cache de la première touche.
    getProjectProofs: vi.fn(async () => []),
    getProjectProof: vi.fn(async () => undefined),
    getSequenceSteps: vi.fn(async () => []),
    getMessageFeedback: vi.fn(async () => []),
    getLearnedRules: vi.fn(async () => []),
    upsertLeadStepMessage: vi.fn(async () => {}),
    getLeadStepMessage: vi.fn(async () => undefined),
  },
}));
vi.mock("./prospection/relecture", () => ({ relire: vi.fn(async () => []) }));
vi.mock("./serp", async (io) => ({ ...(await io<any>()), serpConfigured: () => false }));
vi.mock("./brightdata-enrich", () => ({
  linkedinEnrichConfigured: () => true,
  instagramEnrichConfigured: () => false,
  webScrapeConfigured: () => false,
  scrapeLinkedInProfile: vi.fn(async () => ({
    headline: "Directrice marketing",
    company: "Maison X",
    about: "prépare un rebranding en 2026",
    raw: {},
  })),
  scrapeInstagramProfile: vi.fn(),
  scrapeAsMarkdown: vi.fn(),
}));
vi.mock("./claude", async (io) => {
  const actual = await io<any>();
  // callClaudeWithContext est mocke depuis le 18 septembre : la redaction des messages
  // passe par lui pour recevoir le Brand DNA, la voix et la langue du compte. Avant, elle
  // appelait callClaude sans aucun contexte — le generateur ignorait ce que propose
  // l'utilisatrice, d'ou des messages qui n'en parlaient jamais.
  return { ...actual, callClaude: vi.fn(), callClaudeWithContext: vi.fn() };
});
vi.mock("./prospection-access", async (io) => {
  const actual = await io<any>();
  return { ...actual, assertEnrichmentAccess: vi.fn(async () => {}), logProspectionUsage: vi.fn(async () => {}) };
});

// La tâche de validation du planning est synchronisée en fin d'enrichissement.
vi.mock("./prospection-verification", () => ({
  synchroniserValidationsProspection: vi.fn(async () => ({ creees: 1, majs: 0, closes: 0 })),
}));

import { storage } from "../storage";
import * as claude from "./claude";
import * as verification from "./prospection-verification";
import * as access from "./prospection-access";
import { ProspectionAccessError } from "./prospection-access";
import { enrichProspects } from "./prospection-pipeline";

const campaign = {
  id: 5,
  projectId: 8,
  channel: "linkedin",
  buyingSignals: "rebranding, levée de fonds",
  name: "De Stratège à Scène",
  targetSector: "Mode & Beauté",
  messageAngle: "raconter les coulisses",
};

beforeEach(() => {
  vi.clearAllMocks();
  (storage.getLead as any).mockResolvedValue({
    id: 10, userId: "u1", name: "Marie Dupont", role: "Directrice marketing",
    company: "Maison X", linkedinUrl: "https://linkedin.com/in/marie", instagramUrl: null, profileUrl: null,
  });
  (storage.getProject as any).mockResolvedValue({ id: 8, name: "Agence JMD", type: "Agency" });
  (storage.getBrandDnaForProject as any).mockResolvedValue({ businessType: "agence de communication", businessName: "Agence JMD" });
  (storage.getBrandDna as any).mockResolvedValue({ businessType: "agence de communication", businessName: "Agence JMD" });
  (storage.getUser as any).mockResolvedValue({ id: "u1", firstName: "Jeanne" });
  (storage.updateLead as any).mockResolvedValue({});
  // Un seul point d'entrée IA, aiguillé par le contenu du prompt : audit, qualification,
  // brief, puis rédaction (depuis le 12 octobre, tout passe par callClaudeWithContext).
  (claude.callClaudeWithContext as any).mockImplementation(async ({ userMessage }: any) => {
    if (userMessage.includes("audit factuel")) {
      return JSON.stringify({
        contexteMarque: "Maison de mode.", audience: "…", contenu: "…",
        positionnement: "…", enjeux: "manque de coulisses", angle: "proposer un format coulisses",
      });
    }
    if (userMessage.includes("BRIEF d'une prise de contact")) {
      return JSON.stringify({
        declencheur: { fait: "Maison X prépare un rebranding en 2026", source: "profil" },
        raison: "Rebranding en cours.", proposition: { type: "idee", contenu: "un format coulisses" },
        angles: ["le rebranding", "un format coulisses", "clore"], langue: "fr", registre: "vous",
      });
    }
    if (userMessage.includes("DOCTRINE DE PROSPECTION")) return JSON.stringify({ body: MESSAGE });
    return JSON.stringify({ verdict: "retenu", raison: "Maison en rebranding.", confiance: "haute" });
  });
});

const MESSAGE = "Bonjour Marie, le rebranding de Maison X m'a parlé : je dirige JMD, on raconte les coulisses des maisons de mode. Au plaisir d'échanger. Jeanne";

describe("enrichProspects — tâche de validation dans le planning", () => {
  it("synchronise la tâche « Valider les messages » de la campagne une fois les messages prêts", async () => {
    await enrichProspects("u1", campaign, [10]);
    expect(verification.synchroniserValidationsProspection).toHaveBeenCalledTimes(1);
    expect(verification.synchroniserValidationsProspection).toHaveBeenCalledWith("u1", undefined, { campaignId: 5 });
  });

  it("un échec de synchronisation ne fait pas échouer l'enrichissement", async () => {
    (verification.synchroniserValidationsProspection as any).mockRejectedValueOnce(new Error("db"));
    const res = await enrichProspects("u1", campaign, [10]);
    expect(res.enriched).toBe(1);
  });
});

describe("enrichProspects — condition 3 (données + coûts enregistrés)", () => {
  it("enrichit, détecte le signal d'achat, et logge chaque coût", async () => {
    const res = await enrichProspects("u1", campaign, [10]);

    expect(res).toEqual({ enriched: 1, failed: 0, linkedin_requests_used: 1 });

    // Coûts loggés dans prospection_usage
    const ops = (access.logProspectionUsage as any).mock.calls.map((c: any[]) => c[1]);
    expect(ops).toContain("bright_data_linkedin_enrich");
    expect(ops).toContain("claude_audit");
    expect(ops).toContain("claude_message");

    // CRM mis à jour avec données réelles + priorité + message
    const upd = (storage.updateLead as any).mock.calls[0][2];
    expect(upd.enriched).toBe(true);
    expect(upd.priority).toBe("hot"); // "rebranding" présent dans les données
    expect(upd.linkedinMessage.length).toBeLessThanOrEqual(300);
    expect(upd.linkedinMessage).not.toContain("—");
    expect(upd.stage).toBe("messages_ready");
    // Messages neufs : la validation donnée aux précédents est retirée.
    expect(upd).toHaveProperty("validatedAt", null);
    expect(upd.enrichedProfile.linkedin.company).toBe("Maison X");
    // Compat affichage : champs legacy remplis
    expect(upd.strategicNotes).toBe(upd.auditNotes);
    expect(upd.message1).toBe(upd.linkedinMessage);

    // Le brief est écrit sur la fiche, et la rédaction part du brief, signée du PRÉNOM.
    expect(upd.prospectBrief.declencheur.fait).toContain("rebranding");
    expect(upd.linkedinMessage).toBe(MESSAGE);
    const messagePrompt = (claude.callClaudeWithContext as any).mock.calls
      .map((c: any[]) => c[0]).find((a: any) => a.userMessage.includes("DOCTRINE DE PROSPECTION"));
    expect(messagePrompt.destinataire).toBe("tiers");
    expect(messagePrompt.userMessage).toContain("Jeanne");
    expect(messagePrompt.userMessage).toContain("Maison X prépare un rebranding");
    expect(messagePrompt.userMessage).not.toMatch(/Signature : Agence JMD/);
  });

  it("brief en échec mais note sur la fiche : la note sert de déclencheur", async () => {
    (storage.getLead as any).mockResolvedValue({
      id: 10, userId: "u1", name: "Marie Dupont", role: "Directrice marketing", company: "Maison X",
      linkedinUrl: "https://linkedin.com/in/marie", notes: "Rencontrée au salon Première Vision",
    });
    const defaut = (claude.callClaudeWithContext as any).getMockImplementation();
    (claude.callClaudeWithContext as any).mockImplementation(async (a: any) => {
      if (a.userMessage.includes("BRIEF d'une prise de contact")) throw new Error("panne");
      return defaut(a);
    });
    await enrichProspects("u1", campaign, [10]);
    const upd = (storage.updateLead as any).mock.calls.at(-1)[2];
    expect(upd.prospectBrief.declencheur).toEqual(expect.objectContaining({ fait: "Rencontrée au salon Première Vision", source: "note" }));
    expect(upd.linkedinMessage).toBe(MESSAGE);
  });

  it("ré-enrichir ne remplace ni un brief modifié par l'utilisatrice, ni un message qu'elle a édité", async () => {
    const briefEdite = { declencheur: { fait: "Vu au salon", source: "note" }, preuveId: null, raison: "r", proposition: { type: "idee", contenu: "c" }, angles: ["a"], langue: "fr", registre: "vous", genereLe: "x", edite: true };
    (storage.getLead as any).mockResolvedValue({
      id: 10, userId: "u1", name: "Marie Dupont", role: "Directrice marketing", company: "Maison X",
      linkedinUrl: "https://linkedin.com/in/marie", prospectBrief: briefEdite, linkedinMessage: "MON TEXTE",
    });
    (storage.getSequenceSteps as any).mockResolvedValue([{ id: 11, channel: "linkedin", condition: "always", role: "invitation" }]);
    (storage.getLeadStepMessage as any).mockResolvedValueOnce({ body: "MON TEXTE", edited: true });
    await enrichProspects("u1", campaign, [10]);
    const upd = (storage.updateLead as any).mock.calls.at(-1)[2];
    expect(upd.prospectBrief).toEqual(briefEdite);
    expect(upd.linkedinMessage).toBe("MON TEXTE");
    expect(storage.upsertLeadStepMessage).not.toHaveBeenCalled();
    (storage.getSequenceSteps as any).mockResolvedValue([]);
  });

  it("sans déclencheur réel : aucun message, le prospect reste à compléter", async () => {
    (claude.callClaudeWithContext as any).mockImplementation(async ({ userMessage }: any) => {
      if (userMessage.includes("BRIEF d'une prise de contact")) return JSON.stringify({ declencheur: null, angles: [] });
      if (userMessage.includes("DOCTRINE DE PROSPECTION")) throw new Error("ne doit pas rédiger");
      if (userMessage.includes("audit factuel")) return JSON.stringify({ angle: "x" });
      return JSON.stringify({ verdict: "retenu", raison: "x", confiance: "haute" });
    });
    await enrichProspects("u1", campaign, [10]);
    const upd = (storage.updateLead as any).mock.calls.at(-1)[2];
    expect(upd.linkedinMessage).toBeUndefined();
    expect(upd.stage).toBe("identified");
    expect(upd.prospectBrief.declencheur).toBeNull();
  });

  it("la garde d'accès bloque en entrée (plan base → throw, aucun scrape)", async () => {
    (access.assertEnrichmentAccess as any).mockRejectedValueOnce(new ProspectionAccessError());
    await expect(enrichProspects("u1", campaign, [10])).rejects.toBeInstanceOf(ProspectionAccessError);
    expect(storage.getLead).not.toHaveBeenCalled();
    expect(access.logProspectionUsage).not.toHaveBeenCalled();
  });
});
