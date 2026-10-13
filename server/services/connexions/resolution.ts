// server/services/connexions/resolution.ts — qui envoie pour une campagne de prospection :
// campagne → projet → périmètre → réglages de l'utilisatrice ou connexion du client. Seul
// chemin utilisé par l'envoi, la synchro LinkedIn et l'aperçu (même signature partout).
import { storage } from "../../storage";
import { identiteEnvoi, porteeDe, type IdentiteEnvoi, type Portee } from "./portee";

export interface DepsResolution {
  getProspectionCampaign(id: number): Promise<any>;
  getProject(id: number, userId: string): Promise<any>;
  getConnexionProjet(userId: string, projectId: number): Promise<any>;
}

const depsReelles: DepsResolution = {
  getProspectionCampaign: (id) => storage.getProspectionCampaign(id),
  getProject: (id, userId) => storage.getProject(id, userId),
  getConnexionProjet: (userId, projectId) => storage.getConnexionProjet(userId, projectId),
};

const RIEN: IdentiteEnvoi = { email: null, linkedin: null, signature: null };

export async function identiteCampagne(
  userId: string, campaignId: number, prefs: any, deps: DepsResolution = depsReelles,
): Promise<{ portee: Portee; identite: IdentiteEnvoi }> {
  return identitePourCampagne(userId, await deps.getProspectionCampaign(campaignId), prefs, deps);
}

/** Même résolution, depuis une campagne déjà chargée. */
export async function identitePourCampagne(
  userId: string, campagne: any, prefs: any, deps: Pick<DepsResolution, "getProject" | "getConnexionProjet"> = depsReelles,
): Promise<{ portee: Portee; identite: IdentiteEnvoi }> {
  // Campagne d'une autre : aucune identité (rien ne part). Introuvable : aucun projet connu,
  // donc le périmètre de l'utilisatrice (comportement historique).
  if (campagne?.userId && campagne.userId !== userId) return { portee: null, identite: RIEN };
  const projet = campagne?.projectId != null ? await deps.getProject(campagne.projectId, userId) : null;
  const portee = porteeDe(projet);
  const connexion = portee != null ? await deps.getConnexionProjet(userId, portee) : null;
  return { portee, identite: identiteEnvoi(portee, prefs, connexion) };
}

/**
 * Projet client sans signature : rien ne se rédige (un message en cache garderait sinon la
 * signature de l'utilisatrice, puis partirait de l'adresse du client).
 */
export class SignatureClientManquanteError extends Error {
  code = "signature_client_manquante";
  constructor() { super("signature_client_manquante"); }
}

/** La signature des messages d'une campagne ; client sans signature → refus (jamais celle de l'utilisatrice). */
export function signatureCampagne(
  resolu: { portee: Portee; identite: IdentiteEnvoi }, signatureUtilisatrice: () => string,
): string {
  if (resolu.portee != null) {
    if (!resolu.identite.signature) throw new SignatureClientManquanteError();
    return resolu.identite.signature;
  }
  return signatureUtilisatrice();
}
