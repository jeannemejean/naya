// « Repenser la campagne » : orchestration testée avec des fakes (aucune base, aucun modèle).
import { describe, it, expect, vi } from "vitest";
import { placerTachesCampagne } from "./placement";
import {
  apercuRepenser, repenserCampagne, fenetrePlacement, normaliserConsigne,
  CampagneIntrouvable, StatutIncompatible, GenerationEchouee, DejaEnCours, PlacementEchoue,
  lancerRepenser, RegistreRepenser, erreurPublique, repenserEnCours, placementPourStatut,
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

function fabrique(over: Partial<RepenserDeps> & { campaign?: any; fraiche?: any } = {}) {
  const journal: string[] = [];
  const { campaign, fraiche, ...reste } = over;
  const ops: OperationsTransaction = {
    // Par défaut la ligne relue FOR UPDATE est celle lue avant la génération.
    verrouillerCampagne: vi.fn(async (userId: string, id: number) => {
      journal.push("verrou");
      if (fraiche !== undefined) return fraiche;
      return userId === "u1" && id === 7 ? (campaign ?? campagne()) : undefined;
    }),
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
      postsRemplaces: 2, postsConserves: 2, tachesRemplacees: 2, tachesConservees: 1, placement: "maintenant",
    });
  });

  it("dit où iront les nouveautés : en pause → à la reprise ; brouillon → au lancement", async () => {
    expect((await apercuRepenser(fabrique({ campaign: campagne({ status: "paused" }) }).deps, "u1", 7)).placement)
      .toBe("reprise");
    expect((await apercuRepenser(fabrique({ campaign: campagne({ status: "draft" }) }).deps, "u1", 7)).placement)
      .toBe("lancement");
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

  it("active → chaque nouveau post a ses tâches de production, reliées et avant sa publication", async () => {
    const { deps, placement } = fabrique();
    let id = 500;
    placement.createContent.mockImplementation(async (c: any) => ({ id: ++id, ...c }));
    const r = await repenserCampagne(deps, "u1", 7);
    const posts = placement.createContent.mock.calls.map(([c]: any[], i: number) => ({ id: 501 + i, jour: c.scheduledFor }));
    const taches = placement.createTask.mock.calls.map(([t]: any[]) => t);
    expect(r.tachesCreees).toBe(taches.length);
    for (const p of posts) {
      const liees = taches.filter((t: any) => t.contentId === p.id);
      expect(liees.map((t: any) => t.title.split(" — ")[0])).toEqual([
        "Rédiger le texte", "Préparer le visuel", "Relire et valider le post", "Publier",
      ]);
      const jourPost = `${p.jour.getFullYear()}-${String(p.jour.getMonth() + 1).padStart(2, "0")}-${String(p.jour.getDate()).padStart(2, "0")}`;
      for (const t of liees) {
        expect(t.scheduledDate >= "2026-10-07" && t.scheduledDate <= jourPost).toBe(true);
        expect(t).toMatchObject({ campaignId: 7, projectId: 3 });
      }
    }
    // Les tâches générées hors contenu restent, une fois chacune.
    expect(taches.filter((t: any) => t.title === "Plan review")).toHaveLength(1);
  });

  it("paused → l'état que laisse /pause : rien n'est placé, statut jamais écrit", async () => {
    const { deps, placement, ops } = fabrique({ campaign: campagne({ status: "paused" }) });
    const r = await repenserCampagne(deps, "u1", 7);
    expect(r).toEqual({ postsCrees: 0, tachesCreees: 0, postsSupprimes: 2, tachesSupprimees: 2 });
    expect(placement.createTask).not.toHaveBeenCalled();
    expect(placement.createContent).not.toHaveBeenCalled();
    expect(deps.fixOverlappingTasks).not.toHaveBeenCalled();
    expect((ops.mettreAJourCampagne as any).mock.calls[0][2]).not.toHaveProperty("status");
  });

  it("paused puis reprise → un seul jeu de tâches, celui du nouveau plan (pas de doublon)", async () => {
    // Base factice à état : les tâches vivent ici ; la reprise est modélisée comme /resume,
    // qui place les `generatedTasks` de la campagne relue, sans rien retirer.
    const base = {
      campagne: campagne({ status: "paused", generatedTasks: [{ title: "Ancienne", phase: 1 }] }) as any,
      taches: [
        { id: 10, campaignId: 7, title: "Faite", completed: true },
        { id: 11, campaignId: 7, title: "Ancienne", completed: false }, // passée, non faite : /pause la laisse
      ] as any[],
    };
    let prochainId = 100;
    const { deps, ops, placement } = fabrique({ campaign: base.campagne });
    (ops.verrouillerCampagne as any).mockImplementation(async () => base.campagne);
    (ops.lireContenus as any).mockResolvedValue([]);
    (ops.lireTaches as any).mockImplementation(async () => base.taches.map((t) => ({ id: t.id, completed: t.completed })));
    (ops.mettreAJourCampagne as any).mockImplementation(async (_u: string, _c: number, champs: any) => {
      base.campagne = { ...base.campagne, ...champs };
      return true;
    });
    (ops.supprimerTaches as any).mockImplementation(async (_u: string, _c: number, ids: number[]) => {
      const avant = base.taches.length;
      base.taches = base.taches.filter((t) => !ids.includes(t.id));
      return avant - base.taches.length;
    });
    placement.createTask.mockImplementation(async (t: any) => {
      const ligne = { ...t, id: prochainId++ };
      base.taches.push(ligne);
      return ligne;
    });

    await repenserCampagne(deps, "u1", 7);
    expect(base.taches.map((t) => t.title)).toEqual(["Faite"]); // l'état de /pause, plan neuf

    // Reprise : la campagne repasse active et ses `generatedTasks` sont placées.
    base.campagne = { ...base.campagne, status: "active" };
    const { creees } = await placerTachesCampagne(placement as any, {
      userId: "u1", campaign: base.campagne,
      debut: new Date("2026-10-07T00:00:00"), fin: new Date("2026-10-31T00:00:00"),
    });
    expect(creees).toBeGreaterThan(0);
    const nonFaites = base.taches.filter((t) => !t.completed);
    expect(nonFaites).toHaveLength(creees); // un seul jeu
    expect(nonFaites.some((t) => t.title === "Ancienne")).toBe(false);
    const titres = nonFaites.map((t) => t.title);
    expect(new Set(titres).size).toBe(titres.length); // aucun doublon
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

describe("repenserCampagne — campagne relue dans la transaction", () => {
  it("la campagne est relue FOR UPDATE avant toute écriture", async () => {
    const { deps, ops, journal } = fabrique();
    await repenserCampagne(deps, "u1", 7);
    expect(ops.verrouillerCampagne).toHaveBeenCalledWith("u1", 7);
    expect(journal.indexOf("verrou")).toBeGreaterThan(journal.indexOf("tx-debut"));
    expect(journal.indexOf("verrou")).toBeLessThan(journal.indexOf("maj"));
  });

  for (const status of ["completed", "archived"]) {
    it(`statut devenu ${status} pendant la génération → StatutIncompatible, rien n'est écrit`, async () => {
      const { deps, ops, placement } = fabrique({ fraiche: campagne({ status }) });
      const err = await repenserCampagne(deps, "u1", 7).catch((e) => e);
      expect(err).toBeInstanceOf(StatutIncompatible);
      expect(erreurPublique(err)).toEqual({ code: "statut_incompatible" });
      expect(ops.mettreAJourCampagne).not.toHaveBeenCalled();
      expect(ops.supprimerContenus).not.toHaveBeenCalled();
      expect(ops.supprimerTaches).not.toHaveBeenCalled();
      expect(placement.createTask).not.toHaveBeenCalled();
      expect(placement.createContent).not.toHaveBeenCalled();
    });
  }

  it("arrière-plan : l'étape en cours est visible dans le registre pendant le travail", async () => {
    const reg = new RegistreRepenser();
    const { deps } = fabrique({});
    const vues: Array<string | undefined> = [];
    const orig = { s: deps.genererStrategie, c: deps.genererContenu, t: deps.genererTaches };
    deps.genererStrategie = (...a: any[]) => { vues.push(reg.lire("u1:7")?.etape); return (orig.s as any)(...a); };
    deps.genererContenu = (...a: any[]) => { vues.push(reg.lire("u1:7")?.etape); return (orig.c as any)(...a); };
    deps.genererTaches = (...a: any[]) => { vues.push(reg.lire("u1:7")?.etape); return (orig.t as any)(...a); };
    await (await lancerRepenser(deps, "u1", 7, {}, reg)).termine;
    expect(vues).toEqual(["strategie", "contenu", "taches"]);
    expect(reg.lire("u1:7")).toMatchObject({ etat: "termine" });
  });

  it("registre : avancer n'a d'effet que sur un travail en cours", () => {
    const reg = new RegistreRepenser();
    reg.avancer("u1:7", "contenu");
    expect(reg.lire("u1:7")).toBeUndefined();
    reg.reserver("u1:7");
    reg.avancer("u1:7", "contenu");
    expect(reg.lire("u1:7")).toMatchObject({ etat: "en_cours", etape: "contenu" });
    expect(typeof reg.lire("u1:7")?.etapeDepuis).toBe("string");
    reg.finir("u1:7", { etat: "termine" });
    reg.avancer("u1:7", "placement");
    expect(reg.lire("u1:7")?.etape).toBeUndefined();
  });

  it("arrière-plan : statut changé → echec statut_incompatible", async () => {
    const reg = new RegistreRepenser();
    const { deps } = fabrique({ fraiche: campagne({ status: "completed" }) });
    await (await lancerRepenser(deps, "u1", 7, {}, reg)).termine;
    expect(reg.lire("u1:7")).toMatchObject({ etat: "echec", erreur: { code: "statut_incompatible" } });
  });

  it("campagne supprimée pendant la génération → CampagneIntrouvable, rien n'est écrit", async () => {
    const { deps, ops } = fabrique({ fraiche: null });
    await expect(repenserCampagne(deps, "u1", 7)).rejects.toBeInstanceOf(CampagneIntrouvable);
    expect(ops.mettreAJourCampagne).not.toHaveBeenCalled();
  });

  it("brouillon lancé pendant la génération → placement sur la fenêtre de la ligne fraîche", async () => {
    const { deps, placement } = fabrique({
      campaign: campagne({ status: "draft", startDate: null, endDate: null }),
      fraiche: campagne({ status: "active", startDate: "2026-10-10", endDate: "2026-10-20" }),
    });
    const r = await repenserCampagne(deps, "u1", 7);
    expect(r.tachesCreees).toBeGreaterThan(0);
    for (const [t] of placement.createTask.mock.calls as any[]) {
      expect(t.scheduledDate >= "2026-10-10" && t.scheduledDate <= "2026-10-20").toBe(true);
    }
    for (const [c] of placement.createContent.mock.calls as any[]) {
      expect(c.scheduledFor < new Date("2026-10-21T00:00:00")).toBe(true);
    }
    expect(deps.fixOverlappingTasks).toHaveBeenCalledWith("u1", "2026-10-10");
  });

  it("active mise en pause pendant la génération → rien n'est placé", async () => {
    const { deps, placement } = fabrique({ fraiche: campagne({ status: "paused" }) });
    const r = await repenserCampagne(deps, "u1", 7);
    expect(r.tachesCreees).toBe(0);
    expect(placement.createTask).not.toHaveBeenCalled();
    expect(placement.createContent).not.toHaveBeenCalled();
  });

  it("placementPourStatut : brouillon / pause / active", () => {
    expect(placementPourStatut("draft")).toBe("lancement");
    expect(placementPourStatut(null)).toBe("lancement");
    expect(placementPourStatut("paused")).toBe("reprise");
    expect(placementPourStatut("active")).toBe("maintenant");
  });

  it("repenserEnCours : vrai pendant le travail (par utilisatrice), faux après", async () => {
    const reg = new RegistreRepenser();
    let relacher!: () => void;
    const attente = new Promise<void>((r) => { relacher = r; });
    const { deps } = fabrique({ genererStrategie: vi.fn(async () => { await attente; return strategie() as any; }) });
    const { termine } = await lancerRepenser(deps, "u1", 7, {}, reg);
    expect(repenserEnCours("u1", 7, reg)).toBe(true);
    expect(repenserEnCours("u2", 7, reg)).toBe(false);
    expect(repenserEnCours("u1", 8, reg)).toBe(false);
    relacher();
    await termine;
    expect(repenserEnCours("u1", 7, reg)).toBe(false);
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

describe("lancerRepenser (arrière-plan) et registre", () => {
  it("contrôles synchrones puis en_cours → termine avec le résultat", async () => {
    const reg = new RegistreRepenser();
    const { deps } = fabrique();
    const { termine } = await lancerRepenser(deps, "u1", 7, {}, reg);
    expect(reg.lire("u1:7")?.etat).toBe("en_cours");
    await termine;
    const e = reg.lire("u1:7")!;
    expect(e.etat).toBe("termine");
    expect(e.resultat).toMatchObject({ postsSupprimes: 2, tachesSupprimees: 2, postsCrees: 2 });
    expect(typeof e.debut).toBe("string");
    expect(typeof e.fin).toBe("string");
  });

  it("échec de génération → echec avec code, sans détails internes ; le processus ne plante pas", async () => {
    const reg = new RegistreRepenser();
    const { deps } = fabrique({ genererContenu: vi.fn(async () => { throw new Error("secret interne"); }) });
    const { termine } = await lancerRepenser(deps, "u1", 7, {}, reg);
    await expect(termine).resolves.toBeUndefined();
    const e = reg.lire("u1:7")!;
    expect(e).toMatchObject({ etat: "echec", erreur: { code: "generation_echouee", etape: "contenu" } });
    expect(JSON.stringify(e)).not.toContain("secret interne");
  });

  it("échec de placement → code placement_echoue avec les suppressions ; autre erreur → code erreur", async () => {
    const reg = new RegistreRepenser();
    const a = fabrique();
    a.placement.createTask.mockRejectedValue(new Error("db"));
    await (await lancerRepenser(a.deps, "u1", 7, {}, reg)).termine;
    expect(reg.lire("u1:7")?.erreur).toEqual({ code: "placement_echoue", postsSupprimes: 2, tachesSupprimees: 2 });
    expect(erreurPublique(new Error("x"))).toEqual({ code: "erreur" });
    expect(erreurPublique(new CampagneIntrouvable(1))).toEqual({ code: "erreur" });
  });

  it("deja_en_cours pendant l'exécution, puis relançable après", async () => {
    const reg = new RegistreRepenser();
    let relacher!: () => void;
    const attente = new Promise<void>((r) => { relacher = r; });
    const { deps } = fabrique({ genererStrategie: vi.fn(async () => { await attente; return strategie() as any; }) });
    const { termine } = await lancerRepenser(deps, "u1", 7, {}, reg);
    await expect(lancerRepenser(deps, "u1", 7, {}, reg)).rejects.toBeInstanceOf(DejaEnCours);
    await expect(repenserCampagne(deps, "u1", 7)).rejects.toBeInstanceOf(DejaEnCours);
    relacher();
    await termine;
    const second = await lancerRepenser(deps, "u1", 7, {}, reg);
    await second.termine;
    expect(reg.lire("u1:7")?.etat).toBe("termine");
  });

  it("contrôle en échec (404 / 409) → l'erreur remonte et l'état précédent est restauré", async () => {
    const reg = new RegistreRepenser();
    const ok = fabrique();
    await (await lancerRepenser(ok.deps, "u1", 7, {}, reg)).termine;
    const fini = reg.lire("u1:7");
    const ko = fabrique({ campaign: campagne({ status: "completed" }) });
    await expect(lancerRepenser(ko.deps, "u1", 7, {}, reg)).rejects.toBeInstanceOf(StatutIncompatible);
    expect(reg.lire("u1:7")).toEqual(fini);
    await expect(lancerRepenser(ok.deps, "u2", 7, {}, reg)).rejects.toBeInstanceOf(CampagneIntrouvable);
    expect(reg.lire("u2:7")).toBeUndefined();
    expect(ko.deps.genererStrategie).not.toHaveBeenCalled();
  });

  it("entrées terminées oubliées après 15 min ; jamais une entrée en cours", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));
      const reg = new RegistreRepenser();
      reg.reserver("a"); reg.finir("a", { etat: "termine" });
      reg.reserver("b");
      vi.advanceTimersByTime(15 * 60_000 - 1);
      expect(reg.lire("a")?.etat).toBe("termine");
      vi.advanceTimersByTime(1);
      expect(reg.lire("a")).toBeUndefined();
      vi.advanceTimersByTime(60 * 60_000);
      expect(reg.lire("b")?.etat).toBe("en_cours");
    } finally {
      vi.useRealTimers();
    }
  });

  it("plafond : au-delà, les plus anciennes terminées partent, les en cours restent", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));
      const reg = new RegistreRepenser(() => Date.now(), 15 * 60_000, 3);
      reg.reserver("enCours");
      for (const k of ["t1", "t2", "t3", "t4"]) {
        reg.reserver(k); reg.finir(k, { etat: "termine" });
        vi.advanceTimersByTime(1000);
      }
      expect(reg.taille()).toBe(3);
      expect(reg.lire("enCours")?.etat).toBe("en_cours");
      expect(reg.lire("t1")).toBeUndefined();
      expect(reg.lire("t2")).toBeUndefined();
      expect(reg.lire("t4")?.etat).toBe("termine");
    } finally {
      vi.useRealTimers();
    }
  });
});
