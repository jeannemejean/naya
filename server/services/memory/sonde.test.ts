import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { embedTexts, lire } = vi.hoisted(() => ({ embedTexts: vi.fn(), lire: vi.fn() }));
vi.mock("../../db", () => ({ db: {} }));
vi.mock("./embed", () => ({ embedTextsParLots: vi.fn(), embedTexts, lireEtatEmbeddings: lire }));

import { sonderEmbeddings, invaliderSonde } from "./indexer-manquants";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));
  invaliderSonde();
  embedTexts.mockReset();
  lire.mockReturnValue({ dernierEchec: { a: new Date(), raison: "credit_balance_exhausted" } });
});
afterEach(() => vi.useRealTimers());

describe("sonderEmbeddings", () => {
  it("un échec n'est mémorisé que 30 s", async () => {
    embedTexts.mockResolvedValue(null);
    expect(await sonderEmbeddings()).toEqual({ disponible: false, raison: "credit_balance_exhausted" });
    await sonderEmbeddings();
    expect(embedTexts).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(31_000);
    embedTexts.mockResolvedValue([[1]]);
    expect(await sonderEmbeddings()).toEqual({ disponible: true });
    expect(embedTexts).toHaveBeenCalledTimes(2);
  });

  it("un succès reste mémorisé 5 min", async () => {
    embedTexts.mockResolvedValue([[1]]);
    await sonderEmbeddings();
    vi.advanceTimersByTime(4 * 60_000);
    await sonderEmbeddings();
    expect(embedTexts).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61_000);
    await sonderEmbeddings();
    expect(embedTexts).toHaveBeenCalledTimes(2);
  });

  it("forcer contourne le cache", async () => {
    embedTexts.mockResolvedValue([[1]]);
    await sonderEmbeddings();
    await sonderEmbeddings({ forcer: true });
    expect(embedTexts).toHaveBeenCalledTimes(2);
  });

  it("les appels concurrents à froid partagent une seule sonde", async () => {
    let fin!: (v: number[][]) => void;
    embedTexts.mockImplementation(() => new Promise((r) => { fin = r; }));
    const [a, b, c] = [sonderEmbeddings(), sonderEmbeddings(), sonderEmbeddings({ forcer: true })];
    fin([[1]]);
    expect(await Promise.all([a, b, c])).toEqual([{ disponible: true }, { disponible: true }, { disponible: true }]);
    expect(embedTexts).toHaveBeenCalledTimes(1);
  });
});
