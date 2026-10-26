import { describe, it, expect, vi } from "vitest";
import { reprendreTaches, annulerReprise, vueReprises, type DepsReprise } from "./index";
import type { SortieReprise } from "./decision";

const AUJ = "2026-10-26"; // lundi
const DEMAIN = "2026-10-27";

/** Une base en mémoire : assez pour rejouer un passage de reprise de bout en bout. */
function base(taches: any[], { posts = [] as any[], avis = null as SortieReprise | null | Error, avisPosts = null as any } = {}) {
  const t = new Map<number, any>(taches.map((x) => [x.id, { completed: false, archivedAt: null, ...x }]));
  let prochainId = 1000;
  const journal: any[] = [];
  const decider = vi.fn(async () => { if (avis instanceof Error) throw avis; return avis; });
  const deps: DepsReprise = {
    getUserPreferences: async () => ({ planningStatus: "active", workDays: "mon,tue,wed,thu,fri", workDayStart: "09:00", workDayEnd: "18:00" }),
    getDayAvailabilityRange: async () => [],
    checkSlotAvailability: async () => ({ available: true }),
    getTasksInRange: async (_u, a, b) => Array.from(t.values()).filter((x) => !x.archivedAt && x.scheduledDate >= a && x.scheduledDate <= b),
    updateTask: async (id, p) => { t.set(id, { ...t.get(id), ...p }); return t.get(id); },
    createTask: async (x) => { const n = { ...x, id: prochainId++ }; t.set(n.id, n); return n; },
    getContentById: async (id) => posts.find((p) => p.id === id),
    updateContent: async (id, patch) => { const p = posts.find((x) => x.id === id); Object.assign(p, patch); return p; },
    getTasksForContents: async (_u, ids) => Array.from(t.values()).filter((x) => ids.includes(x.contentId)),
    campagnes: async () => new Map([[8, { name: "Halloween", endDate: "2026-10-31" }]]),
    deciderPosts: async () => (avisPosts instanceof Error ? Promise.reject(avisPosts) : avisPosts),
    placerAteliers: vi.fn(async () => ({ creees: 0 })),
    getPostsEntre: async (_u, a, b) => posts.filter((p) => new Date(p.scheduledFor) >= a && new Date(p.scheduledFor) < b),
    getTachesAtelier: async (_u, s) => Array.from(t.values()).filter((x) => !x.archivedAt && (x.actionData as any)?.semaine === s),
    fixOverlappingTasks: async () => 0,
    ajouterReprises: async (l) => { journal.push(...l.map((x, i) => ({ ...x, id: journal.length + i + 1, annuleeAt: null }))); },
    libelles: async () => ({ projets: new Map([[3, "Agence JMD"]]), objectifs: new Map() }),
    decider,
  };
  return { deps, t, journal, decider };
}
const opts = { userId: "u", aujourdhui: AUJ, cible: DEMAIN, inclureAujourdhui: true };

describe("reprendreTaches", () => {
  it("le cas du 26 oct. : l'atelier d'une semaine passée s'archive, la validation repasse après l'atelier", async () => {
    const { deps, t, journal } = base([
      { id: 922, title: "Atelier contenu — semaine du 12 oct.", taskType: "atelier_contenu", scheduledDate: AUJ, scheduledTime: "10:21", estimatedDuration: 60, actionData: { semaine: "2026-10-12", partie: 1 } },
      { id: 925, title: "Atelier contenu — semaine du 26 oct.", taskType: "atelier_contenu", scheduledDate: "2026-10-28", scheduledTime: "10:00", estimatedDuration: 60, actionData: { semaine: "2026-10-26", partie: 1 } },
      { id: 926, title: "Valider la semaine — 26 oct.", taskType: "atelier_validation", scheduledDate: DEMAIN, scheduledTime: "10:00", estimatedDuration: 20, actionData: { semaine: "2026-10-26" } },
    ], { posts: [{ id: 50, scheduledFor: "2026-10-30T09:00:00Z", consigne: "x", campaignId: 1 }] });

    await reprendreTaches(deps, opts);

    expect(t.get(922)!.archivedAt).toBeInstanceOf(Date);
    expect(t.get(925)!.scheduledDate).toBe("2026-10-28");
    expect(t.get(926)!.scheduledDate).toBe("2026-10-29");
    expect(journal.map((l) => [l.taskId, l.action])).toEqual([[922, "perimee"], [926, "replacer"]]);
  });

  it("un rituel manqué et l'étape d'un post déjà parti s'archivent ; « Publier » va le jour du post", async () => {
    const { deps, t } = base([
      { id: 1, title: "Revue du lundi", ritualId: 7, scheduledDate: AUJ },
      { id: 2, title: "Préparer le visuel — Halloween", contentId: 196, scheduledDate: AUJ },
      { id: 3, title: "Publier — Coulisses", contentId: 197, scheduledDate: AUJ, estimatedDuration: 15 },
    ], { posts: [
      { id: 196, scheduledFor: "2026-10-13T14:00:00Z", publishedAt: new Date("2026-10-13T14:53:00Z") },
      { id: 197, scheduledFor: "2026-10-29T09:00:00Z" },
    ] });

    await reprendreTaches(deps, { ...opts, ia: false });

    expect(t.get(1)!.archivedAt).toBeInstanceOf(Date);
    expect(t.get(2)!.archivedAt).toBeInstanceOf(Date);
    expect(t.get(3)!.scheduledDate).toBe("2026-10-29");
  });

  it("Naya découpe une tâche reportée : les sous-tâches se suivent, l'originale est archivée", async () => {
    const { deps, t, journal, decider } = base([
      { id: 10, title: "Refaire le site", scheduledDate: AUJ, estimatedDuration: 240, learnedAdjustmentCount: 4, projectId: 3, priority: 2, type: "admin", category: "planning", source: "auto" },
    ], { avis: { taches: [{
      id: 10, action: "decouper", titre: null, description: null, duree: null, fusionAvec: [], priorite: 1, auPlusTard: "2026-10-30",
      sousTaches: [{ titre: "Lister les pages", description: null, duree: 30 }, { titre: "Rédiger l'accueil", description: null, duree: 60 }],
      raison: "Reportée 4 fois : trop grosse, je l'ai découpée.",
    }] } });

    const bilan = await reprendreTaches(deps, opts);

    expect(decider).toHaveBeenCalledOnce();
    expect(decider.mock.calls[0][1].taches[0]).toMatchObject({ id: 10, projet: "Agence JMD", learnedAdjustmentCount: 4 });
    expect(t.get(10)!.archivedAt).toBeInstanceOf(Date);
    const creees = Array.from(t.values()).filter((x) => x.id >= 1000);
    expect(creees.map((x) => [x.title, x.source, x.projectId])).toEqual([["Lister les pages", "replan", 3], ["Rédiger l'accueil", "replan", 3]]);
    expect(creees[0].scheduledDate <= creees[1].scheduledDate).toBe(true);
    expect(creees.every((x) => x.scheduledDate >= DEMAIN && x.scheduledDate <= "2026-10-30")).toBe(true);
    expect(bilan).toMatchObject({ creees: 2, modifiees: 1 });
    expect(journal.at(-1)).toMatchObject({ taskId: 10, action: "decouper", apres: { sousTaches: ["Lister les pages", "Rédiger l'accueil"] } });
  });

  it("sans avis de Naya, rien ne se perd : tout est replacé à partir de demain, une « auto » devient « replan »", async () => {
    const { deps, t } = base([
      { id: 20, title: "Relancer Imetik", scheduledDate: AUJ, estimatedDuration: 30, source: "auto", learnedAdjustmentCount: 1 },
    ], { avis: new Error("API indisponible") });

    const bilan = await reprendreTaches(deps, opts);

    expect(bilan.replacees).toBe(1);
    expect(t.get(20)).toMatchObject({ scheduledDate: DEMAIN, source: "replan", learnedAdjustmentCount: 2, archivedAt: null });
  });

  it("fusion et abandon : les tâches sortent du planning, archivées, jamais supprimées", async () => {
    const { deps, t, journal } = base([
      { id: 30, title: "Écrire à Léa", scheduledDate: AUJ },
      { id: 31, title: "Relancer Léa par mail", scheduledDate: AUJ },
      { id: 32, title: "Publier le brouillon LinkedIn de ce matin", scheduledDate: "2026-10-01", learnedAdjustmentCount: 80 },
    ], { avis: { taches: [
      { id: 30, action: "fusionner", titre: "Relancer Léa (mail)", description: null, duree: 20, sousTaches: [], fusionAvec: [31], priorite: 1, auPlusTard: null, raison: "Deux fois la même relance." },
      { id: 32, action: "abandonner", titre: null, description: null, duree: null, sousTaches: [], fusionAvec: [], priorite: 3, auPlusTard: null, raison: "Ce brouillon n'existe plus." },
    ] } });

    await reprendreTaches(deps, opts);

    expect(t.get(30)).toMatchObject({ title: "Relancer Léa (mail)", estimatedDuration: 20, scheduledDate: DEMAIN });
    expect(t.get(31)!.archivedAt).toBeInstanceOf(Date);
    expect(t.get(32)!.archivedAt).toBeInstanceOf(Date);
    expect(journal.map((l) => l.action).sort()).toEqual(["abandonner", "fusionnee", "fusionner"]);
  });

  it("posts jamais partis : Naya en reprogramme un (à son heure), en retire un autre avec ses étapes", async () => {
    const posts = [
      { id: 216, title: "Sélection chromatique automne", platform: "instagram", campaignId: 8, scheduledFor: new Date("2026-10-14T09:00:00Z"), contentStatus: "ready" },
      { id: 199, title: "Trop beau — Halloween", platform: "TikTok", campaignId: 8, scheduledFor: new Date("2026-10-19T09:00:00Z"), contentStatus: "draft" },
      { id: 300, title: "Déjà publié", platform: "instagram", scheduledFor: new Date("2026-10-15T09:00:00Z"), publishedAt: new Date() },
    ];
    const { deps, t, journal } = base(
      [{ id: 60, title: "Tourner — Trop beau", contentId: 199, scheduledDate: AUJ }],
      { posts, avisPosts: { posts: [
        { id: 216, action: "reprogrammer", jour: "2026-10-28", raison: "Toujours dans le ton de la campagne." },
        { id: 199, action: "retirer", jour: null, raison: "Trop tard pour le tourner avant Halloween." },
      ] } },
    );

    const bilan = await reprendreTaches(deps, opts);

    expect(bilan).toMatchObject({ postsReprogrammes: 1, postsRetires: 1 });
    expect(posts[0].scheduledFor.toISOString()).toBe("2026-10-28T10:00:00.000Z"); // 11 h à Paris, comme avant (passée à l'heure d'hiver)
    expect(posts[1].scheduledFor).toBeNull();
    expect(t.get(60)!.archivedAt).toBeInstanceOf(Date);
    expect(journal.filter((l) => l.taskId === 60)).toHaveLength(0); // archivée avec son post, pas en double
    expect(journal.filter((l) => l.contentId).map((l) => [l.contentId, l.action])).toEqual([[216, "post_reprogramme"], [199, "post_retire"]]);
    expect(deps.placerAteliers).toHaveBeenCalledWith("u", [expect.objectContaining({ id: 216 })], AUJ);
  });

  it("planification en pause : rien ne bouge", async () => {
    const { deps, t } = base([{ id: 40, title: "x", scheduledDate: AUJ }]);
    deps.getUserPreferences = async () => ({ planningStatus: "paused" });
    await reprendreTaches(deps, opts);
    expect(t.get(40)!.scheduledDate).toBe(AUJ);
  });
});

describe("annulerReprise", () => {
  function depsAnnul(ligne: any, taches: Record<number, any>) {
    const t = new Map<number, any>(Object.entries(taches).map(([k, v]) => [Number(k), v]));
    return {
      t,
      deps: {
        getReprise: async () => ligne,
        marquerRepriseAnnulee: vi.fn(async () => {}),
        getTask: async (id: number) => t.get(id),
        updateTask: async (id: number, p: any) => { t.set(id, { ...t.get(id), ...p }); },
        fixOverlappingTasks: vi.fn(async () => 0),
      },
    };
  }

  it("défaire un découpage : les sous-tâches non faites s'archivent, l'originale revient", async () => {
    const { deps, t } = depsAnnul(
      { id: 1, taskId: 10, action: "decouper", annuleeAt: null, avant: { title: "Refaire le site" }, apres: { scheduledDate: "2026-10-28", creees: [1000, 1001] } },
      { 10: { userId: "u", archivedAt: new Date() }, 1000: { userId: "u", completed: false }, 1001: { userId: "u", completed: true } },
    );
    expect(await annulerReprise(deps, "u", 1, AUJ)).toBe(true);
    expect(t.get(10)).toMatchObject({ archivedAt: null, scheduledDate: "2026-10-28" });
    expect(t.get(1000)!.archivedAt).toBeInstanceOf(Date);
    expect(t.get(1001)!.archivedAt).toBeUndefined(); // faite : on n'y touche pas
    expect(deps.marquerRepriseAnnulee).toHaveBeenCalled();
  });

  it("restaurer une tâche abandonnée la remet au plus tôt aujourd'hui", async () => {
    const { deps, t } = depsAnnul(
      { id: 2, taskId: 32, action: "abandonner", annuleeAt: null, avant: { scheduledDate: "2026-07-01" }, apres: {} },
      { 32: { userId: "u", archivedAt: new Date() } },
    );
    await annulerReprise(deps, "u", 2, AUJ);
    expect(t.get(32)).toMatchObject({ archivedAt: null, scheduledDate: AUJ, scheduledTime: null });
  });

  it("défaire une reformulation rend le titre d'origine", async () => {
    const { deps, t } = depsAnnul(
      { id: 3, taskId: 5, action: "reformuler", annuleeAt: null, avant: { title: "Ancien", description: "d", estimatedDuration: 45 }, apres: { title: "Nouveau" } },
      { 5: { userId: "u", title: "Nouveau" } },
    );
    await annulerReprise(deps, "u", 3, AUJ);
    expect(t.get(5)).toMatchObject({ title: "Ancien", description: "d", estimatedDuration: 45 });
  });

  it("restaurer un post retiré : il revient demain à son heure, ses étapes avec lui", async () => {
    const { deps, t } = depsAnnul(
      { id: 6, taskId: null, contentId: 199, action: "post_retire", annuleeAt: null, avant: { scheduledFor: "2026-10-19T09:00:00.000Z" }, apres: { tachesArchivees: [60] } },
      { 60: { userId: "u", archivedAt: new Date() } },
    );
    const posts: Record<number, any> = { 199: {} };
    (deps as any).updateContent = async (id: number, p: any) => Object.assign(posts[id], p);
    expect(await annulerReprise(deps, "u", 6, AUJ)).toBe(true);
    expect(posts[199].scheduledFor.toISOString()).toBe("2026-10-27T10:00:00.000Z"); // 11 h à Paris, le 27
    expect(t.get(60)).toMatchObject({ archivedAt: null, scheduledDate: AUJ });
  });

  it("un simple replacement, ou une ligne déjà annulée, ne se défait pas", async () => {
    expect(await annulerReprise(depsAnnul({ id: 4, action: "replacer", annuleeAt: null }, {}).deps, "u", 4, AUJ)).toBe(false);
    expect(await annulerReprise(depsAnnul({ id: 5, action: "abandonner", annuleeAt: new Date() }, {}).deps, "u", 5, AUJ)).toBe(false);
  });
});

describe("vueReprises", () => {
  it("sépare les changements des simples replacements et montre l'ancien titre", () => {
    const v = vueReprises([
      { id: 1, action: "reformuler", raison: "Plus clair.", avant: { title: "Site" }, apres: { title: "Rédiger l'accueil du site", scheduledDate: DEMAIN }, annuleeAt: null },
      { id: 2, action: "replacer", raison: "", avant: { title: "Appeler" }, apres: { title: "Appeler", scheduledDate: DEMAIN }, annuleeAt: null },
      { id: 3, action: "abandonner", raison: "Dépassée.", avant: { title: "Vieux" }, apres: { title: "Vieux", scheduledDate: AUJ, archive: true }, annuleeAt: null },
    ] as any);
    expect(v.changements.map((c) => [c.id, c.titreAvant, c.jour, c.annulable])).toEqual([[1, "Site", DEMAIN, true], [3, null, null, true]]);
    expect(v.replacees.map((c) => [c.id, c.annulable])).toEqual([[2, false]]);
  });
});
