// shared/profils-veille.test.ts
import { describe, it, expect } from "vitest";
import {
  REGLES, engagementDe, estMur, mediane, estFort, statsFormats, formatsRetenus, enBaisse, cleFormat,
  semaineDe, semaineAnalysee, moisDe, jourDe, clesEcartees, tendanceVisible, creneauTendance,
  normaliserCompteInstagram, handlesInstagram, cleDePost, extraireTendance, libelleFormat, type PostFenetre,
} from "./profils-veille";

describe("engagementDe", () => {
  it("instagram : (likes + commentaires) / abonnés", () => {
    expect(engagementDe("instagram", { likes: 90, commentaires: 10 }, 1000)).toBeCloseTo(0.1);
  });
  it("tiktok : (likes + commentaires + partages) / vues", () => {
    expect(engagementDe("tiktok", { likes: 50, commentaires: 30, partages: 20, vues: 1000 }, null)).toBeCloseTo(0.1);
  });
  it("linkedin : (likes + commentaires + republications) / abonnés", () => {
    expect(engagementDe("linkedin", { likes: 5, commentaires: 3, republications: 2 }, 100)).toBeCloseTo(0.1);
  });
  it("une métrique absente ou un dénominateur nul rend null, jamais 0", () => {
    expect(engagementDe("instagram", { commentaires: 10 }, 1000)).toBeNull();
    expect(engagementDe("instagram", { likes: 10, commentaires: 1 }, null)).toBeNull();
    expect(engagementDe("instagram", { likes: 10, commentaires: 1 }, 0)).toBeNull();
    expect(engagementDe("tiktok", { likes: 1, commentaires: 1, partages: 1 }, 500)).toBeNull();
  });
  it("instagram : commentaires absents comptent pour 0 seulement si les likes sont là", () => {
    expect(engagementDe("instagram", { likes: 100 }, 1000)).toBeCloseTo(0.1);
  });
});

describe("maturité et contenu fort", () => {
  const maintenant = new Date("2026-10-14T10:00:00Z");
  it("mûr à partir de 48 h", () => {
    expect(estMur("2026-10-12T10:00:00Z", maintenant)).toBe(true);
    expect(estMur("2026-10-12T10:00:01Z", maintenant)).toBe(false);
    expect(estMur(null, maintenant)).toBe(false);
  });
  it("médiane", () => {
    expect(mediane([])).toBeNull();
    expect(mediane([3, 1, 2])).toBe(2);
    expect(mediane([4, 1, 2, 3])).toBe(2.5);
  });
  it("fort = plus de 2 × la médiane, avec au moins 8 posts mûrs", () => {
    const hist = [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01];
    expect(estFort(0.03, hist)).toBe(true);
    expect(estFort(0.02, hist)).toBe(false);
    expect(estFort(0.03, hist.slice(0, 7))).toBeNull();
    expect(estFort(null, hist)).toBeNull();
  });
  it("ne garde que les 30 derniers posts de l'historique", () => {
    const vieux = Array(30).fill(0.001);
    const recents = Array(30).fill(0.1);
    expect(estFort(0.15, [...recents, ...vieux])).toBe(false); // médiane 0.1 (30 premiers = les plus récents)
  });
});

describe("formats", () => {
  const p = (cle: string, compteId: number, structure: any, fort: boolean | null, typeMedia: any = "carrousel"): PostFenetre =>
    ({ cle, compteId, plateforme: "instagram", typeMedia, structure, fort });
  const posts: PostFenetre[] = [
    p("a", 1, "avant_apres", true), p("b", 2, "avant_apres", true), p("c", 2, "avant_apres", true), p("d", 1, "avant_apres", false),
    p("e", 1, "tutoriel", false), p("f", 2, "tutoriel", false), p("g", 3, "tutoriel", true), p("h", 3, "tutoriel", false),
    p("i", 3, "liste", false), p("j", 3, "liste", false), p("k", 1, "liste", null), p("l", 1, null, true),
  ];
  it("lift = taux du format / taux global, posts sans fort ni structure ignorés", () => {
    const s = statsFormats(posts).find((x) => x.structure === "avant_apres")!;
    // 10 posts jugés et classés, 4 forts → 0,4 ; avant_apres 3/4 = 0,75 → lift 1,875
    expect(s.nbPosts).toBe(4);
    expect(s.nbForts).toBe(3);
    expect(s.nbComptes).toBe(2);
    expect(s.lift).toBeCloseTo(1.875);
    expect(s.clesForts.sort()).toEqual(["a", "b", "c"]);
    expect(s.cle).toBe(cleFormat("instagram", "carrousel", "avant_apres"));
  });
  it("seuil anti-hasard : lift ≥ 1,5, ≥ 3 forts, ≥ 2 comptes", () => {
    const r = formatsRetenus(statsFormats(posts));
    expect(r.map((x) => x.structure)).toEqual(["avant_apres"]);
    const unSeulCompte = posts.map((x) => ({ ...x, compteId: 1 }));
    expect(formatsRetenus(statsFormats(unSeulCompte))).toEqual([]);
  });
  it("en baisse : retenu la semaine d'avant, plus retenu, lift encore ≥ 1", () => {
    const stats = [{ cle: "x", lift: 1.2 }, { cle: "y", lift: 0.8 }, { cle: "z", lift: 2 }] as any;
    expect(enBaisse([{ cle: "x" }, { cle: "y" }, { cle: "z" }, { cle: "absent" }], new Set(["z"]), stats)).toEqual(["x"]);
  });
});

describe("semaines, mois, jours", () => {
  it("semaineDe = le lundi (UTC) de la semaine", () => {
    expect(semaineDe(new Date("2026-10-14T10:00:00Z"))).toBe("2026-10-12");
    expect(semaineDe(new Date("2026-10-18T23:00:00Z"))).toBe("2026-10-12");
  });
  it("l'analyse du dimanche prépare la semaine qui commence le lendemain", () => {
    expect(semaineAnalysee(new Date("2026-10-18T06:00:00Z"))).toBe("2026-10-19");
  });
  it("moisDe et jourDe", () => {
    expect(moisDe(new Date("2026-10-14T10:00:00Z"))).toBe("2026-10");
    expect(jourDe(new Date("2026-10-14T23:59:00Z"))).toBe("2026-10-14");
  });
});

describe("tendances côté marque", () => {
  const maintenant = new Date("2026-10-14T10:00:00Z");
  it("un format écarté est bloqué 8 semaines", () => {
    const s = clesEcartees([
      { cle: "x", ecarteLe: new Date("2026-08-20T00:00:00Z") },
      { cle: "y", ecarteLe: new Date("2026-08-18T00:00:00Z") },
    ], maintenant);
    expect(s.has("x")).toBe(true);
    expect(s.has("y")).toBe(false);
  });
  it("visible : nouveau / vu non expirés, gardé toujours, écarté et utilisé jamais", () => {
    expect(tendanceVisible({ statut: "nouveau", expireLe: "2026-10-20T00:00:00Z" }, maintenant)).toBe(true);
    expect(tendanceVisible({ statut: "vu", expireLe: "2026-10-13T00:00:00Z" }, maintenant)).toBe(false);
    expect(tendanceVisible({ statut: "garde", expireLe: "2026-01-01T00:00:00Z" }, maintenant)).toBe(true);
    expect(tendanceVisible({ statut: "ecarte", expireLe: "2026-12-01T00:00:00Z" }, maintenant)).toBe(false);
    expect(tendanceVisible({ statut: "utilise", expireLe: "2026-12-01T00:00:00Z" }, maintenant)).toBe(false);
  });
  it("créneau d'un post issu d'une tendance : mercredi de la semaine suivante, 8 h UTC", () => {
    expect(creneauTendance(maintenant).toISOString()).toBe("2026-10-21T08:00:00.000Z");
    expect(creneauTendance(new Date("2026-10-18T22:00:00Z")).toISOString()).toBe("2026-10-21T08:00:00.000Z");
  });
});

describe("comptes et posts", () => {
  it("normalise une saisie Instagram", () => {
    expect(normaliserCompteInstagram("@Lune.Studio")).toEqual({ compte: "lune.studio", url: "https://www.instagram.com/lune.studio/" });
    expect(normaliserCompteInstagram("https://instagram.com/lune.studio/?hl=fr")).toEqual({ compte: "lune.studio", url: "https://www.instagram.com/lune.studio/" });
    expect(normaliserCompteInstagram("https://www.instagram.com/p/ABC123/")).toBeNull();
    expect(normaliserCompteInstagram("")).toBeNull();
    expect(normaliserCompteInstagram("pas un compte !")).toBeNull();
  });
  it("extrait les comptes de liens de recherche, sans doublon ni page de post", () => {
    expect(handlesInstagram([
      "https://www.instagram.com/lune.studio/", "https://www.instagram.com/lune.studio/reels/",
      "https://www.instagram.com/p/XYZ/", "https://www.instagram.com/explore/tags/yoga/", "https://example.com/a",
      "https://instagram.com/soleil_coach",
    ])).toEqual(["lune.studio", "soleil_coach"]);
  });
  it("clé d'un post : URL sans paramètres ni barre finale", () => {
    expect(cleDePost("https://www.instagram.com/p/ABC/?img_index=1")).toBe("https://www.instagram.com/p/ABC");
  });
  it("lit puis retire la ligne TENDANCE: <id>", () => {
    expect(extraireTendance("Mon post.\n\nTENDANCE: 12")).toEqual({ texte: "Mon post.", tendanceId: 12 });
    expect(extraireTendance("Mon post.")).toEqual({ texte: "Mon post.", tendanceId: null });
  });
  it("libellé lisible d'un format", () => {
    expect(libelleFormat("carrousel", "avant_apres")).toBe("Carrousel avant/après");
  });
  it("les seuils sont ceux de la spec", () => {
    expect(REGLES).toMatchObject({ comptesMaxParPlateforme: 15, plafondEurParMois: 10, maturiteHeures: 48, fenetreMediane: 30,
      postsMursMin: 8, facteurFort: 2, fenetreAnalyseJours: 14, liftMin: 1.5, fortsMin: 3, comptesMin: 2,
      tendancesMaxParProjet: 5, dureeTendanceJours: 28, ecartSemaines: 8, confianceMin: 0.7, retentionPostsJours: 90 });
  });
});
