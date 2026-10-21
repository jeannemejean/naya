// server/services/connexions/comptes.ts — le compte social qui publie un post, dans le
// périmètre de son projet. Seul chemin de résolution pour toute publication (worker,
// publication manuelle, programmation) : un post de projet client ne part qu'avec un
// compte du client.
import { storage } from "../../storage";
import { choisirCompte, porteeDe, type ChoixCompte, type Portee } from "./portee";

export interface DepsComptes {
  getProject(id: number, userId: string): Promise<any>;
  getSocialAccounts(userId: string): Promise<any[]>;
}

const depsReelles: DepsComptes = {
  getProject: (id, userId) => storage.getProject(id, userId),
  getSocialAccounts: (userId) => storage.getSocialAccounts(userId),
};

/**
 * Les mêmes lectures, mémorisées le temps d'une requête : un écran qui résout le compte de
 * plusieurs posts (l'atelier) lit chaque projet et la liste des comptes une seule fois.
 */
export function depsComptesMemorisees(base: DepsComptes = depsReelles): DepsComptes {
  const projets = new Map<number, Promise<any>>();
  let comptes: Promise<any[]> | null = null;
  return {
    getProject: (id, userId) => {
      if (!projets.has(id)) projets.set(id, base.getProject(id, userId));
      return projets.get(id)!;
    },
    getSocialAccounts: (userId) => (comptes ??= base.getSocialAccounts(userId)),
  };
}

export async function porteeDuProjet(userId: string, projectId: number | null | undefined, deps: DepsComptes = depsReelles): Promise<Portee> {
  if (projectId == null) return null;
  return porteeDe(await deps.getProject(projectId, userId));
}

export async function compteDePublication(
  post: { userId: string; projectId?: number | null; platform: string; socialAccountId?: number | null },
  deps: DepsComptes = depsReelles,
): Promise<ChoixCompte<any>> {
  const portee = await porteeDuProjet(post.userId, post.projectId, deps);
  return choisirCompte(await deps.getSocialAccounts(post.userId), post, portee);
}
