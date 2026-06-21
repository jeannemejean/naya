import { describe, it, expect } from "vitest";
import { publicIdFromUrl } from "./linkedin";

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
