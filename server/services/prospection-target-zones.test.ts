import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { zonesForCountry, knownCountryCodes } from "./prospection-target-zones";

/**
 * Source IANA faisant autorité, présente sur cette machine et sur le runner
 * CI (ubuntu-latest). Si absente, on laisse `readFileSync` lever — le test
 * doit ÉCHOUER, pas être ignoré : un contrôle qu'on saute en silence n'existe
 * pas.
 */
function fuseauxAutoritairesParPays(): Map<string, Set<string>> {
  const raw = readFileSync("/usr/share/zoneinfo/zone.tab", "utf8");
  const map = new Map<string, Set<string>>();
  for (const ligne of raw.split("\n")) {
    if (!ligne || ligne.startsWith("#")) continue;
    const colonnes = ligne.split("\t");
    if (colonnes.length < 3) continue;
    const [pays, , fuseau] = colonnes;
    if (!map.has(pays)) map.set(pays, new Set());
    map.get(pays)!.add(fuseau);
  }
  return map;
}

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

  it("rend null pour une entree composee uniquement d'espaces", () => {
    expect(zonesForCountry("   ")).toBeNull();
  });

  it("ne declare que des fuseaux IANA valides", () => {
    const tous = ["FR", "US", "CA", "ES", "AU", "BR", "RU", "IN", "HK"]
      .flatMap((cc) => zonesForCountry(cc) ?? []);
    for (const z of tous) {
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: z }), `fuseau invalide : ${z}`)
        .not.toThrow();
    }
  });

  it("est exhaustive pour chaque pays declare, compare a zone.tab (source IANA)", () => {
    // Un pays PRESENT mais incomplet est pire qu'un pays absent : il produit une
    // fenetre d'heures ouvrees silencieusement fausse au lieu d'un refus sûr.
    // Ce test derive la verite de zone.tab plutot que de se fier a une relecture
    // manuelle -- c'est cette derniere qui a produit des tables incompletes pour
    // le Bresil et le Mexique par le passe.
    const autoritaire = fuseauxAutoritairesParPays();
    for (const pays of knownCountryCodes()) {
      const declares = new Set(zonesForCountry(pays) ?? []);
      const reference = autoritaire.get(pays);
      expect(reference, `pays absent de zone.tab : ${pays}`).toBeDefined();
      const manquants = [...reference!].filter((z) => !declares.has(z));
      expect(manquants, `fuseaux manquants pour ${pays} (vs zone.tab)`).toEqual([]);
    }
  });
});
