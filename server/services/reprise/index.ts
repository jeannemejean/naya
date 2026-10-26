// Reprise des tâches non faites (spec 2026-10-26-naya-reprise-intelligente-design.md).
//
// Remplace les deux reports aveugles (6 h et fin de journée) : chaque tâche en retard suit
// la règle de son propriétaire (tri.ts), Naya décide du reste au regard des objectifs
// (decision.ts), tout est replacé là où il y a vraiment la place (placement.ts), et chaque
// changement est journalisé pour la carte « Ce que j'ai repris » et l'annulation.
import { randomUUID } from "crypto";
import { lundiDe, plusJours, etatPost } from "@shared/atelier";
import type { InsertRepriseTache, RepriseTache } from "@shared/schema";
import { grilleCreneaux, heureDeCreneau, joursTravailles, hhmmToMin, minToHHMM, type PlacementDeps } from "../campagne/placement";
import { echeanceTache, estTachePublier, jourDuPost, postAProduire } from "../campagne/production";
import { maxTasksForDay } from "../day-sizing";
import { classer, planRepriseAtelier, estTacheAtelier } from "./tri";
import { normaliserDecisions, decisionParDefaut, type Decision, type EntreePrompt, type SortieReprise, type TacheAReprendre } from "./decision";
import { placerElements, type ElementAPlacer } from "./placement";

type Tache = Record<string, any> & { id: number; title: string; taskType: string; scheduledDate: string | null };

/** Au-delà, les plus anciennes sont gardées telles quelles : la réponse doit tenir. */
export const MAX_TACHES_IA = 40;
/** Fenêtre de placement : trois semaines de jours ouvrés au plus. */
const HORIZON_JOURS = 21;
/** Tâches en retard remontées jusqu'à deux mois en arrière. */
const RECUL_JOURS = 60;

export interface DepsReprise extends PlacementDeps {
  getTasksInRange(userId: string, startDate: string, endDate: string): Promise<any[]>;
  updateTask(id: number, patch: any): Promise<any>;
  createTask(task: any): Promise<any>;
  getContentById(id: number, userId: string): Promise<any>;
  fixOverlappingTasks(userId: string, fromDate: string): Promise<unknown>;
  ajouterReprises(lignes: InsertRepriseTache[]): Promise<void>;
  /** Noms des projets et intitulés des objectifs, pour le prompt. */
  libelles(userId: string): Promise<{ projets: Map<number, string>; objectifs: Map<number, string> }>;
  /** Rendez-vous de l'agenda (Google) sur la période : la grille les évite d'emblée. */
  evenementsAgenda?(userId: string, debut: string, fin: string): Promise<Array<{ date: string; startTime: string; endTime: string; allDay?: boolean }>>;
  /** L'avis de Naya ; null si l'IA n'est pas disponible (panne, budget). */
  decider(userId: string, entree: Omit<EntreePrompt, "contexte">): Promise<SortieReprise | null>;
}

export interface OptionsReprise {
  userId: string;
  aujourdhui: string;
  /** Premier jour où replacer (aujourd'hui le matin, le prochain jour ouvré le soir). */
  cible: string;
  /** Les tâches d'aujourd'hui sont-elles « en retard » ? (oui en fin de journée) */
  inclureAujourdhui: boolean;
  /** Redémarrage : les compteurs de reports repartent de zéro, les tâches ne sont pas en cause. */
  reinitialiserReports?: boolean;
  /** false : pas d'appel à Naya, tout est gardé (le placement reste intelligent). */
  ia?: boolean;
}

export interface BilanReprise { replacees: number; modifiees: number; archivees: number; creees: number }

const etat = (t: Tache) => ({
  title: t.title ?? null, description: t.description ?? null, estimatedDuration: t.estimatedDuration ?? null,
  scheduledDate: t.scheduledDate ?? null, scheduledTime: t.scheduledTime ?? null, scheduledEndTime: t.scheduledEndTime ?? null,
});

/** Nombre de tâches qu'une journée supporte (même calcul que la génération quotidienne). */
export function plafondDeLaJournee(prefs: any): number {
  const total = hhmmToMin(prefs?.workDayEnd || "18:00") - hhmmToMin(prefs?.workDayStart || "09:00");
  const dejeuner = prefs?.lunchBreakEnabled !== false
    ? Math.max(0, hhmmToMin(prefs?.lunchBreakEnd || "13:00") - hhmmToMin(prefs?.lunchBreakStart || "12:00")) : 0;
  const energie = prefs?.currentEnergyLevel === "depleted" ? 0.4 : prefs?.currentEnergyLevel === "low" ? 0.6
    : prefs?.currentEnergyLevel === "medium" ? 0.8 : 1.0;
  return maxTasksForDay({ availableMin: Math.max(60, total - dejeuner), energyFactor: energie, bufferMin: Math.min(30, Math.max(0, prefs?.bufferMin ?? 10)) });
}

const compte = (t: Tache) => !t.completed && t.type !== "milestone" && t.source !== "milestone";

export async function reprendreTaches(deps: DepsReprise, o: OptionsReprise): Promise<BilanReprise> {
  const bilan: BilanReprise = { replacees: 0, modifiees: 0, archivees: 0, creees: 0 };
  const { userId, aujourdhui, cible } = o;
  const prefs = await deps.getUserPreferences(userId);
  if (prefs?.planningStatus === "paused") return bilan;

  const finRetard = o.inclureAujourdhui ? aujourdhui : plusJours(aujourdhui, -1);
  const fin = plusJours(cible, HORIZON_JOURS);
  const [anciennes, aVenir] = await Promise.all([
    deps.getTasksInRange(userId, plusJours(aujourdhui, -RECUL_JOURS), finRetard),
    deps.getTasksInRange(userId, cible, fin),
  ]);
  const enRetard = (anciennes as Tache[]).filter((t) => !t.completed && !t.archivedAt && t.scheduledDate && t.scheduledDate <= finRetard);

  const { isWorkDay } = await joursTravailles(deps, userId, cible, fin);
  const jours: string[] = [];
  for (let d = cible; d <= fin; d = plusJours(d, 1)) if (isWorkDay(d)) jours.push(d);
  // L'agenda d'abord : sans lui, la grille voyait un trou là où il y avait un rendez-vous, la
  // vérification en base décalait l'heure après la fin de journée, et le re-tassage
  // renvoyait la tâche de jour en jour (essai du 26 oct. : une tâche du 28 partie au 17 nov.).
  const agenda = await (deps.evenementsAgenda?.(userId, cible, fin) ?? Promise.resolve([])).catch(() => []);
  const rendezVous = agenda
    .filter((e) => !e.allDay && /^\d{2}:\d{2}$/.test(e.startTime) && /^\d{2}:\d{2}$/.test(e.endTime))
    .map((e) => ({ scheduledDate: e.date, scheduledTime: e.startTime, estimatedDuration: Math.max(0, hhmmToMin(e.endTime) - hhmmToMin(e.startTime)) }));
  const grille = grilleCreneaux(prefs, [...aVenir, ...rendezVous]);
  const finJournee = hhmmToMin(prefs?.workDayEnd || "18:00");
  const plafond = plafondDeLaJournee(prefs);
  const dejaPrevues = new Map<string, number>();
  for (const t of aVenir as Tache[]) if (t.scheduledDate && compte(t)) dejaPrevues.set(t.scheduledDate, (dejaPrevues.get(t.scheduledDate) ?? 0) + 1);

  const lot = randomUUID();
  const journal: InsertRepriseTache[] = [];
  const noter = (t: Tache, action: string, raison: string, apres: Record<string, unknown>) =>
    journal.push({ userId, lot, taskId: t.id, action, raison, avant: etat(t), apres });
  const archiver = async (t: Tache, raison: string, action = "perimee") => {
    await deps.updateTask(t.id, { archivedAt: new Date() });
    noter(t, action, raison, { ...etat(t), archive: true });
    bilan.archivees++;
  };

  // ── 1. Le tri ──
  const libres: Tache[] = [];
  const elements: ElementAPlacer[] = [];
  const aEcrire = new Map<string, { tache?: Tache; decision?: Decision; action: string; raison: string; nouvelle?: Tache & { rang: number; parent: Tache } }>();
  const semaines = new Set<string>();

  for (const t of enRetard) {
    const c = classer(t);
    if (c.genre === "ignorer") continue;
    if (c.genre === "rituel") { await archiver(t, "Rituel manqué : il revient à sa prochaine date."); continue; }
    if (c.genre === "atelier") { semaines.add(c.semaine); continue; }
    if (c.genre === "etapePost") {
      const post = await deps.getContentById(c.contentId, userId).catch(() => null);
      if (!post || !postAProduire(post, aujourdhui)) {
        await archiver(t, post?.publishedAt ? "Le post est déjà parti." : "La date du post est passée.");
        continue;
      }
      const jourPost = jourDuPost(post.scheduledFor);
      const echeance = echeanceTache(t.title, jourPost);
      const cle = `t:${t.id}`;
      // « Publier » va le jour du post (le re-tassage la cale à son heure) ; les autres étapes
      // avant leur échéance, et le re-tassage remet les étapes du post dans l'ordre.
      elements.push(estTachePublier(t.title)
        ? { cle, duree: t.estimatedDuration || 15, priorite: 1, jourExact: jourPost }
        : { cle, duree: t.estimatedDuration || 30, priorite: 1, jourMin: cible, jourMax: echeance && echeance > cible ? echeance : cible, ordre: t.scheduledDate });
      aEcrire.set(cle, { tache: t, action: "replacer", raison: "" });
      continue;
    }
    libres.push(t);
  }

  // ── 2. L'atelier : chaque semaine touchée, et celles dont l'ordre est cassé ──
  for (const t of aVenir as Tache[]) {
    const s = (t.actionData as any)?.semaine;
    if (estTacheAtelier(t) && !t.completed && !t.archivedAt && typeof s === "string") semaines.add(s);
  }
  for (const semaine of Array.from(semaines).sort()) {
    const taches = ((await requisAtelier(deps)(userId, semaine)) as Tache[]).filter((t) => !t.completed);
    if (taches.length === 0) continue;
    const posts = await requisPosts(deps)(userId, new Date(`${plusJours(semaine, -1)}T00:00:00Z`), new Date(`${plusJours(semaine, 8)}T00:00:00Z`));
    const joursPostsRestants = (posts as any[])
      .filter((p) => postAProduire(p, aujourdhui) && lundiDe(jourDuPost(p.scheduledFor)) === semaine && ["a_rediger", "brouillon"].includes(etatPost(p)))
      .map((p) => jourDuPost(p.scheduledFor));
    const plan = planRepriseAtelier({ taches, joursPostsRestants, cible, estTravaille: isWorkDay });
    for (const id of plan.archiver) {
      const t = taches.find((x) => x.id === id)!;
      await archiver(t, "Les posts de cette semaine sont prêts ou passés : plus besoin de cet atelier.");
    }
    for (const { id, jour } of plan.placer) {
      const t = taches.find((x) => x.id === id)!;
      const cle = `t:${t.id}`;
      elements.push({ cle, duree: t.estimatedDuration || 30, priorite: 1, jourExact: jour });
      aEcrire.set(cle, { tache: t, action: "replacer", raison: "Remis dans l'ordre : l'atelier d'abord, la validation ensuite." });
    }
  }

  // ── 3. Naya décide du reste ──
  if (libres.length > 0) {
    // Les plus reportées d'abord dans la fenêtre de l'IA : ce sont elles qui posent question.
    const parUrgence = [...libres].sort((a, b) => (b.learnedAdjustmentCount ?? 0) - (a.learnedAdjustmentCount ?? 0) || String(a.scheduledDate).localeCompare(String(b.scheduledDate)));
    const pourIa = parUrgence.slice(0, MAX_TACHES_IA);
    let sortie: SortieReprise | null = null;
    if (o.ia !== false) {
      try {
        const { projets, objectifs } = await deps.libelles(userId);
        const faites = (await deps.getTasksInRange(userId, plusJours(aujourdhui, -7), aujourdhui))
          .filter((t: Tache) => t.completed).map((t: Tache) => String(t.title)).slice(0, 40);
        sortie = await deps.decider(userId, {
          aujourdhui,
          taches: pourIa.map((t) => ({ ...(t as TacheAReprendre), projet: t.projectId ? projets.get(t.projectId) ?? null : null, objectif: t.goalId ? objectifs.get(t.goalId) ?? null : null })),
          charge: jours.slice(0, 10).map((j) => ({ jour: j, minutesLibres: minutesLibres(grille, j), taches: dejaPrevues.get(j) ?? 0 })),
          faitesRecemment: faites,
        });
      } catch (e: any) {
        console.error(`[Reprise] avis de Naya indisponible user=${userId} :`, e?.message ?? e);
      }
    }
    const decisions = [
      ...normaliserDecisions(pourIa as TacheAReprendre[], sortie, aujourdhui),
      ...parUrgence.slice(MAX_TACHES_IA).map((t) => decisionParDefaut(t as TacheAReprendre)),
    ];
    const parId = new Map(libres.map((t) => [t.id, t]));
    for (const d of decisions) {
      const t = parId.get(d.id)!;
      for (const id of d.absorbe) await archiver(parId.get(id)!, `Fusionnée dans « ${d.titre ?? t.title} ».`, "fusionnee");
      if (d.action === "abandonner") { await archiver(t, d.raison || "Elle ne sert plus tes objectifs.", "abandonner"); continue; }
      if (d.action === "decouper") {
        let precedente: string | null = null;
        d.sousTaches.forEach((s, rang) => {
          const cle = `n:${t.id}:${rang}`;
          elements.push({ cle, duree: s.duree, priorite: d.priorite, jourMin: cible, jourMax: d.auPlusTard, apres: precedente, ordre: t.scheduledDate });
          aEcrire.set(cle, { decision: d, action: "decouper", raison: d.raison, nouvelle: { ...s, title: s.titre, rang, parent: t } as any });
          precedente = cle;
        });
        continue;
      }
      const cle = `t:${t.id}`;
      elements.push({ cle, duree: d.duree, priorite: d.priorite, jourMin: cible, jourMax: d.auPlusTard, ordre: t.scheduledDate });
      aEcrire.set(cle, { tache: t, decision: d, action: d.action === "garder" ? "replacer" : d.action, raison: d.raison });
    }
  }

  // ── 4. Le placement ──
  const places = await placerElements(elements, {
    jours,
    aDeLaPlace: (j, duree) => grille.aDeLaPlace(j, duree),
    placesRestantes: (j) => plafond - (dejaPrevues.get(j) ?? 0),
    reserver: async (j, duree, forcer) => {
      // La journée a-t-elle encore la place ? (la grille a pu changer depuis le tri des jours)
      if (!forcer && !grille.aDeLaPlace(j, duree)) return null;
      const heure = await heureDeCreneau(deps, grille, userId, j, duree, true);
      // La base a décalé l'heure au-delà de la fin de journée : ce jour-là n'a pas la place.
      if (!forcer && hhmmToMin(heure) + duree > finJournee) return null;
      return heure;
    },
  });

  // ── 5. Les écritures ──
  const creeesParParent = new Map<number, { parent: Tache; decision: Decision; ids: number[]; titres: string[]; premier?: { jour: string; heure: string } }>();
  for (const e of elements) {
    const p = places.get(e.cle);
    const w = aEcrire.get(e.cle);
    if (!p || !w) continue;
    const creneau = { scheduledDate: p.jour, scheduledTime: p.heure, scheduledEndTime: minToHHMM(hhmmToMin(p.heure) + e.duree) };

    if (w.nouvelle) {
      const { parent, rang } = w.nouvelle;
      const creee = await deps.createTask({
        userId, projectId: parent.projectId ?? undefined, goalId: parent.goalId ?? undefined, campaignId: parent.campaignId ?? undefined,
        clientId: parent.clientId ?? undefined, title: w.nouvelle.title, description: w.nouvelle.description ?? null,
        type: parent.type || "planning", category: parent.category || "planning", priority: parent.priority ?? 2,
        estimatedDuration: e.duree, taskEnergyType: parent.taskEnergyType ?? undefined, source: "replan",
        ...creneau, completed: false,
      });
      const g = creeesParParent.get(parent.id) ?? { parent, decision: w.decision!, ids: [], titres: [] };
      g.ids.push(creee.id);
      g.titres.push(w.nouvelle.title);
      if (rang === 0) g.premier = p;
      creeesParParent.set(parent.id, g);
      bilan.creees++;
      continue;
    }

    const t = w.tache!;
    const d = w.decision;
    const change = !!d && (d.action === "reformuler" || d.action === "fusionner");
    const reports = o.reinitialiserReports || change ? 0 : (t.learnedAdjustmentCount ?? 0) + 1;
    const patch: Record<string, unknown> = { ...creneau, learnedAdjustmentCount: reports };
    // Une tâche « auto » reprise sur un autre jour n'est plus la génération de ce jour-là :
    // marquée « auto », elle empêcherait la génération d'y poser la suite (capaciteRestanteDuJour).
    if (t.source === "auto") patch.source = "replan";
    if (change) {
      if (d!.titre) patch.title = d!.titre;
      if (d!.description) patch.description = d!.description;
      patch.estimatedDuration = e.duree;
    }
    await deps.updateTask(t.id, patch);
    noter(t, w.action, w.raison, { ...etat({ ...t, ...patch }), absorbees: d?.absorbe ?? [] });
    if (change) bilan.modifiees++; else bilan.replacees++;
  }
  for (const { parent, decision, ids, titres, premier } of Array.from(creeesParParent.values())) {
    await deps.updateTask(parent.id, { archivedAt: new Date() });
    noter(parent, "decouper", decision.raison, { ...etat(parent), scheduledDate: premier?.jour ?? null, creees: ids, sousTaches: titres, archive: true });
    bilan.modifiees++;
  }

  if (journal.length) await deps.ajouterReprises(journal);
  await deps.fixOverlappingTasks(userId, cible);
  console.log(`[Reprise] user=${userId} lot=${lot} → ${JSON.stringify(bilan)}`);
  return bilan;
}

function minutesLibres(grille: ReturnType<typeof grilleCreneaux>, jour: string): number {
  // Le plus long trou n'est pas exposé par la grille : on sonde par pas de 15 min.
  let libre = 0;
  for (let m = 15; m <= 600; m += 15) if (grille.aDeLaPlace(jour, m)) libre = m; else break;
  return libre;
}

const requisAtelier = (deps: DepsReprise) => {
  if (!deps.getTachesAtelier) throw new Error("DepsReprise.getTachesAtelier manquant");
  return deps.getTachesAtelier.bind(deps);
};
const requisPosts = (deps: DepsReprise) => {
  if (!deps.getPostsEntre) throw new Error("DepsReprise.getPostsEntre manquant");
  return deps.getPostsEntre.bind(deps);
};

// ─── Ce que la carte du matin montre ──────────────────────────────────────────────────

export interface VueReprise {
  id: number;
  action: string;
  raison: string;
  titre: string;
  /** L'ancien titre, quand Naya l'a changé. */
  titreAvant: string | null;
  jour: string | null;
  sousTaches: string[];
  annulable: boolean;
  annulee: boolean;
}

/** Les lignes du journal, prêtes pour l'accueil : les changements, puis les simples replacements. PUR. */
export function vueReprises(lignes: RepriseTache[]): { changements: VueReprise[]; replacees: VueReprise[] } {
  const vues = lignes.map((l): VueReprise => {
    const avant = (l.avant ?? {}) as Record<string, any>;
    const apres = (l.apres ?? {}) as Record<string, any>;
    const titre = String(apres.title ?? avant.title ?? "");
    return {
      id: l.id, action: l.action, raison: l.raison,
      titre, titreAvant: avant.title && avant.title !== titre ? String(avant.title) : null,
      jour: apres.archive && l.action !== "decouper" ? null : apres.scheduledDate ?? null,
      sousTaches: Array.isArray(apres.sousTaches) ? apres.sousTaches.map(String) : [],
      annulable: l.action !== "replacer" && !l.annuleeAt, annulee: !!l.annuleeAt,
    };
  });
  return { changements: vues.filter((v) => v.action !== "replacer"), replacees: vues.filter((v) => v.action === "replacer") };
}

// ─── Annuler ce que la reprise a fait ─────────────────────────────────────────────────

export interface DepsAnnulation {
  getReprise(id: number, userId: string): Promise<RepriseTache | undefined>;
  marquerRepriseAnnulee(id: number, userId: string): Promise<void>;
  getTask(id: number): Promise<any>;
  updateTask(id: number, patch: any): Promise<any>;
  fixOverlappingTasks(userId: string, fromDate: string): Promise<unknown>;
}

/** Défait une ligne du journal. Rend false si elle ne se défait pas (simple replacement, déjà annulée). */
export async function annulerReprise(deps: DepsAnnulation, userId: string, id: number, aujourdhui: string): Promise<boolean> {
  const l = await deps.getReprise(id, userId);
  if (!l || l.annuleeAt || l.action === "replacer") return false;
  const avant = l.avant as Record<string, any>;
  const apres = l.apres as Record<string, any>;
  const jour = (j: unknown) => (typeof j === "string" && j >= aujourdhui ? j : aujourdhui);
  const ressortir = (taskId: number, j: unknown) =>
    deps.updateTask(taskId, { archivedAt: null, scheduledDate: jour(j), scheduledTime: null, scheduledEndTime: null });

  switch (l.action) {
    case "reformuler":
    case "fusionner":
      await deps.updateTask(l.taskId, { title: avant.title, description: avant.description, estimatedDuration: avant.estimatedDuration });
      for (const absorbee of (apres.absorbees as number[] | undefined) ?? []) await ressortir(absorbee, apres.scheduledDate);
      break;
    case "decouper":
      for (const creee of (apres.creees as number[] | undefined) ?? []) {
        const t = await deps.getTask(creee);
        if (t && t.userId === userId && !t.completed) await deps.updateTask(creee, { archivedAt: new Date() });
      }
      await ressortir(l.taskId, apres.scheduledDate);
      break;
    default: // abandonner, perimee, fusionnee
      await ressortir(l.taskId, avant.scheduledDate);
  }
  await deps.marquerRepriseAnnulee(id, userId);
  await deps.fixOverlappingTasks(userId, aujourdhui);
  return true;
}
