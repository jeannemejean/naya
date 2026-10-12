import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../storage", () => ({
  storage: { getProspectionCampaign: vi.fn(), getLeadsByCampaign: vi.fn(async () => []) },
}));
vi.mock("../prospection-pipeline", () => ({ sourcerCampagne: vi.fn(), enrichProspects: vi.fn() }));
vi.mock("../prospection-access", async (io) => ({ ...(await io<any>()), hasProspectionEnrichment: vi.fn(async () => true) }));
vi.mock("../serp", async (io) => ({ ...(await io<any>()), serpConfigured: vi.fn(() => true) }));

import { storage } from "../../storage";
import * as pipeline from "../prospection-pipeline";
import * as access from "../prospection-access";
import * as serp from "../serp";
import { executerSourcing } from "./sourcing";

const routine = { id: 1, userId: "u1", kind: "sourcing_prospects", cible: { campaignId: 5 } } as any;
const campagne = { id: 5, userId: "u1", status: "active", prospectsPerDay: 2, projectId: 7 };
const sourcing = (over: any = {}) => ({ found: 6, imported: 6, skipped: 0, cible: 20, raisonCible: "", reserve: 0, reserveSuffisante: false, appels: 4, erreursRecherche: 0, derniereErreurRecherche: null, ...over });
const neuf = (id: number, over: any = {}) => ({ id, stage: "identified", enriched: false, archivedAt: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  (storage.getProspectionCampaign as any).mockResolvedValue(campagne);
  (pipeline.sourcerCampagne as any).mockResolvedValue(sourcing());
  (pipeline.enrichProspects as any).mockImplementation(async (_u: string, _c: any, ids: number[]) => ({ enriched: ids.length, failed: 0, linkedin_requests_used: ids.length }));
  (storage.getLeadsByCampaign as any).mockResolvedValue([neuf(1), neuf(2), neuf(3), neuf(4, { enriched: true }), neuf(5, { stage: "messages_ready" })]);
  (access.hasProspectionEnrichment as any).mockResolvedValue(true);
  (serp.serpConfigured as any).mockReturnValue(true);
});

describe("routine de sourcing", () => {
  it("campagne d'une autre utilisatrice ou disparue : rien à faire, aucune recherche, routine à désactiver", async () => {
    (storage.getProspectionCampaign as any).mockResolvedValue({ ...campagne, userId: "autre" });
    const r = await executerSourcing(routine);
    expect(r.statut).toBe("rien_a_faire");
    expect(r.desactiver).toBe(true);
    expect(pipeline.sourcerCampagne).not.toHaveBeenCalled();
  });

  it("campagne en pause : rien à faire, aucun appel", async () => {
    (storage.getProspectionCampaign as any).mockResolvedValue({ ...campagne, status: "paused" });
    const r = await executerSourcing(routine);
    expect(r.statut).toBe("rien_a_faire");
    expect(pipeline.sourcerCampagne).not.toHaveBeenCalled();
  });

  it("Bright Data non configuré : erreur explicite, aucun appel", async () => {
    (serp.serpConfigured as any).mockReturnValue(false);
    const r = await executerSourcing(routine);
    expect(r.statut).toBe("erreur");
    expect(r.resume).toMatch(/Bright Data/);
    expect(pipeline.sourcerCampagne).not.toHaveBeenCalled();
  });

  it("importe puis prépare au plus « prospects par jour » prospects neufs", async () => {
    const r = await executerSourcing(routine);
    expect(r.statut).toBe("ok");
    expect(pipeline.enrichProspects).toHaveBeenCalledWith("u1", campagne, [1, 2]);
    expect(r.resume).toBe("6 prospects ajoutés, 2 préparés à valider.");
    expect(r.notifier).toBe(true);
  });

  it("offre sans enrichissement : import seul, sans erreur", async () => {
    (access.hasProspectionEnrichment as any).mockResolvedValue(false);
    const r = await executerSourcing(routine);
    expect(r.statut).toBe("ok");
    expect(pipeline.enrichProspects).not.toHaveBeenCalled();
    expect(r.resume).toContain("non incluse");
  });

  it("limite LinkedIn atteinte : import gardé, préparation en pause", async () => {
    (pipeline.enrichProspects as any).mockRejectedValue(new access.LinkedInWeeklyLimitError("limite"));
    const r = await executerSourcing(routine);
    expect(r.statut).toBe("ok");
    expect(r.resume).toContain("limite LinkedIn");
  });

  it("réserve suffisante et rien à préparer : rien à faire, sans notification", async () => {
    (pipeline.sourcerCampagne as any).mockResolvedValue(sourcing({ imported: 0, found: 0, appels: 0, reserveSuffisante: true, reserve: 30 }));
    (storage.getLeadsByCampaign as any).mockResolvedValue([]);
    const r = await executerSourcing(routine);
    expect(r.statut).toBe("rien_a_faire");
    expect(r.notifier).toBeFalsy();
  });

  it("toutes les recherches en échec : erreur lisible et notification", async () => {
    (pipeline.sourcerCampagne as any).mockResolvedValue(sourcing({ imported: 0, found: 0, appels: 4, erreursRecherche: 4, derniereErreurRecherche: "Bright Data SERP : HTTP 401" }));
    (storage.getLeadsByCampaign as any).mockResolvedValue([]);
    const r = await executerSourcing(routine);
    expect(r.statut).toBe("erreur");
    expect(r.resume).toContain("HTTP 401");
    expect(r.notifier).toBe(true);
  });
});
