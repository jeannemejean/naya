import { wallClockToInstant } from "../utils/timezone";
import { zonesForCountry } from "./prospection-target-zones";
import { zoneForCity } from "./prospection-target-cities";

/**
 * Heures ouvrées supposées d'un prospect, dans SON fuseau.
 *
 * ⚠️ DÉFAUT RÉVISABLE, et surtout : c'est une CONVENTION, pas une mesure. Naya ne
 * sait pas quand ses cibles travaillent — l'enrichissement ne capture aucun
 * horodatage d'activité (vérifié : le champ `activity` porte id/img/link/title/
 * interaction, jamais de date). Le jour où on capte l'activité réelle, ces bornes
 * deviennent une mesure. En attendant, elles sont nommées ici pour qu'on se
 * souvienne qu'on les a choisies.
 */
export const TARGET_WORK_START_HHMM = "09:00";
export const TARGET_WORK_END_HHMM = "18:00";
export const TARGET_WORK_DAYS: ReadonlySet<string> = new Set(["mon", "tue", "wed", "thu", "fri"]);

const JOURS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export type TargetWindow =
  | { reachable: true; start: Date; end: Date }
  | {
      reachable: false;
      reason: "country_unknown" | "no_common_window" | "not_a_workday" | "outside_window";
      detail: string;
    };

/**
 * Fenêtre UTC pendant laquelle une cible de ce pays (et, si reconnue, de cette
 * ville) est joignable, ce jour-là.
 *
 * RÉSOLUTION DES FUSEAUX, dans cet ordre :
 * 1. Si `zoneForCity` reconnaît la ville, la fenêtre est celle de CE SEUL fuseau —
 *    plus large et plus juste que l'intersection du pays entier.
 * 2. Sinon (ville absente, inconnue, ou homonyme ambigu sans discriminant d'État),
 *    repli sûr : l'INTERSECTION des créneaux locaux de TOUS les fuseaux du pays.
 *    Étroit, mais valable où que soit la personne dans ce pays.
 *
 * Exemple mesuré : aux États-Unis, l'intersection des 29 fuseaux ne laisse que
 * 19h-22h UTC (3h) ; avec la ville "New York" reconnue, la fenêtre devient celle
 * du seul fuseau America/New_York, 13h-22h UTC (9h) — strictement plus large.
 * Sans la ville, États-Unis et Canada peuvent devenir entièrement injoignables
 * une fois croisés avec les heures ouvrées de l'utilisatrice ; avec elle, une
 * partie des cibles redevient joignable.
 *
 * PURE : `countryCode`, `city` et `dateStr` entrent par paramètre, aucune horloge
 * implicite.
 */
export function targetWindowUTC(
  countryCode: string | null,
  city: string | null,
  dateStr: string,
): TargetWindow {
  if (!countryCode) {
    return {
      reachable: false,
      reason: "country_unknown",
      detail:
        `pays absent — refus par prudence. Ne PAS se replier sur le fuseau de ` +
        `l'utilisatrice : c'est ce repli qui fait aujourd'hui arriver des messages ` +
        `en pleine nuit chez la cible.`,
    };
  }

  const cityZone = zoneForCity(countryCode, city);
  const zones = cityZone ? [cityZone] : zonesForCountry(countryCode);
  if (!zones || zones.length === 0) {
    return {
      reachable: false,
      reason: "country_unknown",
      detail:
        `pays « ${countryCode} » inconnu de la table des fuseaux — refus par ` +
        `prudence. Ne PAS se replier sur le fuseau de l'utilisatrice : c'est ce ` +
        `repli qui fait aujourd'hui arriver des messages en pleine nuit chez la cible.`,
    };
  }

  // Jour ouvré évalué en UTC sur la date civile demandée : la date est déjà celle
  // que l'appelant a choisie, on ne la redécale pas.
  const [y, m, d] = dateStr.split("-").map(Number);
  const jour = JOURS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  if (!TARGET_WORK_DAYS.has(jour)) {
    return { reachable: false, reason: "not_a_workday", detail: `${dateStr} est un ${jour} chez la cible.` };
  }

  let start = -Infinity;
  let end = Infinity;
  for (const zone of zones) {
    const zStart = wallClockToInstant(zone, dateStr, TARGET_WORK_START_HHMM).getTime();
    const zEnd = wallClockToInstant(zone, dateStr, TARGET_WORK_END_HHMM).getTime();
    start = Math.max(start, zStart);
    end = Math.min(end, zEnd);
  }

  if (!(end > start)) {
    return {
      reachable: false,
      reason: "no_common_window",
      detail:
        `les fuseaux retenus (${zones.join(", ")}) n'ont aucun créneau ` +
        `${TARGET_WORK_START_HHMM}-${TARGET_WORK_END_HHMM} commun le ${dateStr} — ` +
        `cible signalée, jamais contactée au hasard.`,
    };
  }
  return { reachable: true, start: new Date(start), end: new Date(end) };
}

/** La cible est-elle joignable À CET INSTANT ? Borne de fin exclusive. */
export function isTargetReachableAt(
  countryCode: string | null,
  city: string | null,
  now: Date,
  dateStr: string,
): TargetWindow {
  const w = targetWindowUTC(countryCode, city, dateStr);
  if (!w.reachable) return w;
  const t = now.getTime();
  if (t < w.start.getTime() || t >= w.end.getTime()) {
    return {
      reachable: false,
      reason: "outside_window",
      detail: `hors de la fenêtre locale de la cible (${w.start.toISOString()} → ${w.end.toISOString()}).`,
    };
  }
  return w;
}
