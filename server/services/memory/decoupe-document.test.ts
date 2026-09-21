import { describe, it, expect } from "vitest";
import { decouperDocument, TAILLE_MAX_MORCEAU, TAILLE_MIN_MORCEAU } from "./decoupe-document";

/**
 * Découpage d'un dossier de recherche en morceaux retrouvables.
 *
 * Demande de Jeanne (18 septembre 2026) : « je vais lui envoyer des dossiers de recherches et
 * ça lui permettrait d'être plus pointue sur sa création de contenu et moins générique », et
 * « un endroit où je pourrais renseigner des dossiers qui permettraient à Naya de mieux
 * comprendre à quoi ressemble une bonne prospection ».
 *
 * Un dossier fait plusieurs pages. Un embedding porte sur un texte court : il faut donc
 * découper. Tout le risque est là — un découpage qui perd du texte fait disparaître
 * silencieusement ce que Jeanne a pris la peine de rassembler.
 */
describe("decouperDocument", () => {
  it("un texte court reste d'un seul morceau", () => {
    const t = "Les posts qui ouvrent sur une tension obtiennent 3x plus de commentaires.";

    expect(decouperDocument(t)).toEqual([t]);
  });

  it("AUCUN texte ne se perd, quelle que soit la découpe", () => {
    // L'INVARIANT. Recoller les morceaux doit redonner le document, aux espaces près.
    // Un découpage qui perd une phrase fait disparaître sans bruit ce que Jeanne a rassemblé,
    // et personne ne s'en apercevrait jamais.
    const paragraphes = Array.from(
      { length: 40 },
      (_, i) => `Paragraphe ${i} : une observation sur ce qui fonctionne en digital, avec un détail précis.`,
    );
    const doc = paragraphes.join("\n\n");

    const morceaux = decouperDocument(doc);
    const recolle = morceaux.join(" ").replace(/\s+/g, " ").trim();
    const attendu = doc.replace(/\s+/g, " ").trim();

    expect(recolle).toBe(attendu);
  });

  it("aucun morceau ne dépasse la taille maximale", () => {
    const doc = Array.from({ length: 60 }, (_, i) => `Phrase numéro ${i} avec du contenu.`).join("\n\n");

    for (const m of decouperDocument(doc)) {
      expect(m.length, `morceau de ${m.length} caractères`).toBeLessThanOrEqual(TAILLE_MAX_MORCEAU);
    }
  });

  it("ne coupe pas au milieu d'un paragraphe quand il peut tenir entier", () => {
    // Bug visé : découper tous les N caractères, en tranchant une phrase en deux. Chaque
    // moitié devient alors inexploitable — l'embedding porte sur un fragment sans sens.
    const p1 = "A".repeat(200);
    const p2 = "B".repeat(200);

    const morceaux = decouperDocument(`${p1}\n\n${p2}`, { tailleMax: 250 });

    expect(morceaux).toEqual([p1, p2]);
  });

  it("regroupe les paragraphes courts au lieu d'en faire des miettes", () => {
    // Bug visé : un morceau par ligne. « Titre », « Introduction », « 1. » deviendraient des
    // entrées de mémoire sans contenu, qui pollueraient toutes les recherches.
    const doc = ["Titre", "Sous-titre", "Une phrase.", "Une autre."].join("\n\n");

    const morceaux = decouperDocument(doc);

    expect(morceaux.length).toBe(1);
  });

  it("découpe un paragraphe trop long pour tenir seul", () => {
    // Un paragraphe de cinq pages doit bien être coupé quelque part : on préfère une coupe
    // sur une frontière de phrase à une coupe au milieu d'un mot.
    const long = Array.from({ length: 80 }, (_, i) => `Phrase ${i} du même paragraphe.`).join(" ");

    const morceaux = decouperDocument(long, { tailleMax: 300 });

    expect(morceaux.length).toBeGreaterThan(1);
    for (const m of morceaux) expect(m.length).toBeLessThanOrEqual(300);

    // AUCUN texte perdu sur CE chemin non plus. L'invariant precedent ne couvrait que la
    // decoupe par paragraphes ; celui-ci couvre la decoupe par phrases, qui est le chemin
    // ou une coupe peut tomber au milieu d'un mot.
    expect(morceaux.join(" ").replace(/\s+/g, " ").trim()).toBe(long.replace(/\s+/g, " ").trim());
  });

  it("ne coupe JAMAIS au milieu d'un mot", () => {
    // Trouve par mutation : mon assertion precedente comparait une chaine nettoyee a
    // elle-meme, donc etait vraie par construction et ne prouvait rien.
    //
    // Ici on prend un mot tres long, impossible a couper sur un espace proche de la limite.
    // Chaque morceau doit rester un decoupage sur des frontieres de mots : recoller avec un
    // espace redonne exactement le texte, ce qu'une coupe en plein mot rendrait faux.
    const mots = Array.from({ length: 40 }, (_, i) => `motnumero${i}tressssssslong`);
    const phrase = mots.join(" ");

    const morceaux = decouperDocument(phrase, { tailleMax: 200 });

    expect(morceaux.join(" ")).toBe(phrase);
    for (const m of morceaux) {
      for (const mot of m.split(" ")) {
        expect(mots, `« ${mot} » n'est pas un mot entier`).toContain(mot);
      }
    }
  });

  it("un document vide ne produit AUCUN morceau", () => {
    // Bug visé : créer une entrée de mémoire vide, qui remonterait dans les recherches sans
    // rien apporter.
    for (const vide of ["", "   ", "\n\n\n", null, undefined]) {
      expect(decouperDocument(vide as string), `« ${String(vide)} »`).toEqual([]);
    }
  });

  it("aucun morceau n'est vide ni ridiculement court", () => {
    const doc = "Un vrai paragraphe.\n\n\n\n   \n\nUn autre vrai paragraphe.";

    for (const m of decouperDocument(doc)) {
      expect(m.trim().length, `« ${m} »`).toBeGreaterThanOrEqual(1);
    }
  });

  it("les seuils sont des constantes exportées", () => {
    expect(TAILLE_MAX_MORCEAU).toBeGreaterThan(TAILLE_MIN_MORCEAU);
    expect(TAILLE_MIN_MORCEAU).toBeGreaterThan(0);
  });
});
