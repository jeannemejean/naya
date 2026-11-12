// Tests de la journée allégée (spec §4, Review Focus 5). Le plan est pur ; l'outil passe par le
// vrai chemin des propositions (propositions.ts) et la vraie annulation (journal.ts). Stockage,
// dépôt (propositions et actions en mémoire) et modifierTache sont mockés : aucune vraie base.
import { describe, it, expect, vi, beforeEach } from "vitest";

// La base est factice : les modules du fil la chargent, aucun test ne la touche.
vi.mock("../../db", async () => await import("./__fixtures__/db-factice"));

const base = vi.hoisted(() => ({ taches: new Map<number, any>() }));
const s = vi.hoisted(() => ({
  getTask: vi.fn(async (id: number) => (base.taches.has(id) ? { ...base.taches.get(id) } : undefined)),
  updateTask: vi.fn(async (id: number, patch: any) => Object.assign(base.taches.get(id), patch)),
  fixOverlappingTasks: vi.fn(async () => undefined),
  getWorkspaceEntries: vi.fn(async () => []), tacheALivrables: vi.fn(async () => false),
  getTasksInRange: vi.fn(async () => []), getUserPreferences: vi.fn(async () => null),
}));
const table = vi.hoisted(() => ({ propositions: new Map<number, any>(), actions: new Map<number, any>(), suivant: 0 }));
const d = vi.hoisted(() => ({
  ajouterProposition: vi.fn(async (userId: string, outil: string, args: unknown, changements: unknown, empreinte: unknown, expireA: Date) => {
    const p = { id: ++table.suivant, userId, outil, arguments: JSON.parse(JSON.stringify(args)), changements, empreinte: JSON.parse(JSON.stringify(empreinte)), statut: "en_attente", resultat: null, expireA };
    table.propositions.set(p.id, p);
    return p;
  }),
  getProposition: vi.fn(async (id: number, userId: string) => {
    const p = table.propositions.get(id);
    return p && p.userId === userId ? { ...p } : undefined;
  }),
  majProposition: vi.fn(async (id: number, _userId: string, patch: any) => Object.assign(table.propositions.get(id), patch)),
  reclamerProposition: vi.fn(async (id: number, userId: string, statut: string) => {
    const p = table.propositions.get(id);
    if (!p || p.userId !== userId || p.statut !== "en_attente") return false;
    p.statut = statut;
    return true;
  }),
  // Le journal est du JSON en base : on le relit sérialisé, comme Postgres le rendrait.
  ajouterAction: vi.fn(async (userId: string, outil: string, resume: string, lignes: unknown) => {
    const a = { id: ++table.suivant, userId, outil, resume, lignes: JSON.parse(JSON.stringify(lignes)), createdAt: new Date("2026-11-12T08:05:00Z"), annuleeAt: null };
    table.actions.set(a.id, a);
    return a;
  }),
  getAction: vi.fn(async (id: number, userId: string) => {
    const a = table.actions.get(id);
    return a && a.userId === userId ? { ...a } : undefined;
  }),
  marquerAnnulee: vi.fn(async (id: number, _userId: string, quand: Date) => { table.actions.get(id).annuleeAt = quand; }),
}));
// modifierTache simulé : vérifie l'appartenance, écrit le patch, rend avant/après.
const ecrire = vi.hoisted(() => ({
  modifierTache: vi.fn(async (userId: string, id: number, patch: Record<string, unknown>) => {
    const t = base.taches.get(id);
    if (!t || t.userId !== userId) return { ok: false, status: 404, message: "task_not_found" };
    const avant = { ...t };
    Object.assign(t, patch);
    return { ok: true, tache: { ...t }, avant };
  }),
  creerTache: vi.fn(),
}));
vi.mock("../../storage", () => ({ storage: s }));
vi.mock("../agent/depot", () => ({ depot: d }));
vi.mock("../taches/ecrire-tache", () => ecrire);
vi.mock("../usage", () => ({ isAiBlocked: vi.fn() }));
vi.mock("../claude", () => ({ callClaudeWithContext: vi.fn(), callClaude: vi.fn(), CLAUDE_MODELS: { fast: "f", smart: "s" } }));
vi.mock("../memory/ranger", () => ({ rangerSouvenir: vi.fn(), lireSouvenir: vi.fn(), perimerSouvenir: vi.fn() }));
vi.mock("../agent/recherche", () => ({ SOURCES: ["tache"], chercher: vi.fn(async () => []), lire: vi.fn(async () => null) }));

process.env.FIL_CONDUCTEUR_USERS = "u1";

const { planAllegement, joursTravaillesSuivants, OUTIL_ALLEGEMENT } = await import("./allegement");
const { validerProposition, proposerHorsConversation } = await import("../agent/propositions");
const { annulerAction } = await import("../agent/journal");
const { HORS_CONVERSATION, outilsDeConversation, REGISTRE } = await import("../agent/registre");
import type { CarteFil, EtapeCarte, ObjectifCarte } from "./carte";

const AUJOURDHUI = "2026-11-12";
const MATIN = new Date("2026-11-12T08:00:00Z");

const etape = (id: number, objectifId: number): EtapeCarte =>
  ({ id, objectifId, projetId: 7, titre: `Étape ${id}`, pourquoi: null, statut: "active", ordre: 0, faites: 0, prevues: 5 });
const objectif = (id: number, dueDate: Date | null): ObjectifCarte =>
  ({ id, projetId: 7, titre: `Objectif ${id}`, successMode: "revenue", goalType: "monthly", cible: null, dueDate, etapes: [etape(id * 10, id)] });

// 1 et 2 : échéance dans 10 jours (urgents, ≥ médiane) ; 3 : dans 300 jours (sous la médiane).
const carte: CarteFil = {
  objectifs: [
    objectif(1, new Date("2026-11-22T12:00:00Z")),
    objectif(2, new Date("2026-11-22T12:00:00Z")),
    objectif(3, new Date("2027-09-08T12:00:00Z")),
  ],
  chainesSansObjectif: new Map(),
  depuis: null,
};

const tache = (p: Record<string, unknown>): any => ({
  userId: "u1", title: `T${p.id}`, priority: 2, completed: false, archivedAt: null, type: "planning",
  scheduledDate: AUJOURDHUI, scheduledTime: "09:00", scheduledEndTime: "09:30", estimatedDuration: 30,
  schedulingMode: "flexible", ritualId: null, goalId: null, milestoneId: null, pourquoi: null, ...p,
});
const cle = (tacheId: number) => ({ tacheId, titre: `T${tacheId}`, pourquoi: null, lien: null, score: 50 });

describe("planAllegement (pur)", () => {
  it("avec 2 objectifs prioritaires, chacun garde au moins une tâche ; le reste part en tourniquet", () => {
    const taches = [
      tache({ id: 1, goalId: 1 }), tache({ id: 2, goalId: 1, priority: 1 }),
      tache({ id: 3, goalId: 2, milestoneId: 20 }),
      tache({ id: 4, goalId: 3 }), tache({ id: 5 }), tache({ id: 6, goalId: 1 }),
    ];
    const r = planAllegement(taches, [], carte, ["2026-11-13", "2026-11-16"]);
    expect(r.garder.sort()).toEqual([2, 3]); // 2 : priorité 1 l'emporte dans l'objectif 1
    expect(r.deplacer).toEqual([
      { tacheId: 1, vers: "2026-11-13" }, { tacheId: 4, vers: "2026-11-16" },
      { tacheId: 5, vers: "2026-11-13" }, { tacheId: 6, vers: "2026-11-16" },
    ]);
  });

  it("garde les tâches clés, les rituels et les tâches à heure fixe ; ignore les faites et les archivées", () => {
    const taches = [
      tache({ id: 1, goalId: 1 }), tache({ id: 2, goalId: 2 }),
      tache({ id: 3, goalId: 3 }), tache({ id: 4, ritualId: 9 }), tache({ id: 5, schedulingMode: "fixed" }),
      tache({ id: 6, completed: true }), tache({ id: 7, archivedAt: new Date() }), tache({ id: 8 }),
    ];
    const r = planAllegement(taches, [cle(3)], carte, ["2026-11-13"]);
    expect(r.garder.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(r.deplacer).toEqual([{ tacheId: 8, vers: "2026-11-13" }]);
  });

  it("une tâche schedulingMode « fixed » n'est jamais déplacée, même sans objectif ni jour libre", () => {
    const taches = [tache({ id: 1, schedulingMode: "fixed", goalId: 3 }), tache({ id: 2, schedulingMode: "fixed" }), tache({ id: 3 })];
    const r = planAllegement(taches, [], { objectifs: [], chainesSansObjectif: new Map(), depuis: null }, ["2026-11-13"]);
    expect(r.deplacer.map((x) => x.tacheId)).toEqual([3]);
    expect(r.garder.sort()).toEqual([1, 2]);
    expect(planAllegement(taches, [], carte, []).deplacer).toEqual([]); // pas de jour suivant : rien ne bouge
  });
});

describe("joursTravaillesSuivants", () => {
  it("saute les jours non travaillés (lun.–ven. par défaut)", () => {
    expect(joursTravaillesSuivants("2026-11-13", null, 3)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
    expect(joursTravaillesSuivants("2026-11-13", "mon,sat", 2)).toEqual(["2026-11-14", "2026-11-16"]);
  });
});

describe("alleger_journee (proposition, validation, annulation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    table.propositions.clear(); table.actions.clear(); table.suivant = 0;
    base.taches = new Map([
      [1, tache({ id: 1, scheduledTime: "09:00" })],
      [2, tache({ id: 2, scheduledTime: "10:00" })],
      [3, tache({ id: 3, scheduledTime: "11:00" })],
      [4, tache({ id: 4, scheduledTime: "14:00", schedulingMode: "fixed" })],
      [5, tache({ id: 5, userId: "u2" })],
    ]);
  });

  const ARGS = { date: AUJOURDHUI, deplacer: [{ tacheId: 1, vers: "2026-11-13" }, { tacheId: 2, vers: "2026-11-16" }, { tacheId: 3, vers: "2026-11-13" }] };

  it("est au registre, hors conversation, et à valider", () => {
    expect(REGISTRE.find((o) => o.nom === "alleger_journee")?.classe).toBe("a_valider");
    expect(HORS_CONVERSATION.has("alleger_journee")).toBe(true);
    expect(outilsDeConversation().some((o) => o.nom === "alleger_journee")).toBe(false);
    expect(OUTIL_ALLEGEMENT.nom).toBe("alleger_journee");
  });

  it("rien ne bouge avant validation ; la proposition vaut jusqu'à la fin du jour (Paris)", async () => {
    const p = await proposerHorsConversation("u1", "alleger_journee", ARGS, MATIN);
    expect("erreur" in p).toBe(false);
    if ("erreur" in p) return;
    expect(p.changements).toHaveLength(3);
    expect(p.expireA).toBe("2026-11-12T23:00:00.000Z"); // minuit à Paris (UTC+1 en novembre)
    expect(ecrire.modifierTache).not.toHaveBeenCalled();
    expect(s.updateTask).not.toHaveBeenCalled();
    expect(d.ajouterAction).not.toHaveBeenCalled();
    expect(base.taches.get(1).scheduledDate).toBe(AUJOURDHUI);
    // Le lendemain, elle a expiré : rien n'est exécuté.
    expect(await validerProposition("u1", p.id, new Date("2026-11-12T23:00:00Z"))).toEqual({ ok: false, raison: "expiree" });
    expect(ecrire.modifierTache).not.toHaveBeenCalled();
  });

  it.each([
    ["devenue à heure fixe", { schedulingMode: "fixed" }],
    ["devenue un rituel", { ritualId: 9 }],
    ["archivée", { archivedAt: new Date("2026-11-12T08:02:00Z") }],
  ])("une tâche %s entre l'aperçu et la validation : la proposition est périmée, rien ne bouge", async (_cas, patch) => {
    const p = await proposerHorsConversation("u1", "alleger_journee", ARGS, MATIN);
    if ("erreur" in p) throw new Error(p.erreur);
    Object.assign(base.taches.get(1), patch);
    expect(await validerProposition("u1", p.id, new Date("2026-11-12T08:05:00Z"))).toEqual({ ok: false, raison: "expiree" });
    expect(ecrire.modifierTache).not.toHaveBeenCalled();
  });

  it("refuse une tâche à heure fixe, celle d'une autre, un jour passé, une cible qui n'est pas après le jour", async () => {
    const essai = (args: any) => proposerHorsConversation("u1", "alleger_journee", args, MATIN);
    expect(await essai({ date: AUJOURDHUI, deplacer: [{ tacheId: 4, vers: "2026-11-13" }] })).toEqual({ erreur: "tache_fixe" });
    expect(await essai({ date: AUJOURDHUI, deplacer: [{ tacheId: 5, vers: "2026-11-13" }] })).toEqual({ erreur: "introuvable" });
    expect(await essai({ date: "2026-11-11", deplacer: [{ tacheId: 1, vers: "2026-11-13" }] })).toEqual({ erreur: "jour_passe" });
    expect(await essai({ date: AUJOURDHUI, deplacer: [{ tacheId: 1, vers: AUJOURDHUI }] })).toEqual({ erreur: "date_invalide" });
    expect(await essai({ date: AUJOURDHUI, deplacer: [] })).toEqual({ erreur: "rien_a_deplacer" });
    expect(d.ajouterProposition).not.toHaveBeenCalled();
  });

  it("validation, puis une tâche déplacée à la main, puis Annuler : celle-ci est refusée (modifiee), les autres reviennent", async () => {
    const p = await proposerHorsConversation("u1", "alleger_journee", ARGS, MATIN);
    if ("erreur" in p) throw new Error(p.erreur);
    const v = await validerProposition("u1", p.id, new Date("2026-11-12T08:05:00Z"));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.reussis).toHaveLength(3);
    expect(v.echecs).toEqual([]);
    expect(ecrire.modifierTache).toHaveBeenCalledTimes(3);
    // Une seule action de journal, une ligne par tâche (avant → après).
    expect(d.ajouterAction).toHaveBeenCalledTimes(1);
    expect(v.actionId).toBe(table.actions.values().next().value.id);
    const lignes = table.actions.get(v.actionId!).lignes;
    expect(lignes.map((l: any) => l.id)).toEqual([1, 2, 3]);
    expect(lignes[1]).toMatchObject({ table: "tasks", avant: { scheduledDate: AUJOURDHUI }, apres: { scheduledDate: "2026-11-16" } });
    expect(base.taches.get(2).scheduledDate).toBe("2026-11-16");

    // Jeanne déplace la tâche 2 à la main.
    base.taches.get(2).scheduledDate = "2026-11-18";

    const r = await annulerAction("u1", v.actionId!, new Date("2026-11-12T15:00:00Z"));
    expect(r).toEqual({ ok: true, nonRemises: [{ table: "tasks", id: 2, raison: "modifiee" }] });
    expect(base.taches.get(1)).toMatchObject({ scheduledDate: AUJOURDHUI, scheduledTime: "09:00" });
    expect(base.taches.get(3)).toMatchObject({ scheduledDate: AUJOURDHUI, scheduledTime: "11:00" });
    expect(base.taches.get(2).scheduledDate).toBe("2026-11-18"); // son geste à elle n'est pas défait
    expect(table.actions.get(v.actionId!).annuleeAt).not.toBeNull();
  });

  it("toutes les tâches modifiées depuis : modifiee, rien n'est réécrit", async () => {
    const p = await proposerHorsConversation("u1", "alleger_journee", { date: AUJOURDHUI, deplacer: [{ tacheId: 1, vers: "2026-11-13" }] }, MATIN);
    if ("erreur" in p) throw new Error(p.erreur);
    const v = await validerProposition("u1", p.id, new Date("2026-11-12T08:05:00Z"));
    if (!v.ok) throw new Error(v.raison);
    base.taches.get(1).completed = true;
    base.taches.get(1).scheduledDate = "2026-11-17";
    s.updateTask.mockClear();
    expect(await annulerAction("u1", v.actionId!, new Date("2026-11-12T15:00:00Z"))).toEqual({ ok: false, raison: "modifiee" });
    expect(s.updateTask).not.toHaveBeenCalled();
    expect(table.actions.get(v.actionId!).annuleeAt).toBeNull();
  });
});
