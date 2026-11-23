import { describe, it, expect } from "vitest";
import {
  contenuDeModele, filtrerParNom, insererAuCurseur, lireNomModele, lireTexteEnregistre, lireUtilisation,
  postDepuisModele, reseauxDuModele, TEXTE_ENREGISTRE_MAX, TITRE_TEXTE_MAX,
} from "./bibliotheque";

const POST = {
  id: 7, userId: "u1", projectId: 3, title: "Lancement", body: "Texte IG", platform: "Instagram",
  contentType: "post", pillar: "p", goal: "g", contentStatus: "ready", postStatus: "posted", autoPost: true,
  publishedAt: new Date(), platformPostId: "x", socialAccountId: 9, campaignId: 4, sourceTaskId: 5,
  scheduledFor: new Date("2026-12-01T09:00:00Z"), mediaIds: [11, 12], postFormat: "carousel",
  premierCommentaire: "#tags", couvertureUrl: "c.jpg", couvertureOffsetMs: 1200, texteAlternatif: "alt",
  collaborateurs: ["a"], reelDansLeFil: false, nomAudio: "son", linkedinDocument: true, crossPostGroupId: "g1",
};

describe("lireTexteEnregistre", () => {
  it("lit titre, texte (bords rognés, retours gardés) et projet", () => {
    expect(lireTexteEnregistre({ titre: " Signature ", texte: "\n  Ligne 1\nLigne 2  \n", projectId: "4" }))
      .toEqual({ titre: "Signature", texte: "Ligne 1\nLigne 2", projectId: 4 });
    expect(lireTexteEnregistre({ titre: "a", texte: "b" })).toEqual({ titre: "a", texte: "b", projectId: null });
  });
  it("refuse vide, trop long, projet illisible", () => {
    expect(lireTexteEnregistre({ titre: " ", texte: "b" })).toBeNull();
    expect(lireTexteEnregistre({ titre: "a", texte: "" })).toBeNull();
    expect(lireTexteEnregistre({ titre: "x".repeat(TITRE_TEXTE_MAX + 1), texte: "b" })).toBeNull();
    expect(lireTexteEnregistre({ titre: "a", texte: "x".repeat(TEXTE_ENREGISTRE_MAX + 1) })).toBeNull();
    expect(lireTexteEnregistre({ titre: "a", texte: "b", projectId: -2 })).toBeNull();
    expect(lireTexteEnregistre(null)).toBeNull();
  });
  it("partiel : seuls les champs présents, au moins un", () => {
    expect(lireTexteEnregistre({ texte: "neuf" }, true)).toEqual({ texte: "neuf" });
    expect(lireTexteEnregistre({ projectId: null }, true)).toEqual({ projectId: null });
    expect(lireTexteEnregistre({}, true)).toBeNull();
    expect(lireTexteEnregistre({ titre: "" }, true)).toBeNull();
  });
});

describe("lireNomModele", () => {
  it("rogne ; refuse vide et > 120", () => {
    expect(lireNomModele({ nom: "  Carrousel promo " })).toBe("Carrousel promo");
    expect(lireNomModele({ nom: "" })).toBeNull();
    expect(lireNomModele({ nom: "x".repeat(121) })).toBeNull();
    expect(lireNomModele({})).toBeNull();
  });
});

describe("contenuDeModele", () => {
  it("garde texte, médias, format et options ; jamais date, compte ni état de publication", () => {
    const c = contenuDeModele(POST);
    expect(c.textes).toEqual({ instagram: "Texte IG" });
    expect(c).toMatchObject({
      platform: "instagram", title: "Lancement", mediaIds: [11, 12], postFormat: "carousel",
      premierCommentaire: "#tags", couvertureUrl: "c.jpg", couvertureOffsetMs: 1200, texteAlternatif: "alt",
      collaborateurs: ["a"], reelDansLeFil: false, nomAudio: "son", linkedinDocument: true,
    });
    for (const k of ["scheduledFor", "socialAccountId", "publishedAt", "platformPostId", "campaignId", "sourceTaskId", "autoPost", "userId", "projectId"]) {
      expect(c).not.toHaveProperty(k);
    }
  });
  it("texte par réseau : les frères du même envoi (vivants, à elle), le post l'emporte", () => {
    const c = contenuDeModele(POST, [
      { userId: "u1", platform: "linkedin", body: "Texte LI" },
      { userId: "u1", platform: "instagram", body: "autre" },
      { userId: "u1", platform: "tiktok", body: "TT", supprimeLe: new Date() },
      { userId: "u2", platform: "facebook", body: "FB" },
    ]);
    expect(c.textes).toEqual({ instagram: "Texte IG", linkedin: "Texte LI" });
    expect(reseauxDuModele(c).sort()).toEqual(["instagram", "linkedin"]);
  });
  it("la copie des médias est indépendante du post", () => {
    const c = contenuDeModele(POST);
    c.mediaIds.push(99);
    expect(POST.mediaIds).toEqual([11, 12]);
  });
});

describe("lireUtilisation", () => {
  it("projet (null = sans marque), date et réseau facultatifs", () => {
    expect(lireUtilisation({ projectId: 2, scheduledFor: "2027-01-05T10:00:00.000Z", platform: "LinkedIn" }))
      .toEqual({ projectId: 2, scheduledFor: new Date("2027-01-05T10:00:00.000Z"), platform: "linkedin" });
    expect(lireUtilisation({})).toEqual({ projectId: null, scheduledFor: null, platform: null });
  });
  it("refuse date ou projet illisibles", () => {
    expect(lireUtilisation({ scheduledFor: "demain" })).toBeNull();
    expect(lireUtilisation({ projectId: "abc" })).toBeNull();
    expect(lireUtilisation({ platform: 3 })).toBeNull();
  });
});

describe("postDepuisModele", () => {
  const contenu = contenuDeModele(POST, [{ userId: "u1", platform: "linkedin", body: "Texte LI" }]);
  it("un brouillon jamais programmé, sans compte, dans la marque et à la date choisies", () => {
    const row = postDepuisModele(contenu, "u1", { projectId: 5, scheduledFor: new Date("2027-01-01T08:00:00Z"), platform: null })!;
    expect(row).toMatchObject({
      userId: "u1", projectId: 5, platform: "instagram", body: "Texte IG", autoPost: false, status: "draft",
      contentStatus: "draft", postStatus: "pending", socialAccountId: null, publishedAt: null, platformPostId: null,
      scheduledFor: new Date("2027-01-01T08:00:00Z"), mediaIds: [11, 12], premierCommentaire: "#tags", postFormat: "carousel",
    });
    expect(row).not.toHaveProperty("textes");
  });
  it("le texte du réseau choisi ; un réseau sans texte dans le modèle : null", () => {
    expect(postDepuisModele(contenu, "u1", { projectId: null, scheduledFor: null, platform: "linkedin" })!.body).toBe("Texte LI");
    expect(postDepuisModele(contenu, "u1", { projectId: null, scheduledFor: null, platform: "tiktok" })).toBeNull();
  });
  it("un modèle incomplet donne quand même une ligne valide", () => {
    const row = postDepuisModele({ platform: "instagram", textes: { instagram: "Bonjour" } }, "u1", { projectId: null, scheduledFor: null, platform: null })!;
    expect(row).toMatchObject({ title: "Bonjour", contentType: "post", autoPost: false, scheduledFor: null });
    expect(row.pillar).toBeTruthy();
    expect(row.goal).toBeTruthy();
  });
});

describe("filtrerParNom", () => {
  it("sans casse ni accents ; requête vide : tout", () => {
    const l = [{ n: "Signature Été" }, { n: "Hashtags" }];
    expect(filtrerParNom(l, "ete", (x) => x.n)).toEqual([{ n: "Signature Été" }]);
    expect(filtrerParNom(l, "  ", (x) => x.n)).toHaveLength(2);
  });
});

describe("insererAuCurseur", () => {
  it("au curseur, à la place d'une sélection, ou à la fin", () => {
    expect(insererAuCurseur("Bonjour monde", "beau ", 8, 8)).toEqual({ valeur: "Bonjour beau monde", curseur: 13 });
    expect(insererAuCurseur("Bonjour monde", "toi", 8, 13)).toEqual({ valeur: "Bonjour toi", curseur: 11 });
    expect(insererAuCurseur("Bonjour", " !", null, null)).toEqual({ valeur: "Bonjour !", curseur: 9 });
    expect(insererAuCurseur("", "x", 5, 2)).toEqual({ valeur: "x", curseur: 1 });
  });
});
