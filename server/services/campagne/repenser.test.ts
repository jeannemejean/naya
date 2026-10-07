// « Repenser la campagne » : orchestration testée avec des fakes (aucune base, aucun modèle).
import { describe, it, expect, vi } from "vitest";
import {
  apercuRepenser, repenserCampagne, fenetrePlacement, normaliserConsigne,
  CampagneIntrouvable, StatutIncompatible, GenerationEchouee, DejaEnCours, PlacementEchoue,
  type RepenserDeps, type OperationsTransaction,
} from "./repenser";

const strategie = () => ({
  name: "Nom inventé par le modèle",
  campaignType: "authority_building",
  coreMessage: "Nouveau message",
  targetAudience: "Nouvelle audience",
  audienceSegment: "Segment",
  insights: ["i1"],
  messagingFramework: { coreMessage: "m" },
  phases: [{ number: 1, name: "P1", duration: "Weeks 1-2", objective: "o", keyActions: [], successSignal: "s" }],
  channels: [{ platform: "linkedin" }],
  kpis: [{ metric: "k" }],
  prospection: { needed: true },
});
const plan = () => [
  { phase: 1, week: "Week 1", platform: "linkedin", format: "post", angle: "a1", pillar: "p", goal: "g", copyDirections: "c" },
  { phase: 1, week: "Week 2", platform: "linkedin", format: "post", angle: "a2", pillar: "p", goal: "g", copyDirections: "c" },
];
const tachesGen = () => [
  { title: "Plan review", description: "d", type: "planning", category: "planning", priority: 1, estimatedDuration: 30, taskEnergyType: "admin", phase: 1 },
];

const campagne = (over: any = {}) => ({
  id: 7, userId: "u1", projectId: 3, name: "Ma campagne", objective: "Vendre l'offre",
  duration: "1_month", status: "active", startDate: "2026-10-01", endDate: "2026-10-31",
  articuleAvecCampaignId: null, articulationIndependante: false,
  coreMessage: "Ancien message", contentPlan: [{ old: true }],
  ...over,
});

const contenus = [
  { id: 1, publishedAt: new Date("2026-10-02"), postStatus: "posted", contentStatus: "published" },
  { id: 2, publishedAt: null, postStatus: "posting", contentStatus: "scheduled" },
  { id: 3, publishedAt: null, postStatus: "pending", contentStatus: "idea" },
  { id: 4, publishedAt: null, postStatus: "pending", contentStatus: "draft" },
];
const taches = [
  { id: 10, completed: true },
  { id: 11, completed: false },
  { id: 12, completed: false },
];

function fabrique(over: Partial<RepenserDeps> & { campaign?: any } = {}) {
  const journal: string[] = [];
  const ops: OperationsTransaction = {
    lireContenus: vi.fn(async () => contenus),
    lireTaches: vi.fn(async () => taches),
    mettreAJourCampagne: vi.fn(async () => { journal.push("maj"); return true; }),
    supprimerContenus: vi.fn(async (_u, _c, ids) => { journal.push(`del-contenus:${ids.join(",")}`); return ids.length; }),
    supprimerTaches: vi.fn(async (_u, _c, ids) => { journal.push(`del-taches:${ids.join(",")}`); return ids.length; }),
  };
  const placement = {
    getUserPreferences: vi.fn(async () => ({ workDays: "mon,tue,wed,thu,fri" })),
    getDayAvailabilityRange: vi.fn(async () => []),
    getTasksInRange: vi.fn(async () => []),
    checkSlotAvailability: vi.fn(async () => ({ available: true })),
    createTask: vi.fn(async (t: any) => { journal.push("createTask"); return t; }),
    createContent: vi.fn(async (c: any) => { journal.push("createContent"); return c; }),
  };
  const { campaign, ...reste } = over;
  const deps = {
    getCampaign: vi.fn(async (id: number, userId: string) =>
      userId === "u1" && id === 7 ? (campaign ?? campagne()) : undefined),
    lireContenus: vi.fn(async () => contenus),
    lireTaches: vi.fn(async () => taches),
    contexteGeneration: vi.fn(async () => ({
      brandDna: { businessType: "agence" } as any,
      preferences: [{ id: 1, content: "Pas de ton corporate" }] as any,
      savoir: "- Le marché a changé",
      revuesPassees: "\n\nPAST CAMPAIGN REVIEWS: x",
    })),
    genererStrategie: vi.fn(async () => { journal.push("gen-strategie"); return strategie() as any; }),
    genererContenu: vi.fn(async () => { journal.push("gen-contenu"); return plan() as any; }),
    genererTaches: vi.fn(async () => { journal.push("gen-taches"); return tachesGen() as any; }),
    transaction: vi.fn(async (fn: any) => { journal.push("tx-debut"); const r = await fn(ops); journal.push("tx-fin"); return r; }),
    placement,
    fixOverlappingTasks: vi.fn(async () => { journal.push("fix"); return 0; }),
    aujourdhuiParis: () => "2026-10-07",
    ...reste,
  } as RepenserDeps & { placement: typeof placement };
  return { deps, ops, journal, placement };
}

describe("apercuRepenser", () => {
  it("compte publiés (ou en cours) / non publiés, faites / non faites", async () => {
    const { deps } = fabrique();
    expect(await apercuRepenser(deps, "u1", 7)).toEqual({
      postsRemplaces: 2, postsConserves: 2, tachesRemplacees: 2, tachesConservees: 1,
    });
  });

  it("campagne d'un autre utilisateur → CampagneIntrouvable, rien n'est lu", async () => {
    const { deps } = fabrique();
    await expect(apercuRepenser(deps, "u2", 7)).rejects.toBeInstanceOf(CampagneIntrouvable);
    expect(deps.lireContenus).not.toHaveBeenCalled();
  });
});

describe("repenserCampagne — génération", () => {
  it("savoir, préférences, articulation, marque et consigne vont aux trois générateurs", async () => {
    const art = { campagne: { id: 99 } } as any;
    const { deps } = fabrique({
      contexteGeneration: vi.fn(async () => ({
        brandDna: { businessType: "agence" } as any, preferences: [{ id: 1 }] as any,
        savoir: "- savoir", articulation: art,
      })),
    });
    await repenserCampagne(deps, "u1", 7, { consigne: "  Plus de cas clients  " });
    for (const f of [deps.genererStrategie, deps.genererContenu, deps.genererTaches]) {
      const req = (f as any).mock.calls[0][0];
      expect(req).toMatchObject({
        userId: "u1", projectId: 3, objective: "Vendre l'offre", duration: "1_month",
        brandDna: { businessType: "agence" }, preferences: [{ id: 1 }], savoir: "- savoir",
        articulation: art, consigne: "Plus de cas clients",
      });
    }
  });

  it("les revues passées n'entrent que dans la stratégie (comme /generate/strategy)", async () => {
    const { deps } = fabrique();
    await repenserCampagne(deps, "u1", 7);
    expect((deps.genererStrategie as any).mock.calls[0][0].weekContext).toContain("PAST CAMPAIGN REVIEWS");
    expect((deps.genererContenu as any).mock.calls[0][0].weekContext).toBeUndefined();
  });

  it("consigne vide ou faite d'espaces → absente des requêtes", async () => {
    for (const consigne of [undefined, "", "   \n\t "]) {
      const { deps } = fabrique();
      await repenserCampagne(deps, "u1", 7, { consigne });
      for (const f of [deps.genererStrategie, deps.genererContenu, deps.genererTaches]) {
        expect("consigne" in (f as any).mock.calls[0][0]).toBe(false);
      }
    }
    expect(normaliserConsigne("  x ")).toBe("x");
    expect(normaliserConsigne(42)).toBeUndefined();
  });

  it("le nom du modèle est ignoré : contenu et tâches reçoivent le nom de la campagne", async () => {
    const { deps, ops } = fabrique();
    await repenserCampagne(deps, "u1", 7);
    expect((deps.genererContenu as any).mock.calls[0][1].name).toBe("Ma campagne");
    expect((deps.genererTaches as any).mock.calls[0][1].name).toBe("Ma campagne");
    const champs = (ops.mettreAJourCampagne as any).mock.calls[0][2];
    expect(Object.keys(champs).sort()).toEqual([
      "audienceSegment", "campaignType", "channels", "contentPlan", "coreMessage", "generatedTasks",
      "insights", "kpis", "messagingFramework", "phases", "targetAudience",
    ]);
    for (const cadre of ["name", "objective", "duration", "projectId", "startDate", "endDate", "status",
      "articuleAvecCampaignId", "articulationIndependante"]) {
      expect(champs).not.toHaveProperty(cadre);
    }
    expect(champs.contentPlan).toEqual(plan());
    expect(champs.generatedTasks).toEqual(tachesGen());
  });

  for (const etape of ["genererStrategie", "genererContenu", "genererTaches", "contexteGeneration"] as const) {
    it(`échec de ${etape} → GenerationEchouee, aucune écriture`, async () => {
      const { deps, placement } = fabrique({ [etape]: vi.fn(async () => { throw new Error("boom"); }) } as any);
      await expect(repenserCampagne(deps, "u1", 7)).rejects.toBeInstanceOf(GenerationEchouee);
      expect(deps.transaction).not.toHaveBeenCalled();
      expect(placement.createTask).not.toHaveBeenCalled();
      expect(placement.createContent).not.toHaveBeenCalled();
      expect(deps.fixOverlappingTasks).not.toHaveBeenCalled();
    });
  }

  it("plan de contenu vide → GenerationEchouee, aucune écriture", async () => {
    const { deps } = fabrique({ genererContenu: vi.fn(async () => [] as any) });
    await expect(repenserCampagne(deps, "u1", 7)).rejects.toBeInstanceOf(GenerationEchouee);
    expect(deps.transaction).not.toHaveBeenCalled();
    expect(deps.genererTaches).not.toHaveBeenCalled();
  });

  it("stratégie sans phases, ou tâches vides → GenerationEchouee, aucune écriture", async () => {
    const a = fabrique({ genererStrategie: vi.fn(async () => ({ ...strategie(), phases: [] }) as any) });
    await expect(repenserCampagne(a.deps, "u1", 7)).rejects.toBeInstanceOf(GenerationEchouee);
    expect(a.deps.transaction).not.toHaveBeenCalled();
    const b = fabrique({ genererTaches: vi.fn(async () => [] as any) });
    await expect(repenserCampagne(b.deps, "u1", 7)).rejects.toBeInstanceOf(GenerationEchouee);
    expect(b.deps.transaction).not.toHaveBeenCalled();
  });

  it("délai dépassé sur une étape → GenerationEchouee, aucune écriture", async () => {
    const { deps } = fabrique({
      delaiGenerationMs: 20,
      genererContenu: vi.fn(() => new Promise<any>(() => {})),
    });
    const err = await repenserCampagne(deps, "u1", 7).catch((e) => e);
    expect(err).toBeInstanceOf(GenerationEchouee);
    expect(err.etape).toBe("contenu");
    expect(deps.transaction).not.toHaveBeenCalled();
  });

  it("toute la génération précède la transaction, qui précède le placement", async () => {
    const { deps, journal } = fabrique();
    await repenserCampagne(deps, "u1", 7);
    const i = (x: string) => journal.indexOf(x);
    expect(i("gen-taches")).toBeLessThan(i("tx-debut"));
    expect(i("tx-fin")).toBeLessThan(i("createTask"));
    expect(journal.at(-1)).toBe("fix");
  });
});

describe("repenserCampagne — écritures", () => {
  it("publiés / en cours de publication et tâches faites sont gardés (jamais supprimés)", async () => {
    const { deps, ops, journal } = fabrique();
    const r = await repenserCampagne(deps, "u1", 7);
    expect(ops.supprimerContenus).toHaveBeenCalledWith("u1", 7, [3, 4]);
    expect(ops.supprimerTaches).toHaveBeenCalledWith("u1", 7, [11, 12]);
    // Les tâches avant les posts (tasks.content_id en NO ACTION)
    expect(journal.indexOf("del-taches:11,12")).toBeLessThan(journal.indexOf("del-contenus:3,4"));
    expect(journal.indexOf("maj")).toBeLessThan(journal.indexOf("del-taches:11,12"));
    expect(r.postsSupprimes).toBe(2);
    expect(r.tachesSupprimees).toBe(2);
    expect(deps.transaction).toHaveBeenCalledTimes(1);
  });

  it("le tri est relu dans la transaction (post publié pendant la génération : gardé)", async () => {
    const { deps, ops } = fabrique();
    (ops.lireContenus as any).mockResolvedValue([
      { id: 3, publishedAt: new Date(), postStatus: "posted", contentStatus: "published" },
      { id: 4, publishedAt: null, postStatus: "pending", contentStatus: "draft" },
    ]);
    await repenserCampagne(deps, "u1", 7);
    expect(ops.supprimerContenus).toHaveBeenCalledWith("u1", 7, [4]);
  });

  it("campagne disparue pendant la génération → CampagneIntrouvable levée dans la transaction", async () => {
    const { deps, ops, placement } = fabrique();
    (ops.mettreAJourCampagne as any).mockResolvedValue(false);
    await expect(repenserCampagne(deps, "u1", 7)).rejects.toBeInstanceOf(CampagneIntrouvable);
    expect(ops.supprimerContenus).not.toHaveBeenCalled();
    expect(placement.createTask).not.toHaveBeenCalled();
  });

  it("brouillon → aucun placement, aucun re-tassage", async () => {
    const { deps, placement } = fabrique({ campaign: campagne({ status: "draft" }) });
    const r = await repenserCampagne(deps, "u1", 7);
    expect(r).toEqual({ postsCrees: 0, tachesCreees: 0, postsSupprimes: 2, tachesSupprimees: 2 });
    expect(placement.createTask).not.toHaveBeenCalled();
    expect(placement.createContent).not.toHaveBeenCalled();
    expect(deps.fixOverlappingTasks).not.toHaveBeenCalled();
  });

  it("brouillon ancien sans startDate/endDate (statut nul) → ne plante pas, pas de placement", async () => {
    const { deps, placement } = fabrique({ campaign: campagne({ status: null, startDate: null, endDate: null }) });
    const r = await repenserCampagne(deps, "u1", 7);
    expect(r.postsCrees).toBe(0);
    expect(placement.createTask).not.toHaveBeenCalled();
  });

  it("active → placement dans [max(aujourd'hui, début) ; fin], autoPost false, puis fixOverlappingTasks", async () => {
    const { deps, placement } = fabrique();
    const r = await repenserCampagne(deps, "u1", 7);
    expect(r.tachesCreees).toBeGreaterThan(0);
    expect(r.postsCrees).toBe(2);
    for (const [t] of placement.createTask.mock.calls as any[]) {
      expect(t.scheduledDate >= "2026-10-07" && t.scheduledDate <= "2026-10-31").toBe(true);
      expect(t).toMatchObject({ campaignId: 7, source: "campaign" });
    }
    for (const [c] of placement.createContent.mock.calls as any[]) {
      expect(c.autoPost).toBe(false);
      expect(c.scheduledFor >= new Date("2026-10-07T00:00:00")).toBe(true);
      expect(c.scheduledFor < new Date("2026-11-01T00:00:00")).toBe(true);
      expect(c.title === "a1" || c.title === "a2").toBe(true); // nouveau plan, pas l'ancien
    }
    expect(deps.fixOverlappingTasks).toHaveBeenCalledWith("u1", "2026-10-07");
  });

  it("paused → placement aussi, statut jamais écrit", async () => {
    const { deps, placement, ops } = fabrique({ campaign: campagne({ status: "paused" }) });
    await repenserCampagne(deps, "u1", 7);
    expect(placement.createContent).toHaveBeenCalled();
    expect((ops.mettreAJourCampagne as any).mock.calls[0][2]).not.toHaveProperty("status");
  });

  it("aucun post ni tâche n'est placé après endDate (fenêtre courte)", async () => {
    const { deps, placement } = fabrique({ campaign: campagne({ endDate: "2026-10-09" }) });
    await repenserCampagne(deps, "u1", 7);
    for (const [t] of placement.createTask.mock.calls as any[]) expect(t.scheduledDate <= "2026-10-09").toBe(true);
    for (const [c] of placement.createContent.mock.calls as any[]) {
      expect(c.scheduledFor < new Date("2026-10-10T00:00:00")).toBe(true);
    }
  });

  it("active dont la fin est passée → fenêtre vide : 0 créé, pas d'erreur", async () => {
    const { deps, placement } = fabrique({ campaign: campagne({ startDate: "2026-09-01", endDate: "2026-09-30" }) });
    const r = await repenserCampagne(deps, "u1", 7);
    expect(r).toEqual({ postsCrees: 0, tachesCreees: 0, postsSupprimes: 2, tachesSupprimees: 2 });
    expect(placement.createTask).not.toHaveBeenCalled();
    expect(placement.createContent).not.toHaveBeenCalled();
  });

  it("active sans dates → fenêtre aujourd'hui + durée, ne plante pas", async () => {
    const { deps, placement } = fabrique({ campaign: campagne({ startDate: null, endDate: null }) });
    await repenserCampagne(deps, "u1", 7);
    expect(placement.createContent).toHaveBeenCalled();
    expect(fenetrePlacement({ startDate: null, endDate: null, duration: "1_month" }, "2026-10-07"))
      .toEqual({ debut: "2026-10-07", fin: "2026-11-06", vide: false });
  });

  it("début futur → la fenêtre part du début de campagne", () => {
    expect(fenetrePlacement({ startDate: "2026-11-01", endDate: "2026-11-30" }, "2026-10-07"))
      .toEqual({ debut: "2026-11-01", fin: "2026-11-30", vide: false });
  });

  it("échec du placement → PlacementEchoue avec les suppressions déjà faites", async () => {
    const { deps, placement } = fabrique();
    placement.createTask.mockRejectedValue(new Error("db down"));
    const err = await repenserCampagne(deps, "u1", 7).catch((e) => e);
    expect(err).toBeInstanceOf(PlacementEchoue);
    expect(err.partiel).toEqual({ postsSupprimes: 2, tachesSupprimees: 2 });
  });

  it("échec de fixOverlappingTasks → l'opération réussit quand même", async () => {
    const { deps } = fabrique({ fixOverlappingTasks: vi.fn(async () => { throw new Error("gcal"); }) });
    await expect(repenserCampagne(deps, "u1", 7)).resolves.toMatchObject({ postsCrees: 2 });
  });
});

describe("repenserCampagne — contrôles et verrou", () => {
  it("statut completed (ou autre) → StatutIncompatible, rien n'est généré", async () => {
    for (const status of ["completed", "archived"]) {
      const { deps } = fabrique({ campaign: campagne({ status }) });
      await expect(repenserCampagne(deps, "u1", 7)).rejects.toBeInstanceOf(StatutIncompatible);
      expect(deps.genererStrategie).not.toHaveBeenCalled();
    }
  });

  it("campagne d'un autre utilisateur → CampagneIntrouvable", async () => {
    const { deps } = fabrique();
    await expect(repenserCampagne(deps, "u2", 7)).rejects.toBeInstanceOf(CampagneIntrouvable);
    expect(deps.genererStrategie).not.toHaveBeenCalled();
  });

  it("second appel concurrent → DejaEnCours ; le verrou est relâché ensuite", async () => {
    let relacher!: () => void;
    const attente = new Promise<void>((r) => { relacher = r; });
    const { deps } = fabrique({
      genererStrategie: vi.fn(async () => { await attente; return strategie() as any; }),
    });
    const premier = repenserCampagne(deps, "u1", 7);
    await expect(repenserCampagne(deps, "u1", 7)).rejects.toBeInstanceOf(DejaEnCours);
    relacher();
    await premier;
    await expect(repenserCampagne(deps, "u1", 7)).resolves.toBeDefined();
  });

  it("le verrou est relâché aussi après un échec", async () => {
    const a = fabrique({ genererStrategie: vi.fn(async () => { throw new Error("x"); }) });
    await expect(repenserCampagne(a.deps, "u1", 7)).rejects.toBeInstanceOf(GenerationEchouee);
    const b = fabrique();
    await expect(repenserCampagne(b.deps, "u1", 7)).resolves.toBeDefined();
  });

  it("le verrou est par utilisateur : une autre utilisatrice n'est pas bloquée (404, pas 409)", async () => {
    let relacher!: () => void;
    const attente = new Promise<void>((r) => { relacher = r; });
    const { deps } = fabrique({
      genererStrategie: vi.fn(async () => { await attente; return strategie() as any; }),
    });
    const premier = repenserCampagne(deps, "u1", 7);
    await expect(repenserCampagne(deps, "u2", 7)).rejects.toBeInstanceOf(CampagneIntrouvable);
    relacher();
    await premier;
  });
});
