import { describe, it, expect, vi, afterEach } from "vitest";
import { PDFDocument } from "pdf-lib";
import { igMediaType, igIsAsync, igContainerParams, igCarouselParams, imagesVersPdf, linkedinAuthorUrn, publishPost } from "./social-publishers";

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

describe("igContainerParams : couverture d'un Reel", () => {
  const video = { url: "https://x/v.mp4", kind: "video" as const };
  it("image de couverture prioritaire, sinon instant en ms", () => {
    expect(igContainerParams("reel", video, "t", false, { url: "https://x/c.jpg", offsetMs: 3000 })).toMatchObject({ cover_url: "https://x/c.jpg" });
    expect(igContainerParams("reel", video, "t", false, { url: "https://x/c.jpg", offsetMs: 3000 })).not.toHaveProperty("thumb_offset");
    expect(igContainerParams("reel", video, "t", false, { offsetMs: 2500 })).toMatchObject({ thumb_offset: 2500 });
  });
  it("pas de couverture sur une story, un élément de carrousel ou une image", () => {
    expect(igContainerParams("story", video, "t", false, { offsetMs: 1000 })).not.toHaveProperty("thumb_offset");
    expect(igContainerParams("carousel", video, "t", true, { offsetMs: 1000 })).not.toHaveProperty("thumb_offset");
    expect(igContainerParams("feed_image", { url: "https://x/i.jpg", kind: "image" }, "t", false, { url: "https://x/c.jpg" })).not.toHaveProperty("cover_url");
  });
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

describe("igContainerParams : options de post (alt, collaborateurs, Reel)", () => {
  const image = { url: "https://x/i.jpg", kind: "image" as const };
  const video = { url: "https://x/v.mp4", kind: "video" as const };
  const options = { texteAlternatif: "Une tasse sur une table", collaborateurs: ["mouture.cafe", "jeanne"], reelDansLeFil: false, nomAudio: "Son original" };

  it("photo du fil : alt_text + collaborators, rien du Reel", () => {
    const p = igContainerParams("feed_image", image, "L", false, undefined, options);
    expect(p).toEqual({ image_url: "https://x/i.jpg", caption: "L", alt_text: "Une tasse sur une table", collaborators: ["mouture.cafe", "jeanne"] });
  });
  it("image de carrousel : alt_text seulement (collaborateurs sur le conteneur carrousel)", () => {
    const p = igContainerParams("carousel", image, "L", true, undefined, options);
    expect(p).toEqual({ image_url: "https://x/i.jpg", is_carousel_item: true, alt_text: "Une tasse sur une table" });
  });
  it("vidéo de carrousel : rien", () => {
    const p = igContainerParams("carousel", video, "L", true, undefined, options);
    for (const k of ["alt_text", "collaborators", "share_to_feed", "audio_name"]) expect(p).not.toHaveProperty(k);
  });
  it("Reel : collaborators, share_to_feed, audio_name ; jamais d'alt_text", () => {
    const p = igContainerParams("reel", video, "L", false, undefined, options);
    expect(p).toMatchObject({ media_type: "REELS", collaborators: ["mouture.cafe", "jeanne"], share_to_feed: false, audio_name: "Son original" });
    expect(p).not.toHaveProperty("alt_text");
    // feed_video part aussi en REELS
    expect(igContainerParams("feed_video", video, "L", false, undefined, options)).toMatchObject({ share_to_feed: false, audio_name: "Son original" });
  });
  it("Reel sans choix : share_to_feed absent (défaut d'Instagram)", () => {
    const p = igContainerParams("reel", video, "L", false, undefined, { reelDansLeFil: null });
    expect(p).not.toHaveProperty("share_to_feed");
    expect(igContainerParams("reel", video, "L", false, undefined, { reelDansLeFil: true })).toMatchObject({ share_to_feed: true });
  });
  it("story (image ou vidéo) : aucune option", () => {
    for (const item of [image, video]) {
      const p = igContainerParams("story", item, "L", false, undefined, options);
      for (const k of ["alt_text", "collaborators", "share_to_feed", "audio_name"]) expect(p).not.toHaveProperty(k);
    }
  });
  it("options vides : rien d'ajouté", () => {
    expect(igContainerParams("feed_image", image, "L", false, undefined, { texteAlternatif: "  ", collaborateurs: [] }))
      .toEqual({ image_url: "https://x/i.jpg", caption: "L" });
  });
});

describe("igCarouselParams", () => {
  it("conteneur carrousel : enfants, légende, collaborateurs", () => {
    expect(igCarouselParams(["1", "2"], "L", { collaborateurs: ["a.b"], texteAlternatif: "x", reelDansLeFil: true }))
      .toEqual({ media_type: "CAROUSEL", children: "1,2", caption: "L", collaborators: ["a.b"] });
    expect(igCarouselParams(["1"], "L")).toEqual({ media_type: "CAROUSEL", children: "1", caption: "L" });
  });
});

// PNG 1×1 transparent
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));

describe("imagesVersPdf", () => {
  it("une page par image, dans l'ordre", async () => {
    const bytes = await imagesVersPdf([PNG, PNG, PNG]);
    expect(bytes.length).toBeGreaterThan(0);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });
  it("format non pris en charge (ni JPEG ni PNG) → erreur claire", async () => {
    await expect(imagesVersPdf([Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0])])).rejects.toThrow("li_document_image_non_supportee");
  });
});

describe("publishPost LinkedIn : carrousel en document PDF", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch() {
    const appels: { url: string; init?: any }[] = [];
    const f = vi.fn(async (url: string, init?: any) => {
      appels.push({ url, init });
      if (url.startsWith("https://cdn/")) return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
      if (url.includes("/rest/documents?action=initializeUpload")) {
        return new Response(JSON.stringify({ value: { uploadUrl: "https://upload/doc", document: "urn:li:document:D1" } }), { status: 200 });
      }
      if (url === "https://upload/doc") return new Response(null, { status: 201 });
      if (url.endsWith("/rest/posts")) return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:9" } });
      return new Response("inattendu", { status: 500 });
    });
    vi.stubGlobal("fetch", f);
    return appels;
  }
  const base = {
    platform: "linkedin", format: "carousel", caption: "Légende",
    media: [{ url: "https://cdn/1.png", kind: "image" as const }, { url: "https://cdn/2.png", kind: "image" as const }],
    credentials: { accessToken: "tok", accountId: "P1", accountPlatform: "linkedin" },
  };

  it("initializeUpload → PUT du PDF → post avec media { id, title }", async () => {
    const appels = stubFetch();
    const r = await publishPost({ ...base, options: { linkedinDocument: true, titre: "Mon carrousel" } });
    expect(r).toEqual({ state: "posted", platformPostId: "urn:li:share:9" });
    const init = appels.find((a) => a.url.includes("/rest/documents?action=initializeUpload"))!;
    expect(JSON.parse(init.init.body)).toEqual({ initializeUploadRequest: { owner: "urn:li:person:P1" } });
    const put = appels.find((a) => a.url === "https://upload/doc")!;
    expect(put.init.method).toBe("PUT");
    const pdf = new Uint8Array(put.init.body);
    expect(pdf.length).toBeGreaterThan(0);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2);
    const post = JSON.parse(appels.find((a) => a.url.endsWith("/rest/posts"))!.init.body);
    expect(post.content).toEqual({ media: { id: "urn:li:document:D1", title: "Mon carrousel" } });
    expect(appels.some((a) => a.url.includes("/rest/images"))).toBe(false);
  });

  it("titre tronqué à 200 caractères", async () => {
    const appels = stubFetch();
    await publishPost({ ...base, options: { linkedinDocument: true, titre: "t".repeat(250) } });
    const post = JSON.parse(appels.find((a) => a.url.endsWith("/rest/posts"))!.init.body);
    expect(post.content.media.title).toHaveLength(200);
  });

  it("sans l'option : multi-images comme avant (pas de document)", async () => {
    const f = vi.fn(async (url: string) => {
      if (url.startsWith("https://cdn/")) return new Response(PNG, { status: 200 });
      if (url.includes("/rest/images?action=initializeUpload")) return new Response(JSON.stringify({ value: { uploadUrl: "https://upload/img", image: "urn:li:image:I" } }), { status: 200 });
      if (url === "https://upload/img") return new Response(null, { status: 201 });
      return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:1" } });
    });
    vi.stubGlobal("fetch", f);
    const r = await publishPost({ ...base, options: { linkedinDocument: false } });
    expect(r.state).toBe("posted");
    expect(f.mock.calls.some(([u]) => String(u).includes("/rest/documents"))).toBe(false);
  });
});


describe("igContainerParams : vidéo dans un carrousel", () => {
  it("media_type VIDEO (et non REELS) pour un élément de carrousel", () => {
    const p = igContainerParams("carousel", { url: "https://x/v.mp4", kind: "video" }, "t", true);
    expect(p.media_type).toBe("VIDEO");
    expect(p.is_carousel_item).toBe(true);
  });
});
