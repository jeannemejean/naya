import { describe, it, expect } from "vitest";
import { filtreMarquesDeRequete, lireGroupeMarques, projetsDuGroupe, NOM_GROUPE_MAX } from "./groupes-marques";

describe("lireGroupeMarques", () => {
  it("création : nom requis (≤ 80), couleur par défaut, projets dédoublonnés", () => {
    expect(lireGroupeMarques({ nom: "  Clients  ", projectIds: [3, "3", 4] })).toEqual({ nom: "Clients", couleur: "#6366f1", projectIds: [3, 4] });
    expect(lireGroupeMarques({ nom: "" })).toBeNull();
    expect(lireGroupeMarques({ nom: "x".repeat(NOM_GROUPE_MAX + 1) })).toBeNull();
    expect(lireGroupeMarques({ nom: "A", couleur: "rouge" })).toBeNull();
    expect(lireGroupeMarques({ nom: "A", projectIds: [0] })).toBeNull();
    expect(lireGroupeMarques({ nom: "A", projectIds: "3" })).toBeNull();
  });
  it("modification : seuls les champs présents", () => {
    expect(lireGroupeMarques({ couleur: "#AABBCC" }, true)).toEqual({ couleur: "#aabbcc" });
    expect(lireGroupeMarques({ projectIds: [] }, true)).toEqual({ projectIds: [] });
    expect(lireGroupeMarques({ nom: 3 }, true)).toBeNull();
  });
});

describe("projetsDuGroupe", () => {
  const liens = [{ groupeId: 1, projectId: 3 }, { groupeId: 1, projectId: 4 }, { groupeId: 1, projectId: 9 }, { groupeId: 2, projectId: 5 }];
  const projets = [{ id: 3, userId: "u1" }, { id: 4, userId: "u1" }, { id: 5, userId: "u1" }, { id: 9, userId: "u2" }];
  it("les projets du groupe qui sont à l'utilisatrice", () => {
    expect(projetsDuGroupe({ id: 1, userId: "u1" }, liens, projets, "u1")).toEqual([3, 4]);
  });
  it("groupe inconnu ou d'un autre compte : null", () => {
    expect(projetsDuGroupe(undefined, liens, projets, "u1")).toBeNull();
    expect(projetsDuGroupe({ id: 1, userId: "u2" }, liens, projets, "u1")).toBeNull();
  });
});

describe("filtreMarquesDeRequete", () => {
  const resoudre = async (g: number) => (g === 1 ? [3, 4] : null);
  it("projectId : inchangé ; groupeId : les projets du groupe ; rien : pas de filtre", async () => {
    expect(await filtreMarquesDeRequete({ projectId: "3" }, resoudre)).toEqual({ ok: true, projectIds: 3 });
    expect(await filtreMarquesDeRequete({ groupeId: "1" }, resoudre)).toEqual({ ok: true, projectIds: [3, 4] });
    expect(await filtreMarquesDeRequete({}, resoudre)).toEqual({ ok: true });
  });
  it("illisible : 400 ; groupe d'un autre compte : 404 ; les deux à la fois : 400", async () => {
    expect(await filtreMarquesDeRequete({ projectId: "x" }, resoudre)).toMatchObject({ ok: false, status: 400 });
    expect(await filtreMarquesDeRequete({ groupeId: "2" }, resoudre)).toMatchObject({ ok: false, status: 404 });
    expect(await filtreMarquesDeRequete({ groupeId: "-1" }, resoudre)).toMatchObject({ ok: false, status: 400 });
    expect(await filtreMarquesDeRequete({ groupeId: "1", projectId: "3" }, resoudre)).toMatchObject({ ok: false, status: 400 });
  });
});
