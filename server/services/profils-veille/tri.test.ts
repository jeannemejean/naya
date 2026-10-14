// server/services/profils-veille/tri.test.ts
import { describe, it, expect, vi } from "vitest";
import { trierPourProjet, formaterBloc, tendancesPourLeContenu, type DepsTri } from "./tri";

const maintenant = new Date("2026-10-19T07:00:00Z");
const r = { userId: "u", projectId: 4, profilId: 7, dernierTri: null };
const T = (id: number, cle: string, plateforme = "instagram") => ({ id, cle, plateforme, typeMedia: "carrousel", structure: "avant_apres", lift: 2, pourquoi: "p", commentAdapter: "c" });

function deps(over: Partial<DepsTri> = {}): DepsTri {
  return {
    estOuvert: vi.fn(async () => true),
    garde: vi.fn(async () => null),
    tendancesSemaine: vi.fn(async () => [T(1, "a"), T(2, "b"), T(3, "c")]),
    ecartees: vi.fn(async () => [{ cle: "b", ecarteLe: new Date("2026-10-01T00:00:00Z") }]),
    projet: vi.fn(async () => ({ nom: "Lune", plateformes: "instagram, linkedin", offre: "Coaching 3 séances", cible: "Femmes 30-45" })),
    choisir: vi.fn(async () => ({ choix: [{ tendanceId: 1, adaptation: "Ta cliente avant/après 3 séances." }, { tendanceId: 2, adaptation: "x" }, { tendanceId: 99, adaptation: "y" }] })),
    enregistrer: vi.fn(async () => {}),
    marquerTri: vi.fn(async () => {}),
    clesRecentes: vi.fn(async () => new Set<string>()),
    ...over,
  };
}

describe("trierPourProjet", () => {
  it("déjà trié cette semaine : rien", async () => {
    const d = deps();
    expect(await trierPourProjet(d, { ...r, dernierTri: "2026-10-19" }, "2026-10-19", maintenant)).toBe("deja");
    expect(d.choisir).not.toHaveBeenCalled();
  });
  it("diffusion fermée (pas owner, variable absente) : rien, sans dépense", async () => {
    const d = deps({ estOuvert: vi.fn(async () => false) });
    expect(await trierPourProjet(d, r, "2026-10-19", maintenant)).toBe("ferme");
    expect(d.choisir).not.toHaveBeenCalled();
  });
  it("écarte les formats bloqués avant l'IA, ignore les ids inventés, au plus 5, expire à 28 jours", async () => {
    const d = deps();
    expect(await trierPourProjet(d, r, "2026-10-19", maintenant)).toBe("ok");
    expect((d.choisir as any).mock.calls[0][0].tendances.map((t: any) => t.id)).toEqual([1, 3]);
    expect(d.enregistrer).toHaveBeenCalledWith([{ userId: "u", projectId: 4, tendanceId: 1, adaptation: "Ta cliente avant/après 3 séances.", statut: "nouveau", expireLe: new Date("2026-11-16T07:00:00Z") }]);
    expect(d.marquerTri).toHaveBeenCalledWith(4, "2026-10-19");
  });
  it("même format déjà proposé (visible ou utilisé < 28 j) : jamais reproposé en double", async () => {
    const d = deps({ ecartees: vi.fn(async () => []), clesRecentes: vi.fn(async () => new Set(["a"])) });
    expect(await trierPourProjet(d, r, "2026-10-19", maintenant)).toBe("ok");
    expect((d.choisir as any).mock.calls[0][0].tendances.map((t: any) => t.id)).toEqual([2, 3]);
    expect(d.clesRecentes).toHaveBeenCalledWith(4, maintenant);
  });
  it("une tendance « en baisse » n'est jamais proposée au tri", async () => {
    const d = deps({ ecartees: vi.fn(async () => []), tendancesSemaine: vi.fn(async () => [{ ...T(1, "a"), statut: "en_baisse" }, { ...T(3, "c"), statut: "confirme" }]) });
    await trierPourProjet(d, r, "2026-10-19", maintenant);
    expect((d.choisir as any).mock.calls[0][0].tendances.map((t: any) => t.id)).toEqual([3]);
  });
  it("aucune tendance cette semaine : marqué trié, sans IA (zéro est normal)", async () => {
    const d = deps({ tendancesSemaine: vi.fn(async () => []) });
    expect(await trierPourProjet(d, r, "2026-10-19", maintenant)).toBe("rien");
    expect(d.choisir).not.toHaveBeenCalled();
    expect(d.marquerTri).toHaveBeenCalledWith(4, "2026-10-19");
  });
  it("erreur IA : non marqué trié (un tour suivant réessaiera)", async () => {
    const d = deps({ choisir: vi.fn(async () => { throw new Error("x"); }) });
    expect(await trierPourProjet(d, r, "2026-10-19", maintenant)).toBe("erreur");
    expect(d.marquerTri).not.toHaveBeenCalled();
  });
});

describe("injection", () => {
  it("bloc court, avec l'identifiant à renvoyer et la consigne de ne jamais copier", () => {
    const b = formaterBloc([{ id: 12, plateforme: "instagram", typeMedia: "carrousel", structure: "avant_apres", lift: 3.1, adaptation: "Une cliente en 3 séances." }]);
    expect(b).toContain("[12] instagram · Carrousel avant/après — contenus forts 3,1× plus souvent");
    expect(b).toContain("Pour cette marque : Une cliente en 3 séances.");
    expect(b).toMatch(/jamais par obligation/);
    expect(b).toMatch(/Ne copie jamais/);
    expect(formaterBloc([])).toBe("");
  });
  it("tendancesPourLeContenu : seulement les tendances visibles des plateformes du post, 5 au plus", async () => {
    const lire = vi.fn(async () => [
      { id: 1, statut: "nouveau", expireLe: new Date("2026-11-01"), plateforme: "instagram", typeMedia: "carrousel", structure: "liste", lift: 2, adaptation: "a" },
      { id: 2, statut: "ecarte", expireLe: new Date("2026-11-01"), plateforme: "instagram", typeMedia: "reel", structure: "liste", lift: 2, adaptation: "b" },
      { id: 3, statut: "nouveau", expireLe: new Date("2026-11-01"), plateforme: "tiktok", typeMedia: "video", structure: "liste", lift: 2, adaptation: "c" },
      { id: 4, statut: "vu", expireLe: new Date("2026-10-01"), plateforme: "instagram", typeMedia: "image", structure: "liste", lift: 2, adaptation: "d" },
    ]);
    const b = await tendancesPourLeContenu("u", 4, ["Instagram"], lire as any, new Date("2026-10-20T00:00:00Z"));
    expect(b).toContain("[1]");
    expect(b).not.toContain("[2]");
    expect(b).not.toContain("[3]");
    expect(b).not.toContain("[4]");
    expect(await tendancesPourLeContenu("u", null, ["instagram"], lire as any)).toBe("");
  });
});
