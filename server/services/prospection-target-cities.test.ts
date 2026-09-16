import { describe, it, expect } from "vitest";
import { zoneForCity, villesPourTest } from "./prospection-target-cities";
import { zonesForCountry } from "./prospection-target-zones";

describe("zoneForCity", () => {
  it("resout une grande ville americaine vers son fuseau quand l'Etat est fourni", () => {
    expect(zoneForCity("US", "New York, NY")).toBe("America/New_York");
    expect(zoneForCity("US", "Los Angeles, CA")).toBe("America/Los_Angeles");
    expect(zoneForCity("US", "Chicago, IL")).toBe("America/Chicago");
  });

  it("resout une grande ville canadienne quand la province est fournie", () => {
    expect(zoneForCity("CA", "Toronto, ON")).toBe("America/Toronto");
    expect(zoneForCity("CA", "Vancouver, BC")).toBe("America/Vancouver");
  });

  it("tolere la casse et les espaces, y compris autour de la virgule", () => {
    expect(zoneForCity("us", "  new york, ny  ")).toBe("America/New_York");
    expect(zoneForCity("us", "New York ,  NY")).toBe("America/New_York");
  });

  it("tolere le suffixe d'etat frequent dans les profils LinkedIn, code 2 lettres ou nom complet", () => {
    // Bright Data rend souvent « New York, NY » ou « San Francisco, California ».
    expect(zoneForCity("US", "New York, NY")).toBe("America/New_York");
    expect(zoneForCity("US", "San Francisco, California")).toBe("America/Los_Angeles");
  });

  it("rend null pour une ville inconnue, jamais un fuseau devine", () => {
    expect(zoneForCity("US", "Ville Imaginaire, NY")).toBeNull();
  });

  it("rend null quand la ville est absente", () => {
    expect(zoneForCity("US", null)).toBeNull();
    expect(zoneForCity("US", "")).toBeNull();
    expect(zoneForCity("US", "   ")).toBeNull();
  });

  it("rend null pour un pays inconnu", () => {
    expect(zoneForCity("ZZ", "New York, NY")).toBeNull();
  });

  it("rend null pour une ville sans Etat, MEME quand elle semble non ambigue — le discriminant est desormais obligatoire pour toute entree", () => {
    // Le defaut de la ronde 2 : une ville "non ambigue en apparence" (New York,
    // Chicago, Toronto) a presque toujours un homonyme dans un autre Etat, dans
    // un autre fuseau. La table ne resout donc plus JAMAIS une ville seule,
    // meme pour les plus grandes villes.
    expect(zoneForCity("US", "New York")).toBeNull();
    expect(zoneForCity("US", "Los Angeles")).toBeNull();
    expect(zoneForCity("US", "Chicago")).toBeNull();
    expect(zoneForCity("CA", "Toronto")).toBeNull();
    expect(zoneForCity("CA", "Vancouver")).toBeNull();
  });

  it("ne resout plus les 6 collisions d'homonymes trouvees en ronde 2 (Etat non declare => null, jamais le mauvais fuseau)", () => {
    // Chacune de ces six lignes rendait un fuseau errone avant la ronde 2 (la
    // ville etait traitee comme non ambigue, l'Etat ignore). Aucune de ces
    // combinaisons ville/Etat n'est declaree dans la table : le repli est null,
    // jamais une devinette.
    expect(zoneForCity("US", "Las Vegas, New Mexico")).toBeNull(); // reel : America/Denver
    expect(zoneForCity("US", "Miami, Oklahoma")).toBeNull(); // reel : America/Chicago
    expect(zoneForCity("US", "Denver, NC")).toBeNull(); // reel : America/New_York
    expect(zoneForCity("US", "Philadelphia, MS")).toBeNull(); // reel : America/Chicago
    expect(zoneForCity("US", "Dallas, OR")).toBeNull(); // reel : America/Los_Angeles
    expect(zoneForCity("US", "Nashville, IN")).toBeNull(); // reel : America/New_York
  });

  it("Portland (OR) et Portland (ME) sont deux fuseaux distincts, jamais fusionnes", () => {
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

  it("ne declare que des fuseaux appartenant reellement au pays, pour TOUTE entree ville/Etat de la table", () => {
    // Garde-fou : parcourt la table entiere (pas un echantillon fixe) — aucun
    // fuseau declare ne doit appartenir a un autre pays que celui sous lequel
    // il est liste.
    for (const [cc, villes] of Object.entries(villesPourTest())) {
      const duPays = new Set(zonesForCountry(cc) ?? []);
      for (const [ville, etats] of Object.entries(villes)) {
        for (const [etat, zone] of Object.entries(etats)) {
          expect(duPays.has(zone), `${cc}/"${ville}, ${etat}" -> ${zone} absent de ${cc}`).toBe(true);
        }
      }
    }
  });

  it("aucune entree de la table n'est resoluble sans discriminant d'Etat — propriete structurelle, pas un cas par cas", () => {
    // Le test qui manquait, generalise a TOUTE la table (pas seulement aux
    // homonymes deja reperes comme Portland ou Washington). Il rend la classe
    // de bug (collision d'homonyme inconnu) impossible plutot que de la
    // chasser ville par ville : pour chaque ville declaree, la forme SANS
    // Etat doit rendre null, et chaque forme AVEC Etat doit rendre le bon
    // fuseau. Une future entree ajoutee en `string` plutot qu'en
    // `Record<Etat, fuseau>` serait detectee ici (voir la preuve par mutation
    // dans le rapport de tache).
    let auMoinsUneEntreeTestee = false;
    for (const [cc, villes] of Object.entries(villesPourTest())) {
      for (const [ville, etats] of Object.entries(villes)) {
        auMoinsUneEntreeTestee = true;

        expect(zoneForCity(cc, ville), `${cc}/"${ville}" sans Etat doit etre null`).toBeNull();

        for (const [etat, fuseauAttendu] of Object.entries(etats)) {
          expect(
            zoneForCity(cc, `${ville}, ${etat}`),
            `${cc}/"${ville}, ${etat}" doit resoudre ${fuseauAttendu}`,
          ).toBe(fuseauAttendu);
        }
      }
    }
    // Garde-fou du garde-fou : si la table venait a se vider, ce test ne
    // verifierait plus rien silencieusement.
    expect(auMoinsUneEntreeTestee).toBe(true);
  });
});
