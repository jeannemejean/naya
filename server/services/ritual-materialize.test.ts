import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Rien n'atteint la vraie base : db, stockage et carte du fil sont simulés.
vi.mock("../db", () => ({ db: {} }));
vi.mock("./fil/carte", async (importOriginal) => ({ ...(await importOriginal<typeof import("./fil/carte")>()), chargerCarte: vi.fn() }));
vi.mock("../storage", () => ({
  storage: {
    getActiveRituals: vi.fn(),
    getRitualTaskForDate: vi.fn(),
    createTask: vi.fn(),
  },
}));

import { storage } from "../storage";
import { chargerCarte, type CarteFil } from "./fil/carte";
import { materializeRituals } from "./ritual-materialize";
import { estRituelDeCreation } from "./rituals";

const RITUAL = {
  id: 1, userId: "u1", projectId: 3,
  title: "Brief news + posts JMD",
  days: "mon,tue,wed,thu,fri",
  startTime: "09:00",
  durationMinutes: 20,
  active: true,
  createdAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Fil conducteur hors interrupteur : comportement historique, aucune carte lue.
  vi.stubEnv("FIL_CONDUCTEUR_USERS", "");
  (storage.createTask as any).mockResolvedValue({ id: 99 });
});

describe("materializeRituals", () => {
  it("crée la tâche du jour pour un rituel actif", async () => {
    (storage.getActiveRituals as any).mockResolvedValue([RITUAL]);
    (storage.getRitualTaskForDate as any).mockResolvedValue(undefined);

    const created = await materializeRituals("u1", "2026-07-24"); // vendredi

    expect(created).toBe(1);
    expect(storage.createTask).toHaveBeenCalledTimes(1);
    expect((storage.createTask as any).mock.calls[0][0]).toMatchObject({
      userId: "u1",
      projectId: 3,
      ritualId: 1,
      title: "Brief news + posts JMD",
      scheduledDate: "2026-07-24",
      scheduledTime: "09:00",
      scheduledEndTime: "09:20",
      schedulingMode: "fixed",
    });
  });

  it("est idempotente : un second appel ne recrée rien", async () => {
    (storage.getActiveRituals as any).mockResolvedValue([RITUAL]);
    (storage.getRitualTaskForDate as any).mockResolvedValue({ id: 99 });

    const created = await materializeRituals("u1", "2026-07-24");

    expect(created).toBe(0);
    expect(storage.createTask).not.toHaveBeenCalled();
  });

  it("ne crée rien un jour non concerné", async () => {
    (storage.getActiveRituals as any).mockResolvedValue([RITUAL]);
    (storage.getRitualTaskForDate as any).mockResolvedValue(undefined);

    const created = await materializeRituals("u1", "2026-07-25"); // samedi

    expect(created).toBe(0);
    expect(storage.createTask).not.toHaveBeenCalled();
  });

  it("ignore les rituels inactifs (getActiveRituals les exclut déjà)", async () => {
    (storage.getActiveRituals as any).mockResolvedValue([]);

    const created = await materializeRituals("u1", "2026-07-24");

    expect(created).toBe(0);
    expect(storage.createTask).not.toHaveBeenCalled();
  });

  it("n'interrompt pas les autres rituels si l'un échoue", async () => {
    const second = { ...RITUAL, id: 2, title: "Revue du soir", startTime: "17:00" };
    (storage.getActiveRituals as any).mockResolvedValue([RITUAL, second]);
    (storage.getRitualTaskForDate as any).mockResolvedValue(undefined);
    (storage.createTask as any)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ id: 100 });

    const created = await materializeRituals("u1", "2026-07-24");

    expect(created).toBe(1);
    expect(storage.createTask).toHaveBeenCalledTimes(2);
  });
});

// ── Fil conducteur : rituels de création ───────────────────────────────────────────────

const ENCORE_MERCI = {
  id: 21, userId: "u1", projectId: 30, title: "Encore Merci : 3 recettes de la semaine",
  days: "mon", startTime: "09:00", durationMinutes: 60, active: true, createdAt: null,
};
const CARTE: CarteFil = {
  objectifs: [
    { id: 5, projetId: 30, titre: "Être visible", successMode: "visibility", goalType: "visibility", cible: null, dueDate: null,
      etapes: [{ id: 500, objectifId: 5, projetId: 30, titre: "Publier chaque semaine", pourquoi: null, statut: "active", ordre: 0, faites: 0, prevues: 0 }] },
    { id: 6, projetId: 30, titre: "3 clients", successMode: "revenue", goalType: "revenue", cible: null, dueDate: null, etapes: [] },
  ],
  chainesSansObjectif: new Map(), depuis: null,
};
const LUNDI = "2026-11-16";

describe("estRituelDeCreation", () => {
  it("mots entiers d'une liste fermée, sans accents ni casse ; jamais de sous-chaîne", () => {
    expect(estRituelDeCreation("Encore Merci : 3 recettes de la semaine")).toBe(true);
    expect(estRituelDeCreation("Publication des comptes annuels")).toBe(true); // cas limite accepté
    expect(estRituelDeCreation("Tourner les VIDÉOS")).toBe(true);
    expect(estRituelDeCreation("Légendes Instagram")).toBe(true);
    expect(estRituelDeCreation("Point compta")).toBe(false);
    expect(estRituelDeCreation("Recette Naya")).toBe(false); // « recette » au singulier : jargon logiciel
    expect(estRituelDeCreation("poste comptable")).toBe(false);
  });
});

describe("materializeRituals : rattachement des rituels de création (fil conducteur)", () => {
  beforeEach(() => {
    (storage.getActiveRituals as any).mockResolvedValue([ENCORE_MERCI]);
    (storage.getRitualTaskForDate as any).mockResolvedValue(undefined);
    (chargerCarte as any).mockResolvedValue(CARTE);
  });
  afterEach(() => vi.unstubAllEnvs());

  const cree = async (title: string) => {
    (storage.getActiveRituals as any).mockResolvedValue([{ ...ENCORE_MERCI, title }]);
    await materializeRituals("u1", LUNDI);
    return (storage.createTask as any).mock.calls.at(-1)[0];
  };

  it("sous interrupteur : « Encore Merci » est rattaché à l'objectif de visibilité du projet", async () => {
    vi.stubEnv("FIL_CONDUCTEUR_USERS", "u1");
    expect(await materializeRituals("u1", LUNDI)).toBe(1);
    expect((storage.createTask as any).mock.calls[0][0]).toMatchObject({
      projectId: 30, ritualId: 21, title: "Encore Merci : 3 recettes de la semaine", goalId: 5, milestoneId: 500,
    });
  });

  it("sous interrupteur : seuls les titres de création sont rattachés", async () => {
    vi.stubEnv("FIL_CONDUCTEUR_USERS", "u1");
    expect((await cree("Publication des comptes annuels")).goalId).toBe(5);
    for (const t of ["Point compta", "Recette Naya", "poste comptable"]) {
      const c = await cree(t);
      expect(c.goalId).toBeUndefined();
      expect(c.milestoneId).toBeUndefined();
    }
  });

  it("hors interrupteur : la tâche est créée exactement comme avant, sans lire la carte", async () => {
    expect(await materializeRituals("u1", LUNDI)).toBe(1);
    expect((storage.createTask as any).mock.calls[0][0]).toEqual({
      userId: "u1", projectId: 30, ritualId: 21, type: "admin", category: "planning", taskEnergyType: "execution", priority: 1,
      title: "Encore Merci : 3 recettes de la semaine", scheduledDate: LUNDI, scheduledTime: "09:00", scheduledEndTime: "10:00",
      estimatedDuration: 60, schedulingMode: "fixed", source: "ritual",
    });
    expect(chargerCarte).not.toHaveBeenCalled();
  });

  it("sous interrupteur, rituel transverse (sans projet) : aucun rattachement deviné", async () => {
    vi.stubEnv("FIL_CONDUCTEUR_USERS", "u1");
    (storage.getActiveRituals as any).mockResolvedValue([{ ...ENCORE_MERCI, projectId: null }]);
    await materializeRituals("u1", LUNDI);
    expect((storage.createTask as any).mock.calls[0][0].goalId).toBeUndefined();
    expect(chargerCarte).not.toHaveBeenCalled();
  });

  it("sous interrupteur, carte illisible : la tâche est créée quand même, sans rattachement", async () => {
    vi.stubEnv("FIL_CONDUCTEUR_USERS", "u1");
    (chargerCarte as any).mockRejectedValue(new Error("base"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await materializeRituals("u1", LUNDI)).toBe(1);
    err.mockRestore();
    expect((storage.createTask as any).mock.calls[0][0].goalId).toBeUndefined();
  });
});
