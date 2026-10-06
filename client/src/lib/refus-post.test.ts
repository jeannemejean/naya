import { describe, it, expect } from "vitest";
import { postRefusable } from "./refus-post";

describe("postRefusable", () => {
  it("vrai pour un brouillon", () => {
    expect(postRefusable({ contentStatus: "draft", postStatus: "pending", publishedAt: null })).toBe(true);
  });
  it("faux si publié, en cours ou publishedAt posé", () => {
    expect(postRefusable({ publishedAt: new Date() })).toBe(false);
    expect(postRefusable({ contentStatus: "published" })).toBe(false);
    for (const s of ["posted", "uploading", "processing", "posting"]) {
      expect(postRefusable({ postStatus: s })).toBe(false);
    }
  });
});
