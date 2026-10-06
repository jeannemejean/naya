import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { embedSpy } = vi.hoisted(() => ({ embedSpy: vi.fn() }));
vi.mock("../ai/registry", () => ({ registry: { get: () => ({ name: "openai", embed: embedSpy }) } }));
vi.mock("../ai/router", () => ({ route: () => ({ provider: "openai", model: "text-embedding-3-large" }) }));

import { embedTexts, lireEtatEmbeddings, _reinitialiserEtatEmbeddings } from "./embed";

function erreurQuota() {
  const e: any = new Error("429 You exceeded your current quota sk-SECRET-KEY-123");
  e.status = 429;
  e.code = "credit_balance_exhausted";
  e.type = "insufficient_quota";
  return e;
}

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));
  _reinitialiserEtatEmbeddings();
  embedSpy.mockReset();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  errSpy.mockRestore();
});

describe("embedTexts — observabilité des échecs", () => {
  it("429 credit_balance_exhausted : null, raison journalisée, état mis à jour, aucun secret", async () => {
    embedSpy.mockRejectedValue(erreurQuota());
    const r = await embedTexts(["texte confidentiel du client"]);
    expect(r).toBeNull();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith("[embed] échec :", "credit_balance_exhausted");
    const logs = JSON.stringify(errSpy.mock.calls);
    expect(logs).not.toContain("sk-SECRET");
    expect(logs).not.toContain("confidentiel");
    expect(lireEtatEmbeddings().dernierEchec?.raison).toBe("credit_balance_exhausted");
    expect(lireEtatEmbeddings().dernierSucces).toBeUndefined();
  });

  it("throttle : une seule ligne par raison et par minute, puis de nouveau après", async () => {
    embedSpy.mockRejectedValue(erreurQuota());
    await embedTexts(["a"]);
    await embedTexts(["b"]);
    await embedTexts(["c"]);
    expect(errSpy).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-06T10:01:01Z"));
    await embedTexts(["d"]);
    expect(errSpy).toHaveBeenCalledTimes(2);
  });

  it("une raison différente est journalisée tout de suite", async () => {
    embedSpy.mockRejectedValueOnce(erreurQuota());
    embedSpy.mockRejectedValueOnce(Object.assign(new Error("x"), { status: 500 }));
    await embedTexts(["a"]);
    await embedTexts(["b"]);
    expect(errSpy).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenLastCalledWith("[embed] échec :", "http_500");
  });

  it("timeout → « timeout »", async () => {
    embedSpy.mockImplementation(() => new Promise(() => {}));
    const p = embedTexts(["a"], 100);
    await vi.advanceTimersByTimeAsync(150);
    expect(await p).toBeNull();
    expect(errSpy).toHaveBeenCalledWith("[embed] échec :", "timeout");
  });

  it("succès : vecteurs renvoyés, dernierSucces renseigné", async () => {
    embedSpy.mockResolvedValue({ vectors: [[1, 2]], model: "m", provider: "openai" });
    expect(await embedTexts(["a"])).toEqual([[1, 2]]);
    expect(lireEtatEmbeddings().dernierSucces).toBeInstanceOf(Date);
    expect(errSpy).not.toHaveBeenCalled();
  });
});
