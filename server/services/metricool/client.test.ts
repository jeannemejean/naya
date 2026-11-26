import { describe, it, expect, vi } from "vitest";
import { marquesMetricool, postsMetricool, statsMetricool, URL_API_METRICOOL } from "./client";

const cx = { jeton: "tok", mcUserId: "11", blogId: "22" };
const D = new Date("2026-11-10T00:00:00Z"); const F = new Date("2026-11-25T09:00:00Z");
const rep = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as any;

describe("postsMetricool", () => {
  it("appelle l'endpoint documenté avec le jeton dans X-Mc-Auth, userId et blogId", async () => {
    const f = vi.fn(async () => rep(200, { data: [] }));
    await postsMetricool(cx, D, F, f as any);
    const [url, init] = (f.mock.calls[0] as any);
    expect(String(url)).toMatch(new RegExp(`^${URL_API_METRICOOL}/v2/scheduler/posts\\?`));
    expect(String(url)).toContain("userId=11");
    expect(String(url)).toContain("blogId=22");
    expect(init.headers["X-Mc-Auth"]).toBe("tok");
    // Bornes en heure de Paris (D = 10 nov. 0 h UTC = 1 h à Paris).
    expect(String(url)).toContain("start=2026-11-10T01%3A00%3A00");
  });
  it("lit réseau, date prévue, publié ou non", async () => {
    const f = vi.fn(async () => rep(200, { data: [
      { text: "Actu 1", publicationDate: { dateTime: "2026-11-12T09:00:00", timezone: "Europe/Paris" }, providers: [{ network: "linkedin", status: "PUBLISHED" }, { network: "instagram", status: "ERROR" }] },
    ] }));
    const r = await postsMetricool(cx, D, F, f as any);
    // 9 h à Paris le 12 nov. = 8 h UTC.
    expect(r).toEqual({ ok: true, posts: [
      { reseau: "linkedin", prevuLe: "2026-11-12T08:00:00.000Z", publie: true, texte: "Actu 1" },
      { reseau: "instagram", prevuLe: "2026-11-12T08:00:00.000Z", publie: false, texte: "Actu 1" },
    ] });
  });
  it("401/403 : refuse ; autre erreur : erreur ; réponse illisible : indisponible", async () => {
    expect(await postsMetricool(cx, D, F, (async () => rep(403, {})) as any)).toEqual({ ok: false, raison: "refuse" });
    expect(await postsMetricool(cx, D, F, (async () => rep(401, {})) as any)).toEqual({ ok: false, raison: "refuse" });
    expect(await postsMetricool(cx, D, F, (async () => rep(500, {})) as any)).toEqual({ ok: false, raison: "erreur" });
    expect(await postsMetricool(cx, D, F, (async () => rep(200, { pas: "de data" })) as any)).toEqual({ ok: false, raison: "indisponible" });
    expect(await postsMetricool(cx, D, F, (async () => { throw new Error("fetch failed"); }) as any)).toEqual({ ok: false, raison: "erreur" });
  });
});

describe("statsMetricool", () => {
  it("non documenté publiquement : toujours indisponible, aucun appel", async () => {
    const f = vi.fn();
    expect(await statsMetricool(cx, D, F, f as any)).toEqual({ ok: false, raison: "indisponible" });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("marquesMetricool", () => {
  it("liste les marques du compte par l'endpoint documenté (jeton en en-tête, userId seul)", async () => {
    const f = vi.fn(async () => rep(200, [
      { id: 6238528, userId: 48, label: "Agence JMD " },
      { id: 7185063, userId: 48, label: "Encore Merci" },
      { id: 99, userId: 48 },
    ]));
    const r = await marquesMetricool("tok", "48", f as any);
    const [url, init] = (f.mock.calls[0] as any);
    expect(String(url)).toBe(`${URL_API_METRICOOL}/admin/simpleProfiles?userId=48`);
    expect(init.headers["X-Mc-Auth"]).toBe("tok");
    expect(r).toEqual({ ok: true, marques: [
      { blogId: "6238528", nom: "Agence JMD" }, { blogId: "7185063", nom: "Encore Merci" }, { blogId: "99", nom: "99" },
    ] });
  });
  it("accepte aussi { data: [...] } ; refus et erreurs comme pour les posts", async () => {
    expect(await marquesMetricool("t", "1", (async () => rep(200, { data: [{ id: 1, label: "A" }] })) as any)).toEqual({ ok: true, marques: [{ blogId: "1", nom: "A" }] });
    expect(await marquesMetricool("t", "1", (async () => rep(401, {})) as any)).toEqual({ ok: false, raison: "refuse" });
    expect(await marquesMetricool("t", "1", (async () => rep(200, { rien: 1 })) as any)).toEqual({ ok: false, raison: "indisponible" });
    expect(await marquesMetricool("t", "1", (async () => { throw new Error("x"); }) as any)).toEqual({ ok: false, raison: "erreur" });
  });
});
