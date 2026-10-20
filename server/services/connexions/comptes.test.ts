import { describe, it, expect, vi } from "vitest";
import { compteDePublication, depsComptesMemorisees, porteeDuProjet } from "./comptes";

const igJeanne = { id: 1, platform: "instagram", projectId: null, isActive: true };
const igClient = { id: 2, platform: "instagram", projectId: 7, isActive: true };

function deps(projets: Record<number, any>, comptes: any[]) {
  return {
    getProject: vi.fn(async (id: number, userId: string) => (projets[id]?.userId === userId ? projets[id] : undefined)),
    getSocialAccounts: vi.fn(async () => comptes),
  };
}

describe("porteeDuProjet", () => {
  it("lit le projet de l'utilisatrice ; aucun projet → utilisatrice", async () => {
    const d = deps({ 7: { id: 7, userId: "u", projectKind: "client" } }, []);
    expect(await porteeDuProjet("u", 7, d)).toBe(7);
    expect(await porteeDuProjet("u", null, d)).toBeNull();
    expect(d.getProject).toHaveBeenCalledTimes(1);
  });
});

describe("compteDePublication", () => {
  it("post d'un projet client sans compte client : échec, même si l'utilisatrice a le compte", async () => {
    const d = deps({ 7: { id: 7, userId: "u", projectKind: "client" } }, [igJeanne]);
    expect(await compteDePublication({ userId: "u", projectId: 7, platform: "instagram" }, d)).toEqual({ erreur: "compte_absent" });
  });
  it("post d'un projet client : le compte du client", async () => {
    const d = deps({ 7: { id: 7, userId: "u", projectKind: "client" } }, [igJeanne, igClient]);
    expect(await compteDePublication({ userId: "u", projectId: 7, platform: "Instagram" }, d)).toEqual({ compte: igClient });
  });
  it("post perso ou sans projet : le compte de l'utilisatrice, jamais celui d'un client", async () => {
    const d = deps({ 5: { id: 5, userId: "u", projectKind: "personal" } }, [igClient, igJeanne]);
    expect(await compteDePublication({ userId: "u", projectId: 5, platform: "instagram" }, d)).toEqual({ compte: igJeanne });
    expect(await compteDePublication({ userId: "u", projectId: null, platform: "instagram" }, d)).toEqual({ compte: igJeanne });
    expect(await compteDePublication({ userId: "u", platform: "instagram", socialAccountId: 2 }, d)).toEqual({ erreur: "compte_hors_projet" });
  });
});

describe("depsComptesMemorisees", () => {
  it("chaque projet et la liste des comptes ne sont lus qu'une fois pour plusieurs posts", async () => {
    const d = deps({ 7: { id: 7, userId: "u", projectKind: "client" } }, [igJeanne, igClient]);
    const memo = depsComptesMemorisees(d);
    await Promise.all([1, 2, 3].map(() => compteDePublication({ userId: "u", projectId: 7, platform: "instagram" }, memo)));
    expect(d.getProject).toHaveBeenCalledTimes(1);
    expect(d.getSocialAccounts).toHaveBeenCalledTimes(1);
  });
});
