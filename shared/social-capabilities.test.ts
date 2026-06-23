import { describe, it, expect } from "vitest";
import { validatePost, formatsFor, capabilitiesFor } from "./social-capabilities";

describe("formatsFor", () => {
  it("LinkedIn n'a ni story ni reel", () => {
    const f = formatsFor("linkedin").map((x) => x.format);
    expect(f).toContain("text");
    expect(f).toContain("feed_video");
    expect(f).not.toContain("story");
    expect(f).not.toContain("reel");
  });
  it("Instagram a story + reel + carrousel", () => {
    const f = formatsFor("instagram").map((x) => x.format);
    expect(f).toEqual(expect.arrayContaining(["feed_image", "feed_video", "carousel", "story", "reel"]));
  });
  it("TikTok = vidéo (short) uniquement", () => {
    expect(formatsFor("tiktok").map((x) => x.format)).toEqual(["short"]);
  });
});

describe("validatePost", () => {
  it("accepte une photo feed Instagram valide", () => {
    const r = validatePost({ platform: "instagram", format: "feed_image", media: [{ kind: "image" }], caption: "ok" });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("refuse une story sur LinkedIn (format indisponible)", () => {
    const r = validatePost({ platform: "linkedin", format: "story", media: [{ kind: "image" }], caption: "" });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/n'est pas disponible/);
  });

  it("refuse un carrousel à 1 seul média", () => {
    const r = validatePost({ platform: "instagram", format: "carousel", media: [{ kind: "image" }], caption: "" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/au moins 2/);
  });

  it("refuse un carrousel à 11 médias (max 10)", () => {
    const media = Array.from({ length: 11 }, () => ({ kind: "image" as const }));
    const r = validatePost({ platform: "instagram", format: "carousel", media, caption: "" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/10 média/);
  });

  it("refuse une image là où une vidéo est requise (reel)", () => {
    const r = validatePost({ platform: "instagram", format: "reel", media: [{ kind: "image" }], caption: "" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/vidéo est requise/);
  });

  it("refuse une vidéo de reel trop longue (>90s)", () => {
    const r = validatePost({ platform: "instagram", format: "reel", media: [{ kind: "video", durationSec: 120 }], caption: "" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/trop longue/);
  });

  it("refuse une légende trop longue sur Twitter-like court (TikTok 2200)", () => {
    const r = validatePost({ platform: "tiktok", format: "short", media: [{ kind: "video", durationSec: 30 }], caption: "x".repeat(2201) });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/trop longue/);
  });

  it("accepte une vidéo TikTok valide", () => {
    const r = validatePost({ platform: "tiktok", format: "short", media: [{ kind: "video", durationSec: 30 }], caption: "ok" });
    expect(r.ok).toBe(true);
  });

  it("capabilitiesFor renvoie la limite de légende", () => {
    expect(capabilitiesFor("linkedin").captionMax).toBe(3000);
  });
});
