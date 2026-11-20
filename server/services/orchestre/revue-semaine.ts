// Étape 5 du chef d'orchestre (spec 2026-11-19-chef-d-orchestre-design.md, « Étape 5 ») : la revue
// de la semaine. Le dimanche soir, Naya prépare la semaine (jalons d'AO, tri du vivier, ateliers,
// re-tassage) ; le bilan, lui, est CALCULÉ à la demande (jamais stocké, toujours à jour).
// `bilanSemaine` et `semaineARevoir` sont purs.
import { contrainteDe } from "./contrainte";
import { fluxDe, type Flux, type TacheClassable } from "./capacite";

const plus = (jour: string, n: number) => {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const jourSemaine = (jour: string) => new Date(`${jour}T12:00:00Z`).getUTCDay();

/** Le lundi de la semaine à revoir : celle en cours en semaine, la suivante le week-end. */
export function semaineARevoir(aujourdhui: string): string {
  const d = jourSemaine(aujourdhui);
  if (d === 6) return plus(aujourdhui, 2);
  if (d === 0) return plus(aujourdhui, 1);
  return plus(aujourdhui, 1 - d);
}

export interface TacheBilan extends TacheClassable {
  id: number;
  title: string;
  completed?: boolean | null;
  archivedAt?: Date | string | null;
  type?: string | null;
  estimatedDuration?: number | null;
  scheduledDate?: string | null;
  actionData?: unknown;
  dueDate?: Date | string | null;
  createdAt?: Date | string | null;
}

export type ParFlux = Partial<Record<Flux, number>>;
export type Risque =
  | { genre: "echeance"; tacheId: number; titre: string; echeance: string; jour: string }
  | { genre: "surcharge"; jour: string; occupeMin: number; capaciteMin: number };

export interface BilanSemaine {
  semaine: string;
  capaciteMin: number;
  occupeMin: number;
  parFlux: ParFlux;
  jours: { jour: string; capaciteMin: number; occupeMin: number; parFlux: ParFlux }[];
  risques: Risque[];
}

const DUREE_DEFAUT = 30;

/** `jours` : les jours travaillés de la semaine ; `capaciteMin` : minutes disponibles par jour. */
export function bilanSemaine(taches: TacheBilan[], o: { jours: string[]; capaciteMin: number; aujourdhui: string; semaine?: string }): BilanSemaine {
  const jours = o.jours.map((jour) => ({ jour, capaciteMin: o.capaciteMin, occupeMin: 0, parFlux: {} as ParFlux }));
  const parJour = new Map(jours.map((j) => [j.jour, j]));
  const parFlux: ParFlux = {};
  const risques: Risque[] = [];
  for (const t of taches) {
    if (t.completed || t.archivedAt || t.type === "milestone" || !t.scheduledDate) continue;
    const j = parJour.get(t.scheduledDate);
    if (!j) continue;
    const min = t.estimatedDuration ?? DUREE_DEFAUT;
    const f = fluxDe(t);
    j.occupeMin += min;
    j.parFlux[f] = (j.parFlux[f] ?? 0) + min;
    parFlux[f] = (parFlux[f] ?? 0) + min;
    const c = contrainteDe(t, { aujourdhui: o.aujourdhui });
    if (c.durete === "dure" && c.echeance && t.scheduledDate > c.echeance) {
      risques.push({ genre: "echeance", tacheId: t.id, titre: t.title, echeance: c.echeance, jour: t.scheduledDate });
    }
  }
  for (const j of jours) {
    if (j.occupeMin > j.capaciteMin) risques.push({ genre: "surcharge", jour: j.jour, occupeMin: j.occupeMin, capaciteMin: j.capaciteMin });
  }
  return {
    semaine: o.semaine ?? o.jours[0] ?? "", capaciteMin: jours.reduce((s, j) => s + j.capaciteMin, 0),
    occupeMin: jours.reduce((s, j) => s + j.occupeMin, 0), parFlux, jours, risques,
  };
}

export const HEURE_REVUE = 18;

/** Le dimanche, à partir de 18 h (Paris). */
export function estMomentDeLaRevue(maintenant: Date): boolean {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(maintenant).map((x) => [x.type, x.value]));
  return p.weekday === "Sun" && Number(p.hour) >= HEURE_REVUE;
}
