// Tests des actions directes de l'agent. Stockage, dépôt et écriture de tâche sont mockés :
// aucun test ne touche une vraie base (consigne projet). On vérifie ce qui est journalisé
// (avant / après) et qu'un refus ne laisse aucune ligne de journal.
import { describe, it, expect, vi, beforeEach } from "vitest";

const s = vi.hoisted(() => ({
  getTask: vi.fn(), getUserPreferences: vi.fn(), upsertUserPreferences: vi.fn(),
  getProject: vi.fn(), createCaptureEntry: vi.fn(),
  createTaskList: vi.fn(), createTaskListItem: vi.fn(), deleteTaskList: vi.fn(),
}));
const d = vi.hoisted(() => ({ ajouterAction: vi.fn() }));
const t = vi.hoisted(() => ({ creerTache: vi.fn(), modifierTache: vi.fn() }));
vi.mock("../../../storage", () => ({ storage: s }));
const m = vi.hoisted(() => ({ rangerSouvenir: vi.fn(), lireSouvenir: vi.fn(), perimerSouvenir: vi.fn() }));
vi.mock("../depot", () => ({ depot: d }));
vi.mock("../../memory/ranger", () => m);
vi.mock("../../taches/ecrire-tache", () => t);
vi.mock("../recherche", () => ({
  SOURCES: ["tache"], chercher: vi.fn(async () => []), lire: vi.fn(async () => null),
}));

const { outil, REGISTRE, DIRECTS_AUTORISES } = await import("../registre");
const ctx = { userId: "u1", maintenant: new Date("2026-11-02T23:30:00Z"), fuseau: "Europe/Paris" };
const run = (nom: string, args: any) => outil(nom)!.executer(ctx, args);
const CREEE = new Date("2026-11-02T23:30:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  d.ajouterAction.mockImplementation(async (userId: string, o: string, resume: string, lignes: any[]) => ({
    id: 42, userId, outil: o, resume, lignes, createdAt: CREEE, annuleeAt: null,
  }));
});

describe("classement", () => {
  it("les neuf outils directs sont présents et autorisés", () => {
    const noms = ["creer_tache", "creer_rappel", "creer_note", "ranger_information", "creer_liste", "cocher_tache", "decocher_tache", "deplacer_tache", "regler_energie"];
    for (const n of noms) {
      expect(outil(n)?.classe).toBe("direct");
      expect(DIRECTS_AUTORISES.has(n)).toBe(true);
    }
    expect(REGISTRE.filter((o) => o.classe === "direct")).toHaveLength(9);
  });
});

describe("creer_tache", () => {
  it("crée une tâche planning, priorité 3, source companion, et journalise la création", async () => {
    t.creerTache.mockResolvedValue({ ok: true, tache: { id: 10, userId: "u1", title: "Appeler Léa", scheduledDate: "2026-11-05", scheduledTime: "10:00", completed: false } });
    const r = await run("creer_tache", { titre: "Appeler Léa", date: "2026-11-05", heure: "10:00", dureeMinutes: 45, projetId: 1 });
    expect(t.creerTache).toHaveBeenCalledWith("u1", expect.objectContaining({
      title: "Appeler Léa", type: "planning", priority: 3, source: "companion",
      scheduledDate: "2026-11-05", scheduledTime: "10:00", scheduledEndTime: "10:45", estimatedDuration: 45, projectId: 1,
    }));
    expect(d.ajouterAction).toHaveBeenCalledWith("u1", "creer_tache", "Tâche « Appeler Léa » ajoutée le 5 nov. à 10 h", [
      { table: "tasks", id: 10, avant: null, apres: { title: "Appeler Léa", scheduledDate: "2026-11-05", scheduledTime: "10:00", completed: false } },
    ]);
    expect(r.faite).toEqual({ actionId: 42, resume: "Tâche « Appeler Léa » ajoutée le 5 nov. à 10 h", annulableJusqua: "2026-11-03T23:30:00.000Z" });
  });

  it("projetId d'une autre utilisatrice : erreur transmise au modèle, aucune ligne de journal", async () => {
    t.creerTache.mockResolvedValue({ ok: false, status: 404, message: "project_not_found" });
    const r = await run("creer_tache", { titre: "X", projetId: 99 });
    expect((r.pourModele as any).erreur).toBe("project_not_found");
    expect(r.faite).toBeUndefined();
    expect(d.ajouterAction).not.toHaveBeenCalled();
  });

  it("date ou heure mal formée : erreur, rien n'est créé", async () => {
    expect((await run("creer_tache", { titre: "X", date: "5 nov" })).pourModele).toHaveProperty("erreur");
    expect((await run("creer_tache", { titre: "X", date: "2026-11-05", heure: "25:00" })).pourModele).toHaveProperty("erreur");
    expect(t.creerTache).not.toHaveBeenCalled();
    expect(d.ajouterAction).not.toHaveBeenCalled();
  });
});

describe("creer_rappel", () => {
  it("crée une tâche admin de priorité 2 à l'heure dite", async () => {
    t.creerTache.mockResolvedValue({ ok: true, tache: { id: 11, title: "Relancer devis", scheduledDate: "2026-11-05", scheduledTime: "09:30", completed: false } });
    const r = await run("creer_rappel", { titre: "Relancer devis", date: "2026-11-05", heure: "09:30" });
    expect(t.creerTache).toHaveBeenCalledWith("u1", expect.objectContaining({
      title: "Relancer devis", type: "admin", priority: 2, source: "companion", scheduledDate: "2026-11-05", scheduledTime: "09:30",
    }));
    expect(r.faite?.resume).toBe("Rappel « Relancer devis » le 5 nov. à 9 h 30");
  });
});

describe("creer_liste", () => {
  it("crée la liste (createdByCompanion) et ses éléments, journalise la liste", async () => {
    s.createTaskList.mockResolvedValue({ id: 3, userId: "u1", title: "Courses" });
    s.createTaskListItem.mockResolvedValue({});
    const r = await run("creer_liste", { titre: "Courses", elements: ["Lait", "Pain"], date: "2026-11-05" });
    expect(s.createTaskList).toHaveBeenCalledWith({
      userId: "u1", title: "Courses", linkedTaskId: null, linkedDate: "2026-11-05", createdByCompanion: true,
    });
    expect(s.createTaskListItem).toHaveBeenNthCalledWith(1, { listId: 3, title: "Lait", order: 0 });
    expect(s.createTaskListItem).toHaveBeenNthCalledWith(2, { listId: 3, title: "Pain", order: 1 });
    expect(d.ajouterAction).toHaveBeenCalledWith("u1", "creer_liste", "Liste « Courses » créée (2 éléments)", [
      { table: "task_lists", id: 3, avant: null, apres: {
        title: "Courses", elements: [{ titre: "Lait", coche: false }, { titre: "Pain", coche: false }],
      } },
    ]);
    expect(r.faite?.actionId).toBe(42);
  });

  it("tâche liée d'une autre utilisatrice : introuvable, rien n'est créé", async () => {
    s.getTask.mockResolvedValue({ id: 9, userId: "u2" });
    const r = await run("creer_liste", { titre: "L", elements: ["a"], tacheLieeId: 9 });
    expect((r.pourModele as any).erreur).toBe("introuvable");
    expect(s.createTaskList).not.toHaveBeenCalled();
    expect(d.ajouterAction).not.toHaveBeenCalled();
  });

  it("un élément qui échoue : la liste à moitié créée est retirée, pas de journal", async () => {
    s.createTaskList.mockResolvedValue({ id: 3, userId: "u1", title: "L" });
    s.createTaskListItem.mockRejectedValueOnce(new Error("base"));
    await expect(run("creer_liste", { titre: "L", elements: ["a"] })).rejects.toThrow();
    expect(s.deleteTaskList).toHaveBeenCalledWith(3, "u1");
    expect(d.ajouterAction).not.toHaveBeenCalled();
  });
});

describe("cocher_tache / decocher_tache", () => {
  it("cocher journalise completed et completedAt d'avant et d'après", async () => {
    const fait = new Date("2026-11-02T23:30:00Z");
    t.modifierTache.mockResolvedValue({
      ok: true,
      avant: { id: 10, title: "T", completed: false, completedAt: null },
      tache: { id: 10, title: "T", completed: true, completedAt: fait },
    });
    const r = await run("cocher_tache", { tacheId: 10 });
    expect(t.modifierTache).toHaveBeenCalledWith("u1", 10, { completed: true });
    expect(d.ajouterAction).toHaveBeenCalledWith("u1", "cocher_tache", "Tâche « T » cochée", [
      { table: "tasks", id: 10, avant: { completed: false, completedAt: null }, apres: { completed: true, completedAt: fait } },
    ]);
    expect(r.faite?.resume).toBe("Tâche « T » cochée");
  });

  it("décocher remet explicitement completedAt à null", async () => {
    const avant = new Date("2026-11-01T08:00:00Z");
    t.modifierTache.mockResolvedValue({
      ok: true,
      avant: { id: 10, title: "T", completed: true, completedAt: avant },
      tache: { id: 10, title: "T", completed: false, completedAt: null },
    });
    await run("decocher_tache", { tacheId: 10 });
    expect(t.modifierTache).toHaveBeenCalledWith("u1", 10, { completed: false, completedAt: null });
    expect(d.ajouterAction).toHaveBeenCalledWith("u1", "decocher_tache", "Tâche « T » décochée", [
      { table: "tasks", id: 10, avant: { completed: true, completedAt: avant }, apres: { completed: false, completedAt: null } },
    ]);
  });

  it("tâche introuvable (ou d'une autre) : erreur, pas de journal", async () => {
    t.modifierTache.mockResolvedValue({ ok: false, status: 404, message: "task_not_found" });
    const r = await run("cocher_tache", { tacheId: 77 });
    expect((r.pourModele as any).erreur).toBe("task_not_found");
    expect(d.ajouterAction).not.toHaveBeenCalled();
  });
});

describe("deplacer_tache", () => {
  it("passe par modifierTache et journalise date, heure et heure de fin d'avant et d'après", async () => {
    t.modifierTache.mockResolvedValue({
      ok: true,
      avant: { id: 10, title: "T", scheduledDate: "2026-11-04", scheduledTime: "09:00", scheduledEndTime: "09:30" },
      tache: { id: 10, title: "T", scheduledDate: "2026-11-06", scheduledTime: "14:00", scheduledEndTime: "14:30" },
    });
    // Relu après le filet anti-chevauchement, qui a pu décaler la tâche.
    s.getTask.mockResolvedValue({ id: 10, userId: "u1", title: "T", scheduledDate: "2026-11-06", scheduledTime: "14:15", scheduledEndTime: "14:45" });
    const r = await run("deplacer_tache", { tacheId: 10, date: "2026-11-06", heure: "14:00" });
    expect(t.modifierTache).toHaveBeenCalledWith("u1", 10, { scheduledDate: "2026-11-06", scheduledTime: "14:00" });
    expect(d.ajouterAction).toHaveBeenCalledWith("u1", "deplacer_tache", "Tâche « T » déplacée au 6 nov. à 14 h 15", [
      { table: "tasks", id: 10,
        avant: { scheduledDate: "2026-11-04", scheduledTime: "09:00", scheduledEndTime: "09:30" },
        apres: { scheduledDate: "2026-11-06", scheduledTime: "14:15", scheduledEndTime: "14:45" } },
    ]);
    expect(r.faite?.actionId).toBe(42);
  });

  it("sans heure : seule la date est envoyée", async () => {
    t.modifierTache.mockResolvedValue({
      ok: true,
      avant: { id: 10, title: "T", scheduledDate: "2026-11-04", scheduledTime: "09:00", scheduledEndTime: "09:30" },
      tache: { id: 10, title: "T", scheduledDate: "2026-11-06", scheduledTime: "09:00", scheduledEndTime: "09:30" },
    });
    s.getTask.mockResolvedValue({ id: 10, userId: "u1", title: "T", scheduledDate: "2026-11-06", scheduledTime: "09:00", scheduledEndTime: "09:30" });
    await run("deplacer_tache", { tacheId: 10, date: "2026-11-06" });
    expect(t.modifierTache).toHaveBeenCalledWith("u1", 10, { scheduledDate: "2026-11-06" });
  });

  it("jour non travaillé : l'erreur de modifierTache est rendue, pas de journal", async () => {
    t.modifierTache.mockResolvedValue({ ok: false, status: 400, message: "Saturday is not one of your work days." });
    const r = await run("deplacer_tache", { tacheId: 10, date: "2026-11-07" });
    expect((r.pourModele as any).erreur).toMatch(/Saturday/);
    expect(d.ajouterAction).not.toHaveBeenCalled();
  });
});

describe("regler_energie", () => {
  it("journalise currentEnergyLevel et energyUpdatedDate, date locale du fuseau", async () => {
    s.getUserPreferences.mockResolvedValue({ userId: "u1", currentEnergyLevel: "high", energyUpdatedDate: "2026-11-01" });
    s.upsertUserPreferences.mockResolvedValue({ userId: "u1", currentEnergyLevel: "low", energyUpdatedDate: "2026-11-03" });
    const r = await run("regler_energie", { niveau: "low" });
    // 23 h 30 UTC le 2 = 0 h 30 le 3 à Paris.
    expect(s.upsertUserPreferences).toHaveBeenCalledWith("u1", { currentEnergyLevel: "low", energyUpdatedDate: "2026-11-03" });
    expect(d.ajouterAction).toHaveBeenCalledWith("u1", "regler_energie", "Énergie du jour : basse", [
      { table: "user_preferences", id: "u1",
        avant: { currentEnergyLevel: "high", energyUpdatedDate: "2026-11-01" },
        apres: { currentEnergyLevel: "low", energyUpdatedDate: "2026-11-03" } },
    ]);
    expect(r.faite?.resume).toBe("Énergie du jour : basse");
  });

  it("sans préférences existantes : avant à null", async () => {
    s.getUserPreferences.mockResolvedValue(undefined);
    s.upsertUserPreferences.mockResolvedValue({ userId: "u1", currentEnergyLevel: "medium", energyUpdatedDate: "2026-11-03" });
    await run("regler_energie", { niveau: "medium" });
    expect(d.ajouterAction.mock.calls[0][3][0].avant).toEqual({ currentEnergyLevel: null, energyUpdatedDate: null });
  });
});

// ── Notes et mémoire ──────────────────────────────────────────────────────────────────

describe("creer_note", () => {
  beforeEach(() => {
    s.getProject.mockResolvedValue({ id: 3, userId: "u1", name: "JMD" });
    s.createCaptureEntry.mockImplementation(async (x: any) => ({ id: 77, ...x }));
  });

  it("écrit comme POST /api/projects/:id/notes (note, inbox) et journalise la création", async () => {
    const r = await run("creer_note", { contenu: "  Idée de série  ", projetId: 3 });
    expect(s.getProject).toHaveBeenCalledWith(3, "u1");
    expect(s.createCaptureEntry).toHaveBeenCalledWith({
      userId: "u1", projectId: 3, content: "Idée de série", captureType: "note",
      classifiedType: "note", isProcessed: false, routingStatus: "inbox",
    });
    expect(d.ajouterAction).toHaveBeenCalledWith("u1", "creer_note", "Note ajoutée aux notes de JMD", [
      { table: "quick_capture_entries", id: 77, avant: null, apres: {
        content: "Idée de série", captureType: "note", isProcessed: false, routingStatus: "inbox",
        routedTo: null, convertedToTaskId: null, projectId: 3,
      } },
    ]);
    expect(r.faite?.actionId).toBe(42);
  });

  it("sans projet : note libre dans la boîte de réception", async () => {
    await run("creer_note", { contenu: "Appeler le comptable" });
    expect(s.getProject).not.toHaveBeenCalled();
    expect(s.createCaptureEntry).toHaveBeenCalledWith(expect.objectContaining({ projectId: null }));
  });

  it("projet d'une autre utilisatrice : introuvable, rien écrit ni journalisé", async () => {
    s.getProject.mockResolvedValue(undefined);
    const r = await run("creer_note", { contenu: "x", projetId: 99 });
    expect(r.pourModele).toEqual({ erreur: "introuvable" });
    expect(s.createCaptureEntry).not.toHaveBeenCalled();
    expect(d.ajouterAction).not.toHaveBeenCalled();
  });

  it("contenu vide : erreur, rien écrit", async () => {
    const r = await run("creer_note", { contenu: "   " });
    expect((r.pourModele as any).erreur).toBeDefined();
    expect(d.ajouterAction).not.toHaveBeenCalled();
  });
});

describe("ranger_information", () => {
  beforeEach(() => {
    s.getProject.mockResolvedValue({ id: 3, userId: "u1", name: "JMD" });
    s.createCaptureEntry.mockImplementation(async (x: any) => ({ id: 77, ...x }));
    m.rangerSouvenir.mockResolvedValue({ id: 500 });
  });

  it("note_projet sans projetId : {erreur: projet_requis}, aucune écriture ni journal", async () => {
    const r = await run("ranger_information", { contenu: "x", ou: "note_projet" });
    expect(r.pourModele).toEqual({ erreur: "projet_requis" });
    expect(s.createCaptureEntry).not.toHaveBeenCalled();
    expect(d.ajouterAction).not.toHaveBeenCalled();
  });

  it("note_projet : note du projet, résumé « Rangé dans les notes de JMD »", async () => {
    const r = await run("ranger_information", { contenu: "Tarif 800 €", ou: "note_projet", projetId: 3 });
    expect(s.createCaptureEntry).toHaveBeenCalledWith(expect.objectContaining({ projectId: 3, captureType: "note", routingStatus: "inbox" }));
    expect(r.faite?.resume).toBe("Rangé dans les notes de JMD");
    expect(d.ajouterAction.mock.calls[0][3][0]).toMatchObject({ table: "quick_capture_entries", id: 77, avant: null });
  });

  it("memoire avec projet : fil cap par défaut, journalise le souvenir", async () => {
    const r = await run("ranger_information", { contenu: "Pas de lundi", ou: "memoire", projetId: 3, type: "préférence" });
    expect(m.rangerSouvenir).toHaveBeenCalledWith("u1", 3, "Pas de lundi", "cap", "préférence");
    expect(r.faite?.resume).toBe("Rangé dans la mémoire de JMD");
    expect(d.ajouterAction).toHaveBeenCalledWith("u1", "ranger_information", "Rangé dans la mémoire de JMD", [
      { table: "memory_entries", id: 500, avant: null, apres: { content: "Pas de lundi", supersededAt: null } },
    ]);
  });

  it("memoire sans projet : fil founder transverse, type fait", async () => {
    await run("ranger_information", { contenu: "Matinale", ou: "memoire" });
    expect(m.rangerSouvenir).toHaveBeenCalledWith("u1", null, "Matinale", "founder", "fait");
  });

  it("fil founder avec projet : stocké sans projet (le fil founder est lu transversalement)", async () => {
    await run("ranger_information", { contenu: "Matinale", ou: "memoire", projetId: 3, fil: "founder" });
    expect(m.rangerSouvenir).toHaveBeenCalledWith("u1", null, "Matinale", "founder", "fait");
  });

  it("fil cap sans projet : projet_requis, rien écrit", async () => {
    const r = await run("ranger_information", { contenu: "x", ou: "memoire", fil: "cap" });
    expect(r.pourModele).toEqual({ erreur: "projet_requis" });
    expect(m.rangerSouvenir).not.toHaveBeenCalled();
  });

  it("projet d'une autre : introuvable, rien écrit", async () => {
    s.getProject.mockResolvedValue(undefined);
    const r = await run("ranger_information", { contenu: "x", ou: "memoire", projetId: 9 });
    expect(r.pourModele).toEqual({ erreur: "introuvable" });
    expect(m.rangerSouvenir).not.toHaveBeenCalled();
    expect(d.ajouterAction).not.toHaveBeenCalled();
  });
});
