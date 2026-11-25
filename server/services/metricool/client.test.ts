import { describe, it, expect, vi } from "vitest";
import { postsMetricool, statsMetricool, URL_API_METRICOOL } from "./client";

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
  });
  it("lit réseau, date prévue, publié ou non", async () => {
    const f = vi.fn(async () => rep(200, { data: [
      { text: "Actu 1", publicationDate: { dateTime: "2026-11-12T09:00:00", timezone: "Europe/Paris" }, providers: [{ network: "linkedin", status: "PUBLISHED" }, { network: "instagram", status: "ERROR" }] },
    ] }));
    const r = await postsMetricool(cx, D, F, f as any);
    expect(r).toEqual({ ok: true, posts: [
      { reseau: "linkedin", prevuLe: "2026-11-12T09:00:00", publie: true, texte: "Actu 1" },
      { reseau: "instagram", prevuLe: "2026-11-12T09:00:00", publie: false, texte: "Actu 1" },
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
