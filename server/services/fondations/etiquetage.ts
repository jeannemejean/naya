/**
 * Étiquetage des contenus d'un projet par motivation d'achat (angle) et format créatif.
 */
import { FORMATS_CREATIFS, ANGLE_AUCUN } from "./catalogues";
import { lireProposition } from "./sections";

export type Etiquette = { id: number; angle: string; formatCreatif: string | null };

/** Les étiquettes lisibles de la réponse de l'IA ; null si la réponse est illisible. PUR. */
export function lireEtiquettes(reponse: string, ids: Set<number>, cles: Set<string>): Etiquette[] | null {
  const o = lireProposition(reponse);
  if (!Array.isArray(o.etiquettes)) return null;
  const vus = new Set<number>();
  const out: Etiquette[] = [];
  for (const e of o.etiquettes as any[]) {
    const id = Number(e?.id);
    if (!ids.has(id) || vus.has(id)) continue;
    const angle = typeof e?.angle === "string" ? e.angle : "";
    if (angle !== ANGLE_AUCUN && !cles.has(angle)) continue;
    vus.add(id);
    out.push({ id, angle, formatCreatif: (FORMATS_CREATIFS as readonly string[]).includes(e?.format) ? e.format : null });
  }
  return out;
}
