// Tests des outils de consultation par domaine. `../../../storage` est mocké : aucun test ne
// touche une vraie base (consigne projet). On vérifie surtout que le stockage n'est appelé
// qu'avec le userId du contexte, qu'un projet/une campagne d'une autre utilisatrice est
// « introuvable », et que les réglages ne laissent filtrer aucune clé secrète.
import { describe, it, expect, vi, beforeEach } from "vitest";

const s = vi.hoisted(() => ({
  getTasksInRange: vi.fn(), getProjects: vi.fn(), getProject: vi.fn(), getMilestones: vi.fn(),
  getContent: vi.fn(), getCampaigns: vi.fn(), getProspectionCampaigns: vi.fn(),
  getLeadsByCampaign: vi.fn(), getLeadSequenceState: vi.fn(), getMesures: vi.fn(),
  getUserPreferences: vi.fn(),
}));
vi.mock("../../../storage", () => ({ storage: s }));
vi.mock("../recherche", () => ({
  SOURCES: ["tache"], chercher: vi.fn(async () => []), lire: vi.fn(async () => null),
}));

const { outil } = await import("../registre");
const ctx = { userId: "u1", maintenant: new Date("2026-11-02T10:00:00Z"), fuseau: "Europe/Paris" };
const run = async (nom: string, args: any = {}) => (await outil(nom)!.executer(ctx, args)).pourModele as any;

const projetA = { id: 1, userId: "u1", name: "Agence", type: "Agency", projectStatus: "active", priorityLevel: "primary", statusNote: "ok" };

beforeEach(() => {
  vi.clearAllMocks();
  s.getProject.mockImplementation(async (id: number, uid: string) => (id === 1 && uid === "u1" ? projetA : undefined));
  s.getProjects.mockResolvedValue([projetA]);
  s.getTasksInRange.mockResolvedValue([]);
  s.getContent.mockResolvedValue([]);
  s.getCampaigns.mockResolvedValue([]);
  s.getMilestones.mockResolvedValue([]);
  s.getMesures.mockResolvedValue([]);
  s.getProspectionCampaigns.mockResolvedValue([{ id: 7, userId: "u1", name: "Vignerons", status: "active", channel: "linkedin" }]);
  s.getLeadsByCampaign.mockResolvedValue([]);
});

describe("consulter_planning", () => {
  it("appelle le stockage avec le userId du contexte et rend les champs compacts", async () => {
    s.getTasksInRange.mockResolvedValue([
      { id: 1, title: "A", scheduledDate: "2026-11-03", scheduledTime: "09:00", estimatedDuration: 30, completed: false, projectId: 1, description: "long" },
      { id: 2, title: "B", scheduledDate: "2026-11-03", scheduledTime: null, estimatedDuration: null, completed: true, projectId: null },
    ]);
    const r = await run("consulter_planning", { du: "2026-11-03", au: "2026-11-05" });
    expect(s.getTasksInRange).toHaveBeenCalledWith("u1", "2026-11-03", "2026-11-05", undefined);
    expect(r.taches[0]).toEqual({ id: 1, titre: "A", date: "2026-11-03", heure: "09:00", duree: 30, faite: false, projet: "Agence" });
    expect(r.taches[0].description).toBeUndefined();
  });

  it("borne 90 jours à 31 jours et le signale", async () => {
    const r = await run("consulter_planning", { du: "2026-11-01", au: "2027-01-29" });
    expect(s.getTasksInRange).toHaveBeenCalledWith("u1", "2026-11-01", "2026-12-01", undefined);
    expect(r.tronque).toBe(true);
    expect(r.au).toBe("2026-12-01");
  });

  it("filtre par état et plafonne à 200 tâches", async () => {
    s.getTasksInRange.mockResolvedValue(
      Array.from({ length: 250 }, (_, i) => ({ id: i, title: "t", scheduledDate: "2026-11-03", completed: i % 2 === 0, projectId: null })),
    );
    const toutes = await run("consulter_planning", { du: "2026-11-03", au: "2026-11-03" });
    expect(toutes.taches).toHaveLength(200);
    expect(toutes.tronque).toBe(true);
    const faites = await run("consulter_planning", { du: "2026-11-03", au: "2026-11-03", etat: "faites" });
    expect(faites.taches.every((t: any) => t.faite)).toBe(true);
    expect(faites.tronque).toBeUndefined();
  });

  it("refuse une date invalide ou une période inversée", async () => {
    expect((await run("consulter_planning", { du: "demain", au: "2026-11-05" })).erreur).toBeTruthy();
    expect((await run("consulter_planning", { du: "2026-02-31", au: "2026-03-05" })).erreur).toBeTruthy();
    expect((await run("consulter_planning", { du: "2026-11-05", au: "2026-11-03" })).erreur).toBeTruthy();
    expect(s.getTasksInRange).not.toHaveBeenCalled();
  });

  it("un projetId d'une autre utilisatrice est introuvable", async () => {
    const r = await run("consulter_planning", { du: "2026-11-03", au: "2026-11-03", projetId: 99 });
    expect(r).toEqual({ erreur: "introuvable" });
    expect(s.getProject).toHaveBeenCalledWith(99, "u1");
    expect(s.getTasksInRange).not.toHaveBeenCalled();
  });
});

describe("consulter_projets", () => {
  it("liste les projets de la session", async () => {
    const r = await run("consulter_projets");
    expect(s.getProjects).toHaveBeenCalledWith("u1", 200);
    expect(r.projets[0]).toMatchObject({ id: 1, nom: "Agence" });
  });
  it("rend les jalons d'un projet à elle", async () => {
    s.getMilestones.mockResolvedValue([{ id: 5, title: "Lancer", status: "locked", milestoneType: "launch", targetDate: "2026-12-01", description: "x" }]);
    const r = await run("consulter_projets", { projetId: 1 });
    expect(s.getMilestones).toHaveBeenCalledWith(1, "u1");
    expect(r.jalons[0]).toEqual({ id: 5, titre: "Lancer", statut: "locked", type: "launch", echeance: "2026-12-01" });
  });
  it("projet d'une autre : introuvable", async () => {
    expect(await run("consulter_projets", { projetId: 99 })).toEqual({ erreur: "introuvable" });
    expect(s.getMilestones).not.toHaveBeenCalled();
  });
});

describe("consulter_contenus", () => {
  it("passe le userId, filtre par statut et période", async () => {
    s.getContent.mockResolvedValue([
      { id: 1, title: "P1", platform: "linkedin", status: "scheduled", scheduledFor: new Date("2026-11-10T08:00:00Z"), publishedAt: null, projectId: 1, body: "secret long" },
      { id: 2, title: "P2", platform: "instagram", status: "draft", scheduledFor: null, publishedAt: null, createdAt: new Date("2026-10-01T00:00:00Z"), projectId: 1 },
    ]);
    s.getCampaigns.mockResolvedValue([{ id: 3, name: "Camp", objective: "obj", status: "active" }]);
    const r = await run("consulter_contenus", { projetId: 1, statut: "scheduled", du: "2026-11-01", au: "2026-11-30" });
    expect(s.getContent).toHaveBeenCalledWith("u1", expect.any(Number), 1);
    expect(s.getCampaigns).toHaveBeenCalledWith("u1", 1);
    expect(r.contenus).toHaveLength(1);
    expect(r.contenus[0].body).toBeUndefined();
    expect(r.campagnes[0]).toMatchObject({ id: 3, nom: "Camp" });
  });
  it("projet d'une autre : introuvable ; date invalide : erreur", async () => {
    expect(await run("consulter_contenus", { projetId: 99 })).toEqual({ erreur: "introuvable" });
    expect((await run("consulter_contenus", { du: "x" })).erreur).toBeTruthy();
    expect(s.getContent).not.toHaveBeenCalled();
  });
});

describe("consulter_prospection", () => {
  it("liste les campagnes de la session", async () => {
    const r = await run("consulter_prospection");
    expect(s.getProspectionCampaigns).toHaveBeenCalledWith("u1");
    expect(r.campagnes[0]).toMatchObject({ id: 7, nom: "Vignerons" });
  });
  it("rend au plus 50 prospects avec l'état de séquence", async () => {
    s.getLeadsByCampaign.mockResolvedValue(Array.from({ length: 60 }, (_, i) => ({ id: i, name: `L${i}`, company: "C", status: "discovered", stage: "in_discussion", email: "x@y.z" })));
    s.getLeadSequenceState.mockResolvedValue({ status: "active", currentStep: 2 });
    const r = await run("consulter_prospection", { campagneId: 7 });
    expect(s.getLeadsByCampaign).toHaveBeenCalledWith(7, "u1");
    expect(r.prospects).toHaveLength(50);
    expect(r.tronque).toBe(true);
    expect(r.prospects[0]).toEqual({ id: 0, nom: "L0", entreprise: "C", stade: "in_discussion", sequence: { statut: "active", etape: 2 } });
  });
  it("campagne d'une autre : introuvable", async () => {
    expect(await run("consulter_prospection", { campagneId: 99 })).toEqual({ erreur: "introuvable" });
    expect(s.getLeadsByCampaign).not.toHaveBeenCalled();
  });
});

describe("consulter_mesures", () => {
  it("rend les mesures d'un projet à elle, filtrées par mois", async () => {
    s.getMesures.mockResolvedValue([{ mois: "2026-10", ca: 1000, nouveauxClients: 2, depenses: { pub: 50 }, bilan: "bon" }, { mois: "2026-09", ca: 500, depenses: {} }]);
    const r = await run("consulter_mesures", { projetId: 1, mois: "2026-10" });
    expect(s.getMesures).toHaveBeenCalledWith("u1", 1, expect.any(Number));
    expect(r.mesures).toHaveLength(1);
    expect(r.mesures[0]).toMatchObject({ mois: "2026-10", ca: 1000 });
  });
  it("projet d'une autre : introuvable ; mois invalide : erreur", async () => {
    expect(await run("consulter_mesures", { projetId: 99 })).toEqual({ erreur: "introuvable" });
    expect((await run("consulter_mesures", { projetId: 1, mois: "octobre" })).erreur).toBeTruthy();
    expect(s.getMesures).not.toHaveBeenCalled();
  });
});

describe("consulter_reglages", () => {
  const prefs = {
    userId: "u1", timezone: "Europe/Paris", workDays: "mon,tue", workDayStart: "09:00", workDayEnd: "18:00",
    currentEnergyLevel: "low", energyUpdatedDate: "2026-11-02",
    prospectionSenderEmail: "j@x.fr", prospectionSenderName: "Jeanne",
    prospectionSendgridApiKey: "enc:SECRET", linkedinUnipileAccountId: "acc1", emailUnipileAccountId: "acc2",
    dailyBriefContent: { x: 1 },
  };
  function cles(o: any): string[] {
    if (!o || typeof o !== "object") return [];
    return Object.entries(o).flatMap(([k, v]) => [k, ...cles(v)]);
  }
  it("n'expose aucune clé, jeton, secret ni id de compte", async () => {
    s.getUserPreferences.mockResolvedValue(prefs);
    const r = await run("consulter_reglages");
    expect(s.getUserPreferences).toHaveBeenCalledWith("u1");
    for (const k of cles(r)) expect(k).not.toMatch(/key|token|secret|accountid/i);
    const texte = JSON.stringify(r);
    expect(texte).not.toContain("SECRET");
    expect(texte).not.toContain("acc1");
    expect(r.joursTravail).toBe("mon,tue");
    expect(r.energie).toBe("low");
    expect(r.adresseEnvoi).toEqual({ email: "j@x.fr", nom: "Jeanne" });
  });
  it("ignore l'énergie d'un autre jour", async () => {
    s.getUserPreferences.mockResolvedValue({ ...prefs, energyUpdatedDate: "2026-10-30" });
    expect((await run("consulter_reglages")).energie).toBeNull();
  });
  it("sans préférences : valeurs vides, pas d'erreur", async () => {
    s.getUserPreferences.mockResolvedValue(undefined);
    expect((await run("consulter_reglages")).erreur).toBeUndefined();
  });
});
