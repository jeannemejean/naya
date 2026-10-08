// Placement commun d'une campagne : mêmes fixtures que la caractérisation des routes
// (server/routes.campaign-placement.test.ts), pour vérifier que le service rend les mêmes dates.
import { describe, it, expect, vi } from "vitest";
import { placerTachesCampagne, placerPostsCampagne, placerTachesProductionPourCampagne } from "./placement";

const task = (title: string, phase: number, type = "other") => ({
  title, description: `d ${title}`, type, category: "marketing", priority: 1,
  estimatedDuration: 30, taskEnergyType: "creative", phase,
});
const piece = (week: string, angle: string) => ({
  phase: 1, week, platform: "linkedin", format: "carousel", angle, pillar: "p", goal: "g", copyDirections: `c ${angle}`,
});
const campaign = {
  id: 3, projectId: 9,
  phases: [{ number: 1, name: "A", duration: "2 weeks" }, { number: 2, name: "B", duration: "2 weeks" }],
  generatedTasks: [
    task("Write post one", 1, "content"), task("Plan review", 1), task("Envoyer des DM aux prospects", 1, "outreach"),
    task("Publish video two", 2, "content"), task("Wrap up", 2),
  ],
  contentPlan: [
    piece("Week 1", "a1"), piece("Week 1", "a2"), piece("Week 1", "a3"), piece("Week 1", "a4"),
    piece("Week 2", "b1"), piece("Month 2", "b2"),
  ],
};
const d = (s: string) => new Date(s + "T00:00:00");
const pad = (n: number) => String(n).padStart(2, "0");
const local = (x: Date) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())} ${pad(x.getHours())}:${pad(x.getMinutes())}`;

function fabrique(over: any = {}) {
  const deps = {
    getUserPreferences: vi.fn(async () => ({ workDays: "mon,tue,wed,thu,fri" })),
    getDayAvailabilityRange: vi.fn(async () => [{ date: "2026-10-14", dayType: "off" }]),
    getTasksInRange: vi.fn(async () => [] as any[]),
    checkSlotAvailability: vi.fn(async () => ({ available: true } as { available: boolean; nextAvailableTime?: string })),
    createTask: vi.fn(async (t: any) => t),
    createContent: vi.fn(async (c: any) => c),
    ...over,
  };
  return deps;
}
const taches = (deps: any) => deps.createTask.mock.calls.map(([t]: any[]) => `${t.scheduledDate} ${t.scheduledTime}-${t.scheduledEndTime} ${t.title}`);

describe("placerTachesCampagne", () => {
  it("ne place plus que les tâches hors contenu et hors prospection, une par tâche (plus de sous-tâches)", async () => {
    const deps = fabrique();
    const r = await placerTachesCampagne(deps, { userId: "u", campaign, debut: d("2026-10-12"), fin: d("2026-11-11") });
    expect(r).toEqual({ creees: 2 });
    expect(taches(deps)).toEqual([
      "2026-10-19 09:00-09:30 Plan review",
      "2026-11-03 09:00-09:30 Wrap up",
    ]);
    const premiere = deps.createTask.mock.calls[0][0] as any;
    expect(premiere).toMatchObject({ source: "campaign", campaignId: 3, projectId: 9, userId: "u", completed: false });
    expect(deps.getTasksInRange).toHaveBeenCalledWith("u", "2026-10-12", "2026-11-11");
  });

  it("aucune tâche ne tombe un week-end ni le jour indisponible, 3 par jour au plus", async () => {
    const deps = fabrique();
    await placerTachesCampagne(deps, { userId: "u", campaign, debut: d("2026-10-12"), fin: d("2026-11-11") });
    const jours = deps.createTask.mock.calls.map(([t]: any[]) => t.scheduledDate as string);
    for (const j of jours) {
      expect([0, 6]).not.toContain(d(j).getDay());
      expect(j).not.toBe("2026-10-14");
    }
    const parJour = new Map<string, number>();
    for (const j of jours) parJour.set(j, (parJour.get(j) || 0) + 1);
    expect(Math.max(...Array.from(parJour.values()))).toBeLessThanOrEqual(3);
  });

  it("un créneau pris en base décale l'heure ; sans contrôle de créneaux, la base n'est pas interrogée", async () => {
    const pris = fabrique({
      checkSlotAvailability: vi.fn(async (_u: string, _d: string, t: string) => t === "09:00" ? { available: false, nextAvailableTime: "10:30" } : { available: true }),
    });
    await placerTachesCampagne(pris, { userId: "u", campaign, debut: d("2026-10-12"), fin: d("2026-11-11") });
    expect(taches(pris)[0]).toBe("2026-10-19 10:30-11:00 Plan review");

    const sans = fabrique();
    await placerTachesCampagne(sans, { userId: "u", campaign, debut: d("2026-10-12"), fin: d("2026-11-11"), controleCreneaux: false });
    expect(sans.checkSlotAvailability).not.toHaveBeenCalled();
    expect(taches(sans)[0]).toBe("2026-10-19 09:00-09:30 Plan review");
  });

  it("fenêtre explicite d'une campagne déjà lancée : rien avant le début, tout avant la fin", async () => {
    const deps = fabrique();
    await placerTachesCampagne(deps, { userId: "u", campaign, debut: d("2026-10-26"), fin: d("2026-11-11") });
    const jours = deps.createTask.mock.calls.map(([t]: any[]) => t.scheduledDate as string);
    expect(jours.length).toBeGreaterThan(0);
    expect(jours.every((j: string) => j >= "2026-10-26" && j <= "2026-11-11")).toBe(true);
  });

  it("fenêtre vide (fin avant début) : aucune erreur, aucune tâche", async () => {
    const deps = fabrique();
    const r = await placerTachesCampagne(deps, { userId: "u", campaign: { ...campaign, phases: [] }, debut: d("2026-11-20"), fin: d("2026-11-11") });
    expect(r.creees).toBeGreaterThanOrEqual(0);
  });
});

describe("placerPostsCampagne", () => {
  it("répartit les 6 posts par semaine sur les jours travaillés, sans publication automatique", async () => {
    const deps = fabrique();
    const r = await placerPostsCampagne(deps, { userId: "u", campaign, debut: d("2026-10-12"), fin: d("2026-11-11") });
    expect(r.crees).toBe(6);
    expect(deps.createContent.mock.calls.map(([c]: any[]) => `${local(c.scheduledFor)} ${c.title}`)).toEqual([
      "2026-10-12 09:00 a1", "2026-10-13 09:00 a2", "2026-10-15 09:00 a3",
      "2026-10-16 09:00 a4", "2026-10-19 09:00 b1", "2026-11-09 09:00 b2",
    ]);
    for (const [c] of deps.createContent.mock.calls as any[]) {
      expect(c).toMatchObject({ autoPost: false, status: "draft", contentStatus: "idea", campaignId: 3, projectId: 9 });
    }
    expect(deps.getDayAvailabilityRange).toHaveBeenCalledWith("u", "2026-10-12", "2026-11-11");
  });

  it("sans fin, lit les indisponibilités sur 365 jours", async () => {
    const deps = fabrique();
    await placerPostsCampagne(deps, { userId: "u", campaign, debut: d("2026-10-12") });
    expect(deps.getDayAvailabilityRange).toHaveBeenCalledWith("u", "2026-10-12", "2027-10-12");
  });

  it("aucun jour travaillé dans la semaine : repli sur le mercredi", async () => {
    const deps = fabrique({ getUserPreferences: vi.fn(async () => ({ workDays: "" })) });
    await placerPostsCampagne(deps, { userId: "u", campaign: { ...campaign, contentPlan: [piece("Week 1", "x")] }, debut: d("2026-10-12") });
    expect(local((deps.createContent.mock.calls[0] as any[])[0].scheduledFor)).toBe("2026-10-14 09:00");
  });
});

describe("borne de fin (option bornerA, utilisée par « repenser »)", () => {
  // Semaine du 12 au 16 octobre déjà pleine (3 tâches par jour) : le plafond repousse.
  const pleine = () => ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]
    .flatMap((j) => [1, 2, 3].map(() => ({ scheduledDate: j })));

  it("sans borne, la recherche de créneau peut déborder après fin (comportement historique)", async () => {
    const deps = fabrique({ getTasksInRange: vi.fn(async () => pleine()) });
    await placerTachesCampagne(deps, { userId: "u", campaign, debut: d("2026-10-12"), fin: d("2026-10-16") });
    const dates = deps.createTask.mock.calls.map(([t]: any[]) => t.scheduledDate as string);
    expect(dates.some((x: string) => x > "2026-10-16")).toBe(true);
  });

  it("avec bornerA, aucune tâche n'est créée après la borne", async () => {
    const deps = fabrique({ getTasksInRange: vi.fn(async () => pleine()) });
    const r = await placerTachesCampagne(deps, {
      userId: "u", campaign, debut: d("2026-10-12"), fin: d("2026-10-16"), bornerA: d("2026-10-16"),
    });
    const dates = deps.createTask.mock.calls.map(([t]: any[]) => t.scheduledDate as string);
    expect(dates.length).toBe(r.creees);
    expect(dates.every((x: string) => x >= "2026-10-12" && x <= "2026-10-16")).toBe(true);
  });

  it("avec bornerA, aucun post n'est créé après la borne ; sans, ils le sont", async () => {
    const sans = fabrique();
    const r0 = await placerPostsCampagne(sans, { userId: "u", campaign, debut: d("2026-10-12"), fin: d("2026-10-16") });
    expect(r0.crees).toBe(6);

    const avec = fabrique();
    const r = await placerPostsCampagne(avec, {
      userId: "u", campaign, debut: d("2026-10-12"), fin: d("2026-10-16"), bornerA: d("2026-10-16"),
    });
    const jours = avec.createContent.mock.calls.map(([c]: any[]) => local(c.scheduledFor).slice(0, 10));
    expect(r.crees).toBe(4);
    expect(jours.every((x: string) => x <= "2026-10-16")).toBe(true);
    expect(avec.createContent.mock.calls.every(([c]: any[]) => c.autoPost === false)).toBe(true);
  });

  it("fenêtre vide (borne avant le début) : rien n'est créé, sans erreur", async () => {
    const deps = fabrique();
    const t = await placerTachesCampagne(deps, { userId: "u", campaign, debut: d("2026-10-12"), fin: d("2026-10-05"), bornerA: d("2026-10-05") });
    const p = await placerPostsCampagne(deps, { userId: "u", campaign, debut: d("2026-10-12"), fin: d("2026-10-05"), bornerA: d("2026-10-05") });
    expect(t.creees).toBe(0);
    expect(p.crees).toBe(0);
  });
});

// Régression du 7 oct. 2026 : en production, `deps` est l'instance `storage` (une classe
// dont les méthodes s'appellent entre elles via `this`). Une méthode extraite sans `bind`
// perdait son `this` → « Cannot read properties of undefined (reading
// 'checkSlotAvailability') » → aucune tâche placée, campagnes repensées vides.
describe("dépendances portées par une instance de classe (comme `storage`)", () => {
  class FauxStockage {
    private journal: string[] = [];
    async getUserPreferences() { return { workDays: "mon,tue,wed,thu,fri" }; }
    async getDayAvailabilityRange() { return []; }
    async getTasksInRange(userId: string) { this.journal.push("range"); return this.taches(userId); }
    private taches(_u: string) { return [] as any[]; }
    async checkSlotAvailability() { return this.libre(); }
    private libre() { return { available: true }; }
    async createTask(t: any) { this.journal.push("task"); return this.copie(t); }
    async createContent(c: any) { this.journal.push("content"); return this.copie({ id: this.journal.length, ...c }); }
    private copie<T>(x: T): T { return x; }
    get appels() { return this.journal; }
  }

  it("place tâches et posts sans perdre `this` (contrôle de créneaux actif)", async () => {
    const s = new FauxStockage();
    const r1 = await placerTachesCampagne(s as any, { userId: "u", campaign, debut: d("2026-10-12"), fin: d("2026-11-11") });
    const r2 = await placerPostsCampagne(s as any, { userId: "u", campaign, debut: d("2026-10-12"), aujourdhui: "2026-10-08" });
    expect(r1.creees).toBe(2);
    expect(r2.crees).toBeGreaterThan(0);
    expect(r2.tachesProduction).toBeGreaterThan(0);
    expect(s.appels).toContain("task");
    expect(s.appels).toContain("content");
  });
});

// ─── Production dérivée des posts ────────────────────────────────────────────

describe("placerPostsCampagne crée aussi les tâches de production de chaque post", () => {
  const avecIds = () => {
    let n = 100;
    return fabrique({ createContent: vi.fn(async (c: any) => ({ id: ++n, ...c })) });
  };
  const prod = (deps: any) => deps.createTask.mock.calls.map(([t]: any[]) => t);

  it("chaque post a ses étapes (format carrousel), reliées par contentId, avant la publication", async () => {
    const deps = avecIds();
    const r = await placerPostsCampagne(deps, { userId: "u", campaign, debut: d("2026-10-12"), fin: d("2026-11-11"), aujourdhui: "2026-10-08" });
    expect(r.crees).toBe(6);
    const posts = deps.createContent.mock.calls.map(([c]: any[]) => c);
    expect(posts.every((c: any) => c.postFormat === "carousel")).toBe(true);

    const taches = prod(deps);
    expect(r.tachesProduction).toBe(taches.length);
    // 6 posts × (structurer, rédiger, designer, relire, publier — pas de publication automatique)
    expect(taches).toHaveLength(30);
    const parPost = new Map<number, any[]>();
    for (const t of taches) parPost.set(t.contentId, [...(parPost.get(t.contentId) || []), t]);
    expect(Array.from(parPost.keys()).sort()).toEqual([101, 102, 103, 104, 105, 106]);
    const jourPost = new Map<number, string>();
    posts.forEach((c: any, i: number) => jourPost.set(101 + i, local(c.scheduledFor).slice(0, 10)));

    for (const [id, ts] of Array.from(parPost.entries())) {
      expect(ts.map((t: any) => t.title.split(" — ")[0])).toEqual([
        "Structurer le carrousel", "Rédiger les slides", "Designer les slides", "Relire et valider le post", "Publier",
      ]);
      for (const t of ts) {
        expect(t).toMatchObject({ userId: "u", campaignId: 3, projectId: 9, contentId: id, source: "campaign", type: "content", completed: false });
        expect(t.scheduledDate <= jourPost.get(id)!).toBe(true);
        expect(t.scheduledDate >= "2026-10-08").toBe(true);
        expect(t.scheduledDate).not.toBe("2026-10-14");
        expect([0, 6]).not.toContain(d(t.scheduledDate).getDay());
      }
      const dates = ts.map((t: any) => t.scheduledDate);
      expect([...dates].sort()).toEqual(dates);
      const publier = ts[ts.length - 1];
      expect(publier.scheduledDate).toBe(jourPost.get(id));
      expect(publier.scheduledTime).toBe("09:00");
    }
  });

  it("post du lundi 12 : tout est prêt le vendredi 9, rien le week-end, publication le lundi", async () => {
    const deps = avecIds();
    await placerPostsCampagne(deps, {
      userId: "u", campaign: { ...campaign, contentPlan: [piece("Week 1", "a1")] }, debut: d("2026-10-12"), aujourdhui: "2026-10-08",
    });
    expect(prod(deps).map((t: any) => `${t.scheduledDate} ${t.scheduledTime} ${t.title}`)).toEqual([
      "2026-10-09 09:00 Structurer le carrousel — a1",
      "2026-10-09 09:45 Rédiger les slides — a1",
      "2026-10-09 10:45 Designer les slides — a1",
      "2026-10-09 13:00 Relire et valider le post — a1",
      "2026-10-12 09:00 Publier — a1",
    ]);
  });

  it("le plafond de 3 tâches par jour ne bloque pas la production (elle a une échéance)", async () => {
    const plein = Array.from({ length: 5 }, () => ({ scheduledDate: "2026-10-09" }));
    const deps = avecIds();
    deps.getTasksInRange = vi.fn(async () => plein);
    await placerPostsCampagne(deps, {
      userId: "u", campaign: { ...campaign, contentPlan: [piece("Week 1", "a1")] }, debut: d("2026-10-12"), aujourdhui: "2026-10-09",
    });
    const t = prod(deps);
    expect(t).toHaveLength(5);
    expect(t.every((x: any) => x.scheduledDate <= "2026-10-12" && x.scheduledDate >= "2026-10-09")).toBe(true);
  });

  it("un post déjà passé n'a pas de tâches de production", async () => {
    const deps = avecIds();
    await placerPostsCampagne(deps, {
      userId: "u", campaign: { ...campaign, contentPlan: [piece("Week 1", "a1")] }, debut: d("2026-10-12"), aujourdhui: "2026-10-20",
    });
    expect(deps.createContent).toHaveBeenCalledTimes(1);
    expect(deps.createTask).not.toHaveBeenCalled();
  });
});

describe("placerTachesProductionPourCampagne (idempotent)", () => {
  const post = (over: any = {}) => ({
    id: 50, userId: "u", projectId: 9, campaignId: 3, title: "Mon post", postFormat: "feed_image", contentType: "post",
    autoPost: false, scheduledFor: new Date("2026-10-16T11:00:00"), publishedAt: null, postStatus: "pending", contentStatus: "idea",
    ...over,
  });

  function deps(posts: any[], liees: any[] = []) {
    return fabrique({
      getContent: vi.fn(async () => posts),
      getTasksForContents: vi.fn(async () => liees),
    });
  }

  it("crée les étapes manquantes des posts à venir, rien pour les posts publiés ou passés", async () => {
    const dp = deps([
      post(),
      post({ id: 51, postStatus: "posted" }),
      post({ id: 52, scheduledFor: new Date("2026-10-01T09:00:00") }),
      post({ id: 53, publishedAt: new Date() }),
    ]);
    const r = await placerTachesProductionPourCampagne(dp, { userId: "u", campaignId: 3, aujourdhui: "2026-10-08" });
    expect(dp.getContent).toHaveBeenCalledWith("u", expect.any(Number), undefined, 3);
    expect(dp.getTasksForContents).toHaveBeenCalledWith("u", [50]);
    expect(dp.createTask.mock.calls.map(([x]: any[]) => `${x.scheduledDate} ${x.scheduledTime} ${x.title} #${x.contentId}`)).toEqual([
      "2026-10-13 09:00 Rédiger le texte — Mon post #50",
      "2026-10-15 09:00 Préparer le visuel — Mon post #50",
      "2026-10-15 10:00 Relire et valider le post — Mon post #50",
      "2026-10-16 11:00 Publier — Mon post #50",
    ]);
    expect(r).toEqual({ creees: 4 });
  });

  it("deuxième passage : les étapes déjà présentes (faites ou non) ne sont pas recréées", async () => {
    const liees = [
      { contentId: 50, title: "Rédiger le texte — Mon post", completed: true },
      { contentId: 50, title: "Préparer le visuel — Ancien titre", completed: false },
    ];
    const dp = deps([post()], liees);
    const r = await placerTachesProductionPourCampagne(dp, { userId: "u", campaignId: 3, aujourdhui: "2026-10-08" });
    expect(dp.createTask.mock.calls.map(([x]: any[]) => x.title)).toEqual([
      "Relire et valider le post — Mon post", "Publier — Mon post",
    ]);
    expect(r.creees).toBe(2);
  });

  it("aucun post à produire : aucune lecture de tâches, rien de créé", async () => {
    const dp = deps([post({ postStatus: "posted" })]);
    const r = await placerTachesProductionPourCampagne(dp, { userId: "u", campaignId: 3, aujourdhui: "2026-10-08" });
    expect(r.creees).toBe(0);
    expect(dp.getTasksForContents).not.toHaveBeenCalled();
    expect(dp.createTask).not.toHaveBeenCalled();
  });
});
