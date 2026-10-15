// Fuseau fixé à celui de la prod (Railway tourne en UTC) : les posts sont créés à 09:00
// heure du serveur et « Publier » est posé à l'heure de Paris correspondante. Sans cela, les
// instantanés ci-dessous dépendraient de la machine qui lance les tests (Mac en Paris, CI en UTC).
process.env.TZ = "UTC";
// Tests de caractérisation du placement d'une campagne (launch / regenerate-content /
// resume / redeploy).
//
// Ils figent le comportement des routes (dates, heures, nombre de tâches et de posts créés).
// Depuis oct. 2026, les tâches de production DÉRIVENT des posts (reliées par content_id,
// planifiées à rebours de la publication) : tout chemin qui crée des posts crée leurs
// tâches, et les tâches de contenu ou de prospection du texte généré ne sont plus placées.
import express from "express";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./db", () => ({
  db: { select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([]) }) })) },
  pool: { query: vi.fn(), on: vi.fn() },
}));
vi.mock("./auth", () => ({
  setupAuth: vi.fn(async () => {}),
  isAuthenticated: (req: any, _res: any, next: any) => { req.userId = "user-1"; next(); },
  hashPassword: vi.fn(), verifyPassword: vi.fn(), generateUserId: vi.fn(), generateJWT: vi.fn(),
}));

let prochainPost = 100;
const storageMock = {
  getCampaign: vi.fn(),
  updateCampaign: vi.fn(async (_id: number, _u: string, d: any) => ({ id: 3, ...d })),
  getTasksInRange: vi.fn(async () => []),
  getUserPreferences: vi.fn(async () => ({ workDays: "mon,tue,wed,thu,fri" })),
  getDayAvailabilityRange: vi.fn(async () => [{ date: "2026-10-14", dayType: "off" }]),
  checkSlotAvailability: vi.fn(async () => ({ available: true })),
  createTask: vi.fn(async (t: any) => ({ id: 1, ...t })),
  createContent: vi.fn(async (c: any) => ({ id: ++prochainPost, ...c })),
  getTasksForContents: vi.fn(async () => [] as any[]),
  // Atelier de contenu : les posts de la semaine sont ceux créés pendant l'appel.
  getPostsEntre: vi.fn(async (_u: string, debut: Date, fin: Date) =>
    storageMock.createContent.mock.calls.map(([c]: any[], i: number) => ({ id: 101 + i, ...c }))
      .filter((c: any) => c.scheduledFor >= debut && c.scheduledFor < fin)),
  getTachesAtelier: vi.fn(async () => [] as any[]),
  updateTask: vi.fn(async (id: number, p: any) => ({ id, ...p })),
  fixOverlappingTasks: vi.fn(async () => {}),
  deleteAllIncompleteCampaignTasks: vi.fn(async () => 2),
  deleteAllCampaignContent: vi.fn(async () => 5),
  getContent: vi.fn(async () => []),
  deleteCampaignContentItems: vi.fn(async (_cid: number, ids: number[]) => ids.length),
};
vi.mock("./storage", () => ({ storage: storageMock }));
const claudeMock = vi.hoisted(() => ({ callClaudeWithContext: vi.fn() }));
vi.mock("./services/claude", async (orig) => ({ ...(await orig<any>()), callClaudeWithContext: claudeMock.callClaudeWithContext }));
const gardeJalons = vi.hoisted(() => ({ marquerTachesDesJalonsVerrouilles: vi.fn(async () => 0) }));
vi.mock("./services/jalons-verrouilles", () => gardeJalons);

const { registerRoutes } = await import("./routes");
const { lundiDe } = await import("@shared/atelier");

let server: http.Server;
let port: number;
beforeEach(async () => {
  vi.clearAllMocks();
  prochainPost = 100;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T09:00:00"));
  const app = express();
  app.use(express.json());
  server = await registerRoutes(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  port = typeof a === "object" && a ? a.port : 0;
});
afterEach(async () => {
  vi.useRealTimers();
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
});

const task = (title: string, phase: number, type = "other") => ({
  title, description: `d ${title}`, type, category: "marketing", priority: 1,
  estimatedDuration: 30, taskEnergyType: "creative", phase,
});
const piece = (week: string, angle: string) => ({
  phase: 1, week, platform: "linkedin", format: "carousel", angle, pillar: "p", goal: "g", copyDirections: `c ${angle}`,
});
const campagne = (over: any = {}) => ({
  id: 3, userId: "user-1", projectId: 9, status: "draft", duration: "1_month",
  startDate: "2026-10-12", endDate: "2026-11-11",
  phases: [{ number: 1, name: "A", duration: "2 weeks" }, { number: 2, name: "B", duration: "2 weeks" }],
  generatedTasks: [
    task("Write post one", 1, "content"), task("Plan review", 1), task("Envoyer 10 DM aux prospects", 1, "outreach"),
    task("Publish video two", 2, "content"), task("Wrap up", 2),
  ],
  contentPlan: [
    piece("Week 1", "a1"), piece("Week 1", "a2"), piece("Week 1", "a3"), piece("Week 1", "a4"),
    piece("Week 2", "b1"), piece("Month 2", "b2"),
  ],
  ...over,
});

const pad = (n: number) => String(n).padStart(2, "0");
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const tasksCreated = () => storageMock.createTask.mock.calls.map(([t]: any[]) => `${t.scheduledDate} ${t.scheduledTime}-${t.scheduledEndTime} ${t.title} [${t.source}/${t.campaignId}/${t.projectId}${t.contentId ? `/#${t.contentId}` : ""}]`);
const tachesProduction = () => storageMock.createTask.mock.calls.map(([t]: any[]) => t).filter((t: any) => t.contentId);
const jourDe = (d: Date) => local(d).slice(0, 10);
/**
 * Atelier de contenu (spec 2026-10-14) : aucune tâche par post pour un carrousel ; chaque
 * semaine qui a un post à venir a son atelier, posé avant le premier post de la semaine.
 */
function verifierProduction() {
  const posts = storageMock.createContent.mock.calls.map(([c]: any[], i: number) => ({ id: 101 + i, jour: jourDe(c.scheduledFor) }));
  expect(tachesProduction()).toEqual([]);
  const ateliers = storageMock.createTask.mock.calls.map(([t]: any[]) => t).filter((t: any) => t.taskType === "atelier_contenu");
  for (const p of posts.filter((x) => x.jour >= "2026-10-12")) {
    const lundi = lundiDe(p.jour);
    const siens = ateliers.filter((t: any) => t.actionData.semaine === lundi);
    expect(siens.length).toBeGreaterThan(0);
    for (const t of siens) expect(t.scheduledDate >= "2026-10-12" && t.scheduledDate <= p.jour).toBe(true);
  }
  return posts.length;
}
const titresAtelier = () => storageMock.createTask.mock.calls.map(([t]: any[]) => t)
  .filter((t: any) => t.taskType).map((t: any) => `${t.scheduledDate} ${t.title}`);
// Lancement le lundi 12 avec un post le jour même : l'atelier de cette semaine ne peut être
// qu'aujourd'hui (ses deux parties), sans validation ; les semaines suivantes ont la leur.
const ATELIERS_LANCEMENT = [
  "2026-10-12 Atelier contenu — semaine du 12 oct. (1/2)",
  "2026-10-12 Atelier contenu — semaine du 12 oct. (2/2)",
  "2026-10-13 Atelier contenu — semaine du 19 oct.",
  "2026-10-15 Valider la semaine — 19 oct.",
  "2026-11-04 Atelier contenu — semaine du 9 nov.",
  "2026-11-05 Valider la semaine — 9 nov.",
];
const postsCreated = () => storageMock.createContent.mock.calls.map(([c]: any[]) => `${local(c.scheduledFor)} ${c.title} ${c.contentType} auto=${c.autoPost}`);
const call = (path: string, body: any = {}) => fetch(`http://127.0.0.1:${port}/api/campaigns/3/${path}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

describe("placement de campagne : caractérisation des routes", () => {
  it("launch : tâches et posts placés, campagne activée", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne());
    const res = await call("launch", { startDate: "2026-10-12" });
    const json: any = await res.json();
    expect(res.status).toBe(200);
    // Ateliers des 3 semaines de posts (12 oct. en 2 parties, 19 oct., 9 nov., avec leurs
    // validations quand il reste un jour) + 2 tâches hors contenu (ni contenu ni prospection).
    expect(verifierProduction()).toBe(6);
    expect(titresAtelier()).toEqual(ATELIERS_LANCEMENT);
    expect({ tasksCreated: json.tasksCreated, contentCreated: json.contentCreated }).toEqual({ tasksCreated: ATELIERS_LANCEMENT.length + 2, contentCreated: 6 });
    const autres = storageMock.createTask.mock.calls.map(([t]: any[]) => t).filter((t: any) => !t.taskType);
    expect(autres.map((t: any) => t.title)).toEqual(["Plan review", "Wrap up"]);
    expect(tasksCreated()).toMatchSnapshot("launch tâches");
    expect(postsCreated()).toMatchSnapshot("launch posts");
    expect(storageMock.updateCampaign).toHaveBeenCalledWith(3, "user-1", { tasksGenerated: true, status: "active", startDate: "2026-10-12", endDate: "2026-11-11" });
    expect(storageMock.fixOverlappingTasks).toHaveBeenCalledWith("user-1", "2026-10-12");
    expect(storageMock.checkSlotAvailability).toHaveBeenCalled();
    expect(storageMock.getTasksInRange).toHaveBeenCalledWith("user-1", "2026-10-12", "2026-11-11");
    expect(storageMock.getDayAvailabilityRange).toHaveBeenCalledWith("user-1", "2026-10-12", "2026-11-11");
  });

  it("launch : un créneau pris en base décale l'heure de la tâche", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne());
    storageMock.checkSlotAvailability.mockImplementation(async (_u: string, _d: string, time: string) =>
      time === "09:00" ? { available: false, nextAvailableTime: "10:30" } : { available: true });
    await call("launch", { startDate: "2026-10-12" });
    expect(tasksCreated()).toMatchSnapshot("launch créneau pris");
  });

  it("launch : campagne déjà active refusée", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne({ status: "active" }));
    const res = await call("launch", {});
    expect(res.status).toBe(400);
    expect(storageMock.createTask).not.toHaveBeenCalled();
  });

  it("regenerate-content : supprime tout puis recrée les posts depuis la date de début", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne({ status: "active" }));
    const res = await call("regenerate-content");
    const json: any = await res.json();
    expect(res.status).toBe(200);
    expect(json.contentCreated).toBe(6);
    expect(postsCreated()).toMatchSnapshot("regenerate posts");
    // Les nouveaux posts arrivent avec leurs ateliers, et seulement eux.
    expect(titresAtelier()).toEqual(ATELIERS_LANCEMENT);
    expect(json.tasksCreated).toBe(ATELIERS_LANCEMENT.length);
    expect(storageMock.createTask).toHaveBeenCalledTimes(ATELIERS_LANCEMENT.length);
    expect(verifierProduction()).toBe(6);
    expect(storageMock.getDayAvailabilityRange).toHaveBeenCalledWith("user-1", "2026-10-12", "2026-11-11");
  });

  it("regenerate-content : un post publié ou en cours de publication survit, `deleted` = le nombre réellement supprimé", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne({ status: "active" }));
    storageMock.getContent.mockResolvedValue([
      { id: 1, postStatus: "pending", contentStatus: "idea", publishedAt: null },
      { id: 2, postStatus: "posted", contentStatus: "idea", publishedAt: null },
      { id: 3, postStatus: "pending", contentStatus: "published", publishedAt: null },
      { id: 4, postStatus: "pending", contentStatus: "idea", publishedAt: new Date() },
      { id: 5, postStatus: "posting", contentStatus: "idea", publishedAt: null },
      { id: 6, postStatus: null, contentStatus: "idea", publishedAt: null },
    ] as any);
    const res = await call("regenerate-content");
    const json: any = await res.json();
    expect(res.status).toBe(200);
    expect(storageMock.deleteCampaignContentItems).toHaveBeenCalledWith(3, [1, 6]);
    expect(storageMock.deleteAllCampaignContent).not.toHaveBeenCalled();
    expect(json).toEqual({ deleted: 2, contentCreated: 6, tasksCreated: ATELIERS_LANCEMENT.length });
  });

  it("regenerate-content : sans date de fin, disponibilités sur 365 jours", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne({ status: "active", endDate: null }));
    await call("regenerate-content");
    expect(storageMock.getDayAvailabilityRange).toHaveBeenCalledWith("user-1", "2026-10-12", "2027-10-12");
  });

  it("redeploy : tâches replacées depuis aujourd'hui, sans contrôle de créneau en base", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne({ status: "paused" }));
    const res = await call("redeploy");
    const json: any = await res.json();
    expect(res.status).toBe(200);
    expect({ tasksCreated: json.tasksCreated, tasksRemoved: json.tasksRemoved }).toEqual({ tasksCreated: 2, tasksRemoved: 2 });
    expect(tasksCreated()).toMatchSnapshot("redeploy tâches");
    expect(storageMock.checkSlotAvailability).not.toHaveBeenCalled();
    expect(storageMock.createContent).not.toHaveBeenCalled();
    expect(storageMock.fixOverlappingTasks).not.toHaveBeenCalled();
    expect(storageMock.updateCampaign.mock.calls.map((c: any[]) => c[2])).toEqual([
      { status: "active", tasksGenerated: false, startDate: "2026-10-12", endDate: "2026-11-11" },
      { tasksGenerated: true },
    ]);
  });

  it("redeploy : les posts à venir retrouvent leurs tâches de production (retirées avec les tâches non faites)", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne({ status: "active" }));
    storageMock.getContent.mockResolvedValue([
      { id: 40, title: "Mon post", postFormat: "feed_image", contentType: "post", autoPost: false, campaignId: 3, projectId: 9,
        scheduledFor: new Date("2026-10-16T11:00:00"), publishedAt: null, postStatus: "pending", contentStatus: "idea" },
      { id: 41, title: "Publié", postFormat: "feed_image", contentType: "post", autoPost: false, campaignId: 3, projectId: 9,
        scheduledFor: new Date("2026-10-15T11:00:00"), publishedAt: new Date(), postStatus: "posted", contentStatus: "published" },
    ] as any);
    storageMock.getPostsEntre.mockImplementation(async () => (await storageMock.getContent()) as any);
    const res = await call("redeploy");
    const json: any = await res.json();
    expect(res.status).toBe(200);
    expect(storageMock.getContent).toHaveBeenCalledWith("user-1", expect.any(Number), undefined, 3);
    // Post du vendredi 16 (mercredi 14 indisponible) : atelier lundi 12, validation mardi 13.
    expect(tachesProduction()).toEqual([]);
    expect(titresAtelier()).toEqual([
      "2026-10-12 Atelier contenu — semaine du 12 oct.",
      "2026-10-13 Valider la semaine — 12 oct.",
    ]);
    expect(json.tasksCreated).toBe(4);
    expect(storageMock.checkSlotAvailability).not.toHaveBeenCalled();
  });

  it("resume : placement partagé (plus de copie en ligne), production des posts restants, sans prospection", async () => {
    storageMock.getCampaign.mockResolvedValue(campagne({ status: "paused", pauseNote: null }));
    storageMock.getContent.mockResolvedValue([
      { id: 40, title: "Mon post", postFormat: "carousel", contentType: "carousel", autoPost: false, campaignId: 3, projectId: 9,
        scheduledFor: new Date("2026-10-16T11:00:00"), publishedAt: null, postStatus: "pending", contentStatus: "idea" },
    ] as any);
    storageMock.getTasksForContents.mockResolvedValue([
      { contentId: 40, title: "Structurer le carrousel — Mon post", completed: true },
    ]);
    storageMock.getPostsEntre.mockImplementation(async () => (await storageMock.getContent()) as any);
    const res = await call("resume");
    const json: any = await res.json();
    expect(res.status).toBe(200);
    const toutes = storageMock.createTask.mock.calls.map(([t]: any[]) => t);
    // Une étape déjà faite (et plus aucune d'écran à faire) : le post rejoint l'atelier de sa semaine.
    expect(toutes.filter((t: any) => t.contentId === 40)).toEqual([]);
    expect(titresAtelier()).toEqual([
      "2026-10-12 Atelier contenu — semaine du 12 oct.",
      "2026-10-13 Valider la semaine — 12 oct.",
    ]);
    expect(toutes.filter((t: any) => !t.taskType).map((t: any) => t.title)).toEqual(["Plan review", "Wrap up"]);
    expect(toutes.some((t: any) => /prospect|DM|Write|Publish|Script/.test(t.title))).toBe(false);
    expect(json.tasksCreated).toBe(4);
    expect(storageMock.createContent).not.toHaveBeenCalled();
    expect(storageMock.checkSlotAvailability).toHaveBeenCalled();
  });

  it("resume avec une note : une tâche réécrite qui ferait avancer un jalon verrouillé n'est pas gardée", async () => {
    const { marquer } = await import("./services/marques-jalons");
    storageMock.getCampaign.mockResolvedValue(campagne({ status: "paused", pauseNote: "Décale tout d'une semaine" }));
    claudeMock.callClaudeWithContext.mockResolvedValue(JSON.stringify([task("Plan review", 1), task("Ouvrir les inscriptions", 1)]));
    gardeJalons.marquerTachesDesJalonsVerrouilles.mockImplementationOnce(async (ts: any[]) => { marquer(ts[1]); return 1; });
    await call("resume");
    expect(gardeJalons.marquerTachesDesJalonsVerrouilles.mock.calls[0][1]).toBe("user-1");
    const ecrit = storageMock.updateCampaign.mock.calls.map((c: any[]) => c[2]).find((d: any) => d.generatedTasks);
    expect(ecrit.generatedTasks.map((t: any) => t.title)).toEqual(["Plan review"]);
  });
});

