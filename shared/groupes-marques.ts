// shared/groupes-marques.ts — groupes de marques (lot 9, inspiré des « brand groups » de
// Metricool) : un paquet de projets piloté ensemble (calendrier, composeur). Règles pures.

export const NOM_GROUPE_MAX = 80;
export const PROJETS_PAR_GROUPE_MAX = 50;
export const GROUPES_MAX = 50;
export const COULEUR_GROUPE_DEFAUT = "#6366f1";
const COULEUR_RE = /^#[0-9a-fA-F]{6}$/;

export interface GroupeSaisi { nom: string; couleur: string; projectIds: number[] }

const idsPositifs = (v: unknown): number[] | null => {
  if (!Array.isArray(v) || v.length > PROJETS_PAR_GROUPE_MAX) return null;
  const ids = v.map(Number);
  if (!ids.every((n) => Number.isInteger(n) && n > 0)) return null;
  return Array.from(new Set(ids));
};

/**
 * Un groupe envoyé par l'écran ; null s'il est illisible. `partiel` (modification) : seuls les
 * champs présents sont lus et rendus.
 */
export function lireGroupeMarques(body: unknown, partiel = false): Partial<GroupeSaisi> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const out: Partial<GroupeSaisi> = {};
  if (b.nom !== undefined || !partiel) {
    if (typeof b.nom !== "string") return null;
    const nom = b.nom.trim();
    if (!nom || nom.length > NOM_GROUPE_MAX) return null;
    out.nom = nom;
  }
  if (b.couleur !== undefined) {
    if (typeof b.couleur !== "string" || !COULEUR_RE.test(b.couleur)) return null;
    out.couleur = b.couleur.toLowerCase();
  } else if (!partiel) out.couleur = COULEUR_GROUPE_DEFAUT;
  if (b.projectIds !== undefined || !partiel) {
    const ids = idsPositifs(b.projectIds ?? []);
    if (!ids) return null;
    out.projectIds = ids;
  }
  return out;
}

/**
 * Les projets d'un groupe, en ne gardant que ceux de l'utilisatrice. null : groupe inconnu ou
 * d'un autre compte (le groupe est introuvable, jamais « vide »).
 */
export function projetsDuGroupe(
  groupe: { id: number; userId: string } | null | undefined,
  liens: Array<{ groupeId: number; projectId: number }>,
  projetsDeLUtilisatrice: Array<{ id: number; userId?: string }>,
  userId: string,
): number[] | null {
  if (!groupe || groupe.userId !== userId) return null;
  const siens = new Set(projetsDeLUtilisatrice.filter((p) => p.userId === undefined || p.userId === userId).map((p) => p.id));
  const ids = liens.filter((l) => l.groupeId === groupe.id && siens.has(l.projectId)).map((l) => l.projectId);
  return Array.from(new Set(ids));
}

/** Le filtre de marques d'une requête de liste : `groupeId` ou `projectId` (jamais les deux). */
export type FiltreMarques =
  | { ok: true; projectIds?: number | number[] }
  | { ok: false; status: 400 | 404; message: string };

export async function filtreMarquesDeRequete(
  query: Record<string, unknown>,
  resoudreGroupe: (groupeId: number) => Promise<number[] | null>,
): Promise<FiltreMarques> {
  const { projectId, groupeId } = query;
  if (projectId !== undefined && groupeId !== undefined) return { ok: false, status: 400, message: "projectId_ou_groupeId" };
  if (projectId !== undefined) {
    const n = Number(projectId);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, status: 400, message: "Invalid projectId" };
    return { ok: true, projectIds: n };
  }
  if (groupeId !== undefined) {
    const g = Number(groupeId);
    if (!Number.isInteger(g) || g <= 0) return { ok: false, status: 400, message: "Invalid groupeId" };
    const ids = await resoudreGroupe(g);
    if (!ids) return { ok: false, status: 404, message: "not_found" };
    return { ok: true, projectIds: ids };
  }
  return { ok: true };
}
