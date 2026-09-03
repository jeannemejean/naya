import { describe, it, expect } from "vitest";
import { validateGeneratedIntent } from "./validate-generated-intent";

describe("validateGeneratedIntent", () => {
  it("accepte exactement les trois valeurs attendues", () => {
    expect(validateGeneratedIntent("awareness")).toBe("awareness");
    expect(validateGeneratedIntent("consideration")).toBe("consideration");
    expect(validateGeneratedIntent("conversion")).toBe("conversion");
  });

  it("renvoie null pour une quatrième valeur inventée", () => {
    expect(validateGeneratedIntent("engagement")).toBeNull();
    expect(validateGeneratedIntent("retention")).toBeNull();
  });

  it("renvoie null pour une variante de casse — jamais de correction silencieuse", () => {
    expect(validateGeneratedIntent("Awareness")).toBeNull();
    expect(validateGeneratedIntent("AWARENESS")).toBeNull();
    expect(validateGeneratedIntent("Consideration")).toBeNull();
  });

  it("renvoie null pour une chaîne vide ou blanche", () => {
    expect(validateGeneratedIntent("")).toBeNull();
    expect(validateGeneratedIntent("   ")).toBeNull();
  });

  it("renvoie null pour un champ manquant, null, ou un type inattendu", () => {
    expect(validateGeneratedIntent(undefined)).toBeNull();
    expect(validateGeneratedIntent(null)).toBeNull();
    expect(validateGeneratedIntent(42)).toBeNull();
    expect(validateGeneratedIntent({})).toBeNull();
    expect(validateGeneratedIntent(["awareness"])).toBeNull();
  });

  it("ne devine jamais et ne tronque jamais une valeur approximative", () => {
    expect(validateGeneratedIntent("awareness ")).toBeNull(); // espace parasite non trimé implicitement
    expect(validateGeneratedIntent("awareness, consideration")).toBeNull();
  });
});
