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

export interface DepsNature {
  getProspectionCampaigns(userId: string): Promise<Array<{ id: number; projectId?: number | null }>>;
  getEnrollmentsByCampaign(campaignId: number): Promise<{ leadId: number; status: string }[]>;
  purgeLeadStepMessagesForCampaign(campaignId: number): Promise<unknown>;
}
const depsNature: DepsNature = {
  getProspectionCampaigns: (u) => storage.getProspectionCampaigns(u) as any,
  getEnrollmentsByCampaign: (id) => storage.getEnrollmentsByCampaign(id),
  purgeLeadStepMessagesForCampaign: (id) => storage.purgeLeadStepMessagesForCampaign(id),
};

/**
 * Passer un projet de client à perso (ou l'inverse) change qui envoie et qui signe pour toutes
 * ses campagnes : même règle que changer le projet d'une campagne — refusé pendant des
 * séquences en cours ; accepté, les messages déjà rédigés sont périmés.
 */
export async function controleChangementNature(
  args: { userId: string; projectId: number; avant: string | null | undefined; corps: any },
  deps: DepsNature = depsNature,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const nouveau = args.corps?.projectKind;
  if (nouveau === undefined || nouveau === (args.avant ?? "personal")) return { ok: true };
  const campagnes = (await deps.getProspectionCampaigns(args.userId)).filter((c) => c.projectId === args.projectId);
  for (const c of campagnes) {
    const enrol = await deps.getEnrollmentsByCampaign(c.id);
    if (enrol.some((e) => EN_COURS.has(e.status))) return { ok: false, status: 409, message: "campagne_en_cours" };
  }
  for (const c of campagnes) await deps.purgeLeadStepMessagesForCampaign(c.id);
  return { ok: true };
}
