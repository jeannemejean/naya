// Tests de l'annulation des actions directes. `../../storage` et `./depot` sont mockés : aucun
// test ne touche une vraie base (consigne projet). On vérifie l'ordre des refus
// (introuvable → deja_annulee → expiree → modifiee), que rien n'est écrit quand une ligne a
// bougé, et que seuls les champs listés dans `apres` sont comparés.
import { describe, it, expect, vi, beforeEach } from "vitest";

const s = vi.hoisted(() => ({
  getTask: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn(), fixOverlappingTasks: vi.fn(),
  getTaskList: vi.fn(), deleteTaskList: vi.fn(),
  getWorkspaceEntries: vi.fn(), tacheALivrables: vi.fn(),
  getUserPreferences: vi.fn(), upsertUserPreferences: vi.fn(),
}));
const d = vi.hoisted(() => ({ getAction: vi.fn(), marquerAnnulee: vi.fn() }));
vi.mock("../../storage", () => ({ storage: s }));
vi.mock("./depot", () => ({ depot: d }));

const { annulerAction, memeValeur } = await import("./journal");

const CREEE = new Date("2026-11-02T10:00:00Z");
const MAINTENANT = new Date("2026-11-02T12:00:00Z");

function action(lignes: any[], extra: Record<string, unknown> = {}) {
  return { id: 5, userId: "u1", outil: "x", resume: "r", lignes, createdAt: CREEE, annuleeAt: null, ...extra };
}

// Ce que creer_liste journalise (le JSONB peut rendre les clés dans un autre ordre).
const LISTE_APRES = { title: "Courses", elements: [{ titre: "Lait", coche: false }, { coche: false, titre: "Pain" }] };
const listeIntacte = () => ({
  id: 3, userId: "u1", title: "Courses",
  items: [
    { id: 1, listId: 3, title: "Lait", completed: false, order: 0 },
    { id: 2, listId: 3, title: "Pain", completed: false, order: 1 },
  ],
});

const rienEcrit = () => {
  for (const f of [s.updateTask, s.deleteTask, s.deleteTaskList, s.upsertUserPreferences, d.marquerAnnulee]) {
    expect(f).not.toHaveBeenCalled();
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  d.getAction.mockResolvedValue(undefined);
  s.fixOverlappingTasks.mockResolvedValue(undefined);
  s.getWorkspaceEntries.mockResolvedValue([]);
  s.tacheALivrables.mockResolvedValue(false);
});

describe("annulerAction", () => {
  it("tâche créée puis annulée : la tâche est supprimée", async () => {
    d.getAction.mockResolvedValue(action([
      { table: "tasks", id: 10, avant: null, apres: { title: "Appeler Léa", scheduledDate: "2026-11-05", scheduledTime: "10:00", completed: false } },
    ]));
    s.getTask.mockResolvedValue({ id: 10, userId: "u1", title: "Appeler Léa", scheduledDate: "2026-11-05", scheduledTime: "10:00", completed: false });
    expect(await annulerAction("u1", 5, MAINTENANT)).toEqual({ ok: true });
    expect(d.getAction).toHaveBeenCalledWith(5, "u1");
    expect(s.deleteTask).toHaveBeenCalledWith(10);
    expect(d.marquerAnnulee).toHaveBeenCalledWith(5, "u1", MAINTENANT);
  });

  it("liste créée puis annulée : la liste et ses éléments sont supprimés", async () => {
    d.getAction.mockResolvedValue(action([{ table: "task_lists", id: 3, avant: null, apres: LISTE_APRES }]));
    s.getTaskList.mockResolvedValue(listeIntacte());
    expect(await annulerAction("u1", 5, MAINTENANT)).toEqual({ ok: true });
    expect(s.getTaskList).toHaveBeenCalledWith(3, "u1");
    expect(s.deleteTaskList).toHaveBeenCalledWith(3, "u1");
  });

  it("tâche modifiée puis annulée : les champs d'avant sont réécrits (completedAt redevient une date)", async () => {
    d.getAction.mockResolvedValue(action([
      { table: "tasks", id: 10, avant: { completed: true, completedAt: "2026-11-01T08:00:00.000Z" }, apres: { completed: false, completedAt: null } },
    ]));
    s.getTask.mockResolvedValue({ id: 10, userId: "u1", title: "T", completed: false, completedAt: null });
    expect(await annulerAction("u1", 5, MAINTENANT)).toEqual({ ok: true });
    expect(s.updateTask).toHaveBeenCalledWith(10, { completed: true, completedAt: new Date("2026-11-01T08:00:00.000Z") });
    expect(s.fixOverlappingTasks).not.toHaveBeenCalled();
  });

  it("déplacement annulé : l'horaire d'avant revient, puis le filet anti-chevauchement passe", async () => {
    d.getAction.mockResolvedValue(action([
      { table: "tasks", id: 10,
        avant: { scheduledDate: "2026-11-04", scheduledTime: "09:00", scheduledEndTime: "09:30" },
        apres: { scheduledDate: "2026-11-06", scheduledTime: "14:00", scheduledEndTime: "14:30" } },
    ]));
    s.getTask.mockResolvedValue({ id: 10, userId: "u1", scheduledDate: "2026-11-06", scheduledTime: "14:00", scheduledEndTime: "14:30" });
    expect(await annulerAction("u1", 5, MAINTENANT)).toEqual({ ok: true });
    expect(s.updateTask).toHaveBeenCalledWith(10, { scheduledDate: "2026-11-04", scheduledTime: "09:00", scheduledEndTime: "09:30" });
    expect(s.fixOverlappingTasks).toHaveBeenCalledWith("u1", expect.any(String));
  });

  it("énergie annulée : les préférences d'avant sont réécrites", async () => {
    d.getAction.mockResolvedValue(action([
      { table: "user_preferences", id: "u1",
        avant: { currentEnergyLevel: "high", energyUpdatedDate: "2026-11-01" },
        apres: { currentEnergyLevel: "low", energyUpdatedDate: "2026-11-02" } },
    ]));
    s.getUserPreferences.mockResolvedValue({ userId: "u1", currentEnergyLevel: "low", energyUpdatedDate: "2026-11-02", timezone: "UTC" });
    expect(await annulerAction("u1", 5, MAINTENANT)).toEqual({ ok: true });
    expect(s.getUserPreferences).toHaveBeenCalledWith("u1");
    expect(s.upsertUserPreferences).toHaveBeenCalledWith("u1", { currentEnergyLevel: "high", energyUpdatedDate: "2026-11-01" });
  });

  it("annuler deux fois : deja_annulee", async () => {
    d.getAction.mockResolvedValue(action([], { annuleeAt: new Date("2026-11-02T11:00:00Z") }));
    expect(await annulerAction("u1", 5, MAINTENANT)).toEqual({ ok: false, raison: "deja_annulee" });
    rienEcrit();
  });

  it("24 h pile : encore annulable ; 24 h et 1 s : expiree", async () => {
    d.getAction.mockResolvedValue(action([]));
    expect(await annulerAction("u1", 5, new Date(CREEE.getTime() + 24 * 3600_000))).toEqual({ ok: true });
    vi.clearAllMocks();
    d.getAction.mockResolvedValue(action([]));
    expect(await annulerAction("u1", 5, new Date(CREEE.getTime() + 24 * 3600_000 + 1000))).toEqual({ ok: false, raison: "expiree" });
    rienEcrit();
  });

  it("déjà annulée ET expirée : deja_annulee passe avant expiree", async () => {
    d.getAction.mockResolvedValue(action([], { annuleeAt: CREEE }));
    expect(await annulerAction("u1", 5, new Date("2026-11-05T00:00:00Z"))).toEqual({ ok: false, raison: "deja_annulee" });
  });

  it("l'action d'une autre utilisatrice : introuvable (le dépôt filtre sur userId)", async () => {
    d.getAction.mockImplementation(async (id: number, uid: string) => (uid === "u2" ? action([]) : undefined));
    expect(await annulerAction("u1", 5, MAINTENANT)).toEqual({ ok: false, raison: "introuvable" });
    expect(d.getAction).toHaveBeenCalledWith(5, "u1");
    rienEcrit();
  });

  it("tâche cochée puis renommée à la main : le titre n'est pas un champ touché, l'annulation passe", async () => {
    d.getAction.mockResolvedValue(action([
      { table: "tasks", id: 10, avant: { completed: false, completedAt: null }, apres: { completed: true, completedAt: "2026-11-02T10:00:00.000Z" } },
    ]));
    s.getTask.mockResolvedValue({ id: 10, userId: "u1", title: "Renommée", completed: true, completedAt: new Date("2026-11-02T10:00:00Z") });
    expect(await annulerAction("u1", 5, MAINTENANT)).toEqual({ ok: true });
    expect(s.updateTask).toHaveBeenCalledWith(10, { completed: false, completedAt: null });
  });

  it("tâche déplacée puis redéplacée à la main : modifiee, et RIEN n'est écrit (même les autres lignes)", async () => {
    d.getAction.mockResolvedValue(action([
      { table: "user_preferences", id: "u1", avant: { currentEnergyLevel: "high" }, apres: { currentEnergyLevel: "low" } },
      { table: "tasks", id: 10, avant: { scheduledDate: "2026-11-04", scheduledTime: "09:00" }, apres: { scheduledDate: "2026-11-06", scheduledTime: "14:00" } },
    ]));
    s.getUserPreferences.mockResolvedValue({ currentEnergyLevel: "low" });
    s.getTask.mockResolvedValue({ id: 10, userId: "u1", scheduledDate: "2026-11-07", scheduledTime: "14:00" });
    expect(await annulerAction("u1", 5, MAINTENANT)).toEqual({ ok: false, raison: "modifiee" });
    rienEcrit();
  });

  it("tâche créée puis cochée à la main : modifiee, la tâche n'est pas supprimée", async () => {
    d.getAction.mockResolvedValue(action([
      { table: "tasks", id: 10, avant: null, apres: { title: "T", completed: false } },
    ]));
    s.getTask.mockResolvedValue({ id: 10, userId: "u1", title: "T", completed: true });
    expect(await annulerAction("u1", 5, MAINTENANT)).toEqual({ ok: false, raison: "modifiee" });
    rienEcrit();
  });

  it("ligne disparue (supprimée entre-temps) ou tâche d'une autre : modifiee, rien n'est écrit", async () => {
    d.getAction.mockResolvedValue(action([{ table: "tasks", id: 10, avant: null, apres: { title: "T" } }]));
    s.getTask.mockResolvedValue(undefined);
    expect(await annulerAction("u1", 5, MAINTENANT)).toEqual({ ok: false, raison: "modifiee" });
    s.getTask.mockResolvedValue({ id: 10, userId: "u2", title: "T" });
    expect(await annulerAction("u1", 5, MAINTENANT)).toEqual({ ok: false, raison: "modifiee" });
    rienEcrit();
  });
});

describe("annulerAction : ne jamais effacer ce que l'utilisatrice a ajouté", () => {
  const tacheCreee = () => {
    d.getAction.mockResolvedValue(action([{ table: "tasks", id: 10, avant: null, apres: { title: "T", completed: false } }]));
    s.getTask.mockResolvedValue({ id: 10, userId: "u1", title: "T", completed: false });
  };

  it("tâche créée avec une entrée d'espace de travail : modifiee, rien n'est supprimé", async () => {
    tacheCreee();
    s.getWorkspaceEntries.mockResolvedValue([{ id: 1, taskId: 10, content: "mon texte" }]);
    expect(await annulerAction("u1", 5, MAINTENANT)).toEqual({ ok: false, raison: "modifiee" });
    expect(s.getWorkspaceEntries).toHaveBeenCalledWith(10);
    rienEcrit();
  });

  it("tâche créée avec un livrable : modifiee, rien n'est supprimé", async () => {
    tacheCreee();
    s.tacheALivrables.mockResolvedValue(true);
    expect(await annulerAction("u1", 5, MAINTENANT)).toEqual({ ok: false, raison: "modifiee" });
    expect(s.tacheALivrables).toHaveBeenCalledWith(10, "u1");
    rienEcrit();
  });

  it("tâche créée intacte (ni espace de travail ni livrable) : supprimée", async () => {
    tacheCreee();
    expect(await annulerAction("u1", 5, MAINTENANT)).toEqual({ ok: true });
    expect(s.deleteTask).toHaveBeenCalledWith(10);
  });

  it("tâche seulement modifiée : la vérification de contenu n'est pas faite (rien ne sera supprimé)", async () => {
    d.getAction.mockResolvedValue(action([
      { table: "tasks", id: 10, avant: { completed: false, completedAt: null }, apres: { completed: true, completedAt: null } },
    ]));
    s.getTask.mockResolvedValue({ id: 10, userId: "u1", completed: true, completedAt: null });
    s.getWorkspaceEntries.mockResolvedValue([{ id: 1 }]);
    expect(await annulerAction("u1", 5, MAINTENANT)).toEqual({ ok: true });
    expect(s.updateTask).toHaveBeenCalled();
  });

  it("liste créée dont un élément a été coché : modifiee, rien n'est supprimé", async () => {
    d.getAction.mockResolvedValue(action([{ table: "task_lists", id: 3, avant: null, apres: LISTE_APRES }]));
    const l = listeIntacte();
    l.items[1].completed = true;
    s.getTaskList.mockResolvedValue(l);
    expect(await annulerAction("u1", 5, MAINTENANT)).toEqual({ ok: false, raison: "modifiee" });
    rienEcrit();
  });

  it("liste créée à laquelle un élément a été ajouté : modifiee, rien n'est supprimé", async () => {
    d.getAction.mockResolvedValue(action([{ table: "task_lists", id: 3, avant: null, apres: LISTE_APRES }]));
    const l = listeIntacte();
    l.items.push({ id: 4, listId: 3, title: "Oeufs", completed: false, order: 2 });
    s.getTaskList.mockResolvedValue(l);
    expect(await annulerAction("u1", 5, MAINTENANT)).toEqual({ ok: false, raison: "modifiee" });
    rienEcrit();
  });
});

describe("memeValeur (comparaison robuste)", () => {
  it("deux objets aux clés dans un ordre différent sont égaux", () => {
    expect(memeValeur({ titre: "a", coche: false }, { coche: false, titre: "a" })).toBe(true);
    expect(memeValeur([{ titre: "a", coche: false }], [{ titre: "a", coche: true }])).toBe(false);
  });

  it("Date et chaîne ISO du même instant sont égales", () => {
    expect(memeValeur(new Date("2026-11-02T10:00:00Z"), "2026-11-02T10:00:00.000Z")).toBe(true);
    expect(memeValeur("2026-11-02T10:00:00Z", new Date("2026-11-02T10:00:00Z"))).toBe(true);
    expect(memeValeur(new Date("2026-11-02T10:00:01Z"), "2026-11-02T10:00:00.000Z")).toBe(false);
  });
  it("null et undefined sont égaux ; null et une valeur ne le sont pas", () => {
    expect(memeValeur(undefined, null)).toBe(true);
    expect(memeValeur(null, undefined)).toBe(true);
    expect(memeValeur(null, "2026-11-04")).toBe(false);
    expect(memeValeur(false, null)).toBe(false);
  });
  it("une date AAAA-MM-JJ et une heure HH:MM restent comparées comme du texte", () => {
    expect(memeValeur("2026-11-04", "2026-11-04")).toBe(true);
    expect(memeValeur("09:00", "09:00")).toBe(true);
    expect(memeValeur("09:00", "09:30")).toBe(false);
  });
});
