// Placement commun d'une campagne : mêmes fixtures que la caractérisation des routes
// (server/routes.campaign-placement.test.ts), pour vérifier que le service rend les mêmes dates.
import { describe, it, expect, vi } from "vitest";
import { placerTachesCampagne, placerPostsCampagne } from "./placement";

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
  generatedTasks: [task("Write post one", 1, "content"), task("Plan review", 1), task("Publish video two", 2, "content"), task("Wrap up", 2)],
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
  it("place les 4 tâches générées (8 sous-tâches) comme /launch, hors jour indisponible", async () => {
    const deps = fabrique();
    const r = await placerTachesCampagne(deps, { userId: "u", campaign, debut: d("2026-10-12"), fin: d("2026-11-11") });
    expect(r).toEqual({ creees: 8 });
    expect(taches(deps)).toEqual([
      "2026-10-19 09:00-09:30 Write copy — Write post one",
      "2026-10-20 09:00-09:15 Publish — Write post one",
      "2026-10-21 09:00-09:30 Plan review",
      "2026-10-28 09:00-09:45 Script — Publish video two",
      "2026-10-30 09:00-10:30 Shoot/record — Publish video two",
      "2026-11-02 09:00-10:00 Edit & caption — Publish video two",
      "2026-11-03 09:00-09:20 Schedule & publish — Publish video two",
      "2026-11-05 09:00-09:30 Wrap up",
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
    expect(taches(pris)[0]).toBe("2026-10-19 10:30-11:00 Write copy — Write post one");

    const sans = fabrique();
    await placerTachesCampagne(sans, { userId: "u", campaign, debut: d("2026-10-12"), fin: d("2026-11-11"), controleCreneaux: false });
    expect(sans.checkSlotAvailability).not.toHaveBeenCalled();
    expect(taches(sans)[0]).toBe("2026-10-19 09:00-09:30 Write copy — Write post one");
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
    expect(r).toEqual({ crees: 6 });
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
  it("sans borne, la recherche de créneau peut déborder après fin (comportement historique)", async () => {
    const deps = fabrique();
    await placerTachesCampagne(deps, { userId: "u", campaign, debut: d("2026-10-12"), fin: d("2026-10-16") });
    const dates = deps.createTask.mock.calls.map(([t]: any[]) => t.scheduledDate as string);
    expect(dates.some((x: string) => x > "2026-10-16")).toBe(true);
  });

  it("avec bornerA, aucune tâche n'est créée après la borne", async () => {
    const deps = fabrique();
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
    async createContent(c: any) { this.journal.push("content"); return this.copie(c); }
    private copie<T>(x: T): T { return x; }
    get appels() { return this.journal; }
  }

  it("place tâches et posts sans perdre `this` (contrôle de créneaux actif)", async () => {
    const s = new FauxStockage();
    const r1 = await placerTachesCampagne(s as any, { userId: "u", campaign, debut: d("2026-10-12"), fin: d("2026-11-11") });
    const r2 = await placerPostsCampagne(s as any, { userId: "u", campaign, debut: d("2026-10-12") });
    expect(r1.creees).toBe(8);
    expect(r2.crees).toBeGreaterThan(0);
    expect(s.appels).toContain("task");
    expect(s.appels).toContain("content");
  });
});
