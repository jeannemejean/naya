// Connexion / déconnexion d'un compte propre à un projet : les posts programmés de ce projet
// qui visaient un compte désormais hors périmètre suivent le nouveau compte ; à la déconnexion
// (projet perso), ils repartent sur le compte des Réglages s'il existe.
import { describe, it, expect, vi } from "vitest";
import { repointerApresConnexion, repointerAvantDeconnexion, type DepsRepointage } from "./repointage";

const igReglages = { id: 1, platform: "instagram", projectId: null, isActive: true };
const igProjet = { id: 2, platform: "instagram", projectId: 5, isActive: true };
const liReglages = { id: 3, platform: "linkedin", projectId: null, isActive: true };
const pageProjet = { id: 4, platform: "linkedin_page_300", projectId: 5, isActive: true };

function fausses(comptes: any[], posts: any[]) {
  const deps: DepsRepointage = {
    comptes: vi.fn(async () => comptes),
    postsEnAttente: vi.fn(async () => posts),
    repointer: vi.fn(async () => true),
    journaliser: vi.fn(async () => {}),
  };
  return deps;
}
const perso = { portee: 5, repli: true };

describe("repointerApresConnexion", () => {
  it("projet perso : un post épinglé au compte des Réglages (désormais hors périmètre) suit le nouveau compte", async () => {
    const deps = fausses([igReglages, igProjet], [
      { id: 10, platform: "Instagram", socialAccountId: 1 },
      { id: 11, platform: "instagram", socialAccountId: 2 },
      { id: 12, platform: "linkedin", socialAccountId: 3 },
      { id: 13, platform: "instagram", socialAccountId: null },
    ]);
    expect(await repointerApresConnexion(deps, "u1", perso, "instagram")).toEqual([10]);
    expect(deps.postsEnAttente).toHaveBeenCalledWith("u1", 5);
    expect(deps.repointer).toHaveBeenCalledTimes(1);
    expect(deps.repointer).toHaveBeenCalledWith("u1", 10, 1, 2);
    expect(deps.journaliser).toHaveBeenCalledWith("u1", 10, "compte_change", { de: 1, vers: 2, raison: "connexion" });
  });

  it("aucun compte propre actif pour ce réseau (page client en attente) : rien", async () => {
    const deps = fausses([igReglages, { ...igProjet, isActive: false }], [{ id: 10, platform: "instagram", socialAccountId: 1 }]);
    expect(await repointerApresConnexion(deps, "u1", perso, "instagram")).toEqual([]);
    expect(deps.repointer).not.toHaveBeenCalled();
  });

  it("LinkedIn : la page du projet couvre le réseau", async () => {
    const deps = fausses([liReglages, pageProjet, { id: 9, platform: "linkedin_page_1", projectId: 8, isActive: true }], [
      { id: 20, platform: "linkedin", socialAccountId: 9 },
    ]);
    expect(await repointerApresConnexion(deps, "u1", perso, "linkedin")).toEqual([20]);
    expect(deps.repointer).toHaveBeenCalledWith("u1", 20, 9, 4);
  });

  it("sans projet (Réglages) : rien", async () => {
    const deps = fausses([igReglages], []);
    expect(await repointerApresConnexion(deps, "u1", { portee: null, repli: false }, "instagram")).toEqual([]);
    expect(deps.postsEnAttente).not.toHaveBeenCalled();
  });
});

describe("repointerAvantDeconnexion", () => {
  it("projet perso : les posts du compte déconnecté repartent sur celui des Réglages", async () => {
    const deps = fausses([igReglages, igProjet], [
      { id: 10, platform: "instagram", socialAccountId: 2 },
      { id: 11, platform: "instagram", socialAccountId: 1 },
    ]);
    expect(await repointerAvantDeconnexion(deps, "u1", perso, igProjet)).toEqual([10]);
    expect(deps.repointer).toHaveBeenCalledWith("u1", 10, 2, 1);
    expect(deps.journaliser).toHaveBeenCalledWith("u1", 10, "compte_change", { de: 2, vers: 1, raison: "deconnexion" });
  });

  it("projet client, ou pas de compte aux Réglages : rien (l'alerte habituelle dira le compte supprimé)", async () => {
    let deps = fausses([igReglages, { ...igProjet, projectId: 7 }], [{ id: 10, platform: "instagram", socialAccountId: 2 }]);
    expect(await repointerAvantDeconnexion(deps, "u1", { portee: 7, repli: false }, { ...igProjet, projectId: 7 })).toEqual([]);
    deps = fausses([igProjet], [{ id: 10, platform: "instagram", socialAccountId: 2 }]);
    expect(await repointerAvantDeconnexion(deps, "u1", perso, igProjet)).toEqual([]);
    expect(deps.repointer).not.toHaveBeenCalled();
  });

  it("une écriture refusée (déjà parti entre-temps) n'est pas journalisée", async () => {
    const deps = fausses([igReglages, igProjet], [{ id: 10, platform: "instagram", socialAccountId: 2 }]);
    (deps.repointer as any).mockResolvedValueOnce(false);
    expect(await repointerAvantDeconnexion(deps, "u1", perso, igProjet)).toEqual([]);
    expect(deps.journaliser).not.toHaveBeenCalled();
  });
});
