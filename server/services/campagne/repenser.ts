// « Repenser la campagne » : garder le cadre (nom, objectif, durée, marque, dates,
// articulation, statut), refaire la stratégie, le plan de contenu et les tâches avec le
// savoir déposé, les préférences de la marque et, si fournie, la consigne de l'utilisatrice.
//
// Ordre (spec 2026-10-07) :
//   verrou → contrôles (404 / 409) → génération (3 étapes, 240 s chacune, HORS transaction)
//   → validation → UNE transaction (mise à jour de la campagne, suppression des posts non
//   publiés et non en cours, suppression des tâches non faites) → placement si active/paused
//   → fixOverlappingTasks → relâche du verrou (finally).
//
// Rien n'est écrit tant que les trois générations n'ont pas réussi. Les posts publiés (ou en
// cours de publication) et les tâches faites restent rattachés à la campagne.
import { CampagneIntrouvable, tacheEstFaite } from "../campaign-reject/rejeter";
import { estPublieOuEnCours } from "../refus-post/pur";
import { placerTachesCampagne, placerPostsCampagne, type PlacementDeps } from "./placement";
import { formatDate, addDays } from "../../utils/dateUtils";
import type { CampaignGenerationRequest, CampaignStrategy, GeneratedCampaign } from "../openai";
import type { Articulation } from "../brand-links/links";
import type { Preference } from "../campaign-reject/preferences";

export { CampagneIntrouvable };

// ─── Erreurs typées (reconnues par `instanceof` dans routes.ts) ──────────────

export class StatutIncompatible extends Error {
  constructor(public statut: string | null) {
    super(`Statut « ${statut} » : la campagne ne peut pas être repensée`);
  }
}

export class GenerationEchouee extends Error {
  constructor(public etape: "contexte" | "strategie" | "contenu" | "taches", public cause?: unknown) {
    super(`Génération échouée (${etape}) : ${(cause as any)?.message ?? cause ?? "réponse invalide"}`);
  }
}

export class DejaEnCours extends Error {
  constructor(campaignId: number) {
    super(`La campagne ${campaignId} est déjà en train d'être repensée`);
  }
}

/** Le plan et les suppressions sont validés ; seul le placement a échoué. */
export class PlacementEchoue extends Error {
  constructor(public partiel: { postsSupprimes: number; tachesSupprimees: number }, public cause?: unknown) {
    super(`Placement échoué : ${(cause as any)?.message ?? cause}`);
  }
}

// ─── Types et dépendances ────────────────────────────────────────────────────

export const STATUTS_REPENSABLES = ["draft", "active", "paused"] as const;
export const CONSIGNE_MAX = 1000;
export const DELAI_GENERATION_MS = 240_000;

export const DUREE_JOURS: Record<string, number> = {
  '1_week': 7, '2_weeks': 14, '3_weeks': 21, '1_month': 30,
  '2_months': 60, '3_months': 90, '6_months': 180, '12_months': 365,
};

export interface CampagneRepensable {
  id: number;
  userId?: string;
  projectId?: number | null;
  name: string;
  objective: string;
  duration?: string | null;
  status?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  articuleAvecCampaignId?: number | null;
  articulationIndependante?: boolean | null;
  [k: string]: unknown;
}

export interface ContenuLu {
  id: number;
  publishedAt: Date | null;
  postStatus: string | null;
  contentStatus: string | null;
}

export interface TacheLue {
  id: number;
  completed: boolean;
}

export interface ContexteGeneration {
  brandDna: CampaignGenerationRequest["brandDna"];
  preferences: Preference[];
  savoir?: string;
  articulation?: Articulation;
  /** Revues des campagnes passées, ajoutées au contexte de la stratégie seulement
   *  (comme `/generate/strategy`). */
  revuesPassees?: string;
}

/** Champs remplacés par repenser — et seulement ceux-là. */
export interface ChampsRepenses {
  coreMessage: string;
  targetAudience: string;
  audienceSegment: string;
  campaignType: string;
  insights: unknown;
  phases: unknown;
  messagingFramework: unknown;
  channels: unknown;
  kpis: unknown;
  contentPlan: unknown;
  generatedTasks: unknown;
}

/** Opérations disponibles DANS la transaction ; toutes scopées userId + campaignId. */
export interface OperationsTransaction {
  lireContenus(userId: string, campaignId: number): Promise<ContenuLu[]>;
  lireTaches(userId: string, campaignId: number): Promise<TacheLue[]>;
  /** Rend faux si la campagne n'existe plus (aucune ligne mise à jour). */
  mettreAJourCampagne(userId: string, campaignId: number, champs: ChampsRepenses): Promise<boolean>;
  supprimerContenus(userId: string, campaignId: number, ids: number[]): Promise<number>;
  supprimerTaches(userId: string, campaignId: number, ids: number[]): Promise<number>;
}

export interface RepenserDeps {
  getCampaign(id: number, userId: string): Promise<CampagneRepensable | undefined>;
  lireContenus(userId: string, campaignId: number): Promise<ContenuLu[]>;
  lireTaches(userId: string, campaignId: number): Promise<TacheLue[]>;
  contexteGeneration(userId: string, campaign: CampagneRepensable): Promise<ContexteGeneration>;
  genererStrategie(req: CampaignGenerationRequest): Promise<CampaignStrategy>;
  genererContenu(req: CampaignGenerationRequest, strategy: CampaignStrategy): Promise<GeneratedCampaign["contentPlan"]>;
  genererTaches(req: CampaignGenerationRequest, strategy: CampaignStrategy): Promise<GeneratedCampaign["tasks"]>;
  transaction<T>(fn: (ops: OperationsTransaction) => Promise<T>): Promise<T>;
  placement: PlacementDeps;
  fixOverlappingTasks(userId: string, fromDate: string): Promise<unknown>;
  aujourdhuiParis(): string;
  /** Délai par étape de génération (défaut 240 s) — réduit dans les tests. */
  delaiGenerationMs?: number;
}

// ─── Pur ─────────────────────────────────────────────────────────────────────

/** Un post est gardé s'il est publié (n'importe quel signal) ou en cours de publication. */
export function contenuGarde(c: ContenuLu): boolean {
  return estPublieOuEnCours(c);
}

export function trierPourRepenser(contenus: ContenuLu[], taches: TacheLue[]) {
  return {
    contenusGardes: contenus.filter(contenuGarde).map((c) => c.id),
    contenusPartants: contenus.filter((c) => !contenuGarde(c)).map((c) => c.id),
    tachesGardees: taches.filter(tacheEstFaite).map((t) => t.id),
    tachesPartantes: taches.filter((t) => !tacheEstFaite(t)).map((t) => t.id),
  };
}

/** Consigne trimée ; vide ou faite d'espaces = absente. La longueur est contrôlée par la route. */
export function normaliserConsigne(consigne: unknown): string | undefined {
  if (typeof consigne !== "string") return undefined;
  const c = consigne.trim();
  return c ? c : undefined;
}

/**
 * Fenêtre de placement `[max(aujourd'hui Paris, startDate) ; endDate]`, en 'YYYY-MM-DD'.
 * Sans endDate (campagne ancienne) : début de campagne (ou aujourd'hui) + durée.
 * `vide` quand la fin est passée.
 */
export function fenetrePlacement(
  campaign: Pick<CampagneRepensable, "startDate" | "endDate" | "duration">,
  aujourdhui: string,
): { debut: string; fin: string; vide: boolean } {
  const start = campaign.startDate || aujourdhui;
  const debut = start > aujourdhui ? start : aujourdhui;
  const fin = campaign.endDate
    || formatDate(addDays(new Date(start + "T00:00:00"), DUREE_JOURS[campaign.duration || "3_months"] || 90));
  return { debut, fin, vide: fin < debut };
}

function avecDelai<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`délai dépassé (${Math.round(ms / 1000)} s)`)), ms);
  });
  return Promise.race([p, delai]).finally(() => clearTimeout(timer));
}

// ─── Aperçu ──────────────────────────────────────────────────────────────────

export async function apercuRepenser(deps: RepenserDeps, userId: string, campaignId: number) {
  const campaign = await deps.getCampaign(campaignId, userId);
  if (!campaign) throw new CampagneIntrouvable(campaignId);
  const tri = trierPourRepenser(
    await deps.lireContenus(userId, campaignId),
    await deps.lireTaches(userId, campaignId),
  );
  return {
    postsRemplaces: tri.contenusPartants.length,
    postsConserves: tri.contenusGardes.length,
    tachesRemplacees: tri.tachesPartantes.length,
    tachesConservees: tri.tachesGardees.length,
  };
}

// ─── Action ──────────────────────────────────────────────────────────────────

/** Verrou en mémoire, par (utilisateur, campagne) : une autre utilisatrice ne peut ni le
 *  prendre ni en déduire l'existence d'une campagne qui n'est pas la sienne. */
const verrous = new Set<string>();

export interface ResultatRepenser {
  postsCrees: number;
  tachesCreees: number;
  postsSupprimes: number;
  tachesSupprimees: number;
}

export async function repenserCampagne(
  deps: RepenserDeps,
  userId: string,
  campaignId: number,
  opts: { consigne?: string } = {},
): Promise<ResultatRepenser> {
  const cle = `${userId}:${campaignId}`;
  if (verrous.has(cle)) throw new DejaEnCours(campaignId);
  verrous.add(cle);
  try {
    // 1. Contrôles
    const campaign = await deps.getCampaign(campaignId, userId);
    if (!campaign) throw new CampagneIntrouvable(campaignId);
    const statut = campaign.status ?? "draft";
    if (!(STATUTS_REPENSABLES as readonly string[]).includes(statut)) throw new StatutIncompatible(campaign.status ?? null);

    // 2. Génération — rien n'est écrit avant qu'elle ait entièrement réussi.
    const delai = deps.delaiGenerationMs ?? DELAI_GENERATION_MS;
    const consigne = normaliserConsigne(opts.consigne);

    let ctx: ContexteGeneration;
    try {
      ctx = await deps.contexteGeneration(userId, campaign);
    } catch (e) {
      throw new GenerationEchouee("contexte", e);
    }
    const base: CampaignGenerationRequest = {
      userId,
      projectId: campaign.projectId ?? undefined,
      objective: campaign.objective,
      duration: campaign.duration || "3_months",
      brandDna: ctx.brandDna,
      preferences: ctx.preferences,
      ...(ctx.savoir ? { savoir: ctx.savoir } : {}),
      ...(ctx.articulation ? { articulation: ctx.articulation } : {}),
      ...(consigne ? { consigne } : {}),
    };

    let strategy: CampaignStrategy;
    try {
      strategy = await avecDelai(
        deps.genererStrategie({ ...base, ...(ctx.revuesPassees ? { weekContext: ctx.revuesPassees } : {}) }),
        delai,
      );
    } catch (e) {
      throw new GenerationEchouee("strategie", e);
    }
    if (!strategy || typeof strategy !== "object" || !Array.isArray(strategy.phases) || strategy.phases.length === 0) {
      throw new GenerationEchouee("strategie");
    }
    // Le cadre est conservé : le nom proposé par le modèle est ignoré, partout.
    const strategieCadree: CampaignStrategy = { ...strategy, name: campaign.name };

    let contentPlan: GeneratedCampaign["contentPlan"];
    try {
      contentPlan = await avecDelai(deps.genererContenu(base, strategieCadree), delai);
    } catch (e) {
      throw new GenerationEchouee("contenu", e);
    }
    if (!Array.isArray(contentPlan) || contentPlan.length === 0) throw new GenerationEchouee("contenu");

    let generatedTasks: GeneratedCampaign["tasks"];
    try {
      generatedTasks = await avecDelai(deps.genererTaches(base, strategieCadree), delai);
    } catch (e) {
      throw new GenerationEchouee("taches", e);
    }
    // Une liste vide supprimerait toutes les tâches non faites sans rien proposer à la place.
    if (!Array.isArray(generatedTasks) || generatedTasks.length === 0) throw new GenerationEchouee("taches");

    const champs: ChampsRepenses = {
      coreMessage: strategy.coreMessage,
      targetAudience: strategy.targetAudience,
      audienceSegment: strategy.audienceSegment,
      campaignType: strategy.campaignType,
      insights: strategy.insights,
      phases: strategy.phases,
      messagingFramework: strategy.messagingFramework,
      channels: strategy.channels,
      kpis: strategy.kpis,
      contentPlan,
      generatedTasks,
    };

    // 3. Une transaction : mise à jour + suppressions. Le tri est relu ICI, pas avant la
    //    génération : un post publié ou une tâche cochée pendant ces minutes est gardé.
    const { postsSupprimes, tachesSupprimees } = await deps.transaction(async (ops) => {
      const ok = await ops.mettreAJourCampagne(userId, campaignId, champs);
      if (!ok) throw new CampagneIntrouvable(campaignId);
      const tri = trierPourRepenser(
        await ops.lireContenus(userId, campaignId),
        await ops.lireTaches(userId, campaignId),
      );
      // Les tâches d'abord : elles peuvent pointer vers un post qui part (tasks.content_id).
      const tachesSupprimees = tri.tachesPartantes.length
        ? await ops.supprimerTaches(userId, campaignId, tri.tachesPartantes) : 0;
      const postsSupprimes = tri.contenusPartants.length
        ? await ops.supprimerContenus(userId, campaignId, tri.contenusPartants) : 0;
      return { postsSupprimes, tachesSupprimees };
    });

    // 4. Brouillon : seul le plan change, le lancement placera.
    if (statut === "draft") return { postsCrees: 0, tachesCreees: 0, postsSupprimes, tachesSupprimees };

    // 5. Active / en pause : placement sur la fenêtre restante, jamais au-delà de endDate.
    const fenetre = fenetrePlacement(campaign, deps.aujourdhuiParis());
    if (fenetre.vide) return { postsCrees: 0, tachesCreees: 0, postsSupprimes, tachesSupprimees };

    const debut = new Date(fenetre.debut + "T00:00:00");
    const fin = new Date(fenetre.fin + "T00:00:00");
    const campagneRepensee = { ...campaign, ...champs };
    let tachesCreees: number;
    let postsCrees: number;
    try {
      ({ creees: tachesCreees } = await placerTachesCampagne(deps.placement, {
        userId, campaign: campagneRepensee, debut, fin, bornerA: fin,
      }));
      ({ crees: postsCrees } = await placerPostsCampagne(deps.placement, {
        userId, campaign: campagneRepensee, debut, fin, bornerA: fin,
      }));
    } catch (e) {
      throw new PlacementEchoue({ postsSupprimes, tachesSupprimees }, e);
    }

    // Comme `/launch` : le re-tassage ne fait pas échouer l'opération.
    await Promise.resolve()
      .then(() => deps.fixOverlappingTasks(userId, fenetre.debut))
      .catch((e: any) => console.error("[repenser] fixOverlappingTasks:", e?.message ?? e));

    return { postsCrees, tachesCreees, postsSupprimes, tachesSupprimees };
  } finally {
    verrous.delete(cle);
  }
}
