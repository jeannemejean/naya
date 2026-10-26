// Reprise des tâches non faites — où elles vont (spec 2026-10-26-naya-reprise-intelligente-design.md).
//
// Le report aveugle posait tout au jour ouvré suivant, plafonné à 8 : le reste restait dans
// le passé, et une tâche dont l'échéance tombait mercredi pouvait partir jeudi. Ici, chaque
// tâche va au premier jour ouvré qui a VRAIMENT la place (un trou dans la journée, et pas
// plus de tâches que la journée n'en supporte), les plus urgentes pour l'objectif d'abord,
// jamais après leur date « au plus tard » quand on peut l'éviter. Les sous-tâches d'une
// tâche découpée se suivent ; l'atelier garde le jour que sa semaine lui donne.

export interface ElementAPlacer {
  cle: string;
  duree: number;
  priorite: 1 | 2 | 3;
  /** Jour imposé (atelier) : la tâche y va, même si la journée est pleine. */
  jourExact?: string | null;
  /** Pas avant ce jour. */
  jourMin?: string | null;
  /** Pas après ce jour, si c'est possible. */
  jourMax?: string | null;
  /** Ne passe qu'après cet élément (même jour permis). */
  apres?: string | null;
  /** Départage à priorité égale : l'ancienne date prévue (la plus vieille d'abord). */
  ordre?: string | null;
}

export interface Calendrier {
  /** Jours ouvrés candidats, dans l'ordre, à partir du premier jour de reprise. */
  jours: string[];
  aDeLaPlace(jour: string, duree: number): boolean;
  /** Tâches qu'on peut encore ajouter ce jour-là (plafond de la journée moins ce qui y est déjà). */
  placesRestantes(jour: string): number;
  /**
   * Réserve le créneau et rend l'heure (HH:MM), ou null si, vérification faite (agenda,
   * fin de journée), la journée n'a finalement pas la place. `forcer` : rendre une heure quand même.
   */
  reserver(jour: string, duree: number, forcer?: boolean): Promise<string | null>;
}

export interface Placement { jour: string; heure: string }

const FIN = "9999-12-31";
/** Jours ouvrés « proches » : la semaine qui vient. */
export const JOURS_PROCHES = 5;

/** Place chaque élément ; rend jour et heure par clé. L'ordre des réservations est déterministe. */
export async function placerElements(elements: ElementAPlacer[], cal: Calendrier): Promise<Map<string, Placement>> {
  const resultat = new Map<string, Placement>();
  if (cal.jours.length === 0) return resultat;
  const restantes = new Map<string, number>();
  const places = (j: string) => restantes.get(j) ?? Math.max(0, cal.placesRestantes(j));
  /** Le premier jour de la liste qui a vraiment la place ; à défaut, `secours`, forcé. */
  const prendre = async (cle: string, jours: string[], duree: number, secours: string) => {
    let jour = secours;
    let heure: string | null = null;
    for (const j of Array.from(new Set(jours))) {
      heure = await cal.reserver(j, duree);
      if (heure != null) { jour = j; break; }
    }
    heure ??= (await cal.reserver(secours, duree, true)) ?? "09:00";
    restantes.set(jour, places(jour) - 1);
    resultat.set(cle, { jour, heure });
  };

  // 1. Les jours imposés d'abord : ils ne se négocient pas.
  for (const e of elements.filter((x) => x.jourExact)) await prendre(e.cle, [e.jourExact!], e.duree, e.jourExact!);

  // 2. Le reste par chaîne (une tâche et ses suites), la chaîne la plus urgente d'abord.
  const libres = elements.filter((x) => !x.jourExact);
  const parCle = new Map(libres.map((e) => [e.cle, e]));
  const tete = (e: ElementAPlacer): ElementAPlacer => {
    let x = e;
    for (let i = 0; i < 20 && x.apres && parCle.has(x.apres); i++) x = parCle.get(x.apres)!;
    return x;
  };
  const rang = (e: ElementAPlacer): number => {
    let n = 0;
    for (let x = e; x.apres && parCle.has(x.apres) && n < 20; x = parCle.get(x.apres)!) n++;
    return n;
  };
  const cleTri = (e: ElementAPlacer) => {
    const t = tete(e);
    // La chaîne prend l'échéance la plus serrée de ses éléments.
    const chaine = libres.filter((x) => tete(x) === t);
    const max = chaine.map((x) => x.jourMax ?? FIN).sort()[0];
    return { max, priorite: Math.min(...chaine.map((x) => x.priorite)), ordre: t.ordre ?? "", tete: t.cle, rang: rang(e) };
  };
  const tries = libres
    .map((e) => ({ e, k: cleTri(e) }))
    .sort((a, b) =>
      a.k.max.localeCompare(b.k.max) || a.k.priorite - b.k.priorite || a.k.ordre.localeCompare(b.k.ordre)
      || a.k.tete.localeCompare(b.k.tete) || a.k.rang - b.k.rang);

  for (const { e } of tries) {
    const precedent = e.apres ? resultat.get(e.apres)?.jour : undefined;
    const plancher = [cal.jours[0], e.jourMin ?? "", precedent ?? ""].sort().pop()!;
    const candidats = cal.jours.filter((j) => j >= plancher);
    if (candidats.length === 0) { await prendre(e.cle, [], e.duree, plancher); continue; }
    const max = e.jourMax ?? FIN;
    // La semaine qui vient : une tâche reprise n'est pas renvoyée à plus tard tant qu'une
    // journée proche a un vrai trou (essai sur les données réelles du 26 oct. : le seul
    // plafond en nombre de tâches renvoyait au 6 et au 10 novembre des tâches qui tenaient
    // dans les trous de la semaine).
    const proches = new Set(candidats.slice(0, JOURS_PROCHES));
    const confortable = (j: string) => places(j) > 0 && cal.aDeLaPlace(j, e.duree);
    const aLaPlace = (j: string) => cal.aDeLaPlace(j, e.duree);
    // Les jours par ordre de préférence : si la vérification en base refuse le premier
    // (un rendez-vous, la fin de journée), on passe au suivant.
    const preferes = [
      // dans la semaine qui vient, avant l'échéance, une journée qui a encore de la place ;
      ...candidats.filter((j) => proches.has(j) && j <= max && confortable(j)),
      // une échéance plus loin : un jour confortable avant elle, sinon un simple trou ;
      ...(e.jourMax ? [...candidats.filter((j) => j <= max && confortable(j)), ...candidats.filter((j) => j <= max && aLaPlace(j))] : []),
      // sinon un trou dans la semaine qui vient, même si la journée est chargée ;
      ...candidats.filter((j) => proches.has(j) && aLaPlace(j)),
      // sinon le premier jour qui a la place, même après l'échéance ;
      ...candidats.filter(confortable),
      ...candidats.filter(aLaPlace),
    ];
    // Rien nulle part : au plus tôt, le re-tassage fera déborder.
    await prendre(e.cle, preferes, e.duree, preferes[0] ?? candidats[0]);
  }
  return resultat;
}
