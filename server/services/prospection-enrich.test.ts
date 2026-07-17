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
  },
}));
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
  return { ...actual, callClaude: vi.fn() };
});
vi.mock("./prospection-access", async (io) => {
  const actual = await io<any>();
  return { ...actual, assertEnrichmentAccess: vi.fn(async () => {}), logProspectionUsage: vi.fn(async () => {}) };
});

import { storage } from "../storage";
import * as claude from "./claude";
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
  (claude.callClaude as any)
    .mockResolvedValueOnce(JSON.stringify({
      contexteMarque: "Maison de mode.", audience: "…", contenu: "…",
      positionnement: "…", enjeux: "manque de coulisses",
      angle: "proposer un format coulisses pour la campagne",
    }))
    .mockResolvedValueOnce(JSON.stringify({
      linkedinMessage: "Bonjour Marie, votre virage sur les coulisses m'a marquée. Qu'est-ce qui l'a déclenché ? Jeanne",
    }));
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
    expect(upd.linkedinMessage.length).toBeLessThanOrEqual(200);
    expect(upd.linkedinMessage).not.toContain("—");
    expect(upd.stage).toBe("messages_ready");
    expect(upd.enrichedProfile.linkedin.company).toBe("Maison X");
    // Compat affichage : champs legacy remplis
    expect(upd.strategicNotes).toBe(upd.auditNotes);
    expect(upd.message1).toBe(upd.linkedinMessage);

    // Signature = PRÉNOM (Jeanne), jamais le nom d'agence dans le prompt de message
    const messagePrompt = (claude.callClaude as any).mock.calls[1][0].messages[0].content;
    expect(messagePrompt).toContain("Jeanne");
    expect(messagePrompt).not.toMatch(/Signé du prénom : Agence JMD/);
  });

  it("la garde d'accès bloque en entrée (plan base → throw, aucun scrape)", async () => {
    (access.assertEnrichmentAccess as any).mockRejectedValueOnce(new ProspectionAccessError());
    await expect(enrichProspects("u1", campaign, [10])).rejects.toBeInstanceOf(ProspectionAccessError);
    expect(storage.getLead).not.toHaveBeenCalled();
    expect(access.logProspectionUsage).not.toHaveBeenCalled();
  });
});
