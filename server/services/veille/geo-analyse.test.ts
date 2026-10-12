import { describe, it, expect } from "vitest";
import { analyserReponse, comparerGeo, sourcesATravailler, bilanGeo } from "./geo-analyse";

const marque = { nom: "Lune Studio", variantes: ["Lune"], domaine: "lune-studio.fr" };
const concurrents = [{ nom: "Soleil & Co", variantes: [], domaine: "soleil.fr" }, { nom: "Étoile", variantes: [], domaine: null }];

describe("analyserReponse", () => {
  it("repère la marque, sa position et les concurrents cités", () => {
    const a = analyserReponse(
      { texte: "Pour des bougies, Etoile est connue, mais Lune Studio fait mieux. Soleil & Co aussi.", citations: ["https://www.soleil.fr/x", "https://reddit.com/r/bougies"] },
      marque, concurrents,
    );
    expect(a.citee).toBe(true);
    expect(a.position).toBe(2);
    expect(a.concurrentsCites).toEqual(["Étoile", "Soleil & Co"]);
    expect(a.sources).toEqual(["soleil.fr", "reddit.com"]);
  });

  it("une marque présente seulement dans les sources compte comme citée", () => {
    const a = analyserReponse({ texte: "Voici trois ateliers.", citations: ["https://lune-studio.fr/a"] }, marque, concurrents);
    expect(a.citee).toBe(true);
    expect(a.citeeDansSources).toBe(true);
    expect(a.position).toBeNull();
  });

  it("ne confond pas un mot qui contient le nom", () => {
    const a = analyserReponse({ texte: "Prenez des lunettes de soleil.", citations: [] }, marque, concurrents);
    expect(a.citee).toBe(false);
    expect(a.concurrentsCites).toEqual([]);
  });
});

describe("comparerGeo", () => {
  const base = { citee: false, citeeDansSources: false, position: null, concurrentsCites: ["Étoile"], sources: [] };
  it("premier relevé : aucun changement signalé", () => {
    expect(comparerGeo(null, base, "Quelle bougie ?", "openai")).toEqual([]);
  });
  it("signale une marque nouvellement citée, ou qui ne l'est plus", () => {
    const gagne = comparerGeo(base, { ...base, citee: true, position: 1 }, "Quelle bougie ?", "openai");
    expect(gagne).toHaveLength(1);
    expect(gagne[0].texte).toMatch(/Quelle bougie/);
    const perd = comparerGeo({ ...base, citee: true }, base, "Quelle bougie ?", "perplexity");
    expect(perd).toHaveLength(1);
  });
  it("signale un concurrent qui apparaît", () => {
    const c = comparerGeo(base, { ...base, concurrentsCites: ["Étoile", "Soleil & Co"] }, "Q", "openai");
    expect(c).toHaveLength(1);
    expect(c[0].texte).toContain("Soleil & Co");
  });
});

describe("sources et bilan", () => {
  const analyses = [
    { citee: false, citeeDansSources: false, position: null, concurrentsCites: ["Étoile"], sources: ["reddit.com", "elle.fr"] },
    { citee: false, citeeDansSources: false, position: null, concurrentsCites: ["Soleil & Co"], sources: ["elle.fr"] },
    { citee: true, citeeDansSources: false, position: 1, concurrentsCites: ["Étoile"], sources: ["marie-claire.fr"] },
    { citee: false, citeeDansSources: false, position: null, concurrentsCites: [], sources: ["wikipedia.org"] },
  ];
  it("les sources à travailler sont celles des réponses où un concurrent est cité sans la marque", () => {
    expect(sourcesATravailler(analyses)).toEqual([{ domaine: "elle.fr", n: 2 }, { domaine: "reddit.com", n: 1 }]);
  });
  it("le bilan compte les réponses qui citent la marque", () => {
    expect(bilanGeo(analyses)).toEqual({ citees: 1, total: 4 });
  });
});
