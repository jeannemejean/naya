import { describe, it, expect } from "vitest";
import { zoneForCity } from "./prospection-target-cities";
import { zonesForCountry } from "./prospection-target-zones";

describe("zoneForCity", () => {
  it("resout une grande ville americaine vers son fuseau", () => {
    expect(zoneForCity("US", "New York")).toBe("America/New_York");
    expect(zoneForCity("US", "Los Angeles")).toBe("America/Los_Angeles");
    expect(zoneForCity("US", "Chicago")).toBe("America/Chicago");
  });

  it("resout une grande ville canadienne", () => {
    expect(zoneForCity("CA", "Toronto")).toBe("America/Toronto");
    expect(zoneForCity("CA", "Vancouver")).toBe("America/Vancouver");
  });

  it("tolere la casse et les espaces", () => {
    expect(zoneForCity("us", "  new york  ")).toBe("America/New_York");
  });

  it("tolere le suffixe d'etat frequent dans les profils LinkedIn", () => {
    // Bright Data rend souvent « New York, NY » ou « San Francisco, California ».
    expect(zoneForCity("US", "New York, NY")).toBe("America/New_York");
    expect(zoneForCity("US", "San Francisco, California")).toBe("America/Los_Angeles");
  });

  it("rend null pour une ville inconnue, jamais un fuseau devine", () => {
    expect(zoneForCity("US", "Ville Imaginaire")).toBeNull();
  });

  it("rend null quand la ville est absente", () => {
    expect(zoneForCity("US", null)).toBeNull();
    expect(zoneForCity("US", "")).toBeNull();
    expect(zoneForCity("US", "   ")).toBeNull();
  });

  it("rend null pour un pays inconnu", () => {
    expect(zoneForCity("ZZ", "New York")).toBeNull();
  });

  it("ne declare que des fuseaux appartenant reellement au pays", () => {
    // Garde-fou : une ville ne doit jamais pointer vers un fuseau d'un autre pays.
    for (const cc of ["US", "CA"]) {
      const duPays = new Set(zonesForCountry(cc) ?? []);
      for (const ville of ["New York", "Los Angeles", "Chicago", "Toronto", "Vancouver"]) {
        const z = zoneForCity(cc, ville);
        if (z) expect(duPays.has(z), `${ville} -> ${z} absent de ${cc}`).toBe(true);
      }
    }
  });
});
