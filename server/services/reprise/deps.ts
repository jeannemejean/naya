// Reprise des tâches non faites — branchement réel (base, contexte, modèle).
import type { DepsAnnulation, DepsReprise } from "./index";
import { SCHEMA_REPRISE, SYSTEME_REPRISE, promptReprise } from "./decision";
import { SCHEMA_POSTS, SYSTEME_POSTS, promptPosts, type Campagne } from "./posts";

export async function depsReprise(): Promise<DepsReprise> {
  const { storage } = await import("../../storage");
  const s = storage as any;
  return {
    getUserPreferences: (u) => s.getUserPreferences(u),
    getDayAvailabilityRange: (u, a, b) => s.getDayAvailabilityRange(u, a, b),
    getTasksInRange: (u, a, b) => s.getTasksInRange(u, a, b),
    checkSlotAvailability: (u, d, h, m) => s.checkSlotAvailability(u, d, h, m),
    updateTask: (id, p) => s.updateTask(id, p),
    createTask: (t) => s.createTask(t),
    getContentById: (id, u) => s.getContentById(id, u),
    getPostsEntre: (u, a, b) => s.getPostsEntre(u, a, b),
    getTachesAtelier: (u, semaine) => s.getTachesAtelier(u, semaine),
    fixOverlappingTasks: (u, d) => s.fixOverlappingTasks(u, d),
    ajouterReprises: (l) => s.ajouterReprises(l),
    getTasksForContents: (u, ids) => s.getTasksForContents(u, ids),
    updateContent: (id, p) => s.updateContent(id, p),
    async campagnes(userId) {
      const m = new Map<number, Campagne>();
      for (const c of await s.getCampaigns(userId)) m.set(c.id, { name: c.name, startDate: c.startDate ?? null, endDate: c.endDate ?? null });
      return m;
    },
    async placerAteliers(userId, posts, aujourdhui) {
      const { placerTachesProductionPosts } = await import("../campagne/placement");
      return placerTachesProductionPosts(storage as any, { userId, posts, aujourdhui });
    },
    async deciderPosts(userId, entree) {
      const [{ isAiBlocked }, { genererStructure }, { CLAUDE_MODELS }] = await Promise.all([
        import("../usage"), import("../ai/structure"), import("../claude"),
      ]);
      if (await isAiBlocked(userId)) return null;
      const jourParis = (d: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(d));
      const { valeur } = await genererStructure({
        schema: SCHEMA_POSTS, system: SYSTEME_POSTS, model: CLAUDE_MODELS.smart, maxTokens: 3000,
        taskKind: "strategic_reasoning", etape: "reprise des posts jamais partis", userId,
        prompt: promptPosts({ ...entree, jourDe: (p) => jourParis(p.scheduledFor) }),
      });
      return valeur;
    },
    async evenementsAgenda(userId, debut, fin) {
      const { getCalendarEvents } = await import("../google-calendar");
      return getCalendarEvents(userId, debut, fin);
    },
    async libelles(userId) {
      const projets = new Map<number, string>();
      const objectifs = new Map<number, string>();
      for (const p of await s.getProjects(userId, 200)) {
        projets.set(p.id, p.name);
        for (const g of await s.getProjectGoals(p.id).catch(() => [])) {
          objectifs.set(g.id, `${g.title}${g.dueDate ? ` (échéance ${new Date(g.dueDate).toISOString().slice(0, 10)})` : ""}`);
        }
      }
      return { projets, objectifs };
    },
    async decider(userId, entree) {
      const [{ isAiBlocked }, { buildNayaContext }, { genererStructure }, { CLAUDE_MODELS }] = await Promise.all([
        import("../usage"), import("../naya-context"), import("../ai/structure"), import("../claude"),
      ]);
      if (await isAiBlocked(userId)) return null;
      const contexte = await buildNayaContext(userId, null, "Reprendre les tâches non faites au regard des objectifs");
      const { valeur } = await genererStructure({
        schema: SCHEMA_REPRISE, system: SYSTEME_REPRISE, model: CLAUDE_MODELS.smart, maxTokens: 8000,
        taskKind: "strategic_reasoning", etape: "reprise des tâches non faites", userId,
        prompt: promptReprise({ ...entree, contexte }),
      });
      return valeur;
    },
  };
}

export async function depsAnnulation(): Promise<DepsAnnulation> {
  const { storage } = await import("../../storage");
  const s = storage as any;
  return {
    getReprise: (id, u) => s.getReprise(id, u),
    marquerRepriseAnnulee: (id, u) => s.marquerRepriseAnnulee(id, u),
    getTask: (id) => s.getTask(id),
    updateTask: (id, p) => s.updateTask(id, p),
    fixOverlappingTasks: (u, d) => s.fixOverlappingTasks(u, d),
    getContentById: (id, u) => s.getContentById(id, u),
    updateContent: (id, p) => s.updateContent(id, p),
  };
}
