import { describe, it, expect, vi } from "vitest";
import { moteursConfigures, lireReponseOpenAI, lireReponsePerplexity, interrogerMoteur } from "./moteurs-ia";

describe("moteurs configurés", () => {
  it("selon les clés présentes", () => {
    expect(moteursConfigures({})).toEqual([]);
    expect(moteursConfigures({ OPENAI_API_KEY: "x" })).toEqual(["openai"]);
    expect(moteursConfigures({ OPENAI_API_KEY: "x", PERPLEXITY_API_KEY: "y" })).toEqual(["openai", "perplexity"]);
  });
});

describe("lecture des réponses", () => {
  it("OpenAI Responses : texte et URLs citées", () => {
    const json = { output: [
      { type: "web_search_call", id: "ws" },
      { type: "message", content: [{ type: "output_text", text: "Lune Studio est bien noté.", annotations: [
        { type: "url_citation", url: "https://elle.fr/a" }, { type: "url_citation", url: "https://elle.fr/a" }, { type: "autre" },
      ] }] },
    ] };
    expect(lireReponseOpenAI(json)).toEqual({ texte: "Lune Studio est bien noté.", citations: ["https://elle.fr/a"] });
  });
  it("Perplexity : texte, citations ou résultats de recherche", () => {
    expect(lireReponsePerplexity({ choices: [{ message: { content: "Réponse" } }], citations: ["https://a.fr", 3] }))
      .toEqual({ texte: "Réponse", citations: ["https://a.fr"] });
    expect(lireReponsePerplexity({ choices: [{ message: { content: "R" } }], search_results: [{ url: "https://b.fr" }] }).citations)
      .toEqual(["https://b.fr"]);
  });
  it("une forme inattendue donne une réponse vide", () => {
    expect(lireReponseOpenAI(null)).toEqual({ texte: "", citations: [] });
    expect(lireReponsePerplexity({})).toEqual({ texte: "", citations: [] });
  });
});

describe("interrogerMoteur", () => {
  it("appelle OpenAI avec la recherche web et lit la réponse", async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ output: [{ type: "message", content: [{ type: "output_text", text: "ok", annotations: [] }] }] }) }));
    const r = await interrogerMoteur("openai", "Quelle bougie ?", { fetch: fetch as any, env: { OPENAI_API_KEY: "k" } });
    expect(r.texte).toBe("ok");
    const [url, init] = (fetch.mock.calls[0] as any);
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(init.body);
    expect(body.input).toBe("Quelle bougie ?");
    expect(body.tools[0].type).toMatch(/web_search/);
    expect(init.headers.Authorization).toBe("Bearer k");
  });
  it("lève une erreur lisible sur un refus HTTP ou une clé absente", async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 401, text: async () => "bad key", json: async () => ({}) }));
    await expect(interrogerMoteur("perplexity", "Q", { fetch: fetch as any, env: { PERPLEXITY_API_KEY: "k" } })).rejects.toThrow(/Perplexity.*401/);
    await expect(interrogerMoteur("openai", "Q", { fetch: fetch as any, env: {} })).rejects.toThrow(/clé/);
  });
});
