// « Publier » est tenue par l'heure du post. Quand cette heure tombe sur un rendez-vous ou une
// tâche terminée (cas du 13 octobre : Publier 11:00 sur « serrure » 10:00–11:30), le post et sa
// tâche glissent au premier créneau libre du MÊME jour — jamais de chevauchement, jamais un
// autre jour (l'échéance du post reste son jour). Fonctions pures.

export interface Plage { start: number; end: number }

/** Premier début ≥ `debut` où [début, début+durée) ne touche aucune plage ; null si minuit est dépassé. */
export function heurePublicationLibre(a: { debut: number; duree: number; occupes: Plage[]; finJournee?: number }): number | null {
  const fin = a.finJournee ?? 24 * 60;
  let d = a.debut;
  for (let i = 0; i < 500; i++) {
    const bloc = a.occupes.find((r) => d < r.end && d + a.duree > r.start);
    if (!bloc) return d + a.duree <= fin ? d : null;
    d = bloc.end;
  }
  return null;
}

const EN_COURS = new Set(["posted", "posting", "uploading", "processing"]);

/** Un post déjà parti (ou en train de partir), ou un créneau passé, ne bouge jamais. */
export function peutDeplacerPublication(
  post: { publishedAt?: Date | string | null; postStatus?: string | null } | undefined,
  jour: string,
  debut: number,
  maintenant: { jour: string; minute: number },
): boolean {
  if (!post || post.publishedAt || EN_COURS.has(post.postStatus ?? "")) return false;
  if (jour < maintenant.jour) return false;
  if (jour === maintenant.jour && debut < maintenant.minute) return false;
  return true;
}

/** Paires de tâches qui se recouvrent le même jour (surveillance après re-tassage). */
export function chevauchements(
  taches: Array<{ id: number; scheduledDate: string | null; scheduledTime: string | null; estimatedDuration: number | null }>,
): Array<{ jour: string; a: number; b: number }> {
  const m = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  const placees = taches
    .filter((t) => t.scheduledDate && t.scheduledTime && /^\d{2}:\d{2}$/.test(t.scheduledTime))
    .map((t) => ({ id: t.id, jour: t.scheduledDate!, s: m(t.scheduledTime!), e: m(t.scheduledTime!) + (t.estimatedDuration || 30) }))
    .sort((x, y) => x.jour.localeCompare(y.jour) || x.s - y.s || x.id - y.id);
  const r: Array<{ jour: string; a: number; b: number }> = [];
  for (let i = 0; i < placees.length; i++) {
    for (let k = i + 1; k < placees.length && placees[k].jour === placees[i].jour && placees[k].s < placees[i].e; k++) {
      r.push({ jour: placees[i].jour, a: placees[i].id, b: placees[k].id });
    }
  }
  return r;
}
