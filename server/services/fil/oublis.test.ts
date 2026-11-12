// Objectifs oubliés (spec : 7 jours sans tâche faite, jamais avant le 8e jour après la mise en
// route) et tâche courte de reprise. Stockage, plafond IA et appels Claude sont mockés : aucun
// test ne touche une vraie base ni le réseau.
import { describe, it, expect, vi, beforeEach } from "vitest";

// La base est factice : les modules du fil la chargent, aucun test ne la touche.
vi.mock("../../db", async () => await import("./__fixtures__/db-factice"));

const h = vi.hoisted(() => ({
  objectifDe: vi.fn(), isAiBlocked: vi.fn(), callClaudeWithContext: vi.fn(), getDerniereTacheFaiteParObjectif: vi.fn(),
}));
vi.mock("../../storage", () => ({ storage: { getDerniereTacheFaiteParObjectif: h.getDerniereTacheFaiteParObjectif } }));
vi.mock("../usage", () => ({ isAiBlocked: h.isAiBlocked }));
vi.mock("../claude", () => ({
  callClaudeWithContext: h.callClaudeWithContext,
  CLAUDE_MODELS: { fast: "modele-rapide", smart: "modele-fin" },
}));
vi.mock("./etapes", () => ({ objectifDe: h.objectifDe }));

const { objectifsOublies, tacheDeReprise, chargerObjectifsOublies } = await import("./oublis");
import type { CarteFil, ObjectifCarte } from "./carte";

const DEPUIS = new Date("2026-11-02T08:00:00Z");
const jour = (n: number) => new Date(DEPUIS.getTime() + n * 24 * 3600_000);
const objectif = (id: number, titre: string): ObjectifCarte => ({
  id, projetId: 10, titre, successMode: "revenue", goalType: "revenue", cible: null, dueDate: null, etapes: [],
});
const carte = (objectifs: ObjectifCarte[], depuis: Date | null = DEPUIS): CarteFil =>
  ({ objectifs, chainesSansObjectif: new Map(), depuis });

describe("objectifsOublies", () => {
  const c = carte([objectif(1, "3 clients IN SCENA")]);

  it("J+7 après la mise en route : période de grâce, rien", () => {
    expect(objectifsOublies(c, new Map([[1, null]]), jour(7))).toEqual([]);
  });

  it("J+8, aucune tâche faite : l'objectif est oublié", () => {
    expect(objectifsOublies(c, new Map([[1, null]]), jour(8)))
      .toEqual([{ objectifId: 1, titre: "3 clients IN SCENA", joursSansTache: 8 }]);
    // Absent de la carte des dernières tâches : même chose qu'aucune.
    expect(objectifsOublies(c, new Map(), jour(8))).toHaveLength(1);
  });

  it("une tâche faite il y a 6 jours : rien", () => {
    expect(objectifsOublies(c, new Map([[1, jour(2)]]), jour(8))).toEqual([]);
  });

  it("une tâche faite il y a 7 jours ou plus : oublié, jours comptés depuis cette tâche", () => {
    expect(objectifsOublies(c, new Map([[1, jour(3)]]), jour(12)))
      .toEqual([{ objectifId: 1, titre: "3 clients IN SCENA", joursSansTache: 9 }]);
  });

  it("fil pas mis en route (depuis null) : rien", () => {
    expect(objectifsOublies(carte([objectif(1, "x")], null), new Map(), jour(30))).toEqual([]);
  });

  it("seuls les objectifs sans tâche faite récente sont rendus", () => {
    const deux = carte([objectif(1, "A"), objectif(2, "B")]);
    expect(objectifsOublies(deux, new Map([[1, jour(9)], [2, null]]), jour(10)).map((o) => o.objectifId)).toEqual([2]);
  });
});

describe("chargerObjectifsOublies", () => {
  it("lit la dernière tâche faite des objectifs de la carte, puis applique la règle", async () => {
    h.getDerniereTacheFaiteParObjectif.mockResolvedValue(new Map([[1, null]]));
    const r = await chargerObjectifsOublies("u1", carte([objectif(1, "A")]), jour(8));
    expect(h.getDerniereTacheFaiteParObjectif).toHaveBeenCalledWith("u1", [1]);
    expect(r).toEqual([{ objectifId: 1, titre: "A", joursSansTache: 8 }]);
  });

  it("aucun objectif ou fil pas en route : aucune lecture", async () => {
    h.getDerniereTacheFaiteParObjectif.mockClear();
    expect(await chargerObjectifsOublies("u1", carte([]), jour(8))).toEqual([]);
    expect(await chargerObjectifsOublies("u1", carte([objectif(1, "A")], null), jour(8))).toEqual([]);
    expect(h.getDerniereTacheFaiteParObjectif).not.toHaveBeenCalled();
  });
});

describe("tacheDeReprise", () => {
  const jalon = (id: number, status: string, order: number, title = `Étape ${id}`) =>
    ({ id, status, order, title, pourquoi: "Un client signé prouve l'offre", goalId: 1, projectId: 10 });

  beforeEach(() => {
    vi.clearAllMocks();
    h.isAiBlocked.mockResolvedValue(false);
    h.objectifDe.mockResolvedValue({
      objectif: { id: 1, projectId: 10, title: "3 clients IN SCENA", status: "active", goalType: "revenue", successMode: "revenue" },
      etapes: [jalon(5, "locked", 2, "Étape verrouillée"), jalon(4, "active", 1, "1er client IN SCENA"), jalon(3, "completed", 0)],
    });
  });

  it("appel rapide sur l'étape en cours (jamais locked), une tâche de 15 à 30 min", async () => {
    h.callClaudeWithContext.mockResolvedValue(JSON.stringify({
      titre: "Relancer Margaux sur le devis IN SCENA", pourquoi: "Sans réponse au devis, l'étape « 1er client IN SCENA » reste bloquée.", duree: 20,
    }));
    const r = await tacheDeReprise("u1", 1);
    expect(r).toEqual({ titre: "Relancer Margaux sur le devis IN SCENA", pourquoi: "Sans réponse au devis, l'étape « 1er client IN SCENA » reste bloquée.", duree: 20 });
    const appel = h.callClaudeWithContext.mock.calls[0][0];
    expect(appel.model).toBe("modele-rapide");
    expect(appel.projectId).toBe(10);
    expect(appel.userMessage).toContain("1er client IN SCENA");
    expect(appel.userMessage).toContain("15 à 30 minutes");
    expect(appel.userMessage).not.toContain("Étape verrouillée");
  });

  it("durée hors bornes : ramenée entre 15 et 30", async () => {
    h.callClaudeWithContext.mockResolvedValue(JSON.stringify({ titre: "T", pourquoi: "Sans ce devis signé, l'étape reste bloquée.", duree: 90 }));
    expect((await tacheDeReprise("u1", 1))?.duree).toBe(30);
  });

  it("pourquoi creux : un second essai, puis null s'il l'est encore", async () => {
    h.callClaudeWithContext
      .mockResolvedValueOnce(JSON.stringify({ titre: "T", pourquoi: "pour avancer ton objectif", duree: 20 }))
      .mockResolvedValueOnce(JSON.stringify({ titre: "T2", pourquoi: "Sans ce devis signé, l'étape reste bloquée.", duree: 20 }));
    expect((await tacheDeReprise("u1", 1))?.titre).toBe("T2");
    expect(h.callClaudeWithContext.mock.calls[1][0].userMessage).toMatch(/creux/);

    h.callClaudeWithContext.mockReset().mockResolvedValue("pas du json");
    expect(await tacheDeReprise("u1", 1)).toBeNull();
    expect(h.callClaudeWithContext).toHaveBeenCalledTimes(2);
  });

  it("IA bloquée, objectif d'une autre ou inactif : null sans appel IA", async () => {
    h.isAiBlocked.mockResolvedValue(true);
    expect(await tacheDeReprise("u1", 1)).toBeNull();
    h.isAiBlocked.mockResolvedValue(false);
    h.objectifDe.mockResolvedValue(undefined);
    expect(await tacheDeReprise("u1", 1)).toBeNull();
    h.objectifDe.mockResolvedValue({ objectif: { id: 1, projectId: 10, title: "x", status: "paused" }, etapes: [] });
    expect(await tacheDeReprise("u1", 1)).toBeNull();
    expect(h.callClaudeWithContext).not.toHaveBeenCalled();
  });
});
