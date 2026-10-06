import { describe, it, expect, vi } from "vitest";

vi.mock("../../db", () => ({ db: {} }));
vi.mock("./embed", () => ({
  embedTextsParLots: vi.fn(),
  embedTexts: vi.fn(),
  lireEtatEmbeddings: vi.fn(() => ({})),
}));

import { indexerManquants, type DepsIndexation } from "./indexer-manquants";

function fabrique(n: number, embedder: DepsIndexation["embedder"], raison?: string) {
  const lignes = Array.from({ length: n }, (_, i) => ({ id: i + 1, content: `c${i + 1}` }));
  const ecrits: { id: number; userId: string; v: number[] }[] = [];
  const deps: DepsIndexation = {
    chargerManquants: vi.fn(async (_u, max) => lignes.slice(0, max)),
    embedder: vi.fn(embedder),
    ecrireVecteur: vi.fn(async (id, userId, v) => { ecrits.push({ id, userId, v }); }),
    derniereRaison: () => raison,
  };
  return { deps, ecrits };
}

describe("indexerManquants", () => {
  it("tout passe : tout est écrit, scopé par utilisateur", async () => {
    const { deps, ecrits } = fabrique(5, async (t) => t.map(() => [1, 2]));
    const r = await indexerManquants(deps, "u1", { lot: 2 });
    expect(r).toEqual({ traites: 5, indexes: 5, echecs: 0 });
    expect(deps.embedder).toHaveBeenCalledTimes(3);
    expect(ecrits.every((e) => e.userId === "u1")).toBe(true);
    expect(deps.chargerManquants).toHaveBeenCalledWith("u1", 2000);
  });

  it("échec partiel d'un lot suivant : compte les échecs et renvoie la raison", async () => {
    let appel = 0;
    const { deps, ecrits } = fabrique(4, async (t) => (++appel === 1 ? t.map(() => [1]) : t.map(() => null)), "timeout");
    const r = await indexerManquants(deps, "u1", { lot: 2 });
    expect(r).toEqual({ traites: 4, indexes: 2, echecs: 2, raison: "timeout" });
    expect(ecrits.map((e) => e.id)).toEqual([1, 2]);
  });

  it("premier lot entièrement en échec : arrêt immédiat", async () => {
    const { deps, ecrits } = fabrique(10, async (t) => t.map(() => null), "credit_balance_exhausted");
    const r = await indexerManquants(deps, "u1", { lot: 3 });
    expect(deps.embedder).toHaveBeenCalledTimes(1);
    expect(ecrits).toHaveLength(0);
    expect(r).toEqual({ traites: 3, indexes: 0, echecs: 3, raison: "credit_balance_exhausted" });
  });

  it("respecte max", async () => {
    const { deps } = fabrique(10, async (t) => t.map(() => [1]));
    const r = await indexerManquants(deps, "u1", { lot: 4, max: 6 });
    expect(r.traites).toBe(6);
  });

  it("un vecteur partiel dans un lot : seuls les vecteurs reçus sont écrits", async () => {
    const { deps, ecrits } = fabrique(3, async () => [[1], null, [3]], "erreur");
    const r = await indexerManquants(deps, "u1");
    expect(ecrits.map((e) => e.id)).toEqual([1, 3]);
    expect(r).toMatchObject({ indexes: 2, echecs: 1, raison: "erreur" });
  });
});
