/**
 * Couverture des angles : combien de contenus par motivation, combien publiés, et la
 * réception moyenne QUAND elle a été mesurée (jamais un 0 inventé). PUR.
 */
import { ANGLE_AUCUN } from "./catalogues";

export type LigneCouverture = { cle: string; nom: string; contenus: number; publies: number; score: number | null; retiree?: boolean };
export type Couverture = { lignes: LigneCouverture[]; horsMotivations: number; nonEtiquetes: number; jamaisExploitees: string[] };

export function couverture(
  motivations: Array<{ cle: string; nom: string }>,
  contenus: Array<{ id: number; angle: string | null; status?: string | null; publishedAt?: Date | string | null }>,
  scores: Array<{ contentId: number; score: number }>,
): Couverture {
  const scoreDe = new Map(scores.map((s) => [s.contentId, s.score]));
  const parAngle = new Map<string, typeof contenus>();
  let horsMotivations = 0;
  let nonEtiquetes = 0;
  for (const c of contenus) {
    if (!c.angle) { nonEtiquetes++; continue; }
    if (c.angle === ANGLE_AUCUN) { horsMotivations++; continue; }
    parAngle.set(c.angle, [...(parAngle.get(c.angle) || []), c]);
  }
  const ligne = (cle: string, nom: string): LigneCouverture => {
    const cs = parAngle.get(cle) || [];
    const mesures = cs.map((c) => scoreDe.get(c.id)).filter((x): x is number => typeof x === "number");
    return {
      cle, nom, contenus: cs.length,
      publies: cs.filter((c) => c.status === "published" || !!c.publishedAt).length,
      score: mesures.length ? Math.round((mesures.reduce((a, b) => a + b, 0) / mesures.length) * 100) / 100 : null,
    };
  };
  const cles = new Set(motivations.map((m) => m.cle));
  const lignes = motivations.map((m) => ligne(m.cle, m.nom));
  for (const cle of parAngle.keys()) if (!cles.has(cle)) lignes.push({ ...ligne(cle, cle), retiree: true });
  return { lignes, horsMotivations, nonEtiquetes, jamaisExploitees: lignes.filter((l) => !l.retiree && l.contenus === 0).map((l) => l.cle) };
}
