import { describe, it, expect } from "vitest";
import { igMediaType, igIsAsync, igContainerParams, linkedinAuthorUrn } from "./social-publishers";

describe("linkedinAuthorUrn", () => {
  it("profil → urn:li:person", () => expect(linkedinAuthorUrn("linkedin", "ABC123")).toBe("urn:li:person:ABC123"));
  it("page entreprise → urn:li:organization", () => expect(linkedinAuthorUrn("linkedin_page_999", "999")).toBe("urn:li:organization:999"));
  it("défaut (undefined) → person", () => expect(linkedinAuthorUrn(undefined, "X")).toBe("urn:li:person:X"));
});

describe("igMediaType", () => {
  it("image feed → IMAGE", () => expect(igMediaType("feed_image", "image")).toBe("IMAGE"));
  it("reel → REELS", () => expect(igMediaType("reel", "video")).toBe("REELS"));
  it("feed_video → REELS (IG traite la vidéo feed comme un reel)", () => expect(igMediaType("feed_video", "video")).toBe("REELS"));
  it("story → STORIES", () => expect(igMediaType("story", "image")).toBe("STORIES"));
});

describe("igIsAsync", () => {
  it("reel = async (vidéo)", () => expect(igIsAsync("reel", [{ url: "v", kind: "video" }])).toBe(true));
  it("feed_image = synchrone", () => expect(igIsAsync("feed_image", [{ url: "i", kind: "image" }])).toBe(false));
  it("story image = synchrone", () => expect(igIsAsync("story", [{ url: "i", kind: "image" }])).toBe(false));
  it("story vidéo = async", () => expect(igIsAsync("story", [{ url: "v", kind: "video" }])).toBe(true));
  it("carrousel avec une vidéo = async", () =>
    expect(igIsAsync("carousel", [{ url: "i", kind: "image" }, { url: "v", kind: "video" }])).toBe(true));
});

describe("igContainerParams", () => {
  it("photo feed : image_url + caption", () => {
    const p = igContainerParams("feed_image", { url: "https://x/i.jpg", kind: "image" }, "Bonjour");
    expect(p).toEqual({ image_url: "https://x/i.jpg", caption: "Bonjour" });
  });
  it("reel : video_url + media_type REELS + caption", () => {
    const p = igContainerParams("reel", { url: "https://x/v.mp4", kind: "video" }, "Légende");
    expect(p).toEqual({ video_url: "https://x/v.mp4", media_type: "REELS", caption: "Légende" });
  });
  it("story vidéo : media_type STORIES, pas de caption", () => {
    const p = igContainerParams("story", { url: "https://x/v.mp4", kind: "video" }, "ignorée");
    expect(p).toEqual({ video_url: "https://x/v.mp4", media_type: "STORIES" });
  });
  it("enfant de carrousel : is_carousel_item, pas de caption", () => {
    const p = igContainerParams("carousel", { url: "https://x/i.jpg", kind: "image" }, "Légende", true);
    expect(p).toEqual({ image_url: "https://x/i.jpg", is_carousel_item: true });
  });
});
