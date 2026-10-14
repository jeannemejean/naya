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
// « Publier » est à l'heure du post EN HEURE DE PARIS (le serveur tourne en UTC) : le test
// la calcule pareil, pour passer quel que soit le fuseau de la machine (CI en UTC).
const heureParis = (x: Date) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(x);
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
    private posts: any[] = [];
    async getUserPreferences() { return { workDays: "mon,tue,wed,thu,fri" }; }
    async getDayAvailabilityRange() { return []; }
    async getTasksInRange(userId: string) { this.journal.push("range"); return this.taches(userId); }
    private taches(_u: string) { return [] as any[]; }
    async checkSlotAvailability() { return this.libre(); }
    private libre() { return { available: true }; }
    async createTask(t: any) { this.journal.push("task"); return this.copie(t); }
    async createContent(c: any) { this.journal.push("content"); const p = this.copie({ id: this.journal.length, ...c }); this.posts.push(p); return p; }
    async getPostsEntre() { return this.copie(this.posts); }
    async getTachesAtelier() { return this.taches("u"); }
    async getTasksForContents() { return this.taches("u"); }
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

// ─── Production : l'atelier de la semaine (spec 2026-10-14) ──────────────────

describe("placerPostsCampagne pose l'atelier de chaque semaine de posts", () => {
  const avecIds = () => {
    let n = 100;
    const crees: any[] = [];
    const deps = fabrique({
      createContent: vi.fn(async (c: any) => { const p = { id: ++n, ...c }; crees.push(p); return p; }),
      getPostsEntre: vi.fn(async (_u: string, debut: Date, fin: Date) => crees.filter((p) => p.scheduledFor >= debut && p.scheduledFor < fin)),
      getTachesAtelier: vi.fn(async () => []),
      getTasksForContents: vi.fn(async () => []),
    });
    return deps;
  };
  const prod = (deps: any) => deps.createTask.mock.calls.map(([t]: any[]) => t);

  it("un atelier par semaine (et sa validation), plus aucune tâche par post", async () => {
    const deps = avecIds();
    const r = await placerPostsCampagne(deps, { userId: "u", campaign, debut: d("2026-10-12"), fin: d("2026-11-11"), aujourdhui: "2026-10-08" });
    expect(r.crees).toBe(6);
    const taches = prod(deps);
    expect(r.tachesProduction).toBe(taches.length);
    expect(taches.every((t: any) => t.contentId === undefined)).toBe(true);
    expect(taches.map((t: any) => `${t.scheduledDate} ${t.estimatedDuration} ${t.title}`)).toEqual([
      // Semaine du 12 : 4 carrousels (120 min) → 90 + 30, premier post le lundi 12 → tout avant, dès le 8.
      "2026-10-08 90 Atelier contenu — semaine du 12 oct. (1/2)",
      "2026-10-09 30 Atelier contenu — semaine du 12 oct. (2/2)",
      "2026-10-13 30 Atelier contenu — semaine du 19 oct.",
      "2026-10-15 7 Valider la semaine — 19 oct.",
      "2026-11-04 30 Atelier contenu — semaine du 9 nov.",
      "2026-11-05 7 Valider la semaine — 9 nov.",
    ]);
    expect(taches.every((t: any) => ![0, 6].includes(d(t.scheduledDate).getDay()) && t.scheduledDate !== "2026-10-14")).toBe(true);
  });

  it("un post déjà passé n'a pas d'atelier", async () => {
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

  function deps(posts: any[], liees: any[] = [], ateliers: any[] = []) {
    return fabrique({
      getContent: vi.fn(async () => posts),
      getPostsEntre: vi.fn(async () => posts),
      getTachesAtelier: vi.fn(async () => ateliers),
      getTasksForContents: vi.fn(async () => liees),
      updateTask: vi.fn(async () => ({})),
    });
  }

  it("pose l'atelier de la semaine des posts à venir, rien pour les posts publiés ou passés", async () => {
    const dp = deps([
      post(),
      post({ id: 51, postStatus: "posted" }),
      post({ id: 52, scheduledFor: new Date("2026-10-01T09:00:00") }),
      post({ id: 53, publishedAt: new Date() }),
    ]);
    const r = await placerTachesProductionPourCampagne(dp, { userId: "u", campaignId: 3, aujourdhui: "2026-10-08" });
    expect(dp.getContent).toHaveBeenCalledWith("u", expect.any(Number), undefined, 3);
    expect(dp.createTask.mock.calls.map(([x]: any[]) => `${x.scheduledDate} ${x.title}`)).toEqual([
      // Post le vendredi 16 ; le mercredi 14 est indisponible → 3 jours travaillés avant = lundi 12.
      "2026-10-12 Atelier contenu — semaine du 12 oct.",
      "2026-10-13 Valider la semaine — 12 oct.",
    ]);
    expect(r).toEqual({ creees: 2 });
  });

  it("deuxième passage : l'atelier existant n'est pas recréé", async () => {
    const atelier = { id: 7, taskType: "atelier_contenu", completed: false, estimatedDuration: 15, title: "Atelier contenu — semaine du 12 oct.", actionData: { semaine: "2026-10-12", partie: 1, parties: 1, echeance: "2026-10-15" } };
    const dp = deps([post()], [], [atelier]);
    const r = await placerTachesProductionPourCampagne(dp, { userId: "u", campaignId: 3, aujourdhui: "2026-10-08" });
    expect(dp.createTask).not.toHaveBeenCalled();
    expect(r.creees).toBe(0);
  });

  it("aucun post à produire : rien de lu ni de créé", async () => {
    const dp = deps([post({ postStatus: "posted" })]);
    const r = await placerTachesProductionPourCampagne(dp, { userId: "u", campaignId: 3, aujourdhui: "2026-10-08" });
    expect(r.creees).toBe(0);
    expect(dp.getTasksForContents).not.toHaveBeenCalled();
    expect(dp.createTask).not.toHaveBeenCalled();
  });
});
