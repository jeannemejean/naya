import { describe, it, expect } from "vitest";
import { etage1, FRAICHEUR_JOURS } from "./triage";
import { hashUrl, canonicalizeUrl } from "./url";

const TODAY = new Date("2026-10-01T06:00:00Z");
const ilYA = (jours: number) => new Date(TODAY.getTime() - jours * 24 * 3600 * 1000);
const brut = (o: Partial<Parameters<typeof etage1>[0][number]> = {}) => ({
  url: "https://media.fr/article-a",
  title: "Le packaging durable change de régime",
  source: "Média",
  publishedAt: ilYA(1),
  projectId: 1,
  ...o,
});

describe("etage1 — le tri déterministe, avant tout appel modèle", () => {
  it("laisse passer un article frais et inconnu", () => {
    const out = etage1([brut()], { today: TODAY, urlHashDejaVus: new Set() });
    expect(out).toHaveLength(1);
    expect(out[0].urlHash).toBe(hashUrl(canonicalizeUrl("https://media.fr/article-a")!));
  });

  it(`écarte ce qui est plus vieux que ${FRAICHEUR_JOURS} jours`, () => {
    const out = etage1([brut({ publishedAt: ilYA(FRAICHEUR_JOURS + 1) })], { today: TODAY, urlHashDejaVus: new Set() });
    expect(out).toEqual([]);
  });

  it("écarte un candidat SANS date : une date inconnue n'est pas une date fraîche", () => {
    const out = etage1([brut({ publishedAt: null })], { today: TODAY, urlHashDejaVus: new Set() });
    expect(out).toEqual([]);
  });

  it("écarte une URL déjà vue, même sous une forme avec paramètres de suivi", () => {
    const dejaVus = new Set([hashUrl(canonicalizeUrl("https://media.fr/article-a")!)]);
    const out = etage1([brut({ url: "https://media.fr/article-a?utm_source=x" })], { today: TODAY, urlHashDejaVus: dejaVus });
    expect(out).toEqual([]);
  });

  it("écarte les domaines exclus", () => {
    const out = etage1([brut({ url: "https://news.google.com/articles/xyz" })], { today: TODAY, urlHashDejaVus: new Set() });
    expect(out).toEqual([]);
  });

  it("dédoublonne par titre normalisé, même quand les URLs diffèrent", () => {
    const out = etage1(
      [
        brut({ url: "https://media-a.fr/x", title: "Le packaging durable change de régime" }),
        brut({ url: "https://media-b.fr/y", title: "LE PACKAGING DURABLE CHANGE DE RÉGIME !" }),
      ],
      { today: TODAY, urlHashDejaVus: new Set() },
    );
    expect(out).toHaveLength(1);
    expect(out[0].url).toContain("media-a.fr");  // le premier arrivé gagne
  });

  it("dédoublonne deux URLs identiques au suivi près à l'intérieur du même lot", () => {
    const out = etage1(
      [brut({ url: "https://media.fr/x?utm_source=a" }), brut({ url: "https://media.fr/x?utm_source=b" })],
      { today: TODAY, urlHashDejaVus: new Set() },
    );
    expect(out).toHaveLength(1);
  });

  it("écarte une URL inexploitable sans jeter", () => {
    expect(etage1([brut({ url: "pas une url" })], { today: TODAY, urlHashDejaVus: new Set() })).toEqual([]);
  });

  it("ne fait aucun appel réseau ni modèle : la fonction est pure et synchrone", () => {
    expect(etage1([], { today: TODAY, urlHashDejaVus: new Set() })).toEqual([]);
  });
});
