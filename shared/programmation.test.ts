import { describe, it, expect } from "vitest";
import { compteDuPost, formatDePublication, problemesProgrammation } from "./programmation";

const maintenant = new Date("2026-10-09T16:00:00Z");
const ig = { id: 4, platform: "instagram", accountName: "jeanne", isActive: true, expiresAt: "2026-12-01T00:00:00Z" };
const post = { body: "Texte", platform: "Instagram", scheduledFor: "2026-10-14T07:00:00Z", postStatus: "pending" };

describe("formatDePublication", () => {
  it("déduit le format des visuels", () => {
    expect(formatDePublication("feed_image", ["image", "image", "image"])).toBe("carousel");
    expect(formatDePublication("feed_image", ["video"])).toBe("feed_video");
    expect(formatDePublication(null, ["image"])).toBe("feed_image");
    expect(formatDePublication("feed_image", [])).toBe("text");
  });
  it("respecte un format explicite (story, reel)", () => {
    expect(formatDePublication("reel", ["video"])).toBe("reel");
    expect(formatDePublication("story", ["image", "image"])).toBe("story");
  });
});

describe("compteDuPost", () => {
  it("prend le compte lié, sinon le compte actif de la plateforme (casse ignorée)", () => {
    const li = { id: 3, platform: "linkedin", isActive: true };
    expect(compteDuPost({ platform: "Instagram" }, [li, ig])?.id).toBe(4);
    expect(compteDuPost({ platform: "instagram", socialAccountId: 3 }, [li, ig])?.id).toBe(3);
    expect(compteDuPost({ platform: "tiktok" }, [li, ig])).toBeNull();
  });
});

describe("problemesProgrammation", () => {
  it("rien ne bloque un post prêt", () => {
    expect(problemesProgrammation({ post, medias: ["image"], compte: ig, maintenant })).toEqual([]);
  });
  it("signale le compte expiré, le visuel manquant, la date passée, le texte vide", () => {
    expect(problemesProgrammation({
      post: { ...post, body: " ", scheduledFor: "2026-10-09T16:01:00Z" },
      medias: [], compte: { ...ig, expiresAt: "2026-08-22T18:17:40Z" }, maintenant,
    })).toEqual(["texte_vide", "date_passee", "compte_expire", "visuel_requis"]);
  });
  it("LinkedIn accepte un post sans visuel ; une plateforme non publiable bloque", () => {
    expect(problemesProgrammation({ post: { ...post, platform: "linkedin" }, medias: [], compte: { id: 3, platform: "linkedin" }, maintenant })).toEqual([]);
    expect(problemesProgrammation({ post: { ...post, platform: "TikTok" }, medias: ["video"], compte: null, maintenant })).toEqual(["plateforme_non_supportee"]);
  });
  it("un post publié ne se programme plus ; pas plus de 10 visuels", () => {
    expect(problemesProgrammation({ post: { ...post, postStatus: "posted" }, medias: ["image"], compte: ig, maintenant })).toEqual(["deja_publie"]);
    expect(problemesProgrammation({ post, medias: Array(11).fill("image"), compte: ig, maintenant })).toEqual(["trop_de_visuels"]);
  });
});
