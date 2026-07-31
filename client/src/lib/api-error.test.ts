import { describe, it, expect } from "vitest";
import { ApiError, translateError, normalizeErrorCode } from "./api-error";

/** Faux `t` : renvoie ce qu'il a reçu, pour observer la clé ET les paramètres. */
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}|${JSON.stringify(params)}` : key;

describe("normalizeErrorCode", () => {
  it("accepte un code connu", () => {
    expect(normalizeErrorCode("invalid_credentials")).toBe("invalid_credentials");
  });

  it("rejette un code inconnu ou mal typé", () => {
    expect(normalizeErrorCode("boom")).toBeNull();
    expect(normalizeErrorCode(undefined)).toBeNull();
    expect(normalizeErrorCode(12)).toBeNull();
  });
});

describe("translateError", () => {
  it("traduit le code porté par une ApiError", () => {
    expect(translateError(t, new ApiError("invalid_credentials"), "login_failed")).toBe(
      "errors.invalid_credentials",
    );
  });

  it("transmet les paramètres de l'erreur à la traduction", () => {
    expect(
      translateError(t, new ApiError("social_account_not_connected", { platform: "linkedin" }), "content_publish_failed"),
    ).toBe('errors.social_account_not_connected|{"platform":"linkedin"}');
  });

  it("retombe sur le code de repli pour une erreur quelconque", () => {
    expect(translateError(t, new Error("réseau coupé"), "login_failed")).toBe("errors.login_failed");
    expect(translateError(t, null, "register_failed")).toBe("errors.register_failed");
  });
});
