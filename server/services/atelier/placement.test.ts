import { describe, it, expect, vi } from "vitest";
import { placerTachesProductionPosts } from "../campagne/placement";

const post = (id: number, jour: string, over: any = {}) => ({
  id, userId: "u", projectId: 9, campaignId: 3, title: `Post ${id}`, postFormat: "feed_image", contentType: "post",
  autoPost: false, scheduledFor: new Date(`${jour}T09:00:00`), publishedAt: null, postStatus: "pending",
  contentStatus: "idea", consigne: null, createdAt: new Date("2026-10-01T10:00:00Z"), ...over,
});

function fabrique(posts: any[], over: any = {}) {
  let n = 1000;
  return {
    getUserPreferences: vi.fn(async () => ({ workDays: "mon,tue,wed,thu,fri" })),
    getDayAvailabilityRange: vi.fn(async () => []),
    getTasksInRange: vi.fn(async () => [] as any[]),
    checkSlotAvailability: vi.fn(async () => ({ available: true })),
    createTask: vi.fn(async (t: any) => ({ id: ++n, ...t })),
    updateTask: vi.fn(async (id: number, p: any) => ({ id, ...p })),
    getPostsEntre: vi.fn(async () => posts),
    getTachesAtelier: vi.fn(async () => [] as any[]),
    getTasksForContents: vi.fn(async () => [] as any[]),
    ...over,
  };
}
const creees = (deps: any) => deps.createTask.mock.calls.map(([t]: any[]) => t);
const resume = (deps: any) => creees(deps).map((t: any) => `${t.scheduledDate} ${t.estimatedDuration} ${t.title}`);

describe("placerTachesProductionPosts — l'atelier de la semaine", () => {
  it("une semaine de posts : un atelier et une validation, plus aucune tâche par post", async () => {
    const posts = [post(1, "2026-10-22"), post(2, "2026-10-23"), post(3, "2026-10-23", { postFormat: "text" })];
    const deps = fabrique(posts);
    const r = await placerTachesProductionPosts(deps, { userId: "u", posts, aujourdhui: "2026-10-14" });
    expect(resume(deps)).toEqual([
      "2026-10-19 40 Atelier contenu — semaine du 19 oct.",
      "2026-10-20 11 Valider la semaine — 19 oct.",
    ]);
    const [atelier, validation] = creees(deps);
    expect(atelier).toMatchObject({
      userId: "u", type: "content", taskType: "atelier_contenu", completed: false, canBeFragmented: false,
      actionData: { semaine: "2026-10-19", partie: 1, parties: 1, echeance: "2026-10-21" },
    });
    expect(atelier.contentId).toBeUndefined();
    expect(atelier.scheduledTime).toBe("09:00");
    expect(validation).toMatchObject({ taskType: "atelier_validation", actionData: { semaine: "2026-10-19", echeance: "2026-10-21" } });
    expect(r.creees).toBe(2);
    expect(deps.getTachesAtelier).toHaveBeenCalledWith("u", "2026-10-19");
  });

  it("deux semaines → deux ateliers", async () => {
    const posts = [post(1, "2026-10-22"), post(2, "2026-10-28")];
    const deps = fabrique(posts);
    await placerTachesProductionPosts(deps, { userId: "u", posts, aujourdhui: "2026-10-14" });
    expect(creees(deps).filter((t: any) => t.taskType === "atelier_contenu").map((t: any) => t.actionData.semaine))
      .toEqual(["2026-10-19", "2026-10-26"]);
  });

  it("au-delà de 90 minutes : l'atelier est découpé en parties numérotées", async () => {
    const posts = [1, 2, 3, 4].map((i) => post(i, "2026-10-23", { postFormat: "carousel" }));
    const deps = fabrique(posts);
    await placerTachesProductionPosts(deps, { userId: "u", posts, aujourdhui: "2026-10-14" });
    expect(resume(deps)).toEqual([
      "2026-10-20 90 Atelier contenu — semaine du 19 oct. (1/2)",
      "2026-10-21 30 Atelier contenu — semaine du 19 oct. (2/2)",
      "2026-10-22 13 Valider la semaine — 19 oct.",
    ]);
  });

  it("idempotent : un atelier déjà posé et à la bonne durée n'est ni recréé ni modifié", async () => {
    const posts = [post(1, "2026-10-22")];
    const existant = { id: 7, taskType: "atelier_contenu", completed: false, estimatedDuration: 15, title: "Atelier contenu — semaine du 19 oct.", scheduledTime: "09:00", actionData: { semaine: "2026-10-19", partie: 1, parties: 1, echeance: "2026-10-21" } };
    const validation = { id: 8, taskType: "atelier_validation", completed: false, estimatedDuration: 7, title: "Valider la semaine — 19 oct.", actionData: { semaine: "2026-10-19", echeance: "2026-10-21" } };
    const deps = fabrique(posts, { getTachesAtelier: vi.fn(async () => [existant, validation]) });
    const r = await placerTachesProductionPosts(deps, { userId: "u", posts, aujourdhui: "2026-10-14" });
    expect(deps.createTask).not.toHaveBeenCalled();
    expect(deps.updateTask).not.toHaveBeenCalled();
    expect(r.creees).toBe(0);
  });

  it("un post ajouté avant l'atelier en allonge la durée (et celle de la validation)", async () => {
    const posts = [post(1, "2026-10-22"), post(2, "2026-10-23")];
    const existant = { id: 7, taskType: "atelier_contenu", completed: false, estimatedDuration: 15, title: "Atelier contenu — semaine du 19 oct.", scheduledTime: "10:00", actionData: { semaine: "2026-10-19", partie: 1, parties: 1, echeance: "2026-10-21" } };
    const validation = { id: 8, taskType: "atelier_validation", completed: false, estimatedDuration: 7, title: "Valider la semaine — 19 oct.", scheduledTime: null, actionData: { semaine: "2026-10-19", echeance: "2026-10-21" } };
    const deps = fabrique(posts, { getTachesAtelier: vi.fn(async () => [existant, validation]) });
    await placerTachesProductionPosts(deps, { userId: "u", posts, aujourdhui: "2026-10-14" });
    expect(deps.createTask).not.toHaveBeenCalled();
    expect(deps.updateTask).toHaveBeenCalledWith(7, expect.objectContaining({ estimatedDuration: 30, scheduledEndTime: "10:30" }));
    expect(deps.updateTask).toHaveBeenCalledWith(8, expect.objectContaining({ estimatedDuration: 9 }));
  });

  it("atelier déjà fait : un post créé après lui ouvre un atelier de rattrapage, sans validation", async () => {
    const posts = [post(1, "2026-10-22", { contentStatus: "ready" }), post(2, "2026-10-23", { createdAt: new Date("2026-10-19T15:00:00Z") })];
    const fait = { id: 7, taskType: "atelier_contenu", completed: true, completedAt: new Date("2026-10-19T11:00:00Z"), estimatedDuration: 15, actionData: { semaine: "2026-10-19", partie: 1, parties: 1 } };
    const deps = fabrique(posts, { getTachesAtelier: vi.fn(async () => [fait]) });
    await placerTachesProductionPosts(deps, { userId: "u", posts: [posts[1]], aujourdhui: "2026-10-20" });
    expect(resume(deps)).toEqual(["2026-10-20 15 Atelier contenu — semaine du 19 oct. (rattrapage)"]);
    expect(creees(deps)[0].actionData).toMatchObject({ semaine: "2026-10-19", rattrapage: true, echeance: "2026-10-22" });
  });

  it("atelier déjà fait : un post non validé mais déjà là avant ne relance rien", async () => {
    const posts = [post(1, "2026-10-22")];
    const fait = { id: 7, taskType: "atelier_contenu", completed: true, completedAt: new Date("2026-10-19T11:00:00Z"), actionData: { semaine: "2026-10-19" } };
    const deps = fabrique(posts, { getTachesAtelier: vi.fn(async () => [fait]) });
    await placerTachesProductionPosts(deps, { userId: "u", posts, aujourdhui: "2026-10-20" });
    expect(deps.createTask).not.toHaveBeenCalled();
  });

  it("posts validés, programmés ou publiés : pas d'atelier", async () => {
    const posts = [post(1, "2026-10-22", { contentStatus: "ready" }), post(2, "2026-10-22", { autoPost: true }), post(3, "2026-10-22", { postStatus: "posted" })];
    const deps = fabrique(posts);
    await placerTachesProductionPosts(deps, { userId: "u", posts, aujourdhui: "2026-10-14" });
    expect(deps.createTask).not.toHaveBeenCalled();
  });

  it("un post qui suit encore l'ancien parcours (étape d'écran non faite) n'entre pas dans l'atelier", async () => {
    const posts = [post(1, "2026-10-22"), post(2, "2026-10-22")];
    const liees = [{ contentId: 1, title: "Rédiger le texte — Post 1", completed: false, archivedAt: null }];
    const deps = fabrique(posts, { getTasksForContents: vi.fn(async () => liees) });
    await placerTachesProductionPosts(deps, { userId: "u", posts, aujourdhui: "2026-10-14" });
    expect(resume(deps)[0]).toBe("2026-10-19 15 Atelier contenu — semaine du 19 oct.");
  });

  it("seulement des posts manuels (hors campagne) : pas d'atelier ; avec un post de campagne, ils comptent", async () => {
    const manuels = [post(1, "2026-10-22", { campaignId: null })];
    const d1 = fabrique(manuels);
    await placerTachesProductionPosts(d1, { userId: "u", posts: manuels, aujourdhui: "2026-10-14" });
    expect(d1.createTask).not.toHaveBeenCalled();

    const mixtes = [...manuels, post(2, "2026-10-23")];
    const d2 = fabrique(mixtes);
    await placerTachesProductionPosts(d2, { userId: "u", posts: [mixtes[1]], aujourdhui: "2026-10-14" });
    expect(resume(d2)[0]).toBe("2026-10-19 30 Atelier contenu — semaine du 19 oct.");
  });

  it("vidéo : Tourner et Monter restent des tâches du post, jamais avant l'atelier ; pas de doublon au 2e passage", async () => {
    const posts = [post(1, "2026-10-23", { postFormat: "reel" })];
    const deps = fabrique(posts);
    await placerTachesProductionPosts(deps, { userId: "u", posts, aujourdhui: "2026-10-14" });
    const t = creees(deps);
    expect(t.map((x: any) => `${x.scheduledDate} ${x.title}`)).toEqual([
      "2026-10-20 Atelier contenu — semaine du 19 oct.",
      "2026-10-21 Valider la semaine — 19 oct.",
      "2026-10-20 Tourner — Post 1",
      "2026-10-21 Monter — Post 1",
    ]);
    expect(t[2]).toMatchObject({ contentId: 1, type: "content", source: "campaign" });

    const deps2 = fabrique(posts, {
      getTasksForContents: vi.fn(async () => [{ contentId: 1, title: "Tourner — Post 1", completed: false }, { contentId: 1, title: "Monter — Post 1", completed: false }]),
    });
    await placerTachesProductionPosts(deps2, { userId: "u", posts, aujourdhui: "2026-10-14" });
    expect(creees(deps2).map((x: any) => x.title).filter((x: string) => !x.startsWith("Atelier") && !x.startsWith("Valider"))).toEqual([]);
  });

  it("un post passé ou sans date : rien", async () => {
    const posts = [post(1, "2026-10-01")];
    const deps = fabrique(posts);
    const r = await placerTachesProductionPosts(deps, { userId: "u", posts, aujourdhui: "2026-10-14" });
    expect(r.creees).toBe(0);
    expect(deps.getPostsEntre).not.toHaveBeenCalled();
  });
});
