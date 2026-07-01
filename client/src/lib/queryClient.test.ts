import { describe, it, expect, vi, afterEach } from "vitest";
import { throwIfResNotOk, is401, apiRequest } from "./queryClient";
import { isUnauthorizedError } from "./authUtils";

describe("apiRequest — timeout optionnel (génération de campagne)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("abandonne (AbortError) après timeoutMs sur une requête qui traîne", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) =>
      new Promise((_res, rej) => {
        init.signal?.addEventListener("abort", () =>
          rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }));
    await expect(apiRequest("POST", "/slow", {}, { timeoutMs: 30 })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("sans timeout : ne pose pas de signal, la requête aboutit (rétro-compatible)", async () => {
    let sawSignal = false;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sawSignal = !!init.signal;
      return { ok: true, status: 200, text: async () => "{}" } as unknown as Response;
    });
    const res = await apiRequest("GET", "/x");
    expect(res).toBeTruthy();
    expect(sawSignal).toBe(false);
  });
});

function mockRes(status: number, body: string, ok: boolean, statusText = ""): Response {
  return { ok, status, statusText, text: async () => body } as unknown as Response;
}

describe("Exclusion 401 cohérente (throwIfResNotOk + is401)", () => {
  it("401 → erreur reconnue par is401 ET isUnauthorizedError (donc exclue de l'ErrorBoundary + redirige)", async () => {
    let err: unknown;
    try { await throwIfResNotOk(mockRes(401, '{"message":"Unauthorized"}', false)); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
    // throwOnError utilise is401 → false serait remonté à la boundary ; ici true → EXCLU.
    expect(is401(err)).toBe(true);
    // le redirect login utilise isUnauthorizedError → true.
    expect(isUnauthorizedError(err as Error)).toBe(true);
  });

  it("500 → NON reconnu comme 401 → ira à l'ErrorBoundary (écran d'erreur)", async () => {
    let err: unknown;
    try { await throwIfResNotOk(mockRes(500, "Internal error", false)); } catch (e) { err = e; }
    expect(is401(err)).toBe(false);
  });

  it("réponse 200 mais malformée → erreur non-401 → ErrorBoundary (pas un crash silencieux)", () => {
    // C'est le throw que fait la queryFn analytics quand json.tasks n'est pas un objet.
    const malformed = new Error("Réponse /analytics malformée");
    expect(is401(malformed)).toBe(false);
  });

  it("réponse OK → ne throw pas", async () => {
    await expect(throwIfResNotOk(mockRes(200, "ok", true))).resolves.toBeUndefined();
  });
});
