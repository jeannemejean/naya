import { describe, it, expect } from "vitest";
import { zonesForCountry } from "./prospection-target-zones";

describe("zonesForCountry", () => {
  it("rend un fuseau unique pour un pays mono-fuseau", () => {
    expect(zonesForCountry("FR")).toEqual(["Europe/Paris"]);
  });

  it("rend tous les fuseaux d'un pays multi-fuseaux", () => {
    const us = zonesForCountry("US");
    expect(us).toContain("America/New_York");
    expect(us).toContain("America/Los_Angeles");
    expect(us!.length).toBeGreaterThan(2);
  });

  it("couvre les pays reellement presents dans la base", () => {
    for (const cc of ["FR", "EG", "US", "IN", "GB", "ES", "AE", "HK", "KW", "CA", "MG"]) {
      expect(zonesForCountry(cc), `pays manquant : ${cc}`).not.toBeNull();
    }
  });

  it("accepte un code en minuscules", () => {
    expect(zonesForCountry("fr")).toEqual(["Europe/Paris"]);
  });

  it("rend null pour un pays inconnu, jamais un tableau vide", () => {
    expect(zonesForCountry("ZZ")).toBeNull();
    expect(zonesForCountry("")).toBeNull();
  });

  it("ne declare que des fuseaux IANA valides", () => {
    const tous = ["FR", "US", "CA", "ES", "AU", "BR", "RU", "IN", "HK"]
      .flatMap((cc) => zonesForCountry(cc) ?? []);
    for (const z of tous) {
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: z }), `fuseau invalide : ${z}`)
        .not.toThrow();
    }
  });
});
