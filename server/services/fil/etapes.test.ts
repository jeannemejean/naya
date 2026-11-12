// Tests des propositions d'étapes et des rattachements du fil conducteur. Stockage, dépôt des
// propositions (table en mémoire qui reproduit la réclamation conditionnelle), plafond IA et
// appels Claude sont mockés : aucun test ne touche une vraie base ni le réseau.
import { describe, it, expect, vi, beforeEach } from "vitest";

const s = vi.hoisted(() => ({
  getProjectGoal: vi.fn(), getProject: vi.fn(), getProjects: vi.fn(), getActiveGoalsForProject: vi.fn(),
  getMilestones: vi.fn(), getMilestone: vi.fn(), createMilestone: vi.fn(), createMilestoneCondition: vi.fn(),
  updateMilestone: vi.fn(), getAvancementEtapes: vi.fn(),
  getCampaigns: vi.fn(), getProspectionCampaigns: vi.fn(), getPostsEntre: vi.fn(), getMesures: vi.fn(),
  getTask: vi.fn(), getTasksInRange: vi.fn(),
}));
const table = vi.hoisted(() => ({ lignes: new Map<number, any>(), suivant: 0 }));
const d = vi.hoisted(() => ({
  ajouterAction: vi.fn(),
  ajouterProposition: vi.fn(async (userId: string, outil: string, args: unknown, changements: unknown, empreinte: unknown, expireA: Date) => {
    const p = { id: ++table.suivant, userId, outil, arguments: JSON.parse(JSON.stringify(args)), changements, empreinte: JSON.parse(JSON.stringify(empreinte)), statut: "en_attente", resultat: null, expireA };
    table.lignes.set(p.id, p);
    return p;
  }),
  getProposition: vi.fn(async (id: number, userId: string) => {
    const p = table.lignes.get(id);
    return p && p.userId === userId ? { ...p } : undefined;
  }),
  majProposition: vi.fn(async (id: number, userId: string, patch: any) => {
    const p = table.lignes.get(id);
    if (!p || p.userId !== userId) return undefined;
    Object.assign(p, patch);
    return p;
  }),
  reclamerProposition: vi.fn(async (id: number, userId: string, statut: string) => {
    const p = table.lignes.get(id);
    if (!p || p.userId !== userId || p.statut !== "en_attente") return false;
    p.statut = statut;
    return true;
  }),
  propositionsEnAttente: vi.fn(async (userId: string, outils: string[], maintenant: Date) =>
    Array.from(table.lignes.values()).filter((p) => p.userId === userId && p.statut === "en_attente"
      && outils.includes(p.outil) && p.expireA.getTime() > maintenant.getTime())),
}));
const ia = vi.hoisted(() => ({ callClaudeWithContext: vi.fn(), isAiBlocked: vi.fn() }));
vi.mock("../../storage", () => ({ storage: s }));
vi.mock("../agent/depot", () => ({ depot: d }));
vi.mock("../usage", () => ({ isAiBlocked: ia.isAiBlocked }));
vi.mock("../claude", () => ({
  callClaudeWithContext: ia.callClaudeWithContext,
  CLAUDE_MODELS: { fast: "modele-rapide", smart: "modele-fin" },
}));
vi.mock("../taches/ecrire-tache", () => ({ creerTache: vi.fn(), modifierTache: vi.fn() }));
vi.mock("../memory/ranger", () => ({ rangerSouvenir: vi.fn(), lireSouvenir: vi.fn(), perimerSouvenir: vi.fn() }));
vi.mock("../agent/recherche", () => ({ SOURCES: ["tache"], chercher: vi.fn(async () => []), lire: vi.fn(async () => null) }));

process.env.FIL_CONDUCTEUR_USERS = "u1";

const { proposerEtapesPour, genererEtapes, proposerRattachements, DUREE_PROPOSITION_FIL_MS, normaliserEtats } = await import("./etapes");
const { validerProposition, proposerHorsConversation, DUREE_PROPOSITION_MS } = await import("../agent/propositions");

const DEBUT = new Date("2026-11-12T08:00:00Z");
const jours = (n: number) => new Date(DEBUT.getTime() + n * 24 * 3600_000);

// Base simulée : projet 10 (u1), projet 20 (u2), objectifs, jalons.
let objectifs: Map<number, any>;
let jalons: Map<number, any>;
let prochainJalon: number;

const POURQUOI = (x: string) => `Parce que ${x} ouvre la porte aux trois premiers clients de l'agence.`;
const sortie = (etapes: Array<{ titre: string; etat: string; pourquoi?: string }>) =>
  JSON.stringify({ etapes: etapes.map((e) => ({ pourquoi: POURQUOI(e.titre), ...e })) });
const TROIS = [
  { titre: "Clarifier l'offre", etat: "a_venir" },
  { titre: "Être visible sur LinkedIn", etat: "a_venir" },
  { titre: "Relancer les contacts chauds", etat: "a_venir" },
];

beforeEach(() => {
  vi.clearAllMocks();
  table.lignes.clear();
  table.suivant = 0;
  prochainJalon = 100;
  objectifs = new Map([
    [1, { id: 1, projectId: 10, title: "3 nouveaux clients", description: null, goalType: "quarterly", successMode: "revenue", targetValue: "3", dueDate: null, status: "active" }],
    [2, { id: 2, projectId: 10, title: "Être reconnue sur LinkedIn", description: null, goalType: "visibility", successMode: "visibility", targetValue: null, dueDate: null, status: "active" }],
    [3, { id: 3, projectId: 20, title: "Objectif d'une autre", status: "active" }],
  ]);
  jalons = new Map();
  ia.isAiBlocked.mockResolvedValue(false);
  ia.callClaudeWithContext.mockResolvedValue(sortie(TROIS));
  s.getProjectGoal.mockImplementation(async (id: number) => objectifs.get(id) ?? null);
  s.getProject.mockImplementation(async (id: number, userId: string) =>
    (id === 10 && userId === "u1") ? { id: 10, name: "Agence JMD", userId: "u1" }
      : (id === 20 && userId === "u2") ? { id: 20, name: "Autre", userId: "u2" } : undefined);
  s.getProjects.mockImplementation(async (userId: string) => (userId === "u1" ? [{ id: 10, name: "Agence JMD" }] : []));
  s.getActiveGoalsForProject.mockImplementation(async (pid: number) =>
    Array.from(objectifs.values()).filter((g) => g.projectId === pid && g.status === "active"));
  s.getMilestones.mockImplementation(async (pid: number, userId: string) =>
    Array.from(jalons.values()).filter((j) => j.projectId === pid && j.userId === userId).sort((a, b) => a.order - b.order));
  s.getMilestone.mockImplementation(async (id: number) => (jalons.has(id) ? { ...jalons.get(id) } : undefined));
  s.createMilestone.mockImplementation(async (data: any) => {
    const j = { id: ++prochainJalon, ...data };
    jalons.set(j.id, j);
    return j;
  });
  s.createMilestoneCondition.mockResolvedValue({});
  s.updateMilestone.mockImplementation(async (id: number, patch: any) => {
    const j = { ...jalons.get(id), ...patch };
    jalons.set(id, j);
    return j;
  });
  s.getAvancementEtapes.mockResolvedValue(new Map());
  s.getCampaigns.mockResolvedValue([]);
  s.getProspectionCampaigns.mockResolvedValue([]);
  s.getPostsEntre.mockResolvedValue([]);
  s.getMesures.mockResolvedValue([]);
});

describe("proposer_etapes", () => {
  it("vit 7 jours : validée à J+6 elle s'exécute", async () => {
    const p = await proposerEtapesPour("u1", 1, DEBUT);
    expect("erreur" in p).toBe(false);
    expect(DUREE_PROPOSITION_FIL_MS).toBe(7 * 24 * 3600_000);
    expect(table.lignes.get(1).expireA).toEqual(jours(7));
    // Sans `outils` : validerProposition retrouve l'outil dans le REGISTRE par défaut (hors conversation, mais présent).
    const r = await validerProposition("u1", 1, jours(6));
    expect(r).toEqual({ ok: true, reussis: expect.any(Array), echecs: [] });
    expect(s.createMilestone).toHaveBeenCalledTimes(3);
    const creees = Array.from(jalons.values());
    expect(creees.map((j) => j.goalId)).toEqual([1, 1, 1]);
    expect(creees.map((j) => j.status)).toEqual(["active", "locked", "locked"]);
    expect(creees[0].pourquoi).toBe(POURQUOI("Clarifier l'offre"));
  });

  it("à J+7 (pile) elle passe expiree, sans rien créer", async () => {
    await proposerEtapesPour("u1", 1, DEBUT);
    expect(await validerProposition("u1", 1, jours(7))).toEqual({ ok: false, raison: "expiree" });
    expect(table.lignes.get(1).statut).toBe("expiree");
    expect(s.createMilestone).not.toHaveBeenCalled();
  });

  it("rien n'est créé avant validation", async () => {
    await proposerEtapesPour("u1", 1, DEBUT);
    expect(s.createMilestone).not.toHaveBeenCalled();
    expect(s.createMilestoneCondition).not.toHaveBeenCalled();
    expect(table.lignes.get(1)).toMatchObject({ outil: "proposer_etapes", statut: "en_attente" });
  });

  it("une campagne de prospection active : l'étape « Lancer la prospection » est en cours, créée active (pas locked)", async () => {
    s.getProspectionCampaigns.mockResolvedValue([{ name: "Agences lyonnaises", status: "active", projectId: 10 }]);
    ia.callClaudeWithContext.mockImplementation(async ({ userMessage }: any) => {
      expect(userMessage).toContain("« Agences lyonnaises » (active)");
      return sortie([
        { titre: "Définir la cible", etat: "faite" },
        { titre: "Lancer la prospection", etat: "en_cours" },
        { titre: "Convertir les rendez-vous", etat: "a_venir" },
      ]);
    });
    await proposerEtapesPour("u1", 1, DEBUT);
    expect(await validerProposition("u1", 1, jours(1))).toMatchObject({ ok: true });
    const parTitre = new Map(Array.from(jalons.values()).map((j) => [j.title, j]));
    expect(parTitre.get("Définir la cible").status).toBe("completed");
    expect(parTitre.get("Lancer la prospection").status).toBe("active");
    expect(parTitre.get("Convertir les rendez-vous").status).toBe("locked");
  });

  it("le prompt porte campagnes en cours, posts publiés sur 30 jours et dernière mesure ; modèle fin", async () => {
    s.getCampaigns.mockResolvedValue([{ name: "Campagne 360", status: "active" }, { name: "Brouillon", status: "draft" }]);
    s.getPostsEntre.mockResolvedValue([
      { platform: "linkedin", status: "published" }, { platform: "linkedin", status: "published" }, { platform: "instagram", status: "scheduled" },
    ]);
    s.getMesures.mockResolvedValue([{ mois: "2026-10", ca: 4200, nouveauxClients: 1, commandes: null }]);
    await genererEtapes("u1", 1);
    const appel = ia.callClaudeWithContext.mock.calls[0][0];
    expect(appel.model).toBe("modele-fin");
    expect(appel.userMessage).toContain("Campagnes en cours : « Campagne 360 »");
    expect(appel.userMessage).not.toContain("Brouillon");
    expect(appel.userMessage).toContain("Posts publiés sur 30 jours : 2 (linkedin 2)");
    expect(appel.userMessage).toContain("Dernière mesure (2026-10) : CA 4200");
  });

  it("2 étapes ou 7 étapes : nombre_etapes", async () => {
    const etapes = (n: number) => Array.from({ length: n }, (_, i) => ({ titre: `Étape ${i}`, pourquoi: POURQUOI(`l'étape ${i}`), etat: "a_venir" }));
    expect(await proposerHorsConversation("u1", "proposer_etapes", { objectifId: 1, etapes: etapes(2) }, DEBUT)).toEqual({ erreur: "nombre_etapes" });
    expect(await proposerHorsConversation("u1", "proposer_etapes", { objectifId: 1, etapes: etapes(7) }, DEBUT)).toEqual({ erreur: "nombre_etapes" });
    expect(table.lignes.size).toBe(0);
  });

  it("états hors ordre (à venir avant faite, deux en cours) : ordre_etats", async () => {
    const e = (etat: string, i: number) => ({ titre: `Étape ${i}`, pourquoi: POURQUOI(`l'étape ${i}`), etat });
    expect(await proposerHorsConversation("u1", "proposer_etapes", { objectifId: 1, etapes: [e("a_venir", 0), e("faite", 1), e("a_venir", 2)] }, DEBUT))
      .toEqual({ erreur: "ordre_etats" });
    expect(await proposerHorsConversation("u1", "proposer_etapes", { objectifId: 1, etapes: [e("en_cours", 0), e("en_cours", 1), e("a_venir", 2)] }, DEBUT))
      .toEqual({ erreur: "ordre_etats" });
  });

  it("normaliserEtats remet faites → une en cours → à venir", () => {
    const r = normaliserEtats([{ etat: "a_venir" as const, n: 1 }, { etat: "en_cours" as const, n: 2 }, { etat: "faite" as const, n: 3 }, { etat: "en_cours" as const, n: 4 }]);
    expect(r.map((x) => `${x.n}:${x.etat}`)).toEqual(["3:faite", "2:en_cours", "1:a_venir", "4:a_venir"]);
  });

  it("un objectif qui a déjà une étape non faite : chaine_en_cours", async () => {
    jalons.set(50, { id: 50, projectId: 10, userId: "u1", goalId: 1, status: "active", order: 0, title: "En cours" });
    const etapes = TROIS.map((e) => ({ ...e, pourquoi: POURQUOI(e.titre) }));
    expect(await proposerHorsConversation("u1", "proposer_etapes", { objectifId: 1, etapes }, DEBUT)).toEqual({ erreur: "chaine_en_cours" });
  });

  it("chaîne franchie : la suite est rangée après les étapes faites", async () => {
    jalons.set(50, { id: 50, projectId: 10, userId: "u1", goalId: 1, status: "completed", order: 0, title: "A" });
    jalons.set(51, { id: 51, projectId: 10, userId: "u1", goalId: 1, status: "skipped", order: 1, title: "B" });
    await proposerEtapesPour("u1", 1, DEBUT);
    await validerProposition("u1", 1, jours(1));
    expect(s.createMilestone.mock.calls.map((c) => c[0].order)).toEqual([2, 3, 4]);
  });

  it("une chaîne posée entre l'aperçu et la validation rend la proposition périmée", async () => {
    await proposerEtapesPour("u1", 1, DEBUT);
    jalons.set(50, { id: 50, projectId: 10, userId: "u1", goalId: 1, status: "active", order: 0, title: "Posée ailleurs" });
    expect(await validerProposition("u1", 1, jours(1))).toEqual({ ok: false, raison: "expiree" });
    expect(s.createMilestone).not.toHaveBeenCalled();
  });

  it("objectif non actif, ou qui a déjà une étape ouverte : aucun appel IA, aucune proposition", async () => {
    objectifs.get(1).status = "paused";
    expect(await genererEtapes("u1", 1)).toBeNull();
    expect(await proposerEtapesPour("u1", 1, DEBUT)).toEqual({ erreur: "generation_impossible" });
    objectifs.get(1).status = "active";
    jalons.set(50, { id: 50, projectId: 10, userId: "u1", goalId: 1, status: "locked", order: 0, title: "Ouverte" });
    expect(await genererEtapes("u1", 1)).toBeNull();
    expect(await proposerEtapesPour("u1", 1, DEBUT)).toEqual({ erreur: "generation_impossible" });
    expect(ia.callClaudeWithContext).not.toHaveBeenCalled();
    expect(table.lignes.size).toBe(0);
  });

  it("les posts publiés sont comptés sur les 30 jours avant le `maintenant` de l'appelant", async () => {
    await proposerEtapesPour("u1", 1, jours(3));
    expect(s.getPostsEntre).toHaveBeenCalledWith("u1", new Date(jours(3).getTime() - 30 * 24 * 3600_000), jours(3));
  });

  it("deuxième appel avec une proposition déjà en attente : aucun nouvel appel IA", async () => {
    await proposerEtapesPour("u1", 1, DEBUT);
    expect(await proposerEtapesPour("u1", 1, jours(1))).toEqual({ erreur: "deja_en_attente" });
    expect(ia.callClaudeWithContext).toHaveBeenCalledTimes(1);
    expect(table.lignes.size).toBe(1);
  });

  it("isAiBlocked vrai : aucun appel IA, aucune proposition", async () => {
    ia.isAiBlocked.mockResolvedValue(true);
    expect(await proposerEtapesPour("u1", 1, DEBUT)).toEqual({ erreur: "generation_impossible" });
    expect(ia.callClaudeWithContext).not.toHaveBeenCalled();
    expect(table.lignes.size).toBe(0);
  });

  it("« pourquoi » creux : un seul nouvel essai, puis abandon", async () => {
    const creux = JSON.stringify({ etapes: TROIS.map((e) => ({ ...e, pourquoi: "Pour avancer." })) });
    ia.callClaudeWithContext.mockResolvedValueOnce(creux).mockResolvedValueOnce(sortie(TROIS));
    expect(await genererEtapes("u1", 1)).toHaveLength(3);
    expect(ia.callClaudeWithContext).toHaveBeenCalledTimes(2);

    ia.callClaudeWithContext.mockReset();
    ia.callClaudeWithContext.mockResolvedValue(creux);
    expect(await genererEtapes("u1", 1)).toBeNull();
    expect(ia.callClaudeWithContext).toHaveBeenCalledTimes(2);
  });

  it("sortie hors schéma (2 étapes) : nouvel essai", async () => {
    ia.callClaudeWithContext.mockResolvedValueOnce(sortie(TROIS.slice(0, 2))).mockResolvedValueOnce(sortie(TROIS));
    expect(await genererEtapes("u1", 1)).toHaveLength(3);
  });

  it("objectif d'une autre utilisatrice : introuvable, et rien n'est généré", async () => {
    const etapes = TROIS.map((e) => ({ ...e, pourquoi: POURQUOI(e.titre) }));
    expect(await proposerHorsConversation("u1", "proposer_etapes", { objectifId: 3, etapes }, DEBUT)).toEqual({ erreur: "introuvable" });
    expect(await genererEtapes("u1", 3)).toBeNull();
    expect(ia.callClaudeWithContext).not.toHaveBeenCalled();
  });

  it("hors interrupteur : refusée", async () => {
    const etapes = TROIS.map((e) => ({ ...e, pourquoi: POURQUOI(e.titre) }));
    expect(await proposerHorsConversation("u9", "proposer_etapes", { objectifId: 1, etapes }, DEBUT)).toEqual({ erreur: "fil_inactif" });
  });
});

describe("rattacher_chaine", () => {
  beforeEach(() => {
    jalons.set(60, { id: 60, projectId: 10, userId: "u1", goalId: null, status: "completed", order: 0, title: "Site refait" });
    jalons.set(61, { id: 61, projectId: 10, userId: "u1", goalId: null, status: "active", order: 1, title: "Lancer la newsletter" });
    jalons.set(62, { id: 62, projectId: 10, userId: "u1", goalId: null, status: "locked", order: 2, title: "100 abonnés" });
    jalons.set(70, { id: 70, projectId: 20, userId: "u2", goalId: null, status: "active", order: 0, title: "Jalon d'une autre" });
  });

  it("un jalon d'une autre utilisatrice : introuvable", async () => {
    expect(await proposerHorsConversation("u1", "rattacher_chaine", { projetId: 10, objectifId: 1, jalonIds: [60, 70] }, DEBUT))
      .toEqual({ erreur: "introuvable" });
    expect(table.lignes.size).toBe(0);
  });

  it("validation : goalId posé, statuts identiques", async () => {
    const p = await proposerHorsConversation("u1", "rattacher_chaine", { projetId: 10, objectifId: 2, jalonIds: [60, 61, 62] }, DEBUT);
    expect("erreur" in p).toBe(false);
    expect(table.lignes.get(1).expireA).toEqual(jours(7));
    expect(table.lignes.get(1).empreinte).toEqual(expect.arrayContaining([
      { table: "project_milestones", id: 61, champs: { goalId: null, status: "active" } },
    ]));
    const r = await validerProposition("u1", 1, jours(2));
    expect(r).toMatchObject({ ok: true, echecs: [] });
    for (const c of s.updateMilestone.mock.calls) expect(c[1]).toEqual({ goalId: 2 });
    expect([60, 61, 62].map((id) => jalons.get(id).goalId)).toEqual([2, 2, 2]);
    expect([60, 61, 62].map((id) => jalons.get(id).status)).toEqual(["completed", "active", "locked"]);
  });

  it("un jalon rattaché ailleurs depuis l'aperçu : proposition périmée", async () => {
    await proposerHorsConversation("u1", "rattacher_chaine", { projetId: 10, objectifId: 2, jalonIds: [60, 61, 62] }, DEBUT);
    jalons.set(61, { ...jalons.get(61), goalId: 1 });
    expect(await validerProposition("u1", 1, jours(1))).toEqual({ ok: false, raison: "expiree" });
    expect(s.updateMilestone).not.toHaveBeenCalled();
  });

  it("l'objectif a reçu une étape ouverte depuis l'aperçu (proposer_etapes validée) : rattachement périmé", async () => {
    await proposerHorsConversation("u1", "rattacher_chaine", { projetId: 10, objectifId: 2, jalonIds: [60, 61, 62] }, DEBUT);
    expect(table.lignes.get(1).empreinte).toEqual(expect.arrayContaining([
      { table: "etapes_objectif", id: 2, champs: { nombre: 0, ouvertes: 0 } },
    ]));
    const etapes = await proposerEtapesPour("u1", 2, DEBUT);
    expect(await validerProposition("u1", (etapes as any).id, jours(1))).toMatchObject({ ok: true });
    expect(await validerProposition("u1", 1, jours(1))).toEqual({ ok: false, raison: "expiree" });
    expect(s.updateMilestone).not.toHaveBeenCalled();
    const ouvertes = Array.from(jalons.values()).filter((j) => j.goalId === 2 && !["completed", "skipped"].includes(j.status));
    expect(ouvertes.filter((j) => j.status === "active")).toHaveLength(1);
  });

  it("proposerRattachements, plusieurs objectifs : l'appel rapide choisit", async () => {
    ia.callClaudeWithContext.mockResolvedValue('{"objectif": 1}');
    const r = await proposerRattachements("u1", DEBUT);
    expect(r).toHaveLength(1);
    expect(ia.callClaudeWithContext.mock.calls[0][0].model).toBe("modele-rapide");
    expect(table.lignes.get(1).arguments).toEqual({ projetId: 10, objectifId: 2, jalonIds: [60, 61, 62] });
    // Une seconde passe ne repropose pas le même projet.
    expect(await proposerRattachements("u1", jours(1))).toEqual([]);
    expect(ia.callClaudeWithContext).toHaveBeenCalledTimes(1);
  });

  it("proposerRattachements, un seul objectif : choisi sans IA", async () => {
    objectifs.get(2).status = "paused";
    const r = await proposerRattachements("u1", DEBUT);
    expect(r).toHaveLength(1);
    expect(ia.callClaudeWithContext).not.toHaveBeenCalled();
    expect(table.lignes.get(1).arguments.objectifId).toBe(1);
  });

  it("proposerRattachements : l'IA s'abstient, rien n'est proposé", async () => {
    ia.callClaudeWithContext.mockResolvedValue('{"objectif": null}');
    expect(await proposerRattachements("u1", DEBUT)).toEqual([]);
    expect(table.lignes.size).toBe(0);
  });
});

describe("déclencheur « chaîne franchie » (confirmMilestone)", () => {
  it("toutes les étapes de l'objectif faites ou sautées : une proposition de suite", async () => {
    const { confirmMilestone } = await import("../milestone-engine");
    jalons.set(50, { id: 50, projectId: 10, userId: "u1", goalId: 1, status: "skipped", order: 0, title: "A" });
    jalons.set(51, { id: 51, projectId: 10, userId: "u1", goalId: 1, status: "active", order: 1, title: "B" });
    Object.assign(s, { getMilestoneConditions: vi.fn(async () => []), completeMilestoneTask: vi.fn(), unblockTasksForMilestone: vi.fn(), fulfillCondition: vi.fn() });
    await confirmMilestone(51);
    await vi.waitFor(() => expect(table.lignes.size).toBe(1));
    expect(table.lignes.get(1)).toMatchObject({ outil: "proposer_etapes", arguments: { objectifId: 1 } });
  });

  it("une étape encore ouverte : rien", async () => {
    const { proposerSuiteSiChaineFranchie } = await import("../milestone-engine");
    jalons.set(50, { id: 50, projectId: 10, userId: "u1", goalId: 1, status: "completed", order: 0, title: "A" });
    jalons.set(51, { id: 51, projectId: 10, userId: "u1", goalId: 1, status: "locked", order: 1, title: "B" });
    await proposerSuiteSiChaineFranchie(10, "u1", 1);
    expect(ia.callClaudeWithContext).not.toHaveBeenCalled();
    expect(table.lignes.size).toBe(0);
  });
});

describe("durées", () => {
  it("les propositions de l'agent gardent 1 h", () => {
    expect(DUREE_PROPOSITION_MS).toBe(3600_000);
  });
});
