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

const JOUR_MS = 86_400_000;
const enUtc = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
// Lundi (UTC) de la semaine ISO d'un instant.
const lundiDe = (t: number): number => t - ((new Date(t).getUTCDay() + 6) % 7) * JOUR_MS;

/**
 * Le rituel tombe-t-il ce jour-là ? `days` suit le format de `work_days` ("mon,tue,…").
 * `intervalWeeks` > 1 (avec `anchorDate`) : une semaine sur N, en comptant depuis la semaine du
 * PREMIER jour prévu à partir de l'ancre (créé un mercredi pour le lundi : le lundi suivant, puis
 * toutes les N semaines). Jamais avant l'ancre. Sans ancre : chaque semaine, comme avant.
 */
export function ritualOccursOn(
  days: string,
  date: string,
  opts?: { intervalWeeks?: number | null; anchorDate?: string | null },
): boolean {
  const set = new Set(days.toLowerCase().split(",").map((d) => d.trim()));
  // UTC : évite tout décalage de fuseau sur le nom du jour.
  const t = enUtc(date);
  if (!set.has(DAY_ABBRS[new Date(t).getUTCDay()])) return false;
  const n = opts?.intervalWeeks ?? 1;
  const ancre = opts?.anchorDate ? String(opts.anchorDate).slice(0, 10) : null;
  if (n <= 1 || !ancre) return true;
  const a = enUtc(ancre);
  if (t < a) return false;
  let premier = a;
  for (let i = 0; i < 7 && !set.has(DAY_ABBRS[new Date(premier).getUTCDay()]); i++) premier += JOUR_MS;
  const semaines = Math.round((lundiDe(t) - lundiDe(premier)) / (7 * JOUR_MS));
  return semaines % n === 0;
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

// Mots d'un rituel de CRÉATION (fil conducteur : seuls ces rituels sont rattachés à l'objectif de
// visibilité du projet). Liste fermée, comparée mot entier après normalisation (sans accents,
// minuscules) : jamais de sous-chaîne (« poste comptable » ne correspond pas).
// « recettes » au pluriel seulement : « recette » au singulier est aussi le jargon logiciel de la
// recette (tests d'acceptation, « Recette Naya »). Cas limite accepté : « Publication des comptes
// annuels » est pris pour un rituel de création.
const MOTS_CREATION = new Set([
  "post", "posts", "reel", "reels", "story", "stories", "carrousel", "carrousels", "carousel", "carousels",
  "contenu", "contenus", "video", "videos", "newsletter", "newsletters", "article", "articles",
  "publication", "publications", "podcast", "podcasts", "shooting", "shootings", "tournage", "tournages",
  "montage", "montages", "legende", "legendes", "recettes", "live", "lives", "tiktok", "instagram", "linkedin",
]);

/** Le titre du rituel désigne-t-il un rituel de création ? (mots entiers de MOTS_CREATION) */
export function estRituelDeCreation(titre: string): boolean {
  const mots = titre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/);
  return mots.some((m) => MOTS_CREATION.has(m));
}
