import { describe, it, expect } from "vitest";
import { publicIdFromUrl, interpretConnectionResponse } from "./linkedin";

describe("publicIdFromUrl", () => {
  it("extrait l'identifiant d'une URL standard", () => {
    expect(publicIdFromUrl("https://www.linkedin.com/in/solene-jaboulet-7799b9/")).toBe("solene-jaboulet-7799b9");
  });
  it("gère les sous-domaines régionaux et l'absence de slash final", () => {
    expect(publicIdFromUrl("https://fr.linkedin.com/in/jeanne-mejean")).toBe("jeanne-mejean");
  });
  it("ignore la query string et le fragment", () => {
    expect(publicIdFromUrl("https://linkedin.com/in/john-doe?utm=x#about")).toBe("john-doe");
  });
  it("décode les caractères encodés", () => {
    expect(publicIdFromUrl("https://www.linkedin.com/in/jos%C3%A9-garcia")).toBe("josé-garcia");
  });
  it("renvoie null si pas une URL de profil ou vide", () => {
    expect(publicIdFromUrl("https://linkedin.com/company/acme")).toBeNull();
    expect(publicIdFromUrl(null)).toBeNull();
    expect(publicIdFromUrl("")).toBeNull();
  });
});

describe("interpretConnectionResponse", () => {
  it("renvoie true quand network_distance vaut FIRST_DEGREE", () => {
    expect(interpretConnectionResponse({ network_distance: "FIRST_DEGREE" })).toBe(true);
  });
  it("renvoie true quand is_relationship vaut true", () => {
    expect(interpretConnectionResponse({ is_relationship: true })).toBe(true);
  });
  it("renvoie false pour un 2e/3e degré explicite", () => {
    expect(interpretConnectionResponse({ network_distance: "SECOND_DEGREE" })).toBe(false);
    expect(interpretConnectionResponse({ network_distance: "THIRD_DEGREE", is_relationship: false })).toBe(false);
  });
  it("renvoie false sur une forme de réponse inconnue (fail closed)", () => {
    expect(interpretConnectionResponse({})).toBe(false);
    expect(interpretConnectionResponse(null)).toBe(false);
    expect(interpretConnectionResponse(undefined)).toBe(false);
    expect(interpretConnectionResponse({ some_other_field: "x" })).toBe(false);
  });
});
