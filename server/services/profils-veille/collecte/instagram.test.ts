import { describe, it, expect } from "vitest";
import { lireProfilInstagram } from "./instagram";

describe("lireProfilInstagram", () => {
  it("lit compte, abonnés et posts (champs usuels du dataset)", () => {
    const r = lireProfilInstagram({
      account: "Lune.Studio", followers: 12000,
      posts: [
        { url: "https://www.instagram.com/p/A/?img_index=1", datetime: "2026-10-10T09:00:00.000Z", content_type: "Carousel", likes: 300, comments: 12, caption: "Avant / après @cliente une séance" },
        { url: "https://www.instagram.com/reel/B/", date_time: "2026-10-09T09:00:00.000Z", product_type: "clips", likes_count: 80, num_comments: 2, video_view_count: 4000 },
        { url: "https://www.instagram.com/p/C/", timestamp: 1791000000, is_video: false, likes: 10 },
      ],
    });
    expect(r.compte).toBe("lune.studio");
    expect(r.abonnes).toBe(12000);
    expect(r.erreur).toBeNull();
    expect(r.posts[0]).toEqual({
      url: "https://www.instagram.com/p/A/?img_index=1", publieLe: new Date("2026-10-10T09:00:00.000Z"), typeMedia: "carrousel",
      legende: "Avant / après … une séance", metriques: { likes: 300, commentaires: 12, vues: null },
    });
    expect(r.posts[1].typeMedia).toBe("reel");
    expect(r.posts[1].metriques).toEqual({ likes: 80, commentaires: 2, vues: 4000 });
    expect(r.posts[2].typeMedia).toBe("image");
    expect(r.posts[2].publieLe).toEqual(new Date(1791000000 * 1000));
  });
  it("likes masqués : likes null (jamais 0)", () => {
    const r = lireProfilInstagram({ account: "x", followers: 10, posts: [{ url: "https://www.instagram.com/p/D/", likes: null, comments: 3 }] });
    expect(r.posts[0].metriques.likes).toBeNull();
  });
  it("ligne d'erreur Bright Data, compte privé ou introuvable : erreur et aucun post", () => {
    expect(lireProfilInstagram({ error: "Profile not found", input: { url: "u" } })).toMatchObject({ erreur: "Profile not found", posts: [] });
    expect(lireProfilInstagram({ account: "x", is_private: true, posts: [] })).toMatchObject({ erreur: "prive" });
    expect(lireProfilInstagram(null)).toMatchObject({ erreur: "vide", posts: [] });
  });
});
