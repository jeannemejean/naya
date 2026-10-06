// Boucle « précédences → re-tassage » jusqu'à stabilité. ORCHESTRATION PURE : les accès
// à la base sont injectés (cf. storage.fixOverlappingTasks), ce qui la rend testable seule.
//
// Pourquoi une boucle : le re-tassage (repackDay) peut faire déborder un prérequis au jour
// suivant alors que son dépendant, plus court, reste en place — la précédence est de
// nouveau violée. On recalcule donc après chaque re-tassage, au plus `maxTours` fois.
//
// Garanties :
//  - le re-tassage tourne TOUJOURS au moins une fois (comportement historique de
//    fixOverlappingTasks préservé, même sans aucune dépendance) ;
//  - un échec de la règle (calcul ou application) ne lève jamais et ne bloque pas le
//    re-tassage : on journalise et on s'arrête sur l'état re-tassé (sans chevauchement) ;
//  - une erreur du re-tassage lui-même remonte comme avant (contrat inchangé pour les appelants).

import type { Calendrier } from "./precedence";

export interface DeplacementPlanning { id: number; scheduledDate: string; scheduledTime: string }

export interface ResultatStabilisation { tours: number; retasses: number; deplaces: number; stable: boolean }

export async function stabiliserPlanning(f: {
  calculerDeplacements: () => Promise<DeplacementPlanning[]>;
  appliquerDeplacements: (d: DeplacementPlanning[]) => Promise<void>;
  retasser: () => Promise<number>;
  maxTours?: number; // défaut 5
}): Promise<ResultatStabilisation> {
  const maxTours = Math.max(1, f.maxTours ?? 5);

  // null = le calcul a échoué (journalisé) : on n'insiste pas.
  const calculer = async (): Promise<DeplacementPlanning[] | null> => {
    try {
      return await f.calculerDeplacements();
    } catch (e: any) {
      console.error("[precedence] calcul des déplacements impossible, re-tassage seul :", e?.message);
      return null;
    }
  };

  let retasses = 0;
  let deplaces = 0;
  let d = await calculer();

  for (let tours = 1; ; tours++) {
    let echec = d === null;
    if (d && d.length > 0) {
      try {
        await f.appliquerDeplacements(d);
        deplaces += d.length;
      } catch (e: any) {
        console.error("[precedence] application des déplacements impossible, re-tassage seul :", e?.message);
        echec = true;
      }
    }

    retasses += await f.retasser();
    if (echec) return { tours, retasses, deplaces, stable: false };

    // Le re-tassage a-t-il recréé une violation ?
    d = await calculer();
    if (d === null) return { tours, retasses, deplaces, stable: false };
    if (d.length === 0) return { tours, retasses, deplaces, stable: true };
    if (tours >= maxTours) return { tours, retasses, deplaces, stable: false };
  }
}

// ── Aides pures pour storage.fixOverlappingTasks ────────────────────────────────

const JOURS_VALIDES = new Set(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]);
const JOURS_DEFAUT = "mon,tue,wed,thu,fri";
const heureValide = (h: unknown): h is string => {
  if (typeof h !== "string" || !/^\d{2}:\d{2}$/.test(h)) return false;
  const [a, b] = h.split(":").map(Number);
  return a < 24 && b < 60;
};
const enMinutes = (h: string) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };

/**
 * Calendrier de la règle de précédence, avec les MÊMES défauts que le re-tassage
 * (09:00 / 18:00 / lun-ven / tampon 10 plafonné à `plafondTampon`). La règle exige des
 * valeurs valides : toute préférence malformée retombe sur le défaut.
 */
export function calendrierDepuisPreferences(
  prefs: { workDays?: string | null; workDayStart?: string | null; workDayEnd?: string | null; bufferMin?: number | null } | null | undefined,
  plafondTampon: number,
): Calendrier {
  const jours = new Set(
    (prefs?.workDays || JOURS_DEFAUT).split(",").map((j) => j.trim().toLowerCase()).filter((j) => JOURS_VALIDES.has(j)),
  );
  let debut = heureValide(prefs?.workDayStart) ? prefs!.workDayStart! : "09:00";
  let fin = heureValide(prefs?.workDayEnd) ? prefs!.workDayEnd! : "18:00";
  if (enMinutes(debut) >= enMinutes(fin)) { debut = "09:00"; fin = "18:00"; }
  const brut = prefs?.bufferMin ?? 10;
  const tampon = Number.isFinite(brut) ? Math.min(plafondTampon, Math.max(0, brut)) : 10;
  return {
    joursTravailles: jours.size > 0 ? jours : new Set(JOURS_DEFAUT.split(",")),
    debutJournee: debut,
    finJournee: fin,
    tamponMin: tampon,
  };
}

/**
 * Filtre prudent des déplacements proposés par la règle :
 *  - jamais dans le passé (date antérieure à aujourd'hui, ou aujourd'hui avant « maintenant ») :
 *    le re-tassage, qui porte la garde « pas avant maintenant », s'en charge ;
 *  - jamais une tâche à créneau fixe (rituel) : le re-tassage promet de ne pas la bouger.
 */
export function deplacementsAdmissibles(
  d: DeplacementPlanning[],
  ctx: { aujourdhui: string; maintenantMin: number; idsFixes: Set<number> },
): DeplacementPlanning[] {
  return d.filter((x) => {
    if (ctx.idsFixes.has(x.id)) return false;
    if (x.scheduledDate < ctx.aujourdhui) return false;
    if (x.scheduledDate === ctx.aujourdhui && enMinutes(x.scheduledTime) < ctx.maintenantMin) return false;
    return true;
  });
}
