// Reprise des tâches non faites — le tri (spec 2026-10-26-naya-reprise-intelligente-design.md).
//
// Chaque tâche en retard a un propriétaire. Le report aveugle les traitait toutes pareil :
// « Valider la semaine — 26 oct. » s'est retrouvée avant l'atelier de la même semaine, et
// l'atelier de la semaine du 12 oct., reporté sept fois, traînait encore le 27. Ici, ce qui
// a sa propre règle (rituel, étape d'un post, atelier) la suit ; seul le reste est confié à
// Naya. PUR.
import { TYPE_ATELIER, TYPE_VALIDATION, plusJours } from "@shared/atelier";

export type Classe =
  /** Géré ailleurs (validation de prospection, jalon virtuel, agenda) : on n'y touche pas. */
  | { genre: "ignorer" }
  /** Occurrence de rituel manquée : le rituel revient à sa date, celle-ci s'archive. */
  | { genre: "rituel" }
  /** Étape de production d'un post : suit le post, jamais réécrite. */
  | { genre: "etapePost"; contentId: number }
  /** Atelier contenu ou « Valider la semaine » : suit la semaine. */
  | { genre: "atelier"; semaine: string }
  /** Le reste : Naya décide. */
  | { genre: "libre" };

export interface TacheTriable {
  id: number;
  type?: string | null;
  source?: string | null;
  taskType?: string | null;
  ritualId?: number | null;
  contentId?: number | null;
  actionData?: unknown;
}

export const estTacheAtelier = (t: { taskType?: string | null }) =>
  t.taskType === TYPE_ATELIER || t.taskType === TYPE_VALIDATION;

export function classer(t: TacheTriable): Classe {
  if (t.type === "milestone" || t.source === "milestone" || t.source === "gcal") return { genre: "ignorer" };
  if (t.taskType === "prospection_validation") return { genre: "ignorer" };
  if (t.ritualId != null) return { genre: "rituel" };
  if (estTacheAtelier(t)) {
    const semaine = (t.actionData as { semaine?: unknown } | null)?.semaine;
    if (typeof semaine === "string" && /^\d{4}-\d{2}-\d{2}$/.test(semaine)) return { genre: "atelier", semaine };
    return { genre: "libre" };
  }
  if (typeof t.contentId === "number") return { genre: "etapePost", contentId: t.contentId };
  return { genre: "libre" };
}

// ─── Atelier : la semaine dicte l'ordre ─────────────────────────────────────────────────

export interface TacheAtelier {
  id: number;
  taskType: string;
  scheduledDate: string | null;
  actionData?: unknown;
}

export interface PlanRepriseAtelier {
  archiver: number[];
  /** Jour exact de chaque tâche à déplacer ; celles déjà au bon jour n'y sont pas. */
  placer: Array<{ id: number; jour: string }>;
}

/**
 * Les tâches d'atelier NON FAITES d'une semaine, remises d'aplomb :
 * - plus aucun post à produire cette semaine → toutes archivées ;
 * - sinon les parties d'atelier, dans l'ordre, jamais avant `cible` ; puis la validation,
 *   le jour ouvré suivant la dernière partie si c'est encore avant le premier post, sinon
 *   le même jour (après elle). Le dernier jour utile est la veille ouvrée du premier post ;
 *   s'il est déjà passé, tout se fait au plus tôt.
 */
export function planRepriseAtelier({ taches, joursPostsRestants, cible, estTravaille }: {
  taches: TacheAtelier[];
  joursPostsRestants: string[];
  cible: string;
  estTravaille: (d: string) => boolean;
}): PlanRepriseAtelier {
  if (joursPostsRestants.length === 0) return { archiver: taches.map((t) => t.id), placer: [] };

  const premierPost = [...joursPostsRestants].sort()[0];
  let limite: string | null = null;
  for (let d = plusJours(premierPost, -1); d >= cible; d = plusJours(d, -1)) if (estTravaille(d)) { limite = d; break; }
  const premierOuvre = (d: string) => { let x = d; for (let i = 0; i < 14 && !estTravaille(x); i++) x = plusJours(x, 1); return x; };
  const debut = premierOuvre(cible);

  const placer: PlanRepriseAtelier["placer"] = [];
  const poser = (t: TacheAtelier, jour: string) => { if (t.scheduledDate !== jour) placer.push({ id: t.id, jour }); };

  const partie = (t: TacheAtelier) => Number((t.actionData as { partie?: unknown } | null)?.partie) || 0;
  const parties = taches.filter((t) => t.taskType === TYPE_ATELIER).sort((a, b) => partie(a) - partie(b));
  let precedent: string | null = null;
  for (const t of parties) {
    const plancher: string = precedent && precedent > debut ? precedent : debut;
    let jour: string = t.scheduledDate && t.scheduledDate >= plancher ? t.scheduledDate : plancher;
    if (limite && jour > limite && limite >= plancher) jour = limite;
    poser(t, jour);
    precedent = jour;
  }

  for (const v of taches.filter((t) => t.taskType === TYPE_VALIDATION)) {
    let jour: string;
    if (precedent) {
      // Le lendemain ouvré, seulement s'il tombe encore avant le premier post.
      let lendemain: string | null = null;
      if (limite) for (let x = plusJours(precedent, 1); x <= limite; x = plusJours(x, 1)) if (estTravaille(x)) { lendemain = x; break; }
      const ideal = lendemain ?? precedent;
      const actuelBon = !!v.scheduledDate && v.scheduledDate > precedent && (!limite || v.scheduledDate <= limite);
      jour = actuelBon ? v.scheduledDate! : ideal;
    } else {
      const actuelBon = !!v.scheduledDate && v.scheduledDate >= debut && (!limite || v.scheduledDate <= limite);
      jour = actuelBon ? v.scheduledDate! : limite && v.scheduledDate && v.scheduledDate > limite ? limite : debut;
    }
    poser(v, jour);
  }
  return { archiver: [], placer };
}
