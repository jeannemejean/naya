import { describe, it, expect } from "vitest";
import { consignePerimetre, exemplesTitres, consignesGenerateur } from "./consignes-generateur";
import { ecritDansUneAutreLangue, languageDirective } from "@shared/language";
import { raisonExclusionGenerateur } from "./filtre-taches-generees";

const titresExemples = (texte: string) =>
  Array.from(texte.matchAll(/[✅❌] "([^"]+)"/g)).map((m) => m[1]);

describe("consignes des générateurs génériques", () => {
  it("les exemples de titres d'un compte français sont en français", () => {
    const titres = titresExemples(exemplesTitres("fr"));
    expect(titres.length).toBeGreaterThanOrEqual(5);
    for (const t of titres) expect(ecritDansUneAutreLangue(t, "fr"), t).toBe(false);
  });

  it("les exemples de titres d'un compte anglais sont en anglais", () => {
    const titres = titresExemples(exemplesTitres("en"));
    for (const t of titres) expect(ecritDansUneAutreLangue(t, "en"), t).toBe(false);
  });

  it("aucun exemple positif n'est une tâche de contenu ou de prospection", () => {
    for (const langue of ["fr", "en"] as const) {
      const positifs = Array.from(exemplesTitres(langue).matchAll(/✅ "([^"]+)"/g)).map((m) => m[1]);
      for (const t of positifs) expect(raisonExclusionGenerateur({ title: t }), t).toBeNull();
    }
  });

  it("le périmètre renvoie contenu et prospection au calendrier et au pipeline", () => {
    expect(consignePerimetre("fr")).toMatch(/calendrier éditorial/);
    expect(consignePerimetre("fr")).toMatch(/pipeline de prospection/);
    expect(consignePerimetre("en")).toMatch(/content calendar/);
    expect(consignePerimetre("en")).toMatch(/prospecting pipeline/);
  });

  it("le bloc final porte la consigne de langue du compte", () => {
    expect(consignesGenerateur("fr")).toContain(languageDirective("fr"));
    expect(consignesGenerateur("en")).toContain(languageDirective("en"));
  });
});
