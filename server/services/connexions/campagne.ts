// server/services/connexions/campagne.ts — le projet d'une campagne de prospection décide
// de qui envoie (mode agence). On ne le rattache qu'à un projet de l'utilisatrice, et on ne
// le change pas tant que des séquences sont en cours (les messages déjà rédigés porteraient
// la signature de l'autre périmètre).
import { storage } from "../../storage";

const EN_COURS = new Set(["active", "paused"]);

export interface DepsCampagne {
  getProject(id: number, userId: string): Promise<any>;
  getEnrollmentsByCampaign(campaignId: number): Promise<{ leadId: number; status: string }[]>;
}
const depsReelles: DepsCampagne = {
  getProject: (id, userId) => storage.getProject(id, userId),
  getEnrollmentsByCampaign: (id) => storage.getEnrollmentsByCampaign(id),
};

export type ControleCampagne = { ok: true; change: boolean } | { ok: false; status: number; message: string };

export async function controleProjetCampagne(
  args: { userId: string; corps: any; existante?: { id: number; projectId?: number | null } },
  deps: DepsCampagne = depsReelles,
): Promise<ControleCampagne> {
  const corps = args.corps ?? {};
  if (!Object.prototype.hasOwnProperty.call(corps, "projectId")) return { ok: true, change: false };
  const brut = corps.projectId;
  let projectId: number | null = null;
  if (brut !== null && brut !== undefined && brut !== "") {
    const id = Number(brut);
    if (!Number.isInteger(id) || id <= 0 || !(await deps.getProject(id, args.userId))) {
      return { ok: false, status: 404, message: "projet_introuvable" };
    }
    projectId = id;
  }
  if (!args.existante) return { ok: true, change: true };
  if ((args.existante.projectId ?? null) === projectId) return { ok: true, change: false };
  const enrolements = await deps.getEnrollmentsByCampaign(args.existante.id);
  if (enrolements.some((e) => EN_COURS.has(e.status))) return { ok: false, status: 409, message: "campagne_en_cours" };
  return { ok: true, change: true };
}
