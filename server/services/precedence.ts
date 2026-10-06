// Règle de précédence du calendrier (« mode projet »). PURE.
//
// Demande de Jeanne (6 octobre 2026) : comme dans un diagramme de Gantt, la tâche qui sert
// à réaliser la suivante passe d'abord. Constaté en prod le même jour : « Envoyer les 3 DMs »
// planifiée la VEILLE du modèle qu'elle utilise. Le placement ignorait les dépendances.
//
// Cette fonction ne gère pas les chevauchements (c'est le rôle du re-tassage) : elle dit
// seulement quelles tâches doivent partir plus tard, et où au plus tôt.

export interface TachePlanifiable { id: number; scheduledDate: string | null; scheduledTime: string | null; estimatedDuration: number | null; completed: boolean }
export interface Calendrier { joursTravailles: Set<string>; debutJournee: string; finJournee: string; tamponMin: number }
export interface Deplacement { id: number; scheduledDate: string; scheduledTime: string }

const JOURS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const HHMM = /^\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const enMin = (h: string) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
const enHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const duree = (d: number | null) => (d && d > 0 ? d : 30);

function estTravaille(date: string, cal: Calendrier): boolean {
  const [y, m, d] = date.split("-").map(Number);
  return cal.joursTravailles.has(JOURS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]);
}
function jourTravailleSuivant(date: string, cal: Calendrier): string {
  const [y, m, d] = date.split("-").map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < 14; i++) {
    c.setUTCDate(c.getUTCDate() + 1);
    if (cal.joursTravailles.has(JOURS[c.getUTCDay()])) break;
  }
  return c.toISOString().slice(0, 10);
}

export function respecterPrecedences(e: {
  taches: TachePlanifiable[];
  dependances: Array<{ taskId: number; dependsOnTaskId: number }>;
  calendrier: Calendrier;
}): Deplacement[] {
  const cal = e.calendrier;
  const ouverture = enMin(cal.debutJournee);
  const fermeture = enMin(cal.finJournee);

  // Position courante des tâches non terminées ET planifiées.
  const pos = new Map<number, { date: string; debut: number; duree: number }>();
  for (const t of e.taches) {
    if (t.completed || !t.scheduledDate || !t.scheduledTime) continue;
    if (!DATE.test(t.scheduledDate) || !HHMM.test(t.scheduledTime)) continue;
    pos.set(t.id, { date: t.scheduledDate, debut: enMin(t.scheduledTime), duree: duree(t.estimatedDuration) });
  }

  // Arêtes utiles : les deux bouts planifiés, pas d'auto-référence, sans doublon.
  const prerequis = new Map<number, number[]>();
  const suivants = new Map<number, number[]>();
  const vues = new Set<string>();
  for (const { taskId, dependsOnTaskId } of e.dependances) {
    if (taskId === dependsOnTaskId || !pos.has(taskId) || !pos.has(dependsOnTaskId)) continue;
    const cle = `${taskId}<${dependsOnTaskId}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    (prerequis.get(taskId) ?? prerequis.set(taskId, []).get(taskId)!).push(dependsOnTaskId);
    (suivants.get(dependsOnTaskId) ?? suivants.set(dependsOnTaskId, []).get(dependsOnTaskId)!).push(taskId);
  }

  // Tri topologique (Kahn). Les nœuds d'un cycle ne sortent jamais : ils ne bougent pas.
  const degre = new Map<number, number>();
  for (const id of pos.keys()) degre.set(id, prerequis.get(id)?.length ?? 0);
  const file = [...pos.keys()].filter((id) => degre.get(id) === 0).sort((a, b) => a - b);
  const ordre: number[] = [];
  while (file.length) {
    const id = file.shift()!;
    ordre.push(id);
    for (const s of suivants.get(id) ?? []) {
      degre.set(s, degre.get(s)! - 1);
      if (degre.get(s) === 0) file.push(s);
    }
  }

  const deplaces = new Map<number, Deplacement>();
  for (const id of ordre) {
    const pres = prerequis.get(id);
    if (!pres?.length) continue;
    const moi = pos.get(id)!;

    // Le plus tôt possible : après la fin de CHAQUE prérequis, tampon compris.
    let date = moi.date;
    let debut = moi.debut;
    for (const p of pres) {
      const pp = pos.get(p)!;
      const finP = pp.debut + pp.duree + cal.tamponMin;
      if (pp.date > date || (pp.date === date && finP > debut)) {
        date = pp.date;
        debut = finP;
      }
    }
    if (date === moi.date && debut === moi.debut) continue; // déjà dans l'ordre

    // Jour non travaillé ou journée qui déborde → ouverture du jour travaillé suivant.
    if (!estTravaille(date, cal) || debut + moi.duree > fermeture) {
      date = jourTravailleSuivant(date, cal);
      debut = ouverture;
    }
    debut = Math.max(debut, ouverture);

    pos.set(id, { ...moi, date, debut });
    deplaces.set(id, { id, scheduledDate: date, scheduledTime: enHHMM(debut) });
  }

  return [...deplaces.values()];
}
