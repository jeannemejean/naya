// La carte du fil : objectifs actifs → étapes (jalons reliés par goalId) → avancement.
// `../../storage` et `../../db` sont mockés : aucune requête réelle.
import { describe, it, expect, vi, beforeEach } from "vitest";

const etat = vi.hoisted(() => ({
  projets: [] as any[],
  objectifs: {} as Record<number, any[]>,
  jalons: {} as Record<number, any[]>,
  lignesTaches: [] as any[],
  crees: [] as any[],
  conditions: [] as any[],
}));

// db mocké pour le vrai storage.getAvancementEtapes : toute requête renvoie `lignesTaches`.
vi.mock("../../db", () => {
  const chaine = (): any => {
    const suite: any = { then: (ok: any, ko: any) => Promise.resolve(etat.lignesTaches).then(ok, ko) };
    for (const m of ["from", "where", "orderBy", "limit", "groupBy"]) suite[m] = () => suite;
    return suite;
  };
  return { db: { select: () => chaine() }, pool: { query: vi.fn(), on: vi.fn() } };
});

const storageMock = vi.hoisted(() => ({
  getProjects: vi.fn(async () => etat.projets),
  getActiveGoalsForProject: vi.fn(async (pid: number) => (etat.objectifs[pid] ?? []).filter((g) => g.status === "active")),
  getMilestones: vi.fn(async (pid: number) => etat.jalons[pid] ?? []),
  getAvancementEtapes: vi.fn(async (_u: string, ids: number[]) => new Map(ids.map((id) => [id, { faites: 1, prevues: 3 }]))),
  createMilestone: vi.fn(async (data: any) => { const m = { id: 100 + etat.crees.length, ...data }; etat.crees.push(m); return m; }),
  createMilestoneCondition: vi.fn(async (data: any) => { etat.conditions.push(data); return { id: etat.conditions.length, ...data }; }),
}));
vi.mock("../../storage", () => ({ storage: storageMock }));

import { chargerCarte, chargerCarteMemo, etapesActives, libelleCible, oublierCarteDe, viderMemoCarte } from "./carte";
import { createMilestoneChain } from "../milestone-engine";

const jalon = (id: number, projectId: number, goalId: number | null, order: number, status: string) =>
  ({ id, projectId, userId: "u1", goalId, order, status, title: `J${id}`, pourquoi: null });

beforeEach(() => {
  etat.projets = [{ id: 7, name: "JMD" }];
  etat.objectifs = {
    7: [
      { id: 1, projectId: 7, title: "Signer 3 clients", status: "active", successMode: "revenue", goalType: "monthly", targetValue: "3 clients", dueDate: null },
      { id: 2, projectId: 7, title: "Être visible", status: "active", successMode: "visibility", goalType: "monthly", targetValue: null, dueDate: null },
      { id: 3, projectId: 7, title: "En pause", status: "paused", successMode: "visibility", goalType: "monthly", targetValue: null, dueDate: null },
    ],
  };
  // Deux chaînes entrelacées par l'ordre (chacune repart de 0), plus une chaîne de projet sans objectif.
  etat.jalons = {
    7: [
      jalon(10, 7, 1, 0, "completed"), jalon(20, 7, 2, 0, "active"), jalon(30, 7, null, 0, "unlocked"), jalon(40, 7, 3, 0, "active"),
      jalon(11, 7, 1, 1, "active"), jalon(21, 7, 2, 1, "locked"), jalon(31, 7, null, 1, "locked"),
      jalon(12, 7, 1, 2, "locked"),
    ],
  };
  etat.crees = [];
  etat.conditions = [];
  etat.lignesTaches = [];
  vi.clearAllMocks();
});

describe("etapesActives", () => {
  it("deux chaînes dans un projet (objectifs A et B) : une étape active par chaîne", () => {
    const deuxChaines = etat.jalons[7].filter((j) => j.goalId === 1 || j.goalId === 2);
    const actives = etapesActives(deuxChaines as any);
    expect(actives.map((j: any) => j.id).sort()).toEqual([11, 20]);
  });

  it("une seule par chaîne, dans l'ordre reçu : le premier reste celui que `find` aurait trouvé", () => {
    const chaine = [jalon(1, 7, null, 0, "unlocked"), jalon(2, 7, null, 1, "active"), jalon(3, 7, null, 2, "locked")];
    const actives = etapesActives(chaine as any);
    expect(actives.map((j: any) => j.id)).toEqual([1]);
    const tout = etat.jalons[7];
    expect(etapesActives(tout as any)[0]).toBe(tout.find((m) => m.status === "active" || m.status === "unlocked"));
  });

  it("accepte aussi des EtapeCarte (objectifId / projetId / statut)", () => {
    const e = (id: number, objectifId: number | null, statut: string) =>
      ({ id, objectifId, projetId: 7, titre: "t", pourquoi: null, statut, ordre: 0, faites: 0, prevues: 0 });
    expect(etapesActives([e(1, 1, "locked"), e(2, 1, "active"), e(3, 2, "unlocked"), e(4, 2, "active")]).map((x) => x.id)).toEqual([2, 3]);
  });

  it("jamais une étape locked ni completed", () => {
    expect(etapesActives([jalon(1, 7, 1, 0, "locked"), jalon(2, 7, 1, 1, "completed")] as any)).toEqual([]);
  });
});

describe("chargerCarte", () => {
  it("objectifs actifs avec leurs étapes triées par ordre et leur avancement", async () => {
    const carte = await chargerCarte("u1", null);
    expect(carte.objectifs.map((o) => o.id)).toEqual([1, 2]);
    const a = carte.objectifs[0];
    expect(a).toMatchObject({ projetId: 7, titre: "Signer 3 clients", successMode: "revenue", cible: "3 clients" });
    expect(a.etapes.map((e) => e.id)).toEqual([10, 11, 12]);
    expect(a.etapes[1]).toMatchObject({ objectifId: 1, projetId: 7, titre: "J11", statut: "active", ordre: 1, faites: 1, prevues: 3 });
  });

  it("un objectif paused est absent", async () => {
    const carte = await chargerCarte("u1", null);
    expect(carte.objectifs.find((o) => o.id === 3)).toBeUndefined();
  });

  it("une chaîne sans goalId va dans chainesSansObjectif, rangée par projet", async () => {
    const carte = await chargerCarte("u1", null);
    expect(carte.chainesSansObjectif.get(7)?.map((e) => e.id)).toEqual([30, 31]);
    expect(carte.chainesSansObjectif.get(7)?.[0].objectifId).toBeNull();
  });

  it("transmet `depuis` au comptage et le renvoie", async () => {
    const depuis = new Date("2026-11-12T08:00:00Z");
    const carte = await chargerCarte("u1", depuis);
    expect(carte.depuis).toBe(depuis);
    expect(storageMock.getAvancementEtapes).toHaveBeenCalledWith("u1", expect.arrayContaining([10, 11, 12, 20, 21, 30, 31]), depuis);
  });
});

describe("libelleCible", () => {
  const o = (cible: string | null, dueDate: Date | null) =>
    ({ id: 1, projetId: 7, titre: "x", successMode: "revenue", goalType: "monthly", cible, dueDate, etapes: [] });
  it("cible et échéance de fin de mois", () => {
    expect(libelleCible(o("3 nouveaux clients", new Date("2026-12-31T12:00:00Z")))).toBe("3 nouveaux clients d'ici fin décembre");
  });
  it("échéance en cours de mois", () => {
    expect(libelleCible(o("3 nouveaux clients", new Date("2026-12-15T12:00:00Z")))).toBe("3 nouveaux clients d'ici le 15 décembre");
  });
  it("cible seule, échéance seule, ni l'une ni l'autre", () => {
    expect(libelleCible(o(" 3 clients ", null))).toBe("3 clients");
    expect(libelleCible(o(null, new Date("2026-12-31T12:00:00Z")))).toBe("d'ici fin décembre");
    expect(libelleCible(o("  ", null))).toBeNull();
  });
});

describe("storage.getAvancementEtapes", () => {
  it("compte faites / prévues par étape et ignore une tâche créée avant `depuis`, ou archivée", async () => {
    const { storage: reel } = await vi.importActual<typeof import("../../storage")>("../../storage");
    const depuis = new Date("2026-11-12T00:00:00Z");
    etat.lignesTaches = [
      { milestoneId: 11, completed: true, createdAt: new Date("2026-11-12T09:00:00Z"), archivedAt: null },
      { milestoneId: 11, completed: false, createdAt: new Date("2026-11-13T09:00:00Z"), archivedAt: null },
      { milestoneId: 11, completed: true, createdAt: new Date("2026-11-01T09:00:00Z"), archivedAt: null }, // avant `depuis`
      { milestoneId: 11, completed: false, createdAt: new Date("2026-11-13T09:00:00Z"), archivedAt: new Date() }, // archivée
    ];
    const m = await reel.getAvancementEtapes("u1", [11, 12], depuis);
    expect(m.get(11)).toEqual({ faites: 1, prevues: 2 });
    expect(m.get(12)).toEqual({ faites: 0, prevues: 0 });
  });

  it("sans `depuis`, tout compte ; aucune étape : carte vide", async () => {
    const { storage: reel } = await vi.importActual<typeof import("../../storage")>("../../storage");
    etat.lignesTaches = [{ milestoneId: 11, completed: true, createdAt: new Date("2020-01-01"), archivedAt: null }];
    expect((await reel.getAvancementEtapes("u1", [11], null)).get(11)).toEqual({ faites: 1, prevues: 1 });
    expect((await reel.getAvancementEtapes("u1", [], null)).size).toBe(0);
  });
});

describe("createMilestoneChain avec goalId, pourquoi et état réel", () => {
  it("[faite, en_cours, a_venir] → completed, active, locked ; une condition par jalon non premier", async () => {
    const r = await createMilestoneChain(7, "u1", [
      { title: "Fondations", pourquoi: "base", etat: "faite" },
      { title: "Prospection", pourquoi: "contacts", etat: "en_cours" },
      { title: "Signature", etat: "a_venir" },
    ], { goalId: 1 });
    expect(r.map((m) => m.status)).toEqual(["completed", "active", "locked"]);
    expect(r[0].completedAt).toBeInstanceOf(Date);
    expect(r[1].activatedAt).toBeInstanceOf(Date);
    expect(r[2].activatedAt).toBeNull();
    expect(r.every((m) => m.goalId === 1)).toBe(true);
    expect(r.map((m) => m.pourquoi)).toEqual(["base", "contacts", null]);
    expect(etat.conditions.map((c) => [c.milestoneId, c.blockedByMilestoneId])).toEqual([[r[1].id, r[0].id], [r[2].id, r[1].id]]);
    // La condition de l'étape en cours est déjà remplie (la précédente est faite) ; pas celle de la verrouillée.
    expect(etat.conditions.map((c) => c.isFulfilled)).toEqual([true, false]);
  });

  it("sans état ni goalId : comportement historique (premier actif, suivants verrouillés)", async () => {
    const r = await createMilestoneChain(7, "u1", [{ title: "A" }, { title: "B" }]);
    expect(r.map((m) => m.status)).toEqual(["active", "locked"]);
    expect(r.map((m) => m.goalId)).toEqual([null, null]);
    expect(etat.conditions).toHaveLength(1);
    expect(etat.conditions[0]).toMatchObject({ conditionType: "milestone_completed", label: "A doit être complété", isFulfilled: false });
  });

  it("la première non faite devient active même si elle est annoncée « à venir »", async () => {
    const r = await createMilestoneChain(7, "u1", [{ title: "A", etat: "faite" }, { title: "B", etat: "a_venir" }, { title: "C", etat: "en_cours" }]);
    expect(r.map((m) => m.status)).toEqual(["completed", "active", "locked"]);
  });
});

describe("chargerCarteMemo (20 s par utilisatrice et date de mise en route)", () => {
  const T0 = 1_800_000_000_000;
  const CARTE = { objectifs: [], chainesSansObjectif: new Map(), depuis: null };
  beforeEach(() => viderMemoCarte());

  it("deux appels rapprochés : un seul chargement ; après 20 s ou pour une autre clé : rechargée", async () => {
    const charger = vi.fn(async () => CARTE);
    const a = await chargerCarteMemo("u1", null, { maintenant: T0, charger });
    const b = await chargerCarteMemo("u1", null, { maintenant: T0 + 5_000, charger });
    expect(b).toBe(a);
    expect(charger).toHaveBeenCalledTimes(1);
    await chargerCarteMemo("u2", null, { maintenant: T0 + 5_000, charger });
    await chargerCarteMemo("u1", new Date(T0), { maintenant: T0 + 5_000, charger });
    expect(charger).toHaveBeenCalledTimes(3);
    await chargerCarteMemo("u1", null, { maintenant: T0 + 20_001, charger });
    expect(charger).toHaveBeenCalledTimes(4);
  });

  it("un échec n'est pas mémorisé : l'appel suivant recharge", async () => {
    const charger = vi.fn().mockRejectedValueOnce(new Error("base")).mockResolvedValue(CARTE);
    await expect(chargerCarteMemo("u1", null, { maintenant: T0, charger })).rejects.toThrow("base");
    await expect(chargerCarteMemo("u1", null, { maintenant: T0 + 1_000, charger })).resolves.toBe(CARTE);
    expect(charger).toHaveBeenCalledTimes(2);
  });

  it("frais : recharge toujours et remplace la carte mémorisée", async () => {
    const autre = { ...CARTE, objectifs: [] };
    const charger = vi.fn().mockResolvedValueOnce(CARTE).mockResolvedValue(autre);
    await chargerCarteMemo("u1", null, { maintenant: T0, charger });
    expect(await chargerCarteMemo("u1", null, { maintenant: T0 + 1_000, charger, frais: true })).toBe(autre);
    expect(await chargerCarteMemo("u1", null, { maintenant: T0 + 2_000, charger })).toBe(autre);
    expect(charger).toHaveBeenCalledTimes(2);
  });

  it("oublierCarteDe : la carte de cette utilisatrice seulement est rechargée", async () => {
    const charger = vi.fn(async () => CARTE);
    await chargerCarteMemo("u1", null, { maintenant: T0, charger });
    await chargerCarteMemo("u10", null, { maintenant: T0, charger });
    oublierCarteDe("u1");
    await chargerCarteMemo("u1", null, { maintenant: T0 + 1_000, charger });
    await chargerCarteMemo("u10", null, { maintenant: T0 + 1_000, charger });
    expect(charger).toHaveBeenCalledTimes(3);
  });

  it("borné : au-delà de la limite, les plus anciennes entrées sortent", async () => {
    const charger = vi.fn(async () => CARTE);
    for (let i = 0; i < 600; i++) await chargerCarteMemo(`u${i}`, null, { maintenant: T0, charger });
    await chargerCarteMemo("u0", null, { maintenant: T0, charger });
    expect(charger).toHaveBeenCalledTimes(601);
  });
});
