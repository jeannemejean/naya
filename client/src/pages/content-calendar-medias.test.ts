import { describe, it, expect } from "vitest";
import { deplacer, mediasDuPost } from "./content-calendar-medias";

const mediatheque = [
  { id: 11, url: "https://r2/a.png", mimeType: "image/png" },
  { id: 12, url: "https://r2/b.png", mimeType: "image/png" },
  { id: 13, url: "https://r2/c.mp4", mimeType: "video/mp4" },
];

describe("mediasDuPost", () => {
  it("rend les visuels déposés sur les tâches, dans l'ordre du post", () => {
    expect(mediasDuPost({ mediaIds: [13, 11] }, mediatheque).map((m) => m.url)).toEqual(["https://r2/c.mp4", "https://r2/a.png"]);
  });

  it("ignore un média supprimé de la médiathèque et les doublons", () => {
    expect(mediasDuPost({ mediaIds: [11, 99, 11] }, mediatheque).map((m) => m.id)).toEqual([11]);
  });

  it("retombe sur l'ancien média unique seulement sans visuel rattaché", () => {
    expect(mediasDuPost({ mediaIds: [], mediaUrl: "https://x/old.jpg" }, mediatheque)).toEqual([{ id: 0, url: "https://x/old.jpg", mimeType: "image/*" }]);
    expect(mediasDuPost({ mediaIds: [12], mediaUrl: "https://x/old.jpg" }, mediatheque).map((m) => m.id)).toEqual([12]);
    expect(mediasDuPost({ mediaIds: null }, mediatheque)).toEqual([]);
  });
});

describe("deplacer", () => {
  it("déplace un visuel vers l'avant ou l'arrière", () => {
    expect(deplacer([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
    expect(deplacer([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
  });
  it("ne change rien hors limites ou sur place", () => {
    const l = [1, 2];
    expect(deplacer(l, 1, 1)).toBe(l);
    expect(deplacer(l, 0, 5)).toBe(l);
  });
});
