// L'atelier de contenu dans le planning (spec 2026-10-14-atelier-contenu-design.md).
//
// Avant : chaque post de campagne devenait 3 à 5 tâches éparpillées sur les jours (Rédiger J-2,
// Visuel J-1, Relire J-1, Publier J0) — une douzaine de petites tâches de contenu par semaine.
// Maintenant : UNE session par semaine (« Atelier contenu »), puis une relecture à froid
// (« Valider la semaine »). Seules les étapes qui ne se font pas derrière un écran (tourner,
// monter une vidéo) restent des tâches du post.
//
// Idempotent : relancé à chaque lancement, reprise, redéploiement, remplacement de post ou
// bascule, il ne crée qu'un atelier par semaine. Il en ajuste la durée tant qu'il n'est pas
// fait ; une fois fait, seul un post CRÉÉ APRÈS lui ouvre un petit atelier de rattrapage.
import {
  requis, joursTravailles, grilleCreneaux, heureDeCreneau, hhmmToMin, minToHHMM,
  type PlacementDeps, type PostPlacable, type Grille,
} from "../campagne/placement";
import { estEtapeEcran, etapesHorsAtelier, jourDeProduction, jourDuPost, postAProduire } from "../campagne/production";
import {
  DUREE_ATELIER, TYPE_ATELIER, TYPE_VALIDATION, decouperAtelier, dureeValidation, etatPost,
  genreDuPost, libelleSemaine, lundiDe, planAtelier, plusJours,
} from "@shared/atelier";

type Tache = Record<string, any>;

const titreAtelier = (lundi: string, partie: number, parties: number) =>
  `Atelier contenu — semaine du ${libelleSemaine(lundi)}${parties > 1 ? ` (${partie}/${parties})` : ""}`;
const titreRattrapage = (lundi: string) => `Atelier contenu — semaine du ${libelleSemaine(lundi)} (rattrapage)`;
const titreValidation = (lundi: string) => `Valider la semaine — ${libelleSemaine(lundi)}`;

const DESCRIPTION_ATELIER =
  "Naya a pré-rédigé les posts de la semaine : relis, corrige, ajoute les visuels et valide. Un post validé part tout seul à son heure.";
const DESCRIPTION_VALIDATION =
  "Dernier regard à froid sur les posts de la semaine avant qu'ils partent.";

/** Posts de la semaine (lundi → dimanche) encore à produire : ni validés, ni publiés, ni passés. */
async function postsDeLaSemaine(deps: PlacementDeps, userId: string, lundi: string, aujourdhui: string) {
  const bruts = await requis(deps, "getPostsEntre")(
    userId, new Date(`${plusJours(lundi, -1)}T00:00:00Z`), new Date(`${plusJours(lundi, 8)}T00:00:00Z`),
  );
  return (bruts as PostPlacable[]).filter((p) =>
    typeof p?.id === "number" && postAProduire(p, aujourdhui) && lundiDe(jourDuPost(p.scheduledFor!)) === lundi);
}

const lireTachesLiees = async (deps: PlacementDeps, userId: string, ids: number[]): Promise<Tache[]> =>
  ids.length && deps.getTasksForContents ? requis(deps, "getTasksForContents")(userId, ids) : [];

/** Posts qui suivent encore l'ancien parcours : une étape d'écran non faite et non archivée. */
const anciensParcours = (liees: Tache[]) =>
  new Set(liees.filter((t) => !t.completed && !t.archivedAt && estEtapeEcran(t.title)).map((t) => t.contentId as number));

interface Contexte {
  deps: PlacementDeps; userId: string; aujourdhui: string; controleCreneaux: boolean;
  grille: Grille; isWorkDay: (d: string) => boolean;
}

/** Jour réellement pris : le jour prévu s'il a la place, sinon un autre jour travaillé dans [aujourdhui, échéance]. */
function jourAvecPlace(ctx: Contexte, jour: string, echeance: string, duree: number): string {
  if (ctx.grille.aDeLaPlace(jour, duree)) return jour;
  for (let d = plusJours(jour, 1); d <= echeance; d = plusJours(d, 1)) if (ctx.isWorkDay(d) && ctx.grille.aDeLaPlace(d, duree)) return d;
  for (let d = plusJours(jour, -1); d >= ctx.aujourdhui; d = plusJours(d, -1)) if (ctx.isWorkDay(d) && ctx.grille.aDeLaPlace(d, duree)) return d;
  return jour;
}

async function creer(ctx: Contexte, t: { titre: string; description: string; taskType: string; jour: string; echeance: string; duree: number; energie: string; actionData: Record<string, unknown> }) {
  const jour = jourAvecPlace(ctx, t.jour, t.echeance, t.duree);
  const heure = await heureDeCreneau(ctx.deps, ctx.grille, ctx.userId, jour, t.duree, ctx.controleCreneaux);
  return requis(ctx.deps, "createTask")({
    userId: ctx.userId,
    title: t.titre,
    description: t.description,
    type: "content",
    category: "engagement",
    priority: 2,
    estimatedDuration: t.duree,
    taskEnergyType: t.energie,
    canBeFragmented: false,
    source: "campaign",
    taskType: t.taskType,
    actionData: t.actionData,
    scheduledDate: jour,
    scheduledTime: heure,
    scheduledEndTime: minToHHMM(hhmmToMin(heure) + t.duree),
    completed: false,
  });
}

/** Met une tâche existante à la bonne durée / au bon titre ; n'écrit que ce qui change. */
async function ajuster(ctx: Contexte, t: Tache, voulu: { duree: number; titre?: string; actionData: Record<string, unknown> }): Promise<boolean> {
  const patch: Record<string, unknown> = {};
  if ((t.estimatedDuration ?? 0) !== voulu.duree) {
    patch.estimatedDuration = voulu.duree;
    if (t.scheduledTime && /^\d{2}:\d{2}$/.test(t.scheduledTime)) patch.scheduledEndTime = minToHHMM(hhmmToMin(t.scheduledTime) + voulu.duree);
  }
  if (voulu.titre && t.title !== voulu.titre) patch.title = voulu.titre;
  const ad = { ...(t.actionData ?? {}), ...voulu.actionData };
  if (JSON.stringify(ad) !== JSON.stringify(t.actionData ?? {})) patch.actionData = ad;
  if (Object.keys(patch).length === 0) return false;
  await requis(ctx.deps, "updateTask")(t.id, patch);
  return true;
}

/**
 * Pose (ou ajuste) l'atelier d'une semaine. Renvoie le nombre de tâches créées et le jour de
 * la première partie d'atelier non faite (plancher des étapes vidéo), ou null.
 */
async function assurerAtelierSemaine(ctx: Contexte, lundi: string): Promise<{ creees: number; jourAtelier: string | null }> {
  const { deps, userId, aujourdhui } = ctx;
  const posts = await postsDeLaSemaine(deps, userId, lundi, aujourdhui);
  const anciens = anciensParcours(await lireTachesLiees(deps, userId, posts.map((p) => p.id)));
  const aFaire = posts
    .filter((p) => !anciens.has(p.id) && ["a_rediger", "brouillon"].includes(etatPost(p as any)))
    .sort((a, b) => new Date(a.scheduledFor!).getTime() - new Date(b.scheduledFor!).getTime());
  const existants = (await requis(deps, "getTachesAtelier")(userId, lundi)) as Tache[];
  const ateliers = existants.filter((t) => t.taskType === TYPE_ATELIER).sort((a, b) => (a.actionData?.partie ?? 0) - (b.actionData?.partie ?? 0));
  const validations = existants.filter((t) => t.taskType === TYPE_VALIDATION);
  const premierNonFait = ateliers.find((t) => !t.completed)?.scheduledDate ?? null;

  // Un post manuel ne crée pas d'atelier à lui seul (spec : arbitrage) ; il compte dans un atelier qui existe.
  if (aFaire.length === 0 || (ateliers.length === 0 && !aFaire.some((p) => p.campaignId != null))) {
    return { creees: 0, jourAtelier: premierNonFait };
  }

  const duree = (p: PostPlacable) => DUREE_ATELIER[genreDuPost(p)];
  const plan = planAtelier({
    joursPosts: aFaire.map((p) => jourDuPost(p.scheduledFor!)), durees: aFaire.map(duree), aujourdhui, estTravaille: ctx.isWorkDay,
  });
  const echeance = plan.echeance;
  let creees = 0;

  // 1. Aucun atelier : on pose le plan.
  if (ateliers.length === 0) {
    const n = plan.parties.length;
    for (let i = 0; i < n; i++) {
      await creer(ctx, {
        titre: titreAtelier(lundi, i + 1, n), description: DESCRIPTION_ATELIER, taskType: TYPE_ATELIER,
        jour: plan.parties[i].jour, echeance, duree: plan.parties[i].duree, energie: "creative",
        actionData: { semaine: lundi, partie: i + 1, parties: n, echeance },
      });
      creees++;
    }
    if (plan.validation) {
      await creer(ctx, {
        titre: titreValidation(lundi), description: DESCRIPTION_VALIDATION, taskType: TYPE_VALIDATION,
        jour: plan.validation.jour, echeance, duree: plan.validation.duree, energie: "execution",
        actionData: { semaine: lundi, echeance },
      });
      creees++;
    }
    return { creees, jourAtelier: plan.parties[0]?.jour ?? null };
  }

  const nonFaits = ateliers.filter((t) => !t.completed);

  // 2. Un atelier reste à faire : il absorbe les posts de la semaine. Ses parties non faites
  //    prennent les durées recalculées ; celles en trop sont archivées (jamais supprimées),
  //    celles qui manquent sont ajoutées après la dernière.
  if (nonFaits.length > 0) {
    const durees = decouperAtelier(aFaire.map(duree));
    const faits = ateliers.length - nonFaits.length;
    const total = faits + durees.length;
    for (let i = 0; i < nonFaits.length; i++) {
      const t = nonFaits[i];
      if (i >= durees.length) {
        await requis(deps, "updateTask")(t.id, { archivedAt: new Date() });
        continue;
      }
      const rattrapage = !!t.actionData?.rattrapage;
      await ajuster(ctx, t, {
        duree: durees[i],
        titre: rattrapage ? undefined : titreAtelier(lundi, faits + i + 1, total),
        actionData: rattrapage ? { echeance } : { partie: faits + i + 1, parties: total, echeance },
      });
    }
    let jour = nonFaits[nonFaits.length - 1].scheduledDate ?? plan.parties[0]?.jour ?? aujourdhui;
    for (let i = nonFaits.length; i < durees.length; i++) {
      for (let x = plusJours(jour, 1); x <= echeance; x = plusJours(x, 1)) if (ctx.isWorkDay(x)) { jour = x; break; }
      await creer(ctx, {
        titre: titreAtelier(lundi, faits + i + 1, total), description: DESCRIPTION_ATELIER, taskType: TYPE_ATELIER,
        jour, echeance, duree: durees[i], energie: "creative", actionData: { semaine: lundi, partie: faits + i + 1, parties: total, echeance },
      });
      creees++;
    }
    for (const v of validations.filter((x) => !x.completed)) {
      await ajuster(ctx, v, { duree: dureeValidation(aFaire.length), actionData: { echeance } });
    }
    return { creees, jourAtelier: premierNonFait };
  }

  // 3. Tout l'atelier est fait : seuls les posts créés APRÈS lui ouvrent un rattrapage.
  const finAtelier = Math.max(...ateliers.map((t) => (t.completedAt ? new Date(t.completedAt).getTime() : 0)));
  const nouveaux = aFaire.filter((p: any) => p.createdAt && new Date(p.createdAt).getTime() > finAtelier);
  if (nouveaux.length === 0) return { creees: 0, jourAtelier: null };
  const planR = planAtelier({
    joursPosts: nouveaux.map((p) => jourDuPost(p.scheduledFor!)), durees: nouveaux.map(duree), aujourdhui, estTravaille: ctx.isWorkDay,
  });
  const dureeR = nouveaux.map(duree).reduce((a, b) => a + b, 0);
  await creer(ctx, {
    titre: titreRattrapage(lundi), description: DESCRIPTION_ATELIER, taskType: TYPE_ATELIER,
    jour: planR.parties[0].jour, echeance: planR.echeance, duree: dureeR, energie: "creative",
    actionData: { semaine: lundi, partie: ateliers.length + 1, parties: ateliers.length + 1, echeance: planR.echeance, rattrapage: true },
  });
  return { creees: 1, jourAtelier: planR.parties[0].jour };
}

/**
 * Production des posts : l'atelier de chaque semaine concernée, puis les étapes qui restent
 * des tâches du post (tourner, monter une vidéo), jamais avant l'atelier.
 */
export async function placerAteliers(
  deps: PlacementDeps,
  { userId, posts, aujourdhui, controleCreneaux = true }: {
    userId: string; posts: PostPlacable[]; aujourdhui: string; controleCreneaux?: boolean;
  },
): Promise<{ creees: number }> {
  const aProduire = posts
    .filter((p) => typeof p?.id === "number" && postAProduire(p, aujourdhui))
    .sort((a, b) => new Date(a.scheduledFor!).getTime() - new Date(b.scheduledFor!).getTime());
  if (aProduire.length === 0) return { creees: 0 };

  const dernierJour = jourDuPost(aProduire[aProduire.length - 1].scheduledFor!);
  const existantes = await requis(deps, "getTasksInRange")(userId, aujourdhui, dernierJour);
  const { prefs, isWorkDay } = await joursTravailles(deps, userId, aujourdhui, dernierJour);
  const ctx: Contexte = { deps, userId, aujourdhui, controleCreneaux, grille: grilleCreneaux(prefs, existantes), isWorkDay };

  let creees = 0;
  const jourAtelier = new Map<string, string | null>();
  const semaines = Array.from(new Set(aProduire.map((p) => lundiDe(jourDuPost(p.scheduledFor!))))).sort();
  for (const lundi of semaines) {
    const r = await assurerAtelierSemaine(ctx, lundi);
    creees += r.creees;
    jourAtelier.set(lundi, r.jourAtelier);
  }

  // Étapes hors écran (vidéo) : par post, à rebours de la publication, jamais avant l'atelier.
  const videos = aProduire.filter((p) => etapesHorsAtelier(p).length > 0 && etatPost(p as any) !== "valide");
  const liees = await lireTachesLiees(deps, userId, videos.map((p) => p.id));
  const anciens = anciensParcours(liees);
  for (const post of videos) {
    if (anciens.has(post.id)) continue;
    const jourPost = jourDuPost(post.scheduledFor!);
    const atelier = jourAtelier.get(lundiDe(jourPost));
    let plancher = atelier && atelier > aujourdhui ? atelier : aujourdhui;
    for (const etape of etapesHorsAtelier(post)) {
      const jour = jourDeProduction({ cible: plusJours(jourPost, -etape.joursAvant), jourPost, aujourdhui, estTravaille: isWorkDay, plancher });
      plancher = jour;
      if (liees.some((t) => t.contentId === post.id && (t.title ?? "").startsWith(`${etape.cle} — `))) continue;
      const heure = await heureDeCreneau(deps, ctx.grille, userId, jour, etape.duree, controleCreneaux);
      await requis(deps, "createTask")({
        userId,
        projectId: post.projectId ?? undefined,
        campaignId: post.campaignId ?? undefined,
        contentId: post.id,
        title: etape.titre,
        description: etape.description,
        type: "content",
        category: "engagement",
        priority: 2,
        estimatedDuration: etape.duree,
        taskEnergyType: etape.energie,
        source: "campaign",
        scheduledDate: jour,
        scheduledTime: heure,
        scheduledEndTime: minToHHMM(hhmmToMin(heure) + etape.duree),
        completed: false,
      });
      creees++;
    }
  }
  return { creees };
}
