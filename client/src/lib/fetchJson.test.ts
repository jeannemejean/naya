import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchJson } from "./fetchJson";
import { is401 } from "./queryClient";

function stubFetchOnce(status: number, body: unknown, ok = status < 400) {
  const res = {
    ok,
    status,
    statusText: "",
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  } as unknown as Response;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("fetchJson — robustesse commune (cause racine du crash analytics)", () => {
  it("réponse OK objet → renvoie l'objet", async () => {
    stubFetchOnce(200, { tasks: { total: 1 } });
    expect(await fetchJson("/x")).toEqual({ tasks: { total: 1 } });
  });

  it("réponse OK tableau → renvoie le tableau", async () => {
    stubFetchOnce(200, [{ id: 1 }]);
    expect(await fetchJson("/x")).toEqual([{ id: 1 }]);
  });

  it("401 → THROW reconnu par is401 (exclu de l'ErrorBoundary, géré par le flux d'auth)", async () => {
    stubFetchOnce(401, { message: "Unauthorized" }, false);
    let err: unknown; try { await fetchJson("/x"); } catch (e) { err = e; }
    expect(is401(err)).toBe(true);
  });

  it("500 (corps d'erreur) → THROW : ne renvoie JAMAIS l'objet d'erreur comme donnée", async () => {
    stubFetchOnce(500, { message: "boom" }, false);
    let err: unknown; try { await fetchJson("/x"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
    expect(is401(err)).toBe(false); // → remonte proprement à l'ErrorBoundary
  });
});

// Un test par fichier touché : on simule l'endpoint réel passant désormais par fetchJson.
// OK → données correctes ; erreur → throw (donc data devient undefined côté query, jamais un
// objet d'erreur → plus de `.map`/accès imbriqué sur un corps d'erreur = plus de crash de rendu).
const PER_FILE: Array<{ file: string; url: string; ok: unknown }> = [
  { file: "analytics.tsx (déjà corrigé)", url: "/api/analytics/project-summary?projectId=1", ok: { tasks: { total: 0, byType: {} } } },
  { file: "projects.tsx — brand-dna (objet imbriqué)", url: "/api/projects/1/brand-dna", ok: { projectId: 1 } },
  { file: "projects.tsx — listes (tableau)", url: "/api/clients?projectId=1", ok: [{ id: 1 }] },
  { file: "NayaCompanion.tsx", url: "/api/companion/pending", ok: { messages: [], unreadCount: 0 } },
  { file: "reading-hub.tsx", url: "/api/saved-articles", ok: [{ id: 1 }] },
  { file: "campaigns.tsx", url: "/api/campaigns", ok: [{ id: 1 }] },
  { file: "content-calendar.tsx", url: "/api/content", ok: [{ id: 1 }] },
];

describe("fetchJson — un test par fichier touché", () => {
  for (const { file, url, ok } of PER_FILE) {
    it(`${file} : OK → données ; erreur → throw (pas de corps d'erreur rendu)`, async () => {
      stubFetchOnce(200, ok);
      expect(await fetchJson(url)).toEqual(ok);

      stubFetchOnce(500, { message: "err" }, false);
      let threw = false;
      try { await fetchJson(url); } catch { threw = true; }
      expect(threw).toBe(true);
    });
  }
});
