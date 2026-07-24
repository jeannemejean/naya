// Logique PURE des rituels récurrents : aucun accès DB, aucun appel réseau.
import type { RecurringRitual } from "@shared/schema";

const DAY_ABBRS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const VALID_DAY_TOKENS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

/**
 * Une heure de rituel est-elle valide ? Le format "HH:MM" seul ne suffit pas :
 * "99:99" respecte le pattern mais n'est pas une heure réelle. On vérifie donc
 * en plus les bornes : heures 0-23, minutes 0-59.
 */
export function isValidTimeOfDay(hhmm: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return false;
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

/**
 * `days` est-il une liste valide de jours ("mon,tue,…") ? Chaque jeton
 * (séparé par une virgule, espaces et casse tolérés) doit appartenir à
 * l'ensemble des abréviations reconnues. Une chaîne vide est invalide.
 */
export function areValidDays(days: string): boolean {
  if (typeof days !== "string" || !days.trim()) return false;
  return days
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .every((d) => VALID_DAY_TOKENS.has(d));
}

/** Le rituel tombe-t-il ce jour-là ? `days` suit le format de `work_days` ("mon,tue,…"). */
export function ritualOccursOn(days: string, date: string): boolean {
  const set = new Set(days.toLowerCase().split(",").map((d) => d.trim()));
  const [y, m, d] = date.split("-").map(Number);
  // UTC : évite tout décalage de fuseau sur le nom du jour.
  return set.has(DAY_ABBRS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]);
}

export interface RitualTaskDraft {
  title: string;
  scheduledDate: string;
  scheduledTime: string;
  scheduledEndTime: string;
  estimatedDuration: number;
  schedulingMode: "fixed";
  source: "ritual";
}

/**
 * Construit la tâche du jour à partir du rituel.
 * `schedulingMode: 'fixed'` est essentiel : dans storage.createTask, une tâche `fixed`
 * garde son heure et ce sont les AUTRES tâches qui se décalent pour l'éviter.
 */
export function buildRitualTask(ritual: RecurringRitual, date: string): RitualTaskDraft {
  const [h, m] = ritual.startTime.split(":").map(Number);
  const endMin = h * 60 + m + ritual.durationMinutes;
  const scheduledEndTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;

  return {
    title: ritual.title,
    scheduledDate: date,
    scheduledTime: ritual.startTime,
    scheduledEndTime,
    estimatedDuration: ritual.durationMinutes,
    schedulingMode: "fixed",
    source: "ritual",
  };
}
