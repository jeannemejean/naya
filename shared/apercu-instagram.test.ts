import { describe, it, expect } from "vitest";
import { APERCU_LIMITE, dansLaGrille, tuilePale, tuilesInstagram } from "./apercu-instagram";

const MAINTENANT = new Date("2026-11-23T12:00:00Z");
let n = 0;
const post = (o: Record<string, any>) => ({
  id: ++n, platform: "instagram", postFormat: "feed_image", mediaIds: [], contentStatus: "draft", autoPost: false,
  publishedAt: null, postStatus: "pending", scheduledFor: null, body: "x", campaignId: null, ...o,
});
const medias = new Map([
  [1, { url: "img1.jpg", thumbnailUrl: null, mimeType: "image/jpeg" }],
  [2, { url: "vid.mp4", thumbnailUrl: "vid-thumb.jpg", mimeType: "video/mp4" }],
  [3, { url: "vid2.mp4", thumbnailUrl: null, mimeType: "video/mp4" }],
  [4, { url: "img4.jpg", thumbnailUrl: "img4-s.jpg", mimeType: "image/png" }],
]);

describe("dansLaGrille", () => {
  it("Instagram, formats du fil seulement ; ni story, ni corbeille, ni Reel hors du fil", () => {
    expect(dansLaGrille(post({}))).toBe(true);
    expect(dansLaGrille(post({ platform: "Instagram", postFormat: "carousel" }))).toBe(true);
    expect(dansLaGrille(post({ postFormat: "story" }))).toBe(false);
    expect(dansLaGrille(post({ platform: "linkedin" }))).toBe(false);
    expect(dansLaGrille(post({ supprimeLe: new Date() }))).toBe(false);
    expect(dansLaGrille(post({ postFormat: "reel", reelDansLeFil: false }))).toBe(false);
    expect(dansLaGrille(post({ postFormat: "reel", reelDansLeFil: null }))).toBe(true);
  });
});

describe("tuilesInstagram", () => {
  it("à venir du plus lointain au plus proche, puis publiés du plus récent au plus ancien", () => {
    const a = post({ scheduledFor: "2026-11-25T09:00:00Z" });
    const b = post({ scheduledFor: "2026-12-10T09:00:00Z" });
    const c = post({ publishedAt: "2026-11-20T09:00:00Z", postStatus: "posted" });
    const d = post({ publishedAt: "2026-11-22T09:00:00Z", postStatus: "posted" });
    const t = tuilesInstagram([a, c, b, d], medias, MAINTENANT);
    expect(t.map((x) => x.id)).toEqual([b.id, a.id, d.id, c.id]);
  });
  it("sans date, ou en retard de plus d'un jour : absent ; en retard de quelques heures : présent", () => {
    const sansDate = post({});
    const vieux = post({ scheduledFor: "2026-11-20T09:00:00Z" });
    const recent = post({ scheduledFor: "2026-11-23T08:00:00Z" });
    expect(tuilesInstagram([sansDate, vieux, recent], medias, MAINTENANT).map((x) => x.id)).toEqual([recent.id]);
  });
  it("état, pâleur, programmation", () => {
    const brouillon = post({ scheduledFor: "2026-11-30T09:00:00Z" });
    const programme = post({ scheduledFor: "2026-11-29T09:00:00Z", autoPost: true, contentStatus: "ready" });
    const publie = post({ publishedAt: "2026-11-01T09:00:00Z", postStatus: "posted", autoPost: true, scheduledFor: "2026-11-01T09:00:00Z" });
    const [t1, t2, t3] = tuilesInstagram([brouillon, programme, publie], medias, MAINTENANT);
    expect(t1).toMatchObject({ etat: "brouillon", programme: false, scheduledFor: "2026-11-30T09:00:00.000Z" });
    expect(tuilePale(t1)).toBe(true);
    expect(t2).toMatchObject({ etat: "valide", programme: true });
    expect(tuilePale(t2)).toBe(false);
    expect(t3).toMatchObject({ etat: "publie", programme: false, publishedAt: "2026-11-01T09:00:00.000Z" });
  });
  it("premier média : image, carrousel, vidéo (couverture, vignette, sinon rien)", () => {
    const quand = { scheduledFor: "2026-12-01T09:00:00Z" };
    const img = post({ ...quand, mediaIds: [4] });
    const car = post({ ...quand, mediaIds: [1, 2], postFormat: "carousel" });
    const vid = post({ ...quand, mediaIds: [2], postFormat: "reel" });
    const couv = post({ ...quand, mediaIds: [2], postFormat: "reel", couvertureUrl: "couv.jpg" });
    const nue = post({ ...quand, mediaIds: [3], postFormat: "feed_video" });
    const sans = post({ ...quand, postFormat: "reel" });
    const t = new Map(tuilesInstagram([img, car, vid, couv, nue, sans], medias, MAINTENANT).map((x) => [x.id, x]));
    expect(t.get(img.id)).toMatchObject({ kind: "image", mediaUrl: "img4.jpg", thumbnailUrl: "img4-s.jpg" });
    expect(t.get(car.id)).toMatchObject({ kind: "carrousel", mediaUrl: "img1.jpg", thumbnailUrl: "img1.jpg" });
    expect(t.get(vid.id)).toMatchObject({ kind: "video", mediaUrl: "vid.mp4", thumbnailUrl: "vid-thumb.jpg" });
    expect(t.get(couv.id)).toMatchObject({ kind: "video", thumbnailUrl: "couv.jpg" });
    expect(t.get(nue.id)).toMatchObject({ kind: "video", thumbnailUrl: null });
    expect(t.get(sans.id)).toMatchObject({ kind: "video", mediaUrl: null, thumbnailUrl: null });
  });
  it("limité à 30", () => {
    const beaucoup = Array.from({ length: 40 }, (_, i) => post({ publishedAt: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(), postStatus: "posted" }));
    expect(tuilesInstagram(beaucoup, medias, MAINTENANT)).toHaveLength(APERCU_LIMITE);
  });
});
