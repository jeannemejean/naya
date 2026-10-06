import { describe, it, expect } from "vitest";
import {
  RAISONS_REFUS_POST, estRaisonRefusPost, libelleRaisonPost, texteSouvenirPost,
  estPublieOuEnCours, validerPostRemplacement,
} from "./pur";

describe("raisons", () => {
  it("liste exacte", () => {
    expect([...RAISONS_REFUS_POST]).toEqual(["wrong_tone", "wrong_angle", "not_for_brand", "too_many", "inaccurate", "other"]);
  });
  it("estRaisonRefusPost", () => {
    expect(estRaisonRefusPost("wrong_tone")).toBe(true);
    expect(estRaisonRefusPost("not_useful")).toBe(false);
    expect(estRaisonRefusPost(3)).toBe(false);
    expect(estRaisonRefusPost(undefined)).toBe(false);
  });
  it("libellés FR", () => {
    expect(libelleRaisonPost("wrong_tone")).toBe("pas le bon ton");
    expect(libelleRaisonPost("wrong_angle")).toBe("mauvais angle");
    expect(libelleRaisonPost("not_for_brand")).toBe("pas pour cette marque");
    expect(libelleRaisonPost("too_many")).toBe("trop de posts");
    expect(libelleRaisonPost("inaccurate")).toBe("inexact");
    expect(libelleRaisonPost("other")).toBe("autre");
  });
});

describe("texteSouvenirPost", () => {
  const post = { platform: "linkedin", pillar: "trust", title: "Mon titre" };
  it("avec explication", () => {
    expect(texteSouvenirPost(post, "wrong_tone", "trop institutionnel")).toBe(
      "Post refusé (linkedin, trust) « Mon titre » — pas le bon ton : trop institutionnel",
    );
  });
  it("sans explication, raison ≠ other", () => {
    expect(texteSouvenirPost(post, "inaccurate", null)).toBe("Post refusé (linkedin, trust) « Mon titre » — inexact");
    expect(texteSouvenirPost(post, "inaccurate", "   ")).toBe("Post refusé (linkedin, trust) « Mon titre » — inexact");
  });
  it("explication vide + other → null", () => {
    expect(texteSouvenirPost(post, "other", "")).toBeNull();
    expect(texteSouvenirPost(post, "other", null)).toBeNull();
    expect(texteSouvenirPost(post, "other", undefined)).toBeNull();
  });
  it("other avec explication → texte", () => {
    expect(texteSouvenirPost(post, "other", "bof")).toContain(" : bof");
  });
  it("tronque titre à 80 et explication à 1500", () => {
    const t = texteSouvenirPost({ ...post, title: "t".repeat(200) }, "other", "e".repeat(3000))!;
    expect(t).toContain("« " + "t".repeat(80) + "… »");
    expect(t).not.toContain("t".repeat(81));
    expect(t).not.toContain("e".repeat(1501));
    expect(t).toContain("e".repeat(1500));
  });
  it("champs manquants tolérés", () => {
    expect(texteSouvenirPost({}, "too_many", null)).toBe("Post refusé (?, ?) «  » — trop de posts");
  });
});

describe("estPublieOuEnCours", () => {
  it("brouillon → false", () => {
    expect(estPublieOuEnCours({ publishedAt: null, postStatus: "pending", contentStatus: "idea" })).toBe(false);
    expect(estPublieOuEnCours({})).toBe(false);
    expect(estPublieOuEnCours({ postStatus: "failed" })).toBe(false);
  });
  it("publié (un seul signal)", () => {
    expect(estPublieOuEnCours({ publishedAt: new Date() })).toBe(true);
    expect(estPublieOuEnCours({ postStatus: "posted" })).toBe(true);
    expect(estPublieOuEnCours({ contentStatus: "published" })).toBe(true);
  });
  it("en cours", () => {
    for (const s of ["uploading", "processing", "posting"]) expect(estPublieOuEnCours({ postStatus: s })).toBe(true);
  });
});

describe("validerPostRemplacement", () => {
  it("valide et nettoie", () => {
    expect(validerPostRemplacement({ title: "  T  ", body: "Corps" })).toEqual({ title: "T", body: "Corps" });
  });
  it("tronque", () => {
    const r = validerPostRemplacement({ title: "a".repeat(300), body: "b".repeat(9000) })!;
    expect(r.title.length).toBe(200);
    expect(r.body.length).toBe(5000);
  });
  it("rejette l'invalide", () => {
    expect(validerPostRemplacement(null)).toBeNull();
    expect(validerPostRemplacement("x")).toBeNull();
    expect(validerPostRemplacement({ title: "", body: "b" })).toBeNull();
    expect(validerPostRemplacement({ title: "t", body: "  " })).toBeNull();
    expect(validerPostRemplacement({ title: 1, body: "b" })).toBeNull();
    expect(validerPostRemplacement({ title: "t" })).toBeNull();
  });
});
