import { describe, it, expect } from "vitest";
import { mediasDuPost } from "./content-calendar-medias";

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
