import { describe, it, expect } from "vitest";
import {
  apercuPassages, attribuer, avancer, bilanPublications, cleCreneau, fenetreDePose, fileDAttente, instantLocal,
  lignePourCreneau, lireAutoliste, lireCreneau, lireOrdre, ordreApresBoucle, problemesDeLaLigne, prochainsCreneaux, texteDuReseau,
} from "./autolistes";

const iso = (ds: Date[]) => ds.map((d) => d.toISOString());

describe("lireAutoliste", () => {
  it("lit une liste complète, avec ses valeurs par défaut", () => {
    expect(lireAutoliste({ nom: "  Evergreen ", creneaux: [{ heure: "09:00", jours: [5, 1, 1] }], comptes: [3, "4", 3] })).toEqual({
      nom: "Evergreen", projectId: null, actif: true, enBoucle: false, creneaux: [{ heure: "09:00", jours: [1, 5] }], comptes: [3, 4],
    });
  });
  it("refuse un nom vide, une heure illisible, un jour hors 0-6, un compte illisible", () => {
    expect(lireAutoliste({ nom: " " })).toBeNull();
    expect(lireAutoliste({ nom: "a", creneaux: [{ heure: "24:00", jours: [1] }] })).toBeNull();
    expect(lireAutoliste({ nom: "a", creneaux: [{ heure: "9:00", jours: [1] }] })).toBeNull();
    expect(lireAutoliste({ nom: "a", creneaux: [{ heure: "09:00", jours: [7] }] })).toBeNull();
    expect(lireAutoliste({ nom: "a", creneaux: [{ heure: "09:00", jours: [] }] })).toBeNull();
    expect(lireAutoliste({ nom: "a", comptes: [0] })).toBeNull();
    expect(lireAutoliste({ nom: "a", actif: "oui" })).toBeNull();
  });
  it("partiel : seuls les champs présents, au moins un", () => {
    expect(lireAutoliste({ actif: false }, true)).toEqual({ actif: false });
    expect(lireAutoliste({ projectId: null }, true)).toEqual({ projectId: null });
    expect(lireAutoliste({}, true)).toBeNull();
  });
  it("lireCreneau", () => {
    expect(lireCreneau({ heure: "18:30", jours: [0, 6] })).toEqual({ heure: "18:30", jours: [0, 6] });
    expect(lireCreneau(null)).toBeNull();
  });
});

describe("lireOrdre", () => {
  it("une permutation exacte des ids", () => {
    expect(lireOrdre({ ids: [3, 1, 2] }, [1, 2, 3])).toEqual([3, 1, 2]);
    expect(lireOrdre({ ids: [3, 1] }, [1, 2, 3])).toBeNull();
    expect(lireOrdre({ ids: [3, 1, 1] }, [1, 2, 3])).toBeNull();
    expect(lireOrdre({ ids: [3, 1, 9] }, [1, 2, 3])).toBeNull();
  });
});

describe("prochainsCreneaux (heure de Paris)", () => {
  it("9 h à Paris reste 9 h de part et d'autre du passage à l'heure d'hiver", () => {
    // Samedi 24 oct. 2026 (été, UTC+2) → dimanche 25 (changement) → lundi 26 (hiver, UTC+1).
    const r = prochainsCreneaux([{ heure: "09:00", jours: [0, 1, 6] }], new Date("2026-10-24T00:00:00Z"), new Date("2026-10-27T00:00:00Z"));
    expect(iso(r)).toEqual(["2026-10-24T07:00:00.000Z", "2026-10-25T08:00:00.000Z", "2026-10-26T08:00:00.000Z"]);
  });
  it("et au passage à l'heure d'été", () => {
    const r = prochainsCreneaux([{ heure: "09:00", jours: [6, 0] }], new Date("2027-03-27T00:00:00Z"), new Date("2027-03-29T00:00:00Z"));
    expect(iso(r)).toEqual(["2027-03-27T08:00:00.000Z", "2027-03-28T07:00:00.000Z"]);
  });
  it("une heure qui n'existe pas (02:30 le jour du passage à l'heure d'été) tombe une fois, juste après le saut", () => {
    const r = prochainsCreneaux([{ heure: "02:30", jours: [0] }], new Date("2027-03-27T00:00:00Z"), new Date("2027-03-29T00:00:00Z"));
    expect(iso(r)).toEqual(["2027-03-28T01:30:00.000Z"]); // 03:30 heure d'été
  });
  it("une heure qui existe deux fois (02:30 au passage à l'heure d'hiver) n'est posée qu'une fois", () => {
    const r = prochainsCreneaux([{ heure: "02:30", jours: [0] }], new Date("2026-10-24T00:00:00Z"), new Date("2026-10-26T00:00:00Z"));
    expect(r).toHaveLength(1);
  });
  it("strictement après `depuis`, au plus tard `jusqua`, triés, sans doublon", () => {
    const depuis = new Date("2026-11-23T08:00:00Z"); // lundi 9 h Paris
    const r = prochainsCreneaux(
      [{ heure: "09:00", jours: [1, 2] }, { heure: "09:00", jours: [2] }, { heure: "18:00", jours: [1] }],
      depuis, new Date("2026-11-24T08:00:00Z"),
    );
    expect(iso(r)).toEqual(["2026-11-23T17:00:00.000Z", "2026-11-24T08:00:00.000Z"]);
  });
  it("instantLocal : 12:00 à New York", () => {
    expect(instantLocal(2026, 7, 1, 12, 0, "America/New_York").toISOString()).toBe("2026-07-01T16:00:00.000Z");
  });
  it("la fenêtre de pose : après la marge de programmation, 7 jours", () => {
    const m = new Date("2026-11-23T10:00:00Z");
    const f = fenetreDePose(m);
    expect(f.depuis.getTime() - m.getTime()).toBe(3 * 60_000);
    expect(f.jusqua.toISOString()).toBe("2026-11-30T10:00:00.000Z");
  });
});

describe("clé anti-doublon", () => {
  it("liste + instant + compte", () => {
    expect(cleCreneau(4, new Date("2026-11-24T08:00:00Z"), 9)).toBe("4|2026-11-24T08:00:00.000Z|9");
    expect(cleCreneau(4, "2026-11-24T08:00:00Z", 9)).toBe(cleCreneau(4, new Date("2026-11-24T08:00:00.000Z"), 9));
  });
});

describe("file et attribution", () => {
  const posts = [
    { id: 1, ordre: 2, actif: true }, { id: 2, ordre: 0, actif: true }, { id: 3, ordre: 1, actif: false }, { id: 4, ordre: 3, actif: true },
  ];
  const c = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 10, 24 + i, 8)));

  it("la file : actifs dans l'ordre ; sans boucle, les réservés attendent", () => {
    expect(fileDAttente(posts, false)).toEqual([2, 1, 4]);
    expect(fileDAttente(posts, false, new Set([1]))).toEqual([2, 4]);
    expect(fileDAttente(posts, true, new Set([1]))).toEqual([2, 1, 4]);
  });
  it("avancer : en boucle le post repart en fin, sinon il est consommé", () => {
    expect(avancer([2, 1, 4], true)).toEqual({ postId: 2, file: [1, 4, 2] });
    expect(avancer([2, 1, 4], false)).toEqual({ postId: 2, file: [1, 4] });
    expect(avancer([], true)).toEqual({ postId: null, file: [] });
  });
  it("sans boucle : un post par créneau puis plus rien", () => {
    const r = attribuer([2, 1, 4], c(5), false);
    expect(r.attributions.map((a) => a.postId)).toEqual([2, 1, 4]);
    expect(r.file).toEqual([]);
  });
  it("en boucle : la file tourne (evergreen)", () => {
    const r = attribuer([2, 1, 4], c(5), true);
    expect(r.attributions.map((a) => a.postId)).toEqual([2, 1, 4, 2, 1]);
    expect(r.file).toEqual([4, 2, 1]);
  });
  it("file vide : rien", () => {
    expect(attribuer([], c(3), true).attributions).toEqual([]);
  });
  it("l'ordre après une boucle : file tournée puis inactifs, seulement ce qui change", () => {
    // Le post 1 garde son ordre (2) ; l'inactif 3 passe derrière la file.
    expect(ordreApresBoucle(posts, [4, 2, 1])).toEqual([{ id: 4, ordre: 0 }, { id: 2, ordre: 1 }, { id: 3, ordre: 3 }]);
    expect(ordreApresBoucle(posts, [2, 1, 4])).toEqual([{ id: 1, ordre: 1 }, { id: 4, ordre: 2 }, { id: 3, ordre: 3 }]);
  });
});

describe("bilanPublications", () => {
  it("un créneau publié sur deux comptes compte une fois ; sans boucle, consommé", () => {
    const b = bilanPublications([
      { autolistePostId: 1, autolisteCreneau: "2026-11-24T08:00:00Z", publishedAt: "2026-11-24T08:00:30Z" },
      { autolistePostId: 1, autolisteCreneau: "2026-11-24T08:00:00Z", publishedAt: "2026-11-24T08:01:00Z" },
      { autolistePostId: 2, autolisteCreneau: "2026-11-25T08:00:00Z", publishedAt: "2026-11-25T08:00:30Z" },
      { autolistePostId: null, autolisteCreneau: null, publishedAt: null },
    ], false);
    expect(b.get(1)).toEqual({ publieFois: 1, dernierPassageAt: new Date("2026-11-24T08:01:00Z"), consomme: true });
    expect(b.get(2)?.publieFois).toBe(1);
    expect(bilanPublications([{ autolistePostId: 1, autolisteCreneau: "2026-11-24T08:00:00Z", publishedAt: "2026-11-24T08:00:30Z" }], true).get(1)?.consomme).toBe(false);
  });
});

describe("la ligne posée", () => {
  const contenu = {
    platform: "instagram", textes: { instagram: "Texte IG", linkedin: "Texte LI" }, title: "T", mediaIds: [1], postFormat: "carousel",
    premierCommentaire: "pc", contentType: "post", pillar: "p", goal: "g",
  } as any;
  const base = { userId: "u1", projectId: 5, creneau: new Date("2026-11-24T08:00:00Z"), autolisteId: 4, autolistePostId: 9 };

  it("le texte du réseau, sinon celui du réseau principal", () => {
    expect(texteDuReseau(contenu, "LinkedIn")).toBe("Texte LI");
    expect(texteDuReseau(contenu, "facebook")).toBe("Texte IG");
    expect(texteDuReseau({ textes: {} } as any, "facebook")).toBeNull();
  });
  it("programmée sur le compte, à l'instant du créneau, rattachée à la liste", () => {
    const l = lignePourCreneau(contenu, { ...base, compte: { id: 30, platform: "LinkedIn" } })!;
    expect(l).toMatchObject({
      userId: "u1", projectId: 5, platform: "linkedin", body: "Texte LI", autoPost: true, postStatus: "pending", contentStatus: "ready",
      socialAccountId: 30, scheduledFor: base.creneau, autolisteId: 4, autolistePostId: 9, autolisteCreneau: base.creneau,
      mediaIds: [1], postFormat: "carousel", premierCommentaire: "pc", publishedAt: null,
      crossPostGroupId: "autoliste-4-2026-11-24T08:00:00.000Z",
    });
  });
  it("« à finir sur le téléphone » : jamais programmé (rappel, pas de publication seule)", () => {
    const l = lignePourCreneau({ ...contenu, finirSurTelephone: true }, { ...base, compte: { id: 30, platform: "linkedin" } })!;
    expect(l).toMatchObject({ autoPost: false, finirSurTelephone: true, socialAccountId: 30, autolisteCreneau: base.creneau });
  });
  it("validation client active : le post naît « à valider »", () => {
    const quand = new Date("2026-11-23T07:00:00Z");
    const l = lignePourCreneau(contenu, { ...base, compte: { id: 30, platform: "linkedin" }, aValiderDepuis: quand })!;
    expect(l).toMatchObject({ autoPost: true, validationStatut: "a_valider", validationDemandeeAt: quand });
    expect(lignePourCreneau(contenu, { ...base, compte: { id: 30, platform: "linkedin" } })).not.toHaveProperty("validationStatut");
  });
  it("mêmes règles que « Programmer » : visuel requis sur Instagram, compte expiré, hors projet, sans texte", () => {
    const maintenant = new Date("2026-11-23T08:00:00Z");
    const l = lignePourCreneau({ ...contenu, mediaIds: [] }, { ...base, compte: { id: 30, platform: "instagram" } });
    expect(problemesDeLaLigne({ ligne: l, medias: [], compte: { id: 30, platform: "instagram" }, maintenant })).toEqual(["visuel_requis"]);
    expect(problemesDeLaLigne({
      ligne: l, medias: ["image"], compte: { id: 30, platform: "instagram", expiresAt: "2026-01-01T00:00:00Z" }, maintenant,
    })).toEqual(["compte_expire"]);
    expect(problemesDeLaLigne({ ligne: l, medias: ["image"], compte: null, horsProjet: true, maintenant })).toEqual(["compte_hors_projet"]);
    expect(problemesDeLaLigne({ ligne: null, medias: [], compte: null, maintenant })).toEqual(["texte_absent"]);
    expect(problemesDeLaLigne({ ligne: l, medias: ["image"], compte: { id: 30, platform: "instagram" }, maintenant })).toEqual([]);
  });
});

describe("apercuPassages", () => {
  const maintenant = new Date("2026-11-23T07:00:00Z"); // lundi 8 h Paris
  const creneaux = [{ heure: "09:00", jours: [1, 3, 5] }]; // lun, mer, ven → 23, 25, 27 nov.
  const posts = [{ id: 1, ordre: 0, actif: true }, { id: 2, ordre: 1, actif: true }];

  it("les créneaux posés d'abord, puis ceux que la file remplira (sans boucle, réservés exclus)", () => {
    const p = apercuPassages({
      creneaux, enBoucle: false, actif: true, posts, maintenant,
      materialisations: [{ id: 50, autolistePostId: 1, autolisteCreneau: "2026-11-23T08:00:00Z", socialAccountId: 3, postStatus: "pending" }],
    });
    expect(p.map((x) => [x.instant.toISOString(), x.postId, x.pose])).toEqual([
      ["2026-11-23T08:00:00.000Z", 1, true], ["2026-11-25T08:00:00.000Z", 2, false], ["2026-11-27T08:00:00.000Z", null, false],
    ]);
    expect(p[0].contentIds).toEqual([50]);
  });
  it("en boucle, la file tourne ; un créneau retiré du calendrier reste sans post ; liste inactive : rien", () => {
    const p = apercuPassages({
      creneaux, enBoucle: true, actif: true, posts, maintenant,
      materialisations: [{ id: 50, autolistePostId: 1, autolisteCreneau: "2026-11-23T08:00:00Z", socialAccountId: 3, supprimeLe: "2026-11-22T00:00:00Z" }],
    });
    expect(p.map((x) => x.postId)).toEqual([null, 1, 2]);
    expect(apercuPassages({ creneaux, enBoucle: true, actif: false, posts, maintenant, materialisations: [] })).toEqual([]);
  });
});
