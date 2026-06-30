import { describe, it, expect } from "vitest";
import { throwIfResNotOk, is401 } from "./queryClient";
import { isUnauthorizedError } from "./authUtils";

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
