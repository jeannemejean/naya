import { describe, it, expect, vi, beforeEach } from "vitest";

// Tout ce qui sort du processus est simulé : base, Bright Data, Claude. Aucun appel réel.
vi.mock("../storage", () => ({
  storage: {
    getLeads: vi.fn(),
    getActiveGoalsForProject: vi.fn(),
    getUserPreferences: vi.fn(),
    getBrandDnaForProject: vi.fn(),
    getBrandDna: vi.fn(),
    createLead: vi.fn(),
    recordProspectionUsage: vi.fn(),
  },
}));
vi.mock("./serp", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, serpSearch: vi.fn() };
});
vi.mock("./prospection", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, generateLeadCriteria: vi.fn() };
});
vi.mock("./claude", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, callClaude: vi.fn(), callClaudeDetailed: vi.fn(), callClaudeWithContext: vi.fn() };
});

import { storage } from "../storage";
import * as serp from "./serp";
import * as prospection from "./prospection";
import { sourcerCampagne, prospectsParJourDerive } from "./prospection-pipeline";
import { PLAFOND_APPELS_SERP } from "./prospection-sourcing";

const ICP = {
  rationale: "", jobTitles: [], seniority: [], sectors: [], companySize: "", geographies: ["Belgique"],
  keywords: [], exclusions: [], linkedinQueries: [],
  googleQueries: ['site:linkedin.com/in "directrice marketing"', '"head of brand" AND cosmétique'],
};

let compteur = 0;
function page(n: number) {
  return Array.from({ length: n }, () => {
    compteur++;
    return { link: `https://www.linkedin.com/in/p${compteur}`, title: `Personne ${compteur} - Directrice - Maison ${compteur} | LinkedIn` };
  });
}

const campagne = { id: 7, projectId: 3, userId: "u1", prospectsPerDay: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  compteur = 0;
  (storage.getLeads as any).mockResolvedValue([]);
  (storage.getActiveGoalsForProject as any).mockResolvedValue([]);
  (storage.getUserPreferences as any).mockResolvedValue({ workDays: "mon,tue,wed,thu,fri", language: "fr" });
  (storage.getBrandDnaForProject as any).mockResolvedValue({ offers: "x" });
  (storage.getBrandDna as any).mockResolvedValue(undefined);
  (storage.createLead as any).mockImplementation(async (l: any) => l);
  (prospection.generateLeadCriteria as any).mockResolvedValue(ICP);
  (serp.serpSearch as any).mockImplementation(async () => page(10));
});

describe("sourcerCampagne — trouve jusqu'à la cible dérivée du contexte", () => {
  it("cible = rythme de la campagne × jours ouvrés (2 × 10 = 20) et importe exactement ça", async () => {
    const r = await sourcerCampagne("u1", campagne);
    expect(r.cible).toBe(20);
    expect(r.imported).toBe(20);
    expect(storage.createLead).toHaveBeenCalledTimes(20);
    expect((storage.createLead as any).mock.calls[0][0]).toMatchObject({
      userId: "u1", projectId: 3, prospectionCampaignId: 7, stage: "identified",
    });
  });

  it("transmet la cible au générateur de critères", async () => {
    await sourcerCampagne("u1", campagne);
    expect(prospection.generateLeadCriteria).toHaveBeenCalledWith("u1", 7, expect.objectContaining({ cible: 20 }));
  });

  it("épingle gl/hl depuis le marché de l'ICP et pagine", async () => {
    (serp.serpSearch as any).mockImplementation(async () => page(3));
    await sourcerCampagne("u1", campagne);
    const appels = (serp.serpSearch as any).mock.calls;
    expect(appels[0][2]).toMatchObject({ pays: "be", langue: "fr", page: 0 });
    expect(appels[1][2]).toMatchObject({ page: 1 });
  });

  it("n'envoie que des requêtes X-ray Google (pas de AND)", async () => {
    (serp.serpSearch as any).mockImplementation(async () => page(1));
    await sourcerCampagne("u1", campagne);
    for (const [q] of (serp.serpSearch as any).mock.calls) {
      expect(q).toContain("site:linkedin.com/in");
      expect(q).not.toMatch(/\bAND\b/);
    }
  });

  it("journalise chaque appel SERP dans prospection_usage", async () => {
    const r = await sourcerCampagne("u1", campagne);
    const recherches = (storage.recordProspectionUsage as any).mock.calls.filter((c: any[]) => c[0].operationType === "bright_data_search");
    expect(recherches).toHaveLength(r.appels);
    expect(recherches[0][0]).toMatchObject({ userId: "u1", campaignId: 7 });
  });

  it("plafond dur d'appels SERP même quand rien de neuf ne sort", async () => {
    (storage.getLeads as any).mockResolvedValue([]);
    // Toujours les mêmes profils : rien de neuf après la première page.
    (serp.serpSearch as any).mockImplementation(async () => [
      { link: "https://www.linkedin.com/in/toujours", title: "Toujours - X - Y | LinkedIn" },
    ]);
    (prospection.generateLeadCriteria as any).mockImplementation(async () => ({
      ...ICP, googleQueries: Array.from({ length: 12 }, () => `site:linkedin.com/in "q${Math.random()}"`),
    }));
    const r = await sourcerCampagne("u1", campagne);
    expect(r.appels).toBeLessThanOrEqual(PLAFOND_APPELS_SERP);
    expect(serp.serpSearch).toHaveBeenCalledTimes(r.appels);
  });

  it("la réserve de la campagne (prospects pas encore contactés) compte dans la cible", async () => {
    (storage.getLeads as any).mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => ({ id: i, prospectionCampaignId: 7, stage: "identified", linkedinUrl: `https://www.linkedin.com/in/r${i}` })),
    );
    const r = await sourcerCampagne("u1", campagne);
    expect(r.cible).toBe(20);
    expect(r.imported).toBe(5);
  });

  it("réserve suffisante : aucun appel SERP facturé", async () => {
    (storage.getLeads as any).mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => ({ id: i, prospectionCampaignId: 7, stage: "messages_ready", linkedinUrl: `https://www.linkedin.com/in/r${i}` })),
    );
    const r = await sourcerCampagne("u1", campagne);
    expect(r.imported).toBe(0);
    expect(r.reserveSuffisante).toBe(true);
    expect(serp.serpSearch).not.toHaveBeenCalled();
    expect(prospection.generateLeadCriteria).not.toHaveBeenCalled();
  });

  it("requêtes fournies par l'écran : utilisées telles quelles (normalisées), sans régénérer", async () => {
    (serp.serpSearch as any).mockImplementation(async () => page(10));
    await sourcerCampagne("u1", campagne, { queries: ['"office manager"'], icp: { searchCountry: "CH" } });
    expect(prospection.generateLeadCriteria).not.toHaveBeenCalled();
    const [q, , opts] = (serp.serpSearch as any).mock.calls[0];
    expect(q).toBe('site:linkedin.com/in "office manager"');
    expect(opts).toMatchObject({ pays: "ch", langue: "fr" });
  });

  it("dédoublonne contre TOUS les prospects existants de l'utilisatrice", async () => {
    (storage.getLeads as any).mockResolvedValue([{ id: 1, prospectionCampaignId: 99, stage: "signed", linkedinUrl: "https://www.linkedin.com/in/p1/" }]);
    const r = await sourcerCampagne("u1", campagne);
    const urls = (storage.createLead as any).mock.calls.map((c: any[]) => c[0].linkedinUrl);
    expect(urls).not.toContain("https://www.linkedin.com/in/p1");
    expect(r.skipped).toBeGreaterThanOrEqual(1);
  });
});

describe("prospectsParJourDerive — plus de « 3 » codé en dur à la création d'une campagne", () => {
  it("sans objectif chiffré : le plancher réparti sur les jours ouvrés", async () => {
    expect(await prospectsParJourDerive("u1", 3)).toBe(3); // 30 / 10 jours ouvrés
  });

  it("avec un objectif en clients : dérivé de l'objectif", async () => {
    (storage.getActiveGoalsForProject as any).mockResolvedValue([
      { title: "Signer 4 clients", successMode: "revenue", targetValue: "4 clients", status: "active", dueDate: null },
    ]);
    // 4 / 0,05 = 80 prospects sur 90 j → 80 × 14 / 90 = 12.4 → 13 sur 10 jours ouvrés → 2/jour
    expect(await prospectsParJourDerive("u1", 3)).toBe(2);
  });

  it("jours de travail de l'utilisatrice pris en compte", async () => {
    (storage.getUserPreferences as any).mockResolvedValue({ workDays: "mon,tue", language: "fr" });
    expect(await prospectsParJourDerive("u1", 3)).toBe(8); // 30 / 4 jours ouvrés
  });

  it("sans projet : plancher", async () => {
    expect(await prospectsParJourDerive("u1", null)).toBe(3);
    expect(storage.getActiveGoalsForProject).not.toHaveBeenCalled();
  });
});
