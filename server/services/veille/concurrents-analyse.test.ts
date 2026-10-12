import { describe, it, expect } from "vitest";
import { engagementPosts, contenusForts, lireResumeOffre } from "./concurrents-analyse";

describe("engagement Instagram", () => {
  const raw = {
    followers: 1000,
    posts: [
      { url: "p1", likes: 20, comments: 0 }, { url: "p2", likes: 25, comments: 5 },
      { url: "p3", likes_count: 30, num_comments: 0 }, { url: "p4", likes: 150, comments: 30 },
      { url: "p5", likes: "abc" },
    ],
  };
  it("calcule un taux normalisé et ignore les posts illisibles", () => {
    const p = engagementPosts(raw);
    expect(p.map((x) => x.url)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(p[3].taux).toBeCloseTo(0.18);
  });
  it("sans abonnés connus, aucun taux", () => {
    expect(engagementPosts({ posts: raw.posts })).toEqual([]);
    expect(engagementPosts(null)).toEqual([]);
  });
  it("un contenu fort dépasse deux fois la médiane du compte", () => {
    expect(contenusForts(engagementPosts(raw)).map((x) => x.url)).toEqual(["p4"]);
  });
  it("trop peu de posts : rien", () => {
    expect(contenusForts(engagementPosts({ followers: 10, posts: [{ url: "a", likes: 1 }, { url: "b", likes: 9 }] }))).toEqual([]);
  });
});

describe("lireResumeOffre", () => {
  it("lit un changement commercial", () => {
    expect(lireResumeOffre('{"changement_commercial": true, "resume": "Nouveau coffret à 39 €."}')).toEqual({ changement: true, resume: "Nouveau coffret à 39 €." });
  });
  it("pas de changement, ou réponse illisible → rien d'exploitable", () => {
    expect(lireResumeOffre('{"changement_commercial": false, "resume": ""}')?.changement).toBe(false);
    expect(lireResumeOffre("???")).toBeNull();
  });
});
