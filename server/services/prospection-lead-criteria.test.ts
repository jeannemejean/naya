import { describe, it, expect, vi, beforeEach } from "vitest";

// On mocke le storage (accès DB) et callClaudeDetailed (réseau) mais on GARDE la vraie
// assertNotTruncated + CLAUDE_MODELS (via importOriginal) pour tester le vrai garde-fou.
vi.mock("../storage", () => ({
  storage: {
    getProspectionCampaign: vi.fn(),
    getBrandDnaForProject: vi.fn(),
    getBrandDna: vi.fn(),
  },
}));
vi.mock("./claude", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, callClaudeDetailed: vi.fn() };
});

import { storage } from "../storage";
import * as claude from "./claude";
import { assertNotTruncated } from "./claude";
import { generateLeadCriteria, buildProspectionContext, projectOfferNature } from "./prospection";

const VALID_JSON = JSON.stringify({
  rationale: "cible les acheteurs de conférences",
  jobTitles: ["directeur de conférence", "responsable programmation événementielle"],
  seniority: ["senior"], sectors: ["événementiel B2B"], companySize: "PME", geographies: ["France"],
  keywords: ["call for speakers"], exclusions: ["étudiants"],
  linkedinQueries: ['"directeur de conférence"'],
  googleQueries: ['site:linkedin.com/in "organisateur d\'événement" conférence'],
});

const PROJECT_DNA = {
  businessName: "Jeanne PB",
  businessType: "Marque personnelle — stratège",
  uniquePositioning: "positionnement X",
  targetAudience: "décideurs de la communication de marque",
  corePainPoint: "les marques peinent à devenir reconnaissables",
  offers: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (storage.getProspectionCampaign as any).mockResolvedValue({
    id: 3, projectId: 8, userId: "u1",
    targetSector: "événements digitaux mode/beauté",
    campaignBrief: "prospection vers organisateurs d'événements",
  });
  (storage.getBrandDnaForProject as any).mockResolvedValue(PROJECT_DNA);
  (storage.getBrandDna as any).mockResolvedValue({ businessName: "Agence JMD GLOBAL", targetAudience: "corporate", corePainPoint: "visibilité" });
  (claude.callClaudeDetailed as any).mockResolvedValue({ text: VALID_JSON, stopReason: "end_turn" });
});

describe("POINT 1 — contexte : bon Brand DNA + champs ressuscités + prompt de ciblage", () => {
  it("utilise le DNA du PROJET de la campagne (pas le DNA global Agence JMD)", async () => {
    await generateLeadCriteria("u1", 3);
    expect(storage.getBrandDnaForProject).toHaveBeenCalledWith("u1", 8);
    const prompt = (claude.callClaudeDetailed as any).mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("Entreprise: Jeanne PB");
    expect(prompt).not.toContain("Agence JMD GLOBAL"); // global non utilisé quand le projet a son DNA
  });

  it("injecte les champs auparavant MORTS (targetAudience + corePainPoint)", async () => {
    await generateLeadCriteria("u1", 3);
    const prompt = (claude.callClaudeDetailed as any).mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("Audience principale: décideurs de la communication de marque");
    expect(prompt).toContain("Douleur de l'audience: les marques peinent à devenir reconnaissables");
    expect(prompt).toContain("Activité: Marque personnelle — stratège");
  });

  it("le prompt cadre le ciblage sur les ACHETEURS/ORGANISATEURS et exclut les rôles du secteur", async () => {
    await generateLeadCriteria("u1", 3);
    const prompt = (claude.callClaudeDetailed as any).mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("CIBLAGE (impératif)");
    expect(prompt).toContain("ACHÈTENT ou PROGRAMMENT");
    expect(prompt).toContain('PAS "responsable réseaux sociaux"');
  });

  it("fallback sur le DNA global si le projet n'a pas de DNA propre", async () => {
    (storage.getBrandDnaForProject as any).mockResolvedValue(undefined);
    await generateLeadCriteria("u1", 3);
    const prompt = (claude.callClaudeDetailed as any).mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("Entreprise: Agence JMD GLOBAL");
  });

  it("utilise le modèle strategic (Sonnet) et max_tokens 2500", async () => {
    await generateLeadCriteria("u1", 3);
    const opts = (claude.callClaudeDetailed as any).mock.calls[0][0];
    expect(opts.model).toBe(claude.CLAUDE_MODELS.smart);
    expect(opts.max_tokens).toBe(2500);
  });
});

describe("POINT 2 — anti-troncature + retry", () => {
  it("assertNotTruncated lève AVANT tout parse quand la sortie est tronquée (max_tokens)", () => {
    expect(() => assertNotTruncated("max_tokens", "génération ICP prospection")).toThrow(/CAMPAIGN_TRUNCATED/);
    expect(() => assertNotTruncated("length", "génération ICP prospection")).toThrow(/CAMPAIGN_TRUNCATED/);
    expect(() => assertNotTruncated("end_turn", "génération ICP prospection")).not.toThrow();
  });

  it("retourne l'ICP quand la sortie est valide", async () => {
    const icp = await generateLeadCriteria("u1", 3);
    expect(icp.jobTitles).toContain("directeur de conférence");
    expect(icp.googleQueries.length).toBeGreaterThan(0);
    expect(claude.callClaudeDetailed).toHaveBeenCalledTimes(1);
  });

  it("réessaie une 2e fois si la 1re sortie est tronquée, puis réussit", async () => {
    (claude.callClaudeDetailed as any)
      .mockResolvedValueOnce({ text: '{"rationale":"...tronqué', stopReason: "max_tokens" })
      .mockResolvedValueOnce({ text: VALID_JSON, stopReason: "end_turn" });
    const icp = await generateLeadCriteria("u1", 3);
    expect(icp.jobTitles).toContain("directeur de conférence");
    expect(claude.callClaudeDetailed).toHaveBeenCalledTimes(2);
  });

  it("lève une erreur claire après 2 tentatives ratées (au lieu d'un 502 opaque)", async () => {
    (claude.callClaudeDetailed as any).mockResolvedValue({ text: '{"rationale":"...tronqué', stopReason: "max_tokens" });
    await expect(generateLeadCriteria("u1", 3)).rejects.toThrow(/échouée après 2 tentatives/);
    expect(claude.callClaudeDetailed).toHaveBeenCalledTimes(2);
  });
});

describe("projectOfferNature — nature de la prestation vendue (générique, dérivée du DNA)", () => {
  it("priorise offers > uniquePositioning > businessType", () => {
    expect(projectOfferNature({ offers: "gestion de réseaux sociaux", uniquePositioning: "X", businessType: "Y" }))
      .toBe("gestion de réseaux sociaux");
    expect(projectOfferNature({ offers: null, uniquePositioning: "stratégie de marque", businessType: "Y" }))
      .toBe("stratégie de marque");
    expect(projectOfferNature({ offers: null, uniquePositioning: null, businessType: "Marque personnelle" }))
      .toBe("Marque personnelle");
  });
  it("aplatit les espaces et tronque à ~280 caractères", () => {
    const long = "a ".repeat(300);
    const out = projectOfferNature({ offers: long });
    expect(out.length).toBeLessThanOrEqual(280);
    expect(out.endsWith("…")).toBe(true);
  });
  it("DNA vide → chaîne vide", () => {
    expect(projectOfferNature(null)).toBe("");
    expect(projectOfferNature({})).toBe("");
  });
});

describe("buildProspectionContext — inclut la nature de l'offre (dynamique par projet)", () => {
  it("le contexte contient explicitement la prestation vendue par le projet", () => {
    const ctx = buildProspectionContext(
      { businessName: "Agence JMD", offers: "community management et stratégie de marque" },
      { targetSector: "mode" },
    );
    expect(ctx).toContain("Type de prestation VENDUE par le projet");
    expect(ctx).toContain("community management et stratégie de marque");
  });
  it("la nature diffère selon le projet (règle dynamique, non hardcodée)", () => {
    const jmd = buildProspectionContext({ offers: "agence de communication pour marques mode/beauté" }, {});
    const naya = buildProspectionContext({ offers: "plateforme IA d'aide à la décision stratégique" }, {});
    expect(jmd).toContain("agence de communication pour marques mode/beauté");
    expect(naya).toContain("plateforme IA d'aide à la décision stratégique");
    expect(jmd).not.toBe(naya);
  });
});

describe("prompt de génération — bloc EXCLUSIONS OBLIGATOIRES (concurrents directs)", () => {
  it("le prompt envoyé au modèle contient le bloc d'exclusion + la nature de l'offre", async () => {
    (storage.getBrandDnaForProject as any).mockResolvedValue({ ...PROJECT_DNA, offers: "agence social media pour marques" });
    await generateLeadCriteria("u1", 3);
    const prompt = (claude.callClaudeDetailed as any).mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("EXCLUSIONS OBLIGATOIRES");
    expect(prompt).toContain("prestataires concurrents directs");
    expect(prompt).toContain("Inclure : les entreprises qui ACHÈTENT ces services");
    expect(prompt).toContain("Type de prestation VENDUE par le projet");
    expect(prompt).toContain("agence social media pour marques");
  });
});
