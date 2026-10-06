import { describe, it, expect, vi, beforeEach } from "vitest";

// Embedder simulé : renvoie un vecteur après un délai « réseau », et compte les appels.
const { embedSpy } = vi.hoisted(() => ({ embedSpy: vi.fn() }));
vi.mock("../ai/registry", () => ({ registry: { get: () => ({ name: "openai", embed: embedSpy }) } }));
vi.mock("../ai/router", () => ({ route: () => ({ provider: "openai", model: "text-embedding-3-large" }) }));

import { embedText } from "./embed";

const NET_MS = 120; // latence réseau simulée d'un appel OpenAI

beforeEach(() => {
  embedSpy.mockReset();
  embedSpy.mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, NET_MS));
    return { vectors: [[0.11, 0.22, 0.33]], model: "text-embedding-3-large", provider: "openai" };
  });
});

describe("embedText — cache par hash de contenu", () => {
  it("le 2e appel sur le MÊME contenu ne rappelle PAS OpenAI (cache hit) → gain mesuré", async () => {
    const txt = "brief stratégique long — contenu identité unique " + Date.now();

    const t1 = Date.now();
    const v1 = await embedText(txt);
    const cold = Date.now() - t1;

    const t2 = Date.now();
    const v2 = await embedText(txt);
    const warm = Date.now() - t2;

    expect(v1).toEqual([0.11, 0.22, 0.33]);
    expect(v2).toEqual([0.11, 0.22, 0.33]);
    // L'embedder n'a été appelé qu'UNE fois : le 2e est servi par le cache.
    expect(embedSpy).toHaveBeenCalledTimes(1);
    // Gain mesuré : le 1er paie la latence réseau, le 2e est quasi instantané.
    expect(cold).toBeGreaterThanOrEqual(NET_MS - 20);
    expect(warm).toBeLessThan(NET_MS / 3);
    // (info) console pour la preuve dans le run :
    console.log(`[embed-cache] cold=${cold}ms warm=${warm}ms gain=${cold - warm}ms`);
  });

  it("un contenu DIFFÉRENT déclenche bien un nouvel embedding (cache miss)", async () => {
    await embedText("contenu A " + Date.now());
    await embedText("contenu B totalement différent " + Date.now());
    expect(embedSpy).toHaveBeenCalledTimes(2);
  });
});

describe("embedTextsParLots", () => {
  const textes = Array.from({ length: 150 }, (_, i) => `t${i}`);
  const vecteurDe = (t: string) => [Number(t.slice(1))];
  beforeEach(() => {
    embedSpy.mockReset();
    embedSpy.mockImplementation(async ({ texts }: { texts: string[] }) => ({ vectors: texts.map(vecteurDe) }));
  });

  it("150 textes : 3 appels séquentiels de 64 / 64 / 22, ordre conservé", async () => {
    const { embedTextsParLots } = await import("./embed");
    const r = await embedTextsParLots(textes, { taille: 64, timeoutMs: 30000 });
    expect(embedSpy.mock.calls.map((c) => c[0].texts.length)).toEqual([64, 64, 22]);
    expect(r).toEqual(textes.map(vecteurDe));
  });
  it("un lot du milieu en échec : seuls ses textes restent null", async () => {
    const { embedTextsParLots } = await import("./embed");
    embedSpy.mockImplementationOnce(async ({ texts }: any) => ({ vectors: texts.map(vecteurDe) }));
    embedSpy.mockImplementationOnce(async () => { throw new Error("boom"); });
    const r = await embedTextsParLots(textes, { taille: 64 });
    expect(r).toHaveLength(150);
    expect(r.slice(0, 64)).toEqual(textes.slice(0, 64).map(vecteurDe));
    expect(r.slice(64, 128).every((v) => v === null)).toBe(true);
    expect(r.slice(128)).toEqual(textes.slice(128).map(vecteurDe));
  });
});
