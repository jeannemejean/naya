import { describe, it, expect } from "vitest";
import { zoneForCity, villesPourTest } from "./prospection-target-cities";
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

  it("Portland (OR) et Portland (ME) sont deux fuseaux distincts, jamais fusionnes", () => {
    // Bug trouve en revue : "portland" resolu en dur vers America/Los_Angeles
    // fusionnait Portland (Oregon, Pacifique) et Portland (Maine, Est). La
    // ville seule, sans Etat, ne doit RIEN deviner.
    expect(zoneForCity("US", "Portland")).toBeNull();
    expect(zoneForCity("US", "Portland, OR")).toBe("America/Los_Angeles");
    expect(zoneForCity("US", "Portland, Oregon")).toBe("America/Los_Angeles");
    expect(zoneForCity("US", "Portland, ME")).toBe("America/New_York");
    expect(zoneForCity("US", "Portland, Maine")).toBe("America/New_York");
  });

  it("Washington (DC) et Washington (Indiana) sont deux fuseaux distincts, jamais fusionnes", () => {
    expect(zoneForCity("US", "Washington")).toBeNull();
    expect(zoneForCity("US", "Washington, DC")).toBe("America/New_York");
    expect(zoneForCity("US", "Washington, District of Columbia")).toBe("America/New_York");
    expect(zoneForCity("US", "Washington, IN")).toBe("America/Chicago");
    expect(zoneForCity("US", "Washington, Indiana")).toBe("America/Chicago");
  });

  it("detecte automatiquement toute ville ambigue de la table et verifie sa desambiguation", () => {
    // Le test qui manquait : parcourt TOUTE la table (pas seulement Portland
    // et Washington a la main) et, pour chaque ville declaree comme ambigue
    // (un Record<etat, fuseau> plutot qu'un string), verifie que la forme
    // sans Etat rend null et que chaque forme "ville, Etat" rend le bon
    // fuseau. Toute future ville ambigue ajoutee a la table est couverte
    // automatiquement, sans test a ecrire a la main.
    let auMoinsUneVilleAmbigueTestee = false;
    for (const [cc, table] of Object.entries(villesPourTest())) {
      for (const [ville, entree] of Object.entries(table)) {
        if (typeof entree === "string") continue; // non ambigu, rien a verifier ici
        auMoinsUneVilleAmbigueTestee = true;

        expect(zoneForCity(cc, ville), `${cc}/"${ville}" sans Etat doit etre null`).toBeNull();

        for (const [etat, fuseauAttendu] of Object.entries(entree)) {
          expect(
            zoneForCity(cc, `${ville}, ${etat}`),
            `${cc}/"${ville}, ${etat}" doit resoudre ${fuseauAttendu}`,
          ).toBe(fuseauAttendu);
        }
      }
    }
    // Garde-fou du garde-fou : si plus aucune entree ambigue n'existe dans la
    // table, ce test ne verifierait plus rien silencieusement.
    expect(auMoinsUneVilleAmbigueTestee).toBe(true);
  });
});
