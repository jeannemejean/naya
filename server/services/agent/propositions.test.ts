// Tests des propositions à valider. Le dépôt est remplacé par une table EN MÉMOIRE qui
// reproduit la mise à jour conditionnelle (statut en_attente) ; stockage et écriture de tâche
// sont mockés : aucun test ne touche une vraie base (consigne projet).
import { describe, it, expect, vi, beforeEach } from "vitest";

const s = vi.hoisted(() => ({
  getTask: vi.fn(), getTasksInRange: vi.fn(), deleteTask: vi.fn(), getProject: vi.fn(), getMilestone: vi.fn(), getMesures: vi.fn(),
}));
const t = vi.hoisted(() => ({ creerTache: vi.fn(), modifierTache: vi.fn() }));
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
}));
vi.mock("../../storage", () => ({ storage: s }));
vi.mock("./depot", () => ({ depot: d }));
vi.mock("../taches/ecrire-tache", () => t);
vi.mock("../memory/ranger", () => ({ rangerSouvenir: vi.fn(), lireSouvenir: vi.fn(), perimerSouvenir: vi.fn() }));
vi.mock("./recherche", () => ({ SOURCES: ["tache"], chercher: vi.fn(async () => []), lire: vi.fn(async () => null) }));

const { outil } = await import("./registre");
const { validerProposition, annulerProposition, DUREE_PROPOSITION_MS } = await import("./propositions");

const DEBUT = new Date("2026-11-02T09:00:00Z");
const ctx = { userId: "u1", maintenant: DEBUT, fuseau: "Europe/Paris" };
const apres = (min: number) => new Date(DEBUT.getTime() + min * 60_000);

// La base simulée des tâches de u1.
let taches: Map<number, any>;
const tache = (id: number) => ({ id, userId: "u1", title: `Tâche ${id}`, scheduledDate: "2026-11-02", scheduledTime: "10:00", completed: false, archivedAt: null, type: "planning" });

async function proposerDeplacement(ids: number[]) {
  const r = await outil("deplacer_taches")!.executer(ctx, { deplacements: ids.map((tacheId) => ({ tacheId, date: "2026-11-04" })) });
  return r;
}

beforeEach(() => {
  vi.clearAllMocks();
  table.lignes.clear();
  table.suivant = 0;
  taches = new Map([[1, tache(1)], [2, tache(2)], [3, tache(3)]]);
  s.getTask.mockImplementation(async (id: number) => (taches.has(id) ? { ...taches.get(id) } : undefined));
  t.modifierTache.mockImplementation(async (userId: string, id: number, patch: any) => {
    const avant = taches.get(id);
    if (!avant || avant.userId !== userId) return { ok: false, status: 404, message: "task_not_found" };
    const tacheApres = { ...avant, ...patch };
    taches.set(id, tacheApres);
    return { ok: true, avant, tache: tacheApres };
  });
});

describe("création de la proposition", () => {
  it("un outil à valider n'écrit rien : proposition en_attente, expire_a = maintenant + 1 h, renvoyée dans la réponse", async () => {
    const r = await proposerDeplacement([1, 2]);
    expect(t.modifierTache).not.toHaveBeenCalled();
    expect(DUREE_PROPOSITION_MS).toBe(3600_000);
    const p = table.lignes.get(1);
    expect(p).toMatchObject({ userId: "u1", outil: "deplacer_taches", statut: "en_attente" });
    expect(p.expireA).toEqual(apres(60));
    expect(r.proposition).toEqual({
      id: 1, resume: "Déplacer 2 tâches", expireA: apres(60).toISOString(),
      changements: [
        { libelle: "« Tâche 1 »", avant: "2 nov. à 10 h", apres: "4 nov. à 10 h" },
        { libelle: "« Tâche 2 »", avant: "2 nov. à 10 h", apres: "4 nov. à 10 h" },
      ],
    });
  });
});

describe("validerProposition", () => {
  it("validée à 59 min, empreinte inchangée : tout s'exécute, statut validee, resultat enregistré", async () => {
    await proposerDeplacement([1, 2]);
    const r = await validerProposition("u1", 1, apres(59));
    expect(r).toEqual({ ok: true, reussis: ["« Tâche 1 » déplacée au 4 nov. à 10 h", "« Tâche 2 » déplacée au 4 nov. à 10 h"], echecs: [] });
    expect(t.modifierTache).toHaveBeenCalledTimes(2);
    expect(table.lignes.get(1).statut).toBe("validee");
    expect(table.lignes.get(1).resultat).toEqual({ reussis: r.ok && r.reussis, echecs: [] });
  });

  it("validée à 61 min : expiree, rien n'est exécuté", async () => {
    await proposerDeplacement([1]);
    expect(await validerProposition("u1", 1, apres(61))).toEqual({ ok: false, raison: "expiree" });
    expect(t.modifierTache).not.toHaveBeenCalled();
    expect(table.lignes.get(1).statut).toBe("expiree");
  });

  it("pile 60 min : déjà expirée (maintenant >= expire_a)", async () => {
    await proposerDeplacement([1]);
    expect(await validerProposition("u1", 1, apres(60))).toEqual({ ok: false, raison: "expiree" });
    expect(t.modifierTache).not.toHaveBeenCalled();
  });

  it("une tâche concernée a changé depuis l'aperçu : expiree, rien n'est exécuté", async () => {
    await proposerDeplacement([1, 2]);
    taches.set(2, { ...taches.get(2), scheduledTime: "11:00" }); // déplacée à la main entre-temps
    expect(await validerProposition("u1", 1, apres(10))).toEqual({ ok: false, raison: "expiree" });
    expect(t.modifierTache).not.toHaveBeenCalled();
  });

  it("une tâche concernée a disparu (ou n'est plus à elle) : expiree", async () => {
    await proposerDeplacement([1, 2]);
    taches.set(1, { ...taches.get(1), userId: "u2" });
    expect(await validerProposition("u1", 1, apres(10))).toEqual({ ok: false, raison: "expiree" });
    expect(t.modifierTache).not.toHaveBeenCalled();
  });

  it("exécution partielle (2 tâches sur 3 déplacées) : reussis et echecs décrivent chaque élément", async () => {
    await proposerDeplacement([1, 2, 3]);
    t.modifierTache.mockImplementation(async (_u: string, id: number, patch: any) => {
      if (id === 2) return { ok: false, status: 400, message: "Wednesday is not one of your work days." };
      const avant = taches.get(id);
      return { ok: true, avant, tache: { ...avant, ...patch } };
    });
    const r = await validerProposition("u1", 1, apres(5));
    expect(r).toEqual({
      ok: true,
      reussis: ["« Tâche 1 » déplacée au 4 nov. à 10 h", "« Tâche 3 » déplacée au 4 nov. à 10 h"],
      echecs: ["« Tâche 2 » : jour non travaillé"],
    });
    expect(table.lignes.get(1).statut).toBe("validee");
    expect(table.lignes.get(1).resultat).toEqual({ reussis: (r as any).reussis, echecs: (r as any).echecs });
  });

  it("validée deux fois : deja_traitee", async () => {
    await proposerDeplacement([1]);
    expect((await validerProposition("u1", 1, apres(1))).ok).toBe(true);
    expect(await validerProposition("u1", 1, apres(2))).toEqual({ ok: false, raison: "deja_traitee" });
    expect(t.modifierTache).toHaveBeenCalledTimes(1);
  });

  it("deux clics simultanés : une seule exécution, l'autre deja_traitee", async () => {
    await proposerDeplacement([1]);
    const [a, b] = await Promise.all([validerProposition("u1", 1, apres(1)), validerProposition("u1", 1, apres(1))]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((x) => !x.ok)).toEqual({ ok: false, raison: "deja_traitee" });
    expect(t.modifierTache).toHaveBeenCalledTimes(1);
  });

  it("proposition d'une autre utilisatrice : introuvable", async () => {
    await proposerDeplacement([1]);
    expect(await validerProposition("u2", 1, apres(1))).toEqual({ ok: false, raison: "introuvable" });
    expect(await validerProposition("u1", 999, apres(1))).toEqual({ ok: false, raison: "introuvable" });
    expect(t.modifierTache).not.toHaveBeenCalled();
    expect(table.lignes.get(1).statut).toBe("en_attente");
  });
});

describe("annulerProposition", () => {
  it("annule une proposition en attente ; ensuite elle ne peut plus être validée", async () => {
    await proposerDeplacement([1]);
    expect(await annulerProposition("u2", 1)).toEqual({ ok: false, raison: "introuvable" });
    expect(await annulerProposition("u1", 1)).toEqual({ ok: true });
    expect(await annulerProposition("u1", 1)).toEqual({ ok: false, raison: "deja_traitee" });
    expect(await validerProposition("u1", 1, apres(1))).toEqual({ ok: false, raison: "deja_traitee" });
    expect(t.modifierTache).not.toHaveBeenCalled();
  });
});
