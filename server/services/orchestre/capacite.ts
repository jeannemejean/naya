// Étape 3 du chef d'orchestre (spec 2026-11-19-chef-d-orchestre-design.md, « Étape 3 ») : la
// capacité d'une journée se compte en MINUTES, et on ne planifie que 70 % du temps disponible ;
// le reste absorbe l'imprévu. PUR.
//
// Les plafonds en nombre de tâches (7-8 à l'auto-planner, 3 en campagne…) ignorent qu'un atelier
// de 4 h n'est pas une tâche de 15 min. Ici, ce que les autres entités ont déjà posé (atelier,
// campagne, prospection, jalons d'AO, agenda) occupe sa place : les tâches d'objectifs ne
// prennent que ce qui reste.

export const MARGE_PLANIFIABLE = 0.7;
/** Durée d'une tâche générée, pour compter combien en tiennent. */
export const DUREE_TYPE = 45;
const DUREE_DEFAUT = 30;

export interface TacheMesurable {
  estimatedDuration?: number | null;
  completed?: boolean | null;
  type?: string | null;
}

export function minutesPlanifiables(o: { disponibles: number; energie: number }): number {
  return Math.floor(Math.max(0, o.disponibles) * o.energie * MARGE_PLANIFIABLE);
}

export function minutesOccupees(taches: TacheMesurable[], tampon: number): number {
  return taches
    .filter((t) => !t.completed && t.type !== "milestone")
    .reduce((s, t) => s + (t.estimatedDuration ?? DUREE_DEFAUT) + tampon, 0);
}

/** Combien de tâches de DUREE_TYPE (+ tampon) tiennent encore dans les 70 %. */
export function tachesEncorePossibles(o: {
  disponibles: number; energie: number; tampon: number; taches: TacheMesurable[]; agendaMin?: number;
}): number {
  const reste = minutesPlanifiables(o) - minutesOccupees(o.taches, o.tampon) - (o.agendaMin ?? 0);
  return Math.max(0, Math.floor(reste / (DUREE_TYPE + o.tampon)));
}

export type Flux =
  | "rituels" | "contenu" | "atelier" | "appels_offres" | "prospection" | "relances"
  | "campagne" | "objectifs" | "autre";

export interface TacheClassable {
  ritualId?: number | null;
  contentId?: number | null;
  campaignId?: number | null;
  goalId?: number | null;
  milestoneId?: number | null;
  taskType?: string | null;
  source?: string | null;
}

/** L'entité de Naya qui porte la tâche (pour les budgets et la revue de la semaine). */
export function fluxDe(t: TacheClassable): Flux {
  if (t.ritualId != null || t.source === "ritual") return "rituels";
  if (t.contentId != null) return "contenu";
  if (t.taskType === "atelier_contenu" || t.taskType === "atelier_validation") return "atelier";
  if (t.source === "appel_offres" || t.taskType === "ao_jalon") return "appels_offres";
  if (t.source === "prospection" || t.taskType === "prospection_validation") return "prospection";
  if (t.source === "relance_prospect" || t.source === "reponse_prospect") return "relances";
  if (t.campaignId != null || t.source === "campaign") return "campagne";
  if (t.goalId != null || t.milestoneId != null || ["generated", "auto", "goal", "milestone"].includes(t.source ?? "")) return "objectifs";
  return "autre";
}

type Plage = { start: number; end: number };

const fusionner = (plages: Plage[]): Plage[] => {
  const tri = plages.filter((p) => p.end > p.start).sort((a, b) => a.start - b.start);
  const out: Plage[] = [];
  for (const p of tri) {
    const d = out[out.length - 1];
    if (d && p.start <= d.end) d.end = Math.max(d.end, p.end);
    else out.push({ ...p });
  }
  return out;
};

/**
 * Minutes d'agenda qui prennent vraiment du temps de travail : rognées à [debut, fin], sans les
 * pauses (déjeuner), chevauchements fusionnés. Un dîner le soir ne vide pas la journée.
 */
export function minutesAgendaDansJournee(plages: Plage[], j: { debut: number; fin: number; pauses?: Plage[] }): number {
  const dansJournee = fusionner(plages.map((p) => ({ start: Math.max(p.start, j.debut), end: Math.min(p.end, j.fin) })));
  const pauses = fusionner(j.pauses ?? []);
  let total = 0;
  for (const p of dansJournee) {
    let m = p.end - p.start;
    for (const q of pauses) m -= Math.max(0, Math.min(p.end, q.end) - Math.max(p.start, q.start));
    total += m;
  }
  return total;
}
