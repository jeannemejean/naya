// server/services/groupes-marques/attribution.ts — composeur sur un groupe de marques (lot 9).
// Chaque cible du post croisé est rattachée à UNE marque du groupe : celle qu'elle désigne
// (`projectId` de la cible), dont le périmètre réseaux (portee.ts) doit contenir le compte
// choisi. Fonction pure : la règle de sécurité tient ici, testée seule.
import { comptesDuPerimetre, porteeReseauxDe } from "../connexions/portee";

export interface MarqueDuGroupe { id: number; projectKind?: string | null }
export interface CibleGroupe { socialAccountId?: number | string | null; projectId?: number | string | null }

export type AttributionMarques =
  | { ok: true; projectIds: number[] }
  | { ok: false; message: "marque_hors_groupe" | "compte_hors_projet" | "marque_ambigue" | "marque_manquante"; index: number };

/**
 * La marque de chaque cible, dans l'ordre des cibles.
 *  - cible avec `projectId` : la marque doit être du groupe ; son compte (s'il y en a un) doit
 *    être dans le périmètre de CETTE marque ;
 *  - cible sans `projectId` mais avec un compte : la seule marque du groupe dont le périmètre
 *    contient le compte ; s'il y en a plusieurs (compte des Réglages, repli de projets perso),
 *    celle qui possède le compte, sinon `marque_ambigue` ;
 *  - cible sans l'un ni l'autre : `marque_manquante` (on ne devine jamais une marque).
 */
export function attribuerMarques<C extends { id: number; platform: string; projectId?: number | null }>(
  cibles: CibleGroupe[],
  marques: MarqueDuGroupe[],
  comptes: C[],
): AttributionMarques {
  const permisDe = new Map<number, Set<number>>(
    marques.map((m) => [m.id, new Set(comptesDuPerimetre(comptes, porteeReseauxDe(m)).map((c) => c.id))]),
  );
  const projectIds: number[] = [];
  for (let index = 0; index < cibles.length; index++) {
    const c = cibles[index] ?? {};
    const compteId = c.socialAccountId != null && c.socialAccountId !== "" ? Number(c.socialAccountId) : null;
    if (c.projectId != null && c.projectId !== "") {
      const pid = Number(c.projectId);
      const permis = permisDe.get(pid);
      if (!permis) return { ok: false, message: "marque_hors_groupe", index };
      if (compteId != null && !permis.has(compteId)) return { ok: false, message: "compte_hors_projet", index };
      projectIds.push(pid);
      continue;
    }
    if (compteId == null) return { ok: false, message: "marque_manquante", index };
    const candidates = marques.filter((m) => permisDe.get(m.id)!.has(compteId));
    if (candidates.length === 0) return { ok: false, message: "compte_hors_projet", index };
    if (candidates.length === 1) { projectIds.push(candidates[0].id); continue; }
    const proprietaire = comptes.find((x) => x.id === compteId)?.projectId ?? null;
    const m = candidates.find((x) => x.id === proprietaire);
    if (!m) return { ok: false, message: "marque_ambigue", index };
    projectIds.push(m.id);
  }
  return { ok: true, projectIds };
}
