// Rattrapage des campagnes lancées avant que la production ne dérive des posts (oct. 2026).
//
// 1. Retire les anciennes sous-tâches de contenu : non faites, de type 'content', rattachées
//    à la campagne, SANS post (content_id nul), dont le titre commence par un préfixe anglais
//    de l'ancien `decomposeContentTask`.
// 2. Crée, pour chaque post à venir et non publié, les tâches de production qui manquent
//    (`placerTachesProductionPourCampagne`, idempotent).
//
// À blanc par défaut : rien n'est écrit, le résultat dit ce qui serait fait.
import { estAncienneSousTacheContenu } from "./production";
import { placerTachesProductionPourCampagne, type PlacementDeps } from "./placement";

export interface MigrationProductionDeps {
  placement: PlacementDeps;
  lireTachesCampagne(campaignId: number): Promise<any[]>;
  supprimerTaches(ids: number[]): Promise<number>;
}

export interface ResultatMigration {
  applique: boolean;
  aSupprimer: Array<{ id: number; title: string; scheduledDate: string | null }>;
  aCreer: Array<{ title: string; scheduledDate: string; scheduledTime: string; contentId: number }>;
  supprimees: number;
  creees: number;
}

export function estAncienneTacheAMigrer(t: {
  campaignId?: number | null; contentId?: number | null; completed?: boolean | null; type?: string | null; title?: string | null;
}): boolean {
  return t.campaignId != null
    && t.contentId == null
    && t.completed !== true
    && t.type === "content"
    && estAncienneSousTacheContenu(t.title);
}

export async function migrerProductionCampagne(
  deps: MigrationProductionDeps,
  { userId, campaignId, aujourdhui, appliquer = false }: {
    userId: string; campaignId: number; aujourdhui?: string; appliquer?: boolean;
  },
): Promise<ResultatMigration> {
  const anciennes = (await deps.lireTachesCampagne(campaignId))
    .filter((t) => t.campaignId === campaignId && estAncienneTacheAMigrer(t));
  const idsAnciennes = new Set<number>(anciennes.map((t) => t.id));
  const aSupprimer = anciennes.map((t) => ({ id: t.id, title: t.title, scheduledDate: t.scheduledDate ?? null }));

  const aCreer: ResultatMigration["aCreer"] = [];
  const p = deps.placement;
  // Le placement voit l'agenda tel qu'il sera après la suppression ; à blanc, il n'écrit pas.
  const placement: PlacementDeps = {
    getUserPreferences: (u) => p.getUserPreferences(u),
    getDayAvailabilityRange: (u, a, b) => p.getDayAvailabilityRange(u, a, b),
    getTasksInRange: async (u, a, b) => (await p.getTasksInRange!(u, a, b)).filter((t: any) => !idsAnciennes.has(t.id)),
    checkSlotAvailability: (u, d, t, m) => p.checkSlotAvailability!(u, d, t, m),
    getContent: (u, l, pr, c) => p.getContent!(u, l, pr, c),
    getTasksForContents: (u, ids) => p.getTasksForContents!(u, ids),
    createTask: async (t: any) => {
      aCreer.push({ title: t.title, scheduledDate: t.scheduledDate, scheduledTime: t.scheduledTime, contentId: t.contentId });
      return appliquer ? p.createTask!(t) : t;
    },
  };

  let supprimees = 0;
  if (appliquer && anciennes.length > 0) supprimees = await deps.supprimerTaches(anciennes.map((t) => t.id));

  const { creees } = await placerTachesProductionPourCampagne(placement, {
    userId, campaignId, aujourdhui,
    // À blanc : pas de contrôle de créneau en base (il verrait encore les anciennes tâches).
    controleCreneaux: appliquer,
  });

  return { applique: appliquer, aSupprimer, aCreer, supprimees, creees: appliquer ? creees : 0 };
}
