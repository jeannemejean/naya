import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../storage", () => ({
  storage: {
    getProspectionCampaigns: vi.fn(),
    getLeads: vi.fn(),
    getTasksInRange: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
  },
}));

import { storage } from "../storage";
import {
  prospectsAValider,
  titreValidation,
  dureeValidation,
  planTacheValidation,
  lienValidation,
  synchroniserValidationsProspection,
  TYPE_TACHE_VALIDATION,
} from "./prospection-verification";

const VALIDE = new Date("2026-10-01T10:00:00Z");
const JOUR = "2026-10-08";

function lead(id: number, over: Record<string, any> = {}) {
  return { id, prospectionCampaignId: 7, stage: "messages_ready", validatedAt: null, archivedAt: null, ...over };
}

describe("prospectsAValider", () => {
  it("messages prêts, jamais validés, de CETTE campagne, non archivés", () => {
    const leads = [
      lead(1),
      lead(2, { validatedAt: VALIDE }),
      lead(3, { stage: "identified" }),
      lead(4, { prospectionCampaignId: 8 }),
      lead(5, { archivedAt: VALIDE }),
      lead(6, { validatedAt: new Date("x") }), // date invalide = jamais validé
    ];
    expect(prospectsAValider(leads, 7).map((l) => l.id)).toEqual([1, 6]);
  });
});

describe("titre, durée, lien", () => {
  it("titre en français avec le nombre et la campagne", () => {
    expect(titreValidation(3, "Maisons de mode")).toBe("Valider les messages préparés par Naya — 3 prospects (Maisons de mode)");
    expect(titreValidation(1, "X")).toBe("Valider les messages préparés par Naya — 1 prospect (X)");
  });
  it("durée courte : 15 min, un peu plus pour un gros lot, jamais plus de 30", () => {
    expect(dureeValidation(1)).toBe(15);
    expect(dureeValidation(10)).toBe(15);
    expect(dureeValidation(16)).toBe(24);
    expect(dureeValidation(100)).toBe(30);
  });
  it("lien interne vers l'onglet Prospects de la campagne", () => {
    expect(lienValidation(7)).toBe("/outreach/campaigns/7?onglet=prospects");
  });
});

const campagne = { id: 7, name: "Maisons de mode", projectId: 3, linkedCampaignId: 42, status: "active" };

function tache(over: Record<string, any> = {}) {
  return {
    id: 100, title: "ancien", completed: false, archivedAt: null, scheduledDate: JOUR,
    taskType: TYPE_TACHE_VALIDATION, actionData: { prospectionCampaignId: 7, aValider: 2 }, ...over,
  };
}

describe("planTacheValidation — idempotent, une tâche par campagne et par jour", () => {
  it("rien à valider et aucune tâche → rien", () => {
    expect(planTacheValidation({ campagne, aValider: 0, taches: [], jour: JOUR })).toEqual({ creer: null, maj: [], clore: [] });
  });

  it("des prospects à valider et aucune tâche → crée UNE tâche liée à la campagne", () => {
    const p = planTacheValidation({ campagne, aValider: 4, taches: [], jour: JOUR });
    expect(p.creer).toMatchObject({
      title: "Valider les messages préparés par Naya — 4 prospects (Maisons de mode)",
      scheduledDate: JOUR,
      estimatedDuration: 15,
      projectId: 3,
      campaignId: 42,
      taskType: TYPE_TACHE_VALIDATION,
      source: "prospection",
      completed: false,
      actionData: { prospectionCampaignId: 7, aValider: 4, lien: "/outreach/campaigns/7?onglet=prospects" },
    });
    expect(p.maj).toEqual([]);
  });

  it("une tâche ouverte du jour → mise à jour du nombre, pas de doublon", () => {
    const p = planTacheValidation({ campagne, aValider: 5, taches: [tache()], jour: JOUR });
    expect(p.creer).toBeNull();
    expect(p.maj).toHaveLength(1);
    expect(p.maj[0].id).toBe(100);
    expect(p.maj[0].data.title).toContain("5 prospects");
    expect((p.maj[0].data.actionData as any).aValider).toBe(5);
  });

  it("même nombre et même titre → aucune écriture", () => {
    const t = tache({ title: titreValidation(2, "Maisons de mode") });
    const p = planTacheValidation({ campagne, aValider: 2, taches: [t], jour: JOUR });
    expect(p).toEqual({ creer: null, maj: [], clore: [] });
  });

  it("une tâche ouverte d'un jour passé → ramenée à aujourd'hui (pas de nouvelle tâche)", () => {
    const p = planTacheValidation({ campagne, aValider: 2, taches: [tache({ scheduledDate: "2026-10-06" })], jour: JOUR });
    expect(p.creer).toBeNull();
    expect(p.maj[0].data.scheduledDate).toBe(JOUR);
  });

  it("deux tâches ouvertes (doublon hérité) → on garde la plus récente, l'autre est close", () => {
    const p = planTacheValidation({
      campagne, aValider: 2,
      taches: [tache({ id: 1, scheduledDate: "2026-10-06" }), tache({ id: 2 })],
      jour: JOUR,
    });
    expect(p.maj.map((m) => m.id)).toEqual([2]);
    expect(p.clore).toEqual([1]);
  });

  it("tâche du jour déjà cochée → pas de seconde tâche aujourd'hui", () => {
    const p = planTacheValidation({ campagne, aValider: 3, taches: [tache({ completed: true })], jour: JOUR });
    expect(p).toEqual({ creer: null, maj: [], clore: [] });
  });

  it("tâche cochée HIER et encore des prospects à valider → nouvelle tâche aujourd'hui", () => {
    const p = planTacheValidation({ campagne, aValider: 3, taches: [tache({ completed: true, scheduledDate: "2026-10-07" })], jour: JOUR });
    expect(p.creer).not.toBeNull();
  });

  it("plus rien à valider → la tâche ouverte est close", () => {
    const p = planTacheValidation({ campagne, aValider: 0, taches: [tache()], jour: JOUR });
    expect(p.clore).toEqual([100]);
    expect(p.creer).toBeNull();
  });

  it("ignore les tâches d'une autre campagne", () => {
    const p = planTacheValidation({
      campagne, aValider: 1,
      taches: [tache({ actionData: { prospectionCampaignId: 8 } })],
      jour: JOUR,
    });
    expect(p.creer).not.toBeNull();
    expect(p.maj).toEqual([]);
  });
});

describe("synchroniserValidationsProspection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storage.getProspectionCampaigns as any).mockResolvedValue([campagne, { ...campagne, id: 8, name: "Pause", status: "paused" }]);
    (storage.getLeads as any).mockResolvedValue([lead(1), lead(2), lead(3, { prospectionCampaignId: 8 })]);
    (storage.getTasksInRange as any).mockResolvedValue([]);
    (storage.createTask as any).mockImplementation(async (t: any) => ({ id: 500, ...t }));
    (storage.updateTask as any).mockImplementation(async (id: number, d: any) => ({ id, ...d }));
  });

  it("crée la tâche de la campagne active, rien pour la campagne en pause", async () => {
    const r = await synchroniserValidationsProspection("u1", JOUR);
    expect(storage.createTask).toHaveBeenCalledTimes(1);
    expect((storage.createTask as any).mock.calls[0][0]).toMatchObject({ userId: "u1", title: expect.stringContaining("2 prospects") });
    expect(r).toMatchObject({ creees: 1, majs: 0, closes: 0 });
  });

  it("deux passages successifs → toujours une seule tâche (idempotent)", async () => {
    await synchroniserValidationsProspection("u1", JOUR);
    const creee = (storage.createTask as any).mock.calls[0][0];
    (storage.getTasksInRange as any).mockResolvedValue([{ id: 500, ...creee }]);
    await synchroniserValidationsProspection("u1", JOUR);
    expect(storage.createTask).toHaveBeenCalledTimes(1);
    expect(storage.updateTask).not.toHaveBeenCalled();
  });

  it("une campagne en pause ferme sa tâche ouverte", async () => {
    (storage.getTasksInRange as any).mockResolvedValue([tache({ id: 9, actionData: { prospectionCampaignId: 8 } })]);
    await synchroniserValidationsProspection("u1", JOUR);
    expect(storage.updateTask).toHaveBeenCalledWith(9, expect.objectContaining({ completed: true }));
  });

  it("peut se limiter à une campagne", async () => {
    await synchroniserValidationsProspection("u1", JOUR, { campaignId: 8 });
    expect(storage.createTask).not.toHaveBeenCalled();
  });

  it("cherche les tâches ouvertes sur les 30 derniers jours", async () => {
    await synchroniserValidationsProspection("u1", JOUR);
    expect(storage.getTasksInRange).toHaveBeenCalledWith("u1", "2026-09-08", JOUR);
  });
});
