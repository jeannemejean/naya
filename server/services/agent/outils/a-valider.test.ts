// Tests des outils « à valider » de l'agent. Stockage, dépôt et écriture de tâche sont mockés :
// aucun test ne touche une vraie base (consigne projet). L'écriture des jalons passe par les
// VRAIES fonctions (ecrire-projet.ts → milestone-engine) sur le stockage mocké, pour vérifier
// qu'aucune tâche n'est jamais créée pour un jalon `locked`.
import { describe, it, expect, vi, beforeEach } from "vitest";

const s = vi.hoisted(() => ({
  getTask: vi.fn(), getTasksInRange: vi.fn(), deleteTask: vi.fn(),
  getProject: vi.fn(), getProjects: vi.fn(), createProject: vi.fn(), upsertUserPreferences: vi.fn(),
  getMilestone: vi.fn(), getMilestoneTaskStats: vi.fn(), createMilestone: vi.fn(), createMilestoneCondition: vi.fn(),
  createTask: vi.fn(), getMesures: vi.fn(), getMilestones: vi.fn(),
}));
const d = vi.hoisted(() => ({ ajouterProposition: vi.fn(), ajouterAction: vi.fn() }));
const t = vi.hoisted(() => ({ creerTache: vi.fn(), modifierTache: vi.fn() }));
vi.mock("../../../storage", () => ({ storage: s }));
vi.mock("../depot", () => ({ depot: d }));
vi.mock("../../taches/ecrire-tache", () => t);
vi.mock("../../memory/ranger", () => ({ rangerSouvenir: vi.fn(), lireSouvenir: vi.fn(), perimerSouvenir: vi.fn() }));
vi.mock("../recherche", () => ({ SOURCES: ["tache"], chercher: vi.fn(async () => []), lire: vi.fn(async () => null) }));

const { outil, REGISTRE } = await import("../registre");
const ctx = { userId: "u1", maintenant: new Date("2026-11-02T09:00:00Z"), fuseau: "Europe/Paris" };
const propose = (nom: string, args: any) => outil(nom)!.executer(ctx, args);
const aValider = (nom: string) => (outil(nom) as any).aValider;

const tache = (id: number, extra: any = {}) => ({
  id, userId: "u1", title: `Tâche ${id}`, scheduledDate: "2026-11-02", scheduledTime: "10:00",
  completed: false, archivedAt: null, type: "planning", ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  d.ajouterProposition.mockImplementation(async (userId: string, o: string, args: any, changements: any, empreinte: any, expireA: Date) => ({
    id: 77, userId, outil: o, arguments: args, changements, empreinte, statut: "en_attente", expireA,
  }));
  s.getProject.mockImplementation(async (id: number, u: string) => (id === 5 && u === "u1" ? { id: 5, name: "Mouture", userId: "u1" } : undefined));
  s.getMilestones.mockResolvedValue([]);
});

describe("classement", () => {
  it("les sept outils du lot 1 sont à valider", () => {
    for (const n of ["deplacer_taches", "decaler_journee", "supprimer_taches", "creer_projet", "creer_jalons", "confirmer_jalon", "saisir_mesure"]) {
      expect(outil(n)?.classe).toBe("a_valider");
    }
    expect(REGISTRE.filter((o) => o.classe === "a_valider")).toHaveLength(7);
  });
});

describe("decaler_journee", () => {
  it("l'aperçu liste chaque tâche, avec avant (date et heure) et après, sans rien écrire", async () => {
    s.getTasksInRange.mockResolvedValue([
      tache(1), tache(2, { scheduledTime: "14:30" }),
      tache(3, { completed: true }), // faite : reste où elle est
      tache(4, { userId: "u2" }),    // jamais celle d'une autre
    ]);
    const r = await propose("decaler_journee", { du: "2026-11-02", au: "2026-11-03" });
    expect(s.getTasksInRange).toHaveBeenCalledWith("u1", "2026-11-02", "2026-11-02");
    expect(r.proposition).toEqual({
      id: 77,
      resume: "Décaler 2 tâches du 2 nov. au 3 nov.",
      changements: [
        { libelle: "« Tâche 1 »", avant: "2 nov. à 10 h", apres: "3 nov. à 10 h" },
        { libelle: "« Tâche 2 »", avant: "2 nov. à 14 h 30", apres: "3 nov. à 14 h 30" },
      ],
      expireA: "2026-11-02T10:00:00.000Z",
    });
    const [, , , , empreinte] = d.ajouterProposition.mock.calls[0];
    expect(empreinte).toContainEqual({ table: "taches_du_jour", id: 0, champs: { date: "2026-11-02", ids: [1, 2] } });
    expect(empreinte).toContainEqual({ table: "tasks", id: 1, champs: { title: "Tâche 1", scheduledDate: "2026-11-02", scheduledTime: "10:00", completed: false } });
    expect(t.modifierTache).not.toHaveBeenCalled();
    expect((r.pourModele as any).a_valider).toBe(true);
  });

  it("refuse de décaler vers un jour passé (dans le fuseau de l'utilisatrice)", async () => {
    // 2 nov. 23 h 30 UTC = déjà le 3 nov. à Paris : le 2 est passé.
    const tard = { ...ctx, maintenant: new Date("2026-11-02T23:30:00Z") };
    const r = await outil("decaler_journee")!.executer(tard, { du: "2026-11-03", au: "2026-11-02" });
    expect((r.pourModele as any).erreur).toMatch(/passé/);
    expect(d.ajouterProposition).not.toHaveBeenCalled();
  });

  it("l'exécution déplace les tâches à faire du jour, une par une", async () => {
    s.getTasksInRange.mockResolvedValue([tache(1), tache(2)]);
    s.getTask.mockImplementation(async (id: number) => tache(id));
    t.modifierTache.mockImplementation(async (_u: string, id: number) => ({ ok: true, avant: tache(id), tache: tache(id, { scheduledDate: "2026-11-03" }) }));
    const b = await aValider("decaler_journee").executer(ctx, { du: "2026-11-02", au: "2026-11-03" });
    expect(t.modifierTache).toHaveBeenCalledWith("u1", 1, { scheduledDate: "2026-11-03" });
    expect(t.modifierTache).toHaveBeenCalledWith("u1", 2, { scheduledDate: "2026-11-03" });
    expect(b).toEqual({ reussis: ["« Tâche 1 » déplacée au 3 nov. à 10 h", "« Tâche 2 » déplacée au 3 nov. à 10 h"], echecs: [] });
  });
});

describe("deplacer_taches", () => {
  it("une tâche d'une autre : {erreur: introuvable}, aucune proposition", async () => {
    s.getTask.mockImplementation(async (id: number) => (id === 9 ? tache(9, { userId: "u2" }) : tache(id)));
    const r = await propose("deplacer_taches", { deplacements: [{ tacheId: 1, date: "2026-11-04" }, { tacheId: 9, date: "2026-11-04" }] });
    expect(r.pourModele).toEqual({ erreur: "introuvable" });
    expect(d.ajouterProposition).not.toHaveBeenCalled();
  });

  it("aperçu : avant et après, l'heure gardée si non donnée", async () => {
    s.getTask.mockImplementation(async (id: number) => tache(id));
    const r = await propose("deplacer_taches", { deplacements: [{ tacheId: 1, date: "2026-11-04" }, { tacheId: 2, date: "2026-11-05", heure: "09:15" }] });
    expect(r.proposition?.changements).toEqual([
      { libelle: "« Tâche 1 »", avant: "2 nov. à 10 h", apres: "4 nov. à 10 h" },
      { libelle: "« Tâche 2 »", avant: "2 nov. à 10 h", apres: "5 nov. à 9 h 15" },
    ]);
  });
});

describe("supprimer_taches", () => {
  it("un id d'une autre : {erreur: introuvable}, aucune proposition créée", async () => {
    s.getTask.mockImplementation(async (id: number) => (id === 9 ? tache(9, { userId: "u2" }) : tache(id)));
    const r = await propose("supprimer_taches", { tacheIds: [1, 9] });
    expect(r.pourModele).toEqual({ erreur: "introuvable" });
    expect(d.ajouterProposition).not.toHaveBeenCalled();
    expect(s.deleteTask).not.toHaveBeenCalled();
  });

  it("l'exécution revérifie l'appartenance avant deleteTask", async () => {
    s.getTask.mockImplementation(async (id: number) => (id === 2 ? undefined : tache(id)));
    const b = await aValider("supprimer_taches").executer(ctx, { tacheIds: [1, 2] });
    expect(s.deleteTask).toHaveBeenCalledTimes(1);
    expect(s.deleteTask).toHaveBeenCalledWith(1);
    expect(b).toEqual({ reussis: ["« Tâche 1 » supprimée"], echecs: ["Tâche n° 2 : introuvable"] });
  });
});

describe("creer_jalons", () => {
  it("projet d'une autre : introuvable", async () => {
    const r = await propose("creer_jalons", { projetId: 6, jalons: [{ titre: "A" }] });
    expect(r.pourModele).toEqual({ erreur: "introuvable" });
    expect(d.ajouterProposition).not.toHaveBeenCalled();
  });

  it("projet qui a déjà des jalons : refus (ajout à une chaîne existante = lot 2), aucune proposition", async () => {
    s.getMilestones.mockResolvedValue([
      { id: 1, title: "Lancer", status: "completed" }, { id: 2, title: "Vendre", status: "active" },
    ]);
    const r = await propose("creer_jalons", { projetId: 5, jalons: [{ titre: "Fidéliser" }] });
    expect(s.getMilestones).toHaveBeenCalledWith(5, "u1");
    expect(r.pourModele).toEqual({
      erreur: "projet_a_deja_des_jalons",
      jalons: [{ titre: "Lancer", statut: "terminé" }, { titre: "Vendre", statut: "actif" }],
    });
    expect(r.proposition).toBeUndefined();
    expect(d.ajouterProposition).not.toHaveBeenCalled();
  });

  it("projet sans jalon : l'empreinte surveille le nombre de jalons", async () => {
    await propose("creer_jalons", { projetId: 5, jalons: [{ titre: "Lancer" }] });
    const [, , , , empreinte] = d.ajouterProposition.mock.calls[0];
    expect(empreinte).toContainEqual({ table: "jalons_du_projet", id: 5, champs: { nombre: 0 } });
  });

  it("ne crée jamais de tâche pour un jalon locked", async () => {
    let n = 100;
    s.createMilestone.mockImplementation(async (row: any) => ({ id: ++n, ...row }));
    s.createMilestoneCondition.mockImplementation(async (row: any) => ({ id: 1, ...row }));
    const r = await propose("creer_jalons", { projetId: 5, jalons: [{ titre: "Lancer" }, { titre: "Vendre" }, { titre: "Fidéliser" }] });
    expect(r.proposition?.changements).toEqual([
      { libelle: "Jalon « Lancer »", avant: null, apres: "actif" },
      { libelle: "Jalon « Vendre »", avant: null, apres: "verrouillé" },
      { libelle: "Jalon « Fidéliser »", avant: null, apres: "verrouillé" },
    ]);
    const b = await aValider("creer_jalons").executer(ctx, { projetId: 5, jalons: [{ titre: "Lancer" }, { titre: "Vendre" }, { titre: "Fidéliser" }] });
    expect(s.createMilestone).toHaveBeenCalledTimes(3);
    expect(s.createMilestone.mock.calls.map((c) => c[0].status)).toEqual(["active", "locked", "locked"]);
    expect(s.createTask).not.toHaveBeenCalled();
    expect(t.creerTache).not.toHaveBeenCalled();
    expect(b.echecs).toEqual([]);
    expect(b.reussis).toEqual(["Jalon « Lancer » créé (actif)", "Jalon « Vendre » créé (verrouillé)", "Jalon « Fidéliser » créé (verrouillé)"]);
  });
});

describe("confirmer_jalon", () => {
  it("jalon d'une autre : introuvable", async () => {
    s.getMilestone.mockResolvedValue({ id: 3, userId: "u2", title: "X", status: "active", projectId: 5 });
    const r = await propose("confirmer_jalon", { jalonId: 3 });
    expect(r.pourModele).toEqual({ erreur: "introuvable" });
  });

  it("aperçu : statut avant → terminé, et les tâches non faites qui seront cochées", async () => {
    s.getMilestone.mockResolvedValue({ id: 3, userId: "u1", title: "Lancer", status: "active", projectId: 5 });
    s.getMilestoneTaskStats.mockResolvedValue({ 3: { dates: [], done: 1, total: 3 } });
    const r = await propose("confirmer_jalon", { jalonId: 3 });
    expect(r.proposition?.changements).toEqual([
      { libelle: "Jalon « Lancer »", avant: "actif", apres: "terminé" },
      { libelle: "2 tâches du jalon non faites", avant: "à faire", apres: "cochées" },
    ]);
    const [, , , , empreinte] = d.ajouterProposition.mock.calls[0];
    expect(empreinte).toEqual([{ table: "project_milestones", id: 3, champs: { status: "active" } }]);
  });
});

describe("creer_projet", () => {
  it("aperçu : le projet et ses jalons, rien n'est créé", async () => {
    s.getProjects.mockResolvedValue([{ id: 5 }]);
    const r = await propose("creer_projet", { nom: "Garance", type: "Business", jalons: ["Ouvrir"] });
    expect(r.proposition?.resume).toBe("Créer le projet « Garance » avec 1 jalon");
    expect(r.proposition?.changements).toEqual([
      { libelle: "Projet", avant: null, apres: "Garance (Business)" },
      { libelle: "Jalon « Ouvrir »", avant: null, apres: "actif" },
    ]);
    expect(s.createProject).not.toHaveBeenCalled();
  });
});

describe("saisir_mesure", () => {
  it("aperçu : seuls les chiffres qui changent, avant → après", async () => {
    s.getMesures.mockResolvedValue([{ id: 40, mois: "2026-09", ca: 10000, caNouveaux: null, nouveauxClients: 20, commandes: null, coutsVariables: null, depenses: { paid_social: 1000 } }]);
    const r = await propose("saisir_mesure", { projetId: 5, mois: "2026-09", champs: { nouveauxClients: 25, ca: 10000 } });
    expect(r.proposition?.changements).toEqual([{ libelle: "Nouveaux clients", avant: "20", apres: "25" }]);
    const [, , , , empreinte] = d.ajouterProposition.mock.calls[0];
    expect(empreinte[0]).toMatchObject({ table: "mesures_mensuelles", id: 5, champs: { mois: "2026-09", id: 40, nouveauxClients: 20 } });
  });

  it("projet d'une autre : introuvable", async () => {
    const r = await propose("saisir_mesure", { projetId: 6, mois: "2026-09", champs: { ca: 1 } });
    expect(r.pourModele).toEqual({ erreur: "introuvable" });
  });
});
