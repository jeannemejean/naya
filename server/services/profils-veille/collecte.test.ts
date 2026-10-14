// server/services/profils-veille/collecte.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { collecterProfil, type DepsCollecte } from "./collecte";
import { lireProfilInstagram } from "./collecte/instagram";

const maintenant = new Date("2026-10-14T06:00:00Z");
const ancien = "2026-10-10T09:00:00.000Z"; // mûr
const recent = "2026-10-13T20:00:00.000Z"; // pas mûr

function deps(over: Partial<DepsCollecte> = {}): DepsCollecte {
  return {
    comptesSuivis: vi.fn(async () => [
      { id: 1, compte: "lune", url: "https://www.instagram.com/lune/", echecsConsecutifs: 0 },
      { id: 2, compte: "soleil", url: "https://www.instagram.com/soleil/", echecsConsecutifs: 1 },
    ]),
    reserverPassage: vi.fn(async () => 50),
    terminerPassage: vi.fn(async () => {}),
    collecter: vi.fn(async () => [
      { account: "lune", followers: 1000, posts: [
        { url: "https://www.instagram.com/p/A/", datetime: ancien, likes: 300, comments: 0 },
        { url: "https://www.instagram.com/p/B/", datetime: recent, likes: 5, comments: 0 },
        { url: "https://www.instagram.com/p/C/", datetime: ancien, comments: 4 },
      ] },
      { error: "Profile not found", input: { url: "https://www.instagram.com/soleil/" } },
    ]),
    lireProfil: lireProfilInstagram,
    clesExistantes: vi.fn(async () => new Set(["https://www.instagram.com/p/A"])),
    enregistrerPosts: vi.fn(async () => {}),
    historiqueCompte: vi.fn(async () => [0.3, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01]),
    marquerForts: vi.fn(async () => {}),
    majCompte: vi.fn(async () => {}),
    depenseDuMois: vi.fn(async () => 1),
    coutParCompte: 0.0014,
    ...over,
  };
}

describe("collecterProfil", () => {
  let d: DepsCollecte;
  beforeEach(() => { d = deps(); });

  it("passage déjà pris (autre instance, autre tour) : rien n'est collecté", async () => {
    d = deps({ reserverPassage: vi.fn(async () => null) });
    expect(await collecterProfil(d, 7, "instagram", maintenant)).toEqual({ statut: "deja" });
    expect(d.collecter).not.toHaveBeenCalled();
  });

  it("plafond atteint : une ligne de passage « plafond », aucune collecte", async () => {
    d = deps({ depenseDuMois: vi.fn(async () => 10) });
    expect(await collecterProfil(d, 7, "instagram", maintenant)).toEqual({ statut: "plafond" });
    expect(d.terminerPassage).toHaveBeenCalledWith(50, expect.objectContaining({ statut: "plafond" }));
    expect(d.collecter).not.toHaveBeenCalled();
  });

  it("enregistre les posts, juge seulement les mûrs, n'invente jamais un engagement", async () => {
    const r = await collecterProfil(d, 7, "instagram", maintenant);
    expect(r).toEqual({ statut: "ok", nouveaux: 2, misAJour: 1, echecs: 1 });
    const rows = (d.enregistrerPosts as any).mock.calls[0][0];
    const parUrl = Object.fromEntries(rows.map((x: any) => [x.cle, x]));
    expect(parUrl["https://www.instagram.com/p/A"].engagement).toBeCloseTo(0.3);
    expect(parUrl["https://www.instagram.com/p/B"].engagement).toBeNull(); // pas mûr
    expect(parUrl["https://www.instagram.com/p/C"].engagement).toBeNull(); // likes absents
    expect(parUrl["https://www.instagram.com/p/A"]).toMatchObject({ profilId: 7, compteId: 1, plateforme: "instagram", abonnes: 1000 });
    expect(d.marquerForts).toHaveBeenCalledWith([{ cle: "https://www.instagram.com/p/A", fort: true }], 7);
  });

  it("un compte en erreur : compteur d'échecs ; injoignable au 2e échec consécutif ; l'autre compte remis à zéro", async () => {
    await collecterProfil(d, 7, "instagram", maintenant);
    expect(d.majCompte).toHaveBeenCalledWith(2, { echecsConsecutifs: 2, statut: "injoignable" });
    expect(d.majCompte).toHaveBeenCalledWith(1, { echecsConsecutifs: 0 });
  });

  it("échec global (Bright Data ne répond pas) : passage en erreur, aucun compte pénalisé", async () => {
    d = deps({ collecter: vi.fn(async () => null) });
    expect(await collecterProfil(d, 7, "instagram", maintenant)).toMatchObject({ statut: "erreur" });
    expect(d.majCompte).not.toHaveBeenCalled();
    expect(d.terminerPassage).toHaveBeenCalledWith(50, expect.objectContaining({ statut: "erreur", coutEur: 0 }));
  });

  it("aucun compte suivi : passage ok vide, sans appel payant", async () => {
    d = deps({ comptesSuivis: vi.fn(async () => []) });
    expect(await collecterProfil(d, 7, "instagram", maintenant)).toEqual({ statut: "ok", nouveaux: 0, misAJour: 0, echecs: 0 });
    expect(d.collecter).not.toHaveBeenCalled();
  });

  it("coût du passage = comptes réellement collectés × coût par compte (le compte en erreur ne coûte rien)", async () => {
    await collecterProfil(d, 7, "instagram", maintenant);
    expect(d.terminerPassage).toHaveBeenCalledWith(50, expect.objectContaining({ statut: "ok", comptes: 1, coutEur: 0.0014 }));
  });

  it("appariement exact : « maison » en erreur ne prend pas les lignes de « maison.paris »", async () => {
    d = deps({
      comptesSuivis: vi.fn(async () => [
        { id: 1, compte: "maison", url: "https://www.instagram.com/maison/", echecsConsecutifs: 0 },
        { id: 2, compte: "maison.paris", url: "https://www.instagram.com/maison.paris/", echecsConsecutifs: 0 },
      ]),
      collecter: vi.fn(async () => [
        { account: "maison.paris", followers: 500, input: { url: "https://www.instagram.com/maison.paris/" },
          posts: [{ url: "https://www.instagram.com/p/M/", datetime: ancien, likes: 10, comments: 0 }] },
        { error: "Profile not found", input: { url: "https://www.instagram.com/maison/" } },
      ]),
    });
    await collecterProfil(d, 7, "instagram", maintenant);
    expect(d.majCompte).toHaveBeenCalledWith(1, { echecsConsecutifs: 1 });
    const rows = (d.enregistrerPosts as any).mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ compteId: 2 });
  });

  it("un même post renvoyé par deux comptes n'est enregistré qu'une fois", async () => {
    const post = { url: "https://www.instagram.com/p/X/", datetime: ancien, likes: 10, comments: 0 };
    d = deps({
      collecter: vi.fn(async () => [
        { account: "lune", followers: 1000, posts: [post] },
        { account: "soleil", followers: 900, posts: [post] },
      ]),
    });
    await collecterProfil(d, 7, "instagram", maintenant);
    const rows = (d.enregistrerPosts as any).mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0].compteId).toBe(1);
  });

  it("une exception après la réservation : passage terminé en erreur, résultat erreur", async () => {
    d = deps({ enregistrerPosts: vi.fn(async () => { throw new Error("db down"); }) });
    const r = await collecterProfil(d, 7, "instagram", maintenant);
    expect(r).toMatchObject({ statut: "erreur" });
    expect(d.terminerPassage).toHaveBeenCalledWith(50, expect.objectContaining({ statut: "erreur", erreur: expect.stringContaining("db down") }));
  });
});
