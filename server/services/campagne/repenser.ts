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

/** Contrôles synchrones : propriété (404) et statut (409). */
async function controler(deps: RepenserDeps, userId: string, campaignId: number): Promise<CampagneRepensable> {
  const campaign = await deps.getCampaign(campaignId, userId);
  if (!campaign) throw new CampagneIntrouvable(campaignId);
  const statut = campaign.status ?? "draft";
  if (!(STATUTS_REPENSABLES as readonly string[]).includes(statut)) throw new StatutIncompatible(campaign.status ?? null);
  return campaign;
}

/** Version synchrone (verrou compris) : contrôles puis exécution complète. */
export async function repenserCampagne(
  deps: RepenserDeps,
  userId: string,
  campaignId: number,
  opts: { consigne?: string } = {},
): Promise<ResultatRepenser> {
  const cle = `${userId}:${campaignId}`;
  if (verrous.has(cle) || registreRepenser.enCours(cle)) throw new DejaEnCours(campaignId);
  verrous.add(cle);
  try {
    const campaign = await controler(deps, userId, campaignId);
    return await executer(deps, userId, campaignId, campaign, opts);
  } finally {
    verrous.delete(cle);
  }
}

async function executer(
  deps: RepenserDeps,
  userId: string,
  campaignId: number,
  campaign: CampagneRepensable,
  opts: { consigne?: string },
): Promise<ResultatRepenser> {
  const statut = campaign.status ?? "draft";

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
}

// ─── Exécution en arrière-plan ───────────────────────────────────────────────
// Trois générations à la suite (jusqu'à 3 × 240 s) dépassent le délai du proxy (~3 min)
// qui a fait découper l'assistant de création : la route répond 202 après les contrôles,
// le travail continue ici, et l'écran interroge l'état.

export type CodeErreurRepenser = "generation_echouee" | "placement_echoue" | "erreur";

export interface EtatRepenser {
  etat: "en_cours" | "termine" | "echec";
  debut: string;
  fin?: string;
  resultat?: ResultatRepenser;
  erreur?: {
    code: CodeErreurRepenser;
    etape?: GenerationEchouee["etape"];
    postsSupprimes?: number;
    tachesSupprimees?: number;
  };
}

export const DUREE_CONSERVATION_MS = 15 * 60_000;
export const PLAFOND_ENTREES = 200;

/** Registre en mémoire, par (utilisateur, campagne). Les entrées terminées sont gardées
 *  15 min puis oubliées ; au-delà de 200 entrées, les plus anciennes terminées partent.
 *  Une entrée `en_cours` n'est jamais évincée : c'est le verrou. */
export class RegistreRepenser {
  private entrees = new Map<string, EtatRepenser & { finMs?: number }>();
  constructor(
    private now: () => number = () => Date.now(),
    private conservationMs = DUREE_CONSERVATION_MS,
    private plafond = PLAFOND_ENTREES,
  ) {}

  private purger() {
    const t = this.now();
    for (const [cle, e] of Array.from(this.entrees)) {
      if (e.finMs !== undefined && t - e.finMs >= this.conservationMs) this.entrees.delete(cle);
    }
    if (this.entrees.size > this.plafond) {
      const terminees = Array.from(this.entrees).filter(([, e]) => e.finMs !== undefined)
        .sort((a, b) => a[1].finMs! - b[1].finMs!);
      for (const [cle] of terminees) {
        if (this.entrees.size <= this.plafond) break;
        this.entrees.delete(cle);
      }
    }
  }

  lire(cle: string): EtatRepenser | undefined {
    this.purger();
    const e = this.entrees.get(cle);
    if (!e) return undefined;
    const { finMs: _f, ...publique } = e;
    return publique;
  }

  enCours(cle: string): boolean {
    return this.entrees.get(cle)?.etat === "en_cours";
  }

  /** Réserve la clé ; rend l'entrée précédente (pour la restaurer si les contrôles échouent). */
  reserver(cle: string): EtatRepenser & { finMs?: number } | undefined {
    const avant = this.entrees.get(cle);
    this.entrees.set(cle, { etat: "en_cours", debut: new Date(this.now()).toISOString() });
    this.purger();
    return avant;
  }

  restaurer(cle: string, avant: (EtatRepenser & { finMs?: number }) | undefined) {
    if (avant) this.entrees.set(cle, avant);
    else this.entrees.delete(cle);
  }

  finir(cle: string, maj: Pick<EtatRepenser, "etat" | "resultat" | "erreur">) {
    const e = this.entrees.get(cle);
    const t = this.now();
    this.entrees.set(cle, {
      debut: e?.debut ?? new Date(t).toISOString(),
      ...maj,
      fin: new Date(t).toISOString(),
      finMs: t,
    });
    this.purger();
  }

  taille(): number {
    return this.entrees.size;
  }
}

export const registreRepenser = new RegistreRepenser();

export function erreurPublique(e: unknown): NonNullable<EtatRepenser["erreur"]> {
  if (e instanceof GenerationEchouee) return { code: "generation_echouee", etape: e.etape };
  if (e instanceof PlacementEchoue) return { code: "placement_echoue", ...e.partiel };
  return { code: "erreur" };
}

/**
 * Contrôles (404 / 409) puis lancement en arrière-plan. Se résout dès que le travail est
 * lancé ; `termine` rend une promesse de fin (pour les tests), qui ne rejette jamais.
 */
export async function lancerRepenser(
  deps: RepenserDeps,
  userId: string,
  campaignId: number,
  opts: { consigne?: string } = {},
  registre: RegistreRepenser = registreRepenser,
): Promise<{ termine: Promise<void> }> {
  const cle = `${userId}:${campaignId}`;
  // Vérifié et réservé sans `await` entre les deux : deux requêtes simultanées ne
  // peuvent pas passer toutes les deux.
  if (registre.enCours(cle) || verrous.has(cle)) throw new DejaEnCours(campaignId);
  const avant = registre.reserver(cle);
  verrous.add(cle);
  let campaign: CampagneRepensable;
  try {
    campaign = await controler(deps, userId, campaignId);
  } catch (e) {
    registre.restaurer(cle, avant);
    verrous.delete(cle);
    throw e;
  }
  const termine = (async () => {
    try {
      const resultat = await executer(deps, userId, campaignId, campaign, opts);
      registre.finir(cle, { etat: "termine", resultat });
    } catch (e: any) {
      console.error(`[repenser] campagne ${campaignId} :`, e?.message ?? e);
      try {
        registre.finir(cle, { etat: "echec", erreur: erreurPublique(e) });
      } catch (e2: any) {
        console.error("[repenser] registre :", e2?.message ?? e2);
      }
    } finally {
      verrous.delete(cle);
    }
  })();
  return { termine };
}
